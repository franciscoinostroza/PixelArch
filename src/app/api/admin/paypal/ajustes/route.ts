/**
 * POST /api/admin/paypal/ajustes (T-16, AC-17/AC-19/AC-22).
 *
 * Registro manual de un reembolso o contracargo PayPal. Solo admin
 * (`requireAdmin` estricto): la asistente recibe 403. Rate limit 20/min.
 *
 * El body se valida con Zod y el servicio `registrarAjustePaypal` crea el
 * `AjustePago`, cambia solo `Pago.estadoPago` a `REFUNDED`/`CONTRACARGO` y
 * aplica la decision explicita del admin (`NINGUNA`, `REVERTIR_HITO` o
 * `DESCONTAR_MESES`). No hay automatismo: el webhook de refund/chargeback solo
 * deja `requiereAccion` para que el admin decida desde esta API.
 *
 * No se loguean motivo, evidencia ni datos del pagador: solo ids, tipo,
 * decision, monto, moneda y estado.
 *
 * Respuesta 200:
 * `{ ok: true, ajusteId, pagoId, estadoPago, decision, mesesDescontados }`.
 */

import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { requireAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import {
  esPaypalAdjustmentError,
  registrarAjustePaypal,
  type PaypalAdjustmentErrorCodigo,
} from "@/lib/paypal/adjustments"
import { paypalAjusteBodySchema } from "@/lib/paypal/validation"

const MENSAJE_POR_CODIGO: Record<PaypalAdjustmentErrorCodigo, string> = {
  ARGUMENTOS_INVALIDOS: "Datos invalidos",
  PAGO_NO_ENCONTRADO: "Pago PayPal no encontrado.",
  ESTADO_NO_AJUSTABLE:
    "El pago no esta en un estado ajustable para reembolso o contracargo.",
  MONTO_EXCEDE_PAGO:
    "El monto del ajuste supera el monto disponible del pago.",
  HITO_CON_OTRO_PAGO:
    "El hito tiene otro pago exitoso y no se puede revertir.",
  DECISION_INCOMPATIBLE:
    "La decision no es compatible con el pago indicado.",
  SIN_VENCIMIENTO:
    "El soporte no tiene un vencimiento para descontar.",
  ERROR_INTERNO: "Error al registrar el ajuste de PayPal.",
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-paypal-ajustes:${ip}`, 20, 60_000)) {
    return jsonNoStore({ error: "Demasiadas solicitudes" }, 429)
  }

  const admin = await requireAdmin()
  if (!admin) {
    return jsonNoStore({ error: "No autorizado" }, 403)
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonNoStore({ error: "JSON invalido" }, 400)
  }

  const parsed = paypalAjusteBodySchema.safeParse(payload)
  if (!parsed.success) {
    return jsonNoStore({ error: "Datos invalidos" }, 400)
  }

  const body = parsed.data
  const logBase = {
    pagoId: body.pagoId,
    tipo: body.tipo,
    decision: body.decision,
    monto: body.montoCents,
    moneda: "usd",
    staffId: admin.id,
  }

  try {
    const resultado = await registrarAjustePaypal({
      pagoId: body.pagoId,
      tipo: body.tipo,
      montoCents: body.montoCents,
      motivo: body.motivo ?? null,
      evidencia: body.evidencia ?? null,
      decision: body.decision,
      mesesDescontados: body.mesesDescontados ?? null,
      // `AjustePago` solo tiene un campo de texto; el id del staff queda en el
      // log estructurado (`staffId`) y no se mezcla con el nombre visible.
      registradoPor: admin.nombre || "Admin",
    })

    logger.info("Ajuste PayPal registrado", {
      ...logBase,
      ajusteId: resultado.ajusteId,
      estadoPago: resultado.estadoPago,
      hitoRevertido: resultado.hitoRevertido,
      vencimientoDescontado: resultado.vencimientoDescontado,
      soporteEnMora: resultado.soporteEnMora,
    })

    return jsonNoStore({
      ok: true,
      ajusteId: resultado.ajusteId,
      pagoId: resultado.pagoId,
      estadoPago: resultado.estadoPago,
      decision: resultado.decision,
      mesesDescontados: resultado.mesesDescontados,
    })
  } catch (error) {
    if (esPaypalAdjustmentError(error)) {
      logger.warn("No se pudo registrar el ajuste PayPal", {
        ...logBase,
        codigo: error.codigo,
      })

      return jsonNoStore(
        { error: MENSAJE_POR_CODIGO[error.codigo] },
        error.httpStatus
      )
    }

    Sentry.captureException(error)
    logger.error("Error inesperado registrando ajuste PayPal", {
      ...logBase,
      error: error instanceof Error ? error.name : "Error desconocido",
    })

    return jsonNoStore(
      { error: MENSAJE_POR_CODIGO.ERROR_INTERNO },
      500
    )
  }
}
