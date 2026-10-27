/**
 * POST /api/admin/paypal/enviar (T-09).
 *
 * Envia el link estable de un cobro PayPal por email (Resend) o devuelve el
 * mensaje canonico para WhatsApp/copia. Solo staff (admin/asistente).
 *
 * Reglas:
 * - El enlace debe ser de pasarela PAYPAL, estar ACTIVO, no vencido, tener
 *   `url` y moneda USD. Si no existe (o es de otra pasarela) -> 404; si no es
 *   utilizable -> 409.
 * - El mensaje se arma siempre con `armarMensajePaypal`; para EMAIL devuelve
 *   `{ asunto, cuerpo }` y para WHATSAPP/COPIA `{ texto }`. COPIA usa la misma
 *   plantilla que WHATSAPP porque es texto plano para copiar y pegar.
 * - EMAIL: si Resend no esta configurado -> 503; si falla el envio -> 502.
 *   Solo se registra el tracking cuando Resend confirma el envio.
 * - WHATSAPP/COPIA: no envian nada; solo se registra el tracking y se devuelve
 *   el mensaje para que la UI lo use.
 * - Se actualizan `enviadoPor`, `enviadoEn`, `canalEnvio` e `idioma` del
 *   `EnlacePago`. No se toca el hito, la suscripcion, `Pago` ni Mercado Pago.
 * - No se loguean el email ni el nombre del cliente (PII). Solo ids, monto,
 *   moneda, estado, canal e idioma.
 *
 * Rate limit: 20/min por IP antes de autenticar (plan §5.1).
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import { sendPaypalPaymentEmail } from "@/lib/notifications"
import {
  armarMensajePaypal,
  type PaypalEmailMensaje,
  type PaypalIdioma,
  type PaypalMensajeBase,
  type PaypalWhatsappMensaje,
} from "@/lib/paypal/messages"
import { PAYPAL_MONEDA, esMonedaUsd, estaVencido } from "@/lib/paypal/utils"
import { paypalEnviarBodySchema } from "@/lib/paypal/validation"

const MENSAJE_NO_DISPONIBLE = "El envio por email no esta disponible."
const MENSAJE_ERROR_ENVIO = "No se pudo enviar el email del cobro."
const MENSAJE_ERROR_TRACKING = "No se pudo registrar el envio del cobro."
const MENSAJE_ERROR_MENSAJE = "No se pudo armar el mensaje del cobro."

function idiomaDeEnvio(
  idiomaSolicitado: "es" | "en" | null | undefined,
  idiomaEnlace: string | null
): PaypalIdioma {
  if (idiomaSolicitado === "es" || idiomaSolicitado === "en") return idiomaSolicitado
  return idiomaEnlace === "en" ? "en" : "es"
}

function mensajeEstadoNoActivo(estado: string): string {
  if (estado === "PAGADO") return "El enlace ya fue pagado."
  if (estado === "INVALIDADO") return "El enlace fue invalidado."
  if (estado === "VENCIDO") return "El enlace esta vencido."
  return "El enlace no esta activo."
}

function nombreError(error: unknown): string {
  return error instanceof Error ? error.name : "Error desconocido"
}

/**
 * Registra la trazabilidad del envio. Devuelve `false` para que la ruta
 * responda 500 sin filtrar el error de base.
 */
async function registrarEnvio(params: {
  enlaceId: string
  staffId: string
  canal: "EMAIL" | "WHATSAPP" | "COPIA"
  idioma: PaypalIdioma
}): Promise<boolean> {
  try {
    await prisma.enlacePago.update({
      where: { id: params.enlaceId },
      data: {
        enviadoPor: params.staffId,
        enviadoEn: new Date(),
        canalEnvio: params.canal,
        idioma: params.idioma,
      },
    })
    return true
  } catch (error) {
    logger.error("No se pudo registrar el envio del link PayPal", {
      enlaceId: params.enlaceId,
      staffId: params.staffId,
      canal: params.canal,
      error: nombreError(error),
    })
    return false
  }
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-paypal-enviar:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const staff = await requireStaff()
  if (!staff) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const parsed = paypalEnviarBodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 })
  }

  const body = parsed.data
  const logBase = {
    enlaceId: body.enlaceId,
    canal: body.canal,
    staffId: staff.userId,
  }

  let enlace
  try {
    enlace = await prisma.enlacePago.findUnique({
      where: { id: body.enlaceId },
      include: {
        cliente: { select: { nombre: true, email: true } },
        hito: { select: { id: true } },
        suscripcion: { select: { id: true } },
      },
    })
  } catch (error) {
    logger.error("Error al consultar el enlace PayPal para enviar", {
      ...logBase,
      error: nombreError(error),
    })
    return NextResponse.json(
      { error: "Error al consultar el enlace de pago." },
      { status: 500 }
    )
  }

  // Un enlace de otra pasarela se trata como inexistente: este endpoint solo
  // opera links PayPal y no debe exponer datos de Mercado Pago.
  if (!enlace || enlace.pasarela !== "PAYPAL") {
    return NextResponse.json({ error: "Enlace no encontrado." }, { status: 404 })
  }

  if (enlace.estado !== "ACTIVO") {
    return NextResponse.json(
      { error: mensajeEstadoNoActivo(enlace.estado) },
      { status: 409 }
    )
  }

  if (estaVencido(enlace.expiraEn)) {
    return NextResponse.json({ error: "El enlace esta vencido." }, { status: 409 })
  }

  const url = enlace.url?.trim()
  if (!url) {
    return NextResponse.json(
      { error: "El enlace no tiene un link de pago disponible." },
      { status: 409 }
    )
  }

  if (!esMonedaUsd(enlace.moneda)) {
    return NextResponse.json(
      { error: "El enlace no esta expresado en USD." },
      { status: 409 }
    )
  }

  const email = enlace.cliente.email?.trim() ?? ""
  if (body.canal === "EMAIL" && email.length === 0) {
    return NextResponse.json(
      { error: "El cliente no tiene un email cargado para enviar el cobro." },
      { status: 409 }
    )
  }

  const idioma = idiomaDeEnvio(body.idioma, enlace.idioma)
  const datosMensaje = {
    idioma,
    concepto: enlace.concepto,
    montoAcordadoCents: enlace.montoAcordado,
    comisionCents: enlace.comision,
    totalCents: enlace.total,
    moneda: PAYPAL_MONEDA,
    link: url,
    vencimiento: enlace.expiraEn,
    clienteNombre: enlace.cliente.nombre,
  } satisfies PaypalMensajeBase

  if (body.canal === "EMAIL") {
    let mensaje: PaypalEmailMensaje
    try {
      mensaje = armarMensajePaypal({ ...datosMensaje, canal: "EMAIL" })
    } catch (error) {
      logger.error("Error al armar el mensaje PayPal", {
        ...logBase,
        error: nombreError(error),
      })
      return NextResponse.json({ error: MENSAJE_ERROR_MENSAJE }, { status: 500 })
    }

    const resultado = await sendPaypalPaymentEmail({
      to: email,
      asunto: mensaje.asunto,
      cuerpo: mensaje.cuerpo,
    })

    if (resultado === "NO_CONFIGURADO") {
      logger.warn("Envio de email PayPal no disponible", logBase)
      return NextResponse.json({ error: MENSAJE_NO_DISPONIBLE }, { status: 503 })
    }

    if (resultado === "ERROR") {
      return NextResponse.json({ error: MENSAJE_ERROR_ENVIO }, { status: 502 })
    }

    const registrado = await registrarEnvio({
      enlaceId: enlace.id,
      staffId: staff.userId,
      canal: "EMAIL",
      idioma,
    })
    if (!registrado) {
      return NextResponse.json({ error: MENSAJE_ERROR_TRACKING }, { status: 500 })
    }

    logger.info("Cobro PayPal enviado por email", {
      ...logBase,
      total: enlace.total,
      moneda: enlace.moneda,
      idioma,
    })

    return NextResponse.json(
      { ok: true, canal: "EMAIL", enviado: true, mensaje },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  // WHATSAPP y COPIA no envian nada: devuelven el texto canonico que el staff
  // copia o pega en WhatsApp. COPIA reutiliza la plantilla de WhatsApp.
  let mensaje: PaypalWhatsappMensaje
  try {
    mensaje = armarMensajePaypal({ ...datosMensaje, canal: "WHATSAPP" })
  } catch (error) {
    logger.error("Error al armar el mensaje PayPal", {
      ...logBase,
      error: nombreError(error),
    })
    return NextResponse.json({ error: MENSAJE_ERROR_MENSAJE }, { status: 500 })
  }

  const registrado = await registrarEnvio({
    enlaceId: enlace.id,
    staffId: staff.userId,
    canal: body.canal,
    idioma,
  })
  if (!registrado) {
    return NextResponse.json({ error: MENSAJE_ERROR_TRACKING }, { status: 500 })
  }

  logger.info("Cobro PayPal listo para enviar", {
    ...logBase,
    total: enlace.total,
    moneda: enlace.moneda,
    idioma,
  })

  return NextResponse.json(
    { ok: true, canal: body.canal, enviado: false, mensaje },
    { headers: { "Cache-Control": "no-store" } }
  )
}
