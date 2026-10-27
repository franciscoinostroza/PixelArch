/**
 * GET /pago/paypal/cancelado (T-14, parte B).
 *
 * PayPal vuelve aca cuando el comprador cancela el checkout. El token local
 * viaja como `enlace` (el `token` de PayPal es el order id, no el token del
 * link). Se registra el intento para trazabilidad y el cobro sigue pendiente.
 * Si el order id pertenece al link, se expira solo esa orden para que el
 * proximo acceso a `[token]` cree una nueva. La cancel URL es publica y no
 * firmada: un order id ajeno no registra evento ni toca ningun link.
 *
 * No expone PII, payloads ni tokens en logs. Todas las respuestas llevan
 * no-store, no-referrer y noindex.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { registrarEventoPasarela } from "@/lib/paypal/events"

export const dynamic = "force-dynamic"

const RATE_LIMIT_IP = 30
const RATE_LIMIT_TOKEN = 5
const RATE_LIMIT_WINDOW_MS = 60_000

/** Evento local (no es un webhook de PayPal): intento abandonado/cancelado. */
const EVENTO_CANCELADO = "PAYPAL.CANCELADO"
const MOTIVO_CANCELADO = "CANCELADO_POR_PAGADOR"

const HEADERS_SEGURIDAD: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

type EstadoPublico = "pendiente"

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{1,128}$/

interface EnlaceCancelado {
  id: string
  token: string
  pasarela: string
  externalId: string | null
  total: number
  moneda: string
}

const SELECT_ENLACE = {
  id: true,
  token: true,
  pasarela: true,
  externalId: true,
  total: true,
  moneda: true,
} as const

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  if (primera) return primera

  const real = req.headers.get("x-real-ip")?.trim()
  return real && real.length > 0 ? real : "desconocida"
}

function respuestaDemasiadasSolicitudes(): NextResponse {
  return new NextResponse("Demasiadas solicitudes", {
    status: 429,
    headers: {
      ...HEADERS_SEGURIDAD,
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "60",
    },
  })
}

function urlEstado(req: Request, token: string, estado: EstadoPublico): URL {
  const url = new URL("/pago/paypal/estado", req.url)
  url.searchParams.set("token", token)
  url.searchParams.set("estado", estado)
  return url
}

function redirigirEstado(
  req: Request,
  token: string,
  estado: EstadoPublico
): NextResponse {
  return NextResponse.redirect(urlEstado(req, token, estado), {
    status: 302,
    headers: HEADERS_SEGURIDAD,
  })
}

function valorValido(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return TOKEN_VALIDO.test(texto) ? texto : null
}

/**
 * Id estable por orden cuando PayPal la incluye. Sin order id se usa un id
 * sintetico por enlace y timestamp: cada cancelacion queda trazada y el rate
 * limit acota el volumen. Nunca contiene PII.
 */
function eventoCanceladoId(enlaceId: string, orderId: string | null): string {
  return orderId
    ? `PAYPAL:CANCELADO:${orderId}`
    : `PAYPAL:CANCELADO:${enlaceId}:${Date.now()}`
}

export async function GET(req: Request) {
  const ip = ipDe(req)
  if (
    !rateLimit(`paypal-cancelado:ip:${ip}`, RATE_LIMIT_IP, RATE_LIMIT_WINDOW_MS)
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return redirigirEstado(req, "", "pendiente")
  }

  const tokenLocal = valorValido(url.searchParams.get("enlace"))
  const orderId = valorValido(url.searchParams.get("token"))

  if (
    tokenLocal &&
    !rateLimit(
      `paypal-cancelado:enlace:${tokenLocal}`,
      RATE_LIMIT_TOKEN,
      RATE_LIMIT_WINDOW_MS
    )
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  if (
    !tokenLocal &&
    orderId &&
    !rateLimit(
      `paypal-cancelado:orden:${orderId}`,
      RATE_LIMIT_TOKEN,
      RATE_LIMIT_WINDOW_MS
    )
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  if (!tokenLocal) {
    return redirigirEstado(req, "", "pendiente")
  }

  let enlace: EnlaceCancelado | null
  try {
    enlace = await prisma.enlacePago.findUnique({
      where: { token: tokenLocal },
      select: SELECT_ENLACE,
    })
  } catch {
    logger.error("No se pudo consultar el link PayPal cancelado")
    return redirigirEstado(req, tokenLocal, "pendiente")
  }

  if (!enlace || enlace.pasarela !== "PAYPAL") {
    return redirigirEstado(req, tokenLocal, "pendiente")
  }

  // La cancel URL no esta firmada. Solo se acepta el order id que el propio
  // link tiene guardado; uno ajeno no se registra ni expira nada.
  const ordenDelEnlace =
    orderId !== null && enlace.externalId !== null && orderId === enlace.externalId

  if (orderId !== null && !ordenDelEnlace) {
    logger.warn("Cancelacion PayPal con orden ajena al link", {
      enlaceId: enlace.id,
      orderId,
    })
    return redirigirEstado(req, tokenLocal, "pendiente")
  }

  const ahora = new Date()

  // Forzar una orden nueva en el proximo intento: se expira solo la orden
  // actual del link y se limpia el checkout guardado. El link de 30 dias, el
  // cobro y el resto de los links no se tocan.
  if (ordenDelEnlace) {
    try {
      await prisma.enlacePago.update({
        where: { id: enlace.id },
        data: { orderExpiraEn: ahora, checkoutUrl: null },
      })
      logger.info("Orden PayPal cancelada; se renovara en el proximo intento", {
        enlaceId: enlace.id,
      })
    } catch {
      logger.warn("No se pudo expirar la orden PayPal cancelada", {
        enlaceId: enlace.id,
      })
    }
  }

  try {
    await registrarEventoPasarela({
      eventoId: eventoCanceladoId(enlace.id, orderId),
      pasarela: "PAYPAL",
      tipo: EVENTO_CANCELADO,
      externalId: orderId ?? enlace.externalId,
      enlacePagoId: enlace.id,
      resultado: "IGNORADO",
      motivo: MOTIVO_CANCELADO,
      monto: enlace.total,
      moneda: enlace.moneda,
      requiereAccion: false,
      procesadoEn: ahora,
    })

    logger.info("Intento de pago PayPal cancelado", {
      enlaceId: enlace.id,
      orderId,
    })
  } catch {
    // La cancelacion no debe romper la experiencia del comprador ni cambiar el
    // link: la trazabilidad es best-effort y se loguea sin PII.
    logger.warn("No se pudo registrar el intento cancelado de PayPal", {
      enlaceId: enlace.id,
      orderId,
    })
  }

  return redirigirEstado(req, tokenLocal, "pendiente")
}
