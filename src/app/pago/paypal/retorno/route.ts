/**
 * GET /pago/paypal/retorno (T-14, parte B).
 *
 * PayPal vuelve del checkout con `token=<orderId>` y nosotros agregamos
 * `enlace=<tokenLocal>` al `return_url`. Por eso el token local nunca se lee
 * del parametro `token`: ese nombre queda reservado para PayPal.
 *
 * Flujo:
 * 1. Rate limit por IP y por token local.
 * 2. Resuelve el `EnlacePago` por el token local; si falta, por `externalId`
 *    (order id) o por `custom_id`/`invoice_id` de la orden.
 * 3. Consulta la orden en PayPal y valida que pertenezca al link. No se confia
 *    en los query params por si solos.
 * 4. Captura la orden si todavia no tiene captura y delega el registro en
 *    `procesarCapturaPaypal` (idempotente por capture/order).
 * 5. Redirige a `/pago/paypal/estado` con un estado publico acotado.
 *
 * No expone PII, payloads de PayPal ni tokens en logs. Todas las respuestas
 * llevan no-store, no-referrer y noindex.
 */

import type { EstadoEnlace } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { paypalConfig } from "@/lib/paypal/config"
import {
  captureOrder,
  esPaypalError,
  getOrder,
  primeraCaptura,
  type PaypalOrder,
} from "@/lib/paypal/client"
import {
  esPaypalProcessError,
  procesarCapturaPaypal,
  type CapturaPaypalProcesable,
  type ResultadoProcesamientoPaypal,
} from "@/lib/paypal/process"
import { resolverBaseUrlPublica } from "@/lib/paypal/utils"

export const dynamic = "force-dynamic"

const RATE_LIMIT_IP = 30
const RATE_LIMIT_TOKEN = 5
const RATE_LIMIT_WINDOW_MS = 60_000
const PAYPAL_TIMEOUT_MS = 8_000

const HEADERS_SEGURIDAD: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

type EstadoPublico = "pagado" | "pendiente" | "error"

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{1,128}$/

interface EnlaceRetorno {
  id: string
  token: string
  pasarela: string
  externalId: string | null
  estado: EstadoEnlace
}

const SELECT_ENLACE = {
  id: true,
  token: true,
  pasarela: true,
  externalId: true,
  estado: true,
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
  // Detras del proxy de Railway `req.url` puede ser el origen interno
  // (0.0.0.0:8080). La base publica configurada manda; `req.url` queda solo
  // como fallback cuando no hay base valida.
  const base =
    resolverBaseUrlPublica(process.env.NEXT_PUBLIC_URL, req.url) ?? req.url
  const url = new URL("/pago/paypal/estado", base)
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

/** Acepta solo tokens/order ids con el alfabeto opaco esperado. */
function valorValido(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return TOKEN_VALIDO.test(texto) ? texto : null
}

/**
 * El link se resuelve por token primero; si el comprador vuelve sin `enlace`,
 * se acepta el order id guardado en `externalId`. El `custom_id`/`invoice_id`
 * de la orden se usa recien despues de consultar la orden en PayPal.
 */
async function buscarEnlacePorToken(token: string): Promise<EnlaceRetorno | null> {
  return prisma.enlacePago.findUnique({
    where: { token },
    select: SELECT_ENLACE,
  })
}

async function buscarEnlacePorOrden(orderId: string): Promise<EnlaceRetorno | null> {
  return prisma.enlacePago.findUnique({
    where: { externalId: orderId },
    select: SELECT_ENLACE,
  })
}

function perteneceAlEnlace(
  enlace: EnlaceRetorno,
  orden: PaypalOrder,
  orderId: string
): boolean {
  return (
    enlace.externalId === orderId ||
    orden.customId === enlace.token ||
    orden.invoiceId === enlace.token
  )
}

function estadoDeResultado(resultado: ResultadoProcesamientoPaypal): EstadoPublico {
  switch (resultado.tipo) {
    case "PROCESADO":
      return "pagado"
    case "DUPLICADO":
      // Un reintento exacto ya registrado no debe alarmar al pagador; un
      // segundo capture de la misma orden queda pendiente de revision.
      return resultado.requiereAccion ? "pendiente" : "pagado"
    case "REVISION":
    case "CONFLICTO":
      return "pendiente"
  }
}

function codigoPaypal(error: unknown): string {
  return esPaypalError(error) ? error.code : "DESCONOCIDO"
}

export async function GET(req: Request) {
  const ip = ipDe(req)
  if (!rateLimit(`paypal-retorno:ip:${ip}`, RATE_LIMIT_IP, RATE_LIMIT_WINDOW_MS)) {
    return respuestaDemasiadasSolicitudes()
  }

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return redirigirEstado(req, "", "error")
  }

  const tokenLocalParam = valorValido(url.searchParams.get("enlace"))
  const orderId = valorValido(url.searchParams.get("token"))

  if (
    tokenLocalParam &&
    !rateLimit(
      `paypal-retorno:enlace:${tokenLocalParam}`,
      RATE_LIMIT_TOKEN,
      RATE_LIMIT_WINDOW_MS
    )
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  if (
    !tokenLocalParam &&
    orderId &&
    !rateLimit(
      `paypal-retorno:orden:${orderId}`,
      RATE_LIMIT_TOKEN,
      RATE_LIMIT_WINDOW_MS
    )
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  if (!orderId) {
    logger.warn("Retorno PayPal sin order id", {
      tieneEnlace: tokenLocalParam !== null,
    })
    return redirigirEstado(req, tokenLocalParam ?? "", "error")
  }

  let enlace: EnlaceRetorno | null = null
  try {
    if (tokenLocalParam) {
      enlace = await buscarEnlacePorToken(tokenLocalParam)
    }
    if (!enlace) {
      enlace = await buscarEnlacePorOrden(orderId)
    }
  } catch {
    logger.error("No se pudo consultar el link PayPal del retorno", { orderId })
    return redirigirEstado(req, tokenLocalParam ?? "", "error")
  }

  const config = paypalConfig()
  if (!config.disponible) {
    logger.warn("PayPal no disponible en el retorno", {
      enlaceId: enlace?.id ?? null,
      orderId,
    })
    return redirigirEstado(req, enlace?.token ?? tokenLocalParam ?? "", "error")
  }

  let orden: PaypalOrder
  try {
    orden = await getOrder(orderId, { timeoutMs: PAYPAL_TIMEOUT_MS })
  } catch (error) {
    logger.warn("No se pudo consultar la orden PayPal del retorno", {
      enlaceId: enlace?.id ?? null,
      orderId,
      codigo: codigoPaypal(error),
    })
    return redirigirEstado(req, enlace?.token ?? tokenLocalParam ?? "", "error")
  }

  if (!enlace) {
    // Respaldo documentado en el plan: la orden viaja con el token local como
    // `custom_id`/`invoice_id`; solo se usa despues de consultar PayPal.
    const referencia =
      valorValido(orden.customId) ?? valorValido(orden.invoiceId)
    if (referencia) {
      try {
        enlace = await buscarEnlacePorToken(referencia)
      } catch {
        logger.error("No se pudo consultar el link PayPal por custom_id", {
          orderId,
        })
        return redirigirEstado(req, tokenLocalParam ?? "", "error")
      }
    }
  }

  if (!enlace || enlace.pasarela !== "PAYPAL") {
    logger.warn("Retorno PayPal sin link valido", { orderId })
    return redirigirEstado(req, tokenLocalParam ?? "", "error")
  }

  const tokenLocal = enlace.token
  if (!perteneceAlEnlace(enlace, orden, orderId)) {
    logger.warn("La orden PayPal no pertenece al link", {
      enlaceId: enlace.id,
      orderId,
    })
    return redirigirEstado(req, tokenLocal, "error")
  }

  let captura = primeraCaptura(orden)
  if (!captura) {
    try {
      orden = await captureOrder(orderId, { timeoutMs: PAYPAL_TIMEOUT_MS })
    } catch (error) {
      logger.warn("No se pudo capturar la orden PayPal", {
        enlaceId: enlace.id,
        orderId,
        codigo: codigoPaypal(error),
      })
      return redirigirEstado(req, tokenLocal, "error")
    }
    captura = primeraCaptura(orden)
  }

  if (!captura) {
    logger.warn("PayPal no devolvio una captura para el retorno", {
      enlaceId: enlace.id,
      orderId,
    })
    return redirigirEstado(req, tokenLocal, "error")
  }

  const capturaProcesable: CapturaPaypalProcesable = {
    captureId: captura.id,
    orderId: captura.orderId ?? orden.id,
    amountCents: captura.amountCents,
    currency: captura.currencyCode,
    status: captura.status,
    customId: captura.customId ?? orden.customId,
    invoiceId: captura.invoiceId ?? orden.invoiceId,
  }

  try {
    const resultado = await procesarCapturaPaypal(capturaProcesable)
    logger.info("Retorno PayPal procesado", {
      enlaceId: enlace.id,
      orderId,
      captureId: captura.id,
      resultado: resultado.tipo,
    })
    return redirigirEstado(req, tokenLocal, estadoDeResultado(resultado))
  } catch (error) {
    logger.warn("No se pudo procesar la captura PayPal del retorno", {
      enlaceId: enlace.id,
      orderId,
      captureId: captura.id,
      codigo: esPaypalProcessError(error) ? error.codigo : "DESCONOCIDO",
    })
    return redirigirEstado(req, tokenLocal, "error")
  }
}
