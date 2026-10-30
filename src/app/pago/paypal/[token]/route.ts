/**
 * GET /pago/paypal/[token] (T-14, parte A).
 *
 * Link publico y estable de un cobro PayPal. No requiere sesion:
 * - rate limit 30/min por IP y 5/min por token;
 * - valida token, pasarela, estado, vencimiento y que el concepto siga pendiente;
 * - reutiliza el checkout PayPal vigente (<3 h) o crea/renueva la orden;
 * - redirige al checkout o a `/pago/paypal/estado` con un motivo publico.
 *
 * No expone PII, ids internos ni el token en logs/respuestas mas alla del
 * redirect. Todas las respuestas llevan no-store, no-referrer y noindex.
 */

import type { EstadoEnlace } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { paypalConfig } from "@/lib/paypal/config"
import {
  createOrder,
  esPaypalError,
  type PaypalOrder,
  type PaypalRequestOptions,
} from "@/lib/paypal/client"
import { PAYPAL_ORDER_TTL_MS } from "@/lib/paypal/links"
import {
  construirLocationEstado,
  esMonedaUsd,
  evaluarConceptoEnlace,
  resolverBaseUrlPublica,
  resolverEstadoEnlace,
  estaVencido,
} from "@/lib/paypal/utils"

export const dynamic = "force-dynamic"

const RATE_LIMIT_IP = 30
const RATE_LIMIT_TOKEN = 5
const RATE_LIMIT_WINDOW_MS = 60_000

const HEADERS_SEGURIDAD: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

type EstadoPublico = "pendiente" | "pagado" | "vencido" | "invalidado" | "error"

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{1,128}$/

interface EnlacePublicoRoute {
  id: string
  pasarela: string
  concepto: string
  descripcion: string | null
  total: number
  moneda: string
  idioma: string | null
  estado: EstadoEnlace
  expiraEn: Date
  orderExpiraEn: Date | null
  checkoutUrl: string | null
  hitoId: string | null
  suscripcionId: string | null
  hito: { estado: string } | null
  suscripcion: { estado: string; plan: string } | null
}

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

function redirigirEstado(
  req: Request,
  token: string,
  estado: EstadoPublico
): NextResponse {
  // Si no hay base publica valida, `Location` es relativo: `NextResponse.redirect`
  // no acepta URLs relativas, por eso se arma la respuesta a mano.
  const { location } = construirLocationEstado(
    process.env.NEXT_PUBLIC_URL,
    req.url,
    token,
    estado
  )

  return new NextResponse(null, {
    status: 302,
    headers: { ...HEADERS_SEGURIDAD, Location: location },
  })
}

function redirigirCheckout(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 302, headers: HEADERS_SEGURIDAD })
}

/**
 * Solo se redirige a un checkout HTTPS de PayPal. Evita un open redirect si
 * el valor guardado en la base fuese manipulado.
 */
function urlCheckoutSegura(valor: string | null | undefined): string | null {
  if (typeof valor !== "string" || valor.trim().length === 0) return null

  try {
    const url = new URL(valor)
    if (url.protocol !== "https:") return null
    if (url.username || url.password) return null

    const host = url.hostname.toLowerCase()
    if (host !== "paypal.com" && !host.endsWith(".paypal.com")) return null

    return url.toString()
  } catch {
    return null
  }
}

function mensajeErrorSanitizado(error: unknown): string {
  const mensaje = esPaypalError(error)
    ? error.message
    : "No se pudo crear o renovar la orden de PayPal."
  return mensaje.replace(/\s+/g, " ").trim().slice(0, 300)
}

/** Best effort: nunca cambia el estado del link ni bloquea el redirect. */
async function registrarUltimoError(enlaceId: string, mensaje: string): Promise<void> {
  try {
    await prisma.enlacePago.update({
      where: { id: enlaceId },
      data: { ultimoError: mensaje },
    })
  } catch {
    // El redirect publico no depende de esta escritura.
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = ipDe(req)
  if (!rateLimit(`paypal-publico:ip:${ip}`, RATE_LIMIT_IP, RATE_LIMIT_WINDOW_MS)) {
    return respuestaDemasiadasSolicitudes()
  }

  const { token: tokenRaw } = await params
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : ""

  // Un token con formato invalido no llega a la base ni consume el limite por token.
  if (!TOKEN_VALIDO.test(token)) {
    return redirigirEstado(req, token, "invalidado")
  }

  if (
    !rateLimit(
      `paypal-publico:token:${token}`,
      RATE_LIMIT_TOKEN,
      RATE_LIMIT_WINDOW_MS
    )
  ) {
    return respuestaDemasiadasSolicitudes()
  }

  let enlace: EnlacePublicoRoute | null
  try {
    enlace = await prisma.enlacePago.findUnique({
      where: { token },
      include: {
        hito: { select: { estado: true } },
        suscripcion: { select: { estado: true, plan: true } },
      },
    })
  } catch {
    logger.error("No se pudo consultar el link publico de PayPal")
    return redirigirEstado(req, token, "error")
  }

  if (!enlace || enlace.pasarela !== "PAYPAL") {
    return redirigirEstado(req, token, "invalidado")
  }

  const ahora = new Date()
  const estadoEnlace = resolverEstadoEnlace(enlace.estado, enlace.expiraEn, ahora)

  if (estadoEnlace === "PAGADO") {
    return redirigirEstado(req, token, "pagado")
  }

  if (estadoEnlace === "VENCIDO") {
    if (enlace.estado === "ACTIVO") {
      try {
        await prisma.enlacePago.update({
          where: { id: enlace.id },
          data: { estado: "VENCIDO" },
        })
      } catch {
        // El vencimiento se resuelve igual de forma perezosa.
      }
    }
    return redirigirEstado(req, token, "vencido")
  }

  if (estadoEnlace === "INVALIDADO") {
    return redirigirEstado(req, token, "invalidado")
  }

  if (estadoEnlace === "FALLIDO") {
    return redirigirEstado(req, token, "error")
  }

  // La regla de concepto es la misma para la ruta y la pagina `/estado`: un
  // hito PAGADO o un soporte no elegible nunca se informan como pendientes.
  const concepto = evaluarConceptoEnlace(enlace)
  if (!concepto.pendiente) {
    return redirigirEstado(req, token, concepto.estado)
  }

  if (estadoEnlace !== "ACTIVO") {
    // CREANDO: el link aun no esta listo para pagar; el cliente puede reintentar.
    return redirigirEstado(req, token, "pendiente")
  }

  // El rollback de PayPal es quitar las envs: aunque el checkout guardado siga
  // vigente, no se redirige a PayPal sin configuracion (el retorno no podria
  // capturar). Se valida despues de estado/vencimiento/concepto para que un
  // link pagado o vencido siga informando su estado real.
  const config = paypalConfig()
  if (!config.disponible) {
    logger.warn("PayPal no disponible al abrir el link publico", {
      enlaceId: enlace.id,
    })
    return redirigirEstado(req, token, "error")
  }

  // Defensa en profundidad: PayPal solo cobra USD y el monto debe ser un
  // entero positivo en centavos. Un link corrupto no llega a createOrder.
  if (
    !esMonedaUsd(enlace.moneda) ||
    !Number.isSafeInteger(enlace.total) ||
    enlace.total <= 0
  ) {
    logger.error("Link PayPal publico con moneda o monto invalido", {
      enlaceId: enlace.id,
    })
    return redirigirEstado(req, token, "invalidado")
  }

  // Reutiliza la orden vigente (<3 h) sin llamar a PayPal.
  const checkoutVigente = urlCheckoutSegura(enlace.checkoutUrl)
  if (checkoutVigente && !estaVencido(enlace.orderExpiraEn, ahora)) {
    return redirigirCheckout(checkoutVigente)
  }

  const baseUrl = resolverBaseUrlPublica(process.env.NEXT_PUBLIC_URL, req.url)
  if (!baseUrl) {
    logger.error("URL base publica invalida para PayPal", { enlaceId: enlace.id })
    return redirigirEstado(req, token, "error")
  }

  const opciones: PaypalRequestOptions = {
    requestId: `pago-${enlace.id}-${ahora.getTime()}`,
    timeoutMs: 8_000,
  }

  let orden: PaypalOrder
  try {
    orden = await createOrder(
      {
        montoCents: enlace.total,
        referencia: token,
        descripcion: enlace.descripcion ?? enlace.concepto,
        returnUrl: `${baseUrl}/pago/paypal/retorno?enlace=${encodeURIComponent(token)}`,
        cancelUrl: `${baseUrl}/pago/paypal/cancelado?enlace=${encodeURIComponent(token)}`,
        locale: enlace.idioma === "en" ? "en-US" : "es-AR",
      },
      opciones
    )
  } catch (error) {
    logger.warn("No se pudo crear la orden PayPal del link publico", {
      enlaceId: enlace.id,
      codigo: esPaypalError(error) ? error.code : "DESCONOCIDO",
    })
    await registrarUltimoError(enlace.id, mensajeErrorSanitizado(error))
    return redirigirEstado(req, token, "error")
  }

  const checkout = urlCheckoutSegura(orden.payerActionUrl)
  if (!checkout) {
    logger.warn("PayPal devolvio un checkout invalido", { enlaceId: enlace.id })
    await registrarUltimoError(
      enlace.id,
      "PayPal no devolvio un link de checkout valido."
    )
    return redirigirEstado(req, token, "error")
  }

  try {
    await prisma.enlacePago.update({
      where: { id: enlace.id },
      data: {
        externalId: orden.id,
        checkoutUrl: checkout,
        orderExpiraEn: new Date(ahora.getTime() + PAYPAL_ORDER_TTL_MS),
        ultimoError: null,
      },
    })
  } catch {
    logger.error("No se pudo guardar la orden PayPal del link publico", {
      enlaceId: enlace.id,
    })
    return redirigirEstado(req, token, "error")
  }

  logger.info("Checkout PayPal renovado", {
    enlaceId: enlace.id,
    total: enlace.total,
    moneda: enlace.moneda,
  })

  return redirigirCheckout(checkout)
}
