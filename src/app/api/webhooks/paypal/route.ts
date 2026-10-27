/**
 * POST /api/webhooks/paypal (T-29, plan.md §4.4 y §5.2).
 *
 * - Verifica la firma server-to-server contra PayPal con
 *   `PAYPAL_WEBHOOK_ID`; nunca confia en el body ni en los headers por si
 *   solos. Sin configuracion responde 503; headers faltantes, cuerpo invalido o
 *   firma invalida/alterada responden 401 y dejan un evento tecnico sin PII.
 * - Timeout de 4 s por llamada (verificacion y orden/captura). Si la
 *   verificacion no esta disponible responde 503 para que PayPal reintente.
 * - Dispatch idempotente por `EventoPasarela.eventoId`; los eventos
 *   desconocidos, duplicados y ya resueltos responden 200. Un error de
 *   procesamiento responde 500 para que PayPal reintente.
 * - No persiste ni loguea el payload crudo ni datos del pagador. El registro
 *   tecnico solo contiene ids, tipo, monto, moneda, resultado y motivo.
 */

import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { logger } from "@/lib/logger"
import { paypalConfig } from "@/lib/paypal/config"
import {
  PAYPAL_WEBHOOK_TIMEOUT_MS,
  esPaypalError,
  leerHeadersTransmision,
  verifyWebhookSignature,
} from "@/lib/paypal/client"
import { esPaypalProcessError } from "@/lib/paypal/process"
import {
  procesarEventoPaypal,
  registrarFirmaInvalida,
  type ResultadoWebhookPaypal,
} from "@/lib/paypal/webhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  })
}

function codigoDeError(error: unknown): string {
  if (esPaypalProcessError(error)) return error.codigo
  if (esPaypalError(error)) return error.code
  return "DESCONOCIDO"
}

function respuestaSegunResultado(resultado: ResultadoWebhookPaypal): NextResponse {
  if (resultado.duplicate) return json({ ok: true, duplicate: true })
  if (resultado.estado === "IGNORADO") return json({ ok: true, ignored: true })
  return json({ ok: true })
}

async function leerEvento(req: Request): Promise<unknown> {
  try {
    const crudo = await req.text()
    return JSON.parse(crudo) as unknown
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const config = paypalConfig()
  if (!config.disponible || !config.webhookId) {
    logger.warn("Webhook PayPal rechazado: PayPal no configurado")
    return json({ error: "Webhook no configurado" }, 503)
  }

  const headers = leerHeadersTransmision(req.headers)
  const evento = await leerEvento(req)

  if (!headers) {
    await registrarFirmaInvalida({
      headers: null,
      evento,
      motivo: "HEADERS_INCOMPLETOS",
    })
    logger.warn("Webhook PayPal sin headers de transmision")
    return json({ error: "Firma invalida" }, 401)
  }

  if (!esRegistro(evento)) {
    await registrarFirmaInvalida({
      headers,
      evento,
      motivo: evento === null ? "CUERPO_INVALIDO" : "EVENTO_INVALIDO",
    })
    logger.warn("Webhook PayPal con cuerpo invalido")
    return json({ error: "Firma invalida" }, 401)
  }

  let verificacion
  try {
    verificacion = await verifyWebhookSignature(
      {
        headers: {
          "PAYPAL-TRANSMISSION-ID": headers.transmissionId,
          "PAYPAL-TRANSMISSION-TIME": headers.transmissionTime,
          "PAYPAL-TRANSMISSION-SIG": headers.transmissionSig,
          "PAYPAL-CERT-URL": headers.certUrl,
          "PAYPAL-AUTH-ALGO": headers.authAlgo,
        },
        event: evento,
      },
      { timeoutMs: PAYPAL_WEBHOOK_TIMEOUT_MS }
    )
  } catch (error) {
    if (esPaypalError(error) && error.code === "VALIDACION") {
      await registrarFirmaInvalida({
        headers,
        evento,
        motivo: "EVENTO_INVALIDO",
      })
      logger.warn("Webhook PayPal con evento invalido")
      return json({ error: "Firma invalida" }, 401)
    }

    // No se pudo verificar (timeout/red/HTTP): no se acepta el evento, pero
    // tampoco se marca como firma invalida. 503 permite el reintento de PayPal.
    logger.warn("No se pudo verificar la firma del webhook PayPal", {
      codigo: codigoDeError(error),
    })
    return json({ error: "Verificacion no disponible" }, 503)
  }

  if (!verificacion.verificado) {
    await registrarFirmaInvalida({
      headers,
      evento,
      motivo:
        verificacion.motivo === "HEADERS_INCOMPLETOS"
          ? "HEADERS_INCOMPLETOS"
          : "FIRMA_INVALIDA",
    })
    logger.warn("Webhook PayPal con firma invalida", {
      estado: verificacion.estado,
    })
    return json({ error: "Firma invalida" }, 401)
  }

  try {
    const resultado = await procesarEventoPaypal(evento)
    logger.info("Webhook PayPal procesado", {
      eventoId: resultado.eventoId,
      tipo: resultado.tipo,
      estado: resultado.estado,
      duplicate: resultado.duplicate,
      ignored: resultado.ignored,
      enlacePagoId: resultado.enlacePagoId,
      pagoId: resultado.pagoId,
    })
    return respuestaSegunResultado(resultado)
  } catch (error) {
    const codigo = codigoDeError(error)
    Sentry.captureException(error)
    logger.error("Error procesando el webhook PayPal", { codigo })
    return json({ error: "Error procesando el webhook" }, 500)
  }
}
