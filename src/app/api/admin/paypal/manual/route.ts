/**
 * POST /api/admin/paypal/manual (T-15, AC-17/AC-19/AC-24/AC-25).
 *
 * Registro manual de un pago PayPal cuando el webhook no llego. Solo admin
 * (`requireAdmin` estricto): la asistente recibe 403. Rate limit 20/min.
 *
 * El body se valida con Zod y luego el servicio `registrarPagoManualPaypal`
 * valida el desglose, la evidencia, las referencias y la idempotencia. La ruta
 * solo traduce errores a un contrato HTTP estable y loguea ids/montos, nunca
 * evidencia, payload crudo ni datos del pagador.
 *
 * Respuesta 200: `{ ok: true, pagoId }`.
 * Duplicado (misma referencia): `409 { ok: false, pagoId, duplicado: true }`.
 */

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import {
  esPaypalManualError,
  registrarPagoManualPaypal,
  type PaypalManualErrorCodigo,
} from "@/lib/paypal/manual"
import { paypalManualBodySchema } from "@/lib/paypal/validation"

const MENSAJE_POR_CODIGO: Record<PaypalManualErrorCodigo, string> = {
  ARGUMENTOS_INVALIDOS: "Datos invalidos",
  EVIDENCIA_INVALIDA:
    "La evidencia es obligatoria (texto o URL, maximo 2000 caracteres).",
  PII_EN_EVIDENCIA:
    "La evidencia no puede contener datos personales del pagador.",
  CONCEPTO_NO_ENCONTRADO: "Concepto no encontrado.",
  CONCEPTO_NO_ELEGIBLE:
    "El concepto no admite el pago manual (hito ya pagado o soporte no elegible).",
  DUPLICADO: "Ya existe un pago PayPal con la misma referencia.",
  LOOKUP_NO_COINCIDE:
    "La orden de PayPal no coincide con los datos informados.",
  PAYPAL_ERROR: "No se pudo consultar la orden en PayPal.",
  NO_CONFIGURADO:
    "PayPal no disponible: configuracion incompleta o invalida.",
  ERROR_INTERNO: "Error al registrar el pago manual de PayPal.",
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-paypal-manual:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const parsed = paypalManualBodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 })
  }

  const body = parsed.data
  const logBase = {
    hitoId: body.hitoId ?? null,
    suscripcionId: body.suscripcionId ?? null,
    monto: body.totalCents,
    moneda: "usd",
    staffId: admin.id,
  }

  try {
    const resultado = await registrarPagoManualPaypal({
      hitoId: body.hitoId ?? null,
      suscripcionId: body.suscripcionId ?? null,
      montoAcordadoCents: body.montoAcordadoCents,
      comisionCents: body.comisionCents,
      totalCents: body.totalCents,
      externalId: body.externalId ?? null,
      paypalOrderId: body.paypalOrderId ?? null,
      evidencia: body.evidencia,
      meses: body.meses ?? null,
      marcarHitoPagado: body.marcarHitoPagado,
      acreditarMeses: body.acreditarMeses,
      moneda: body.moneda ?? null,
      registradoPor: admin.nombre || "Admin",
    })

    logger.info("Pago PayPal manual registrado", {
      ...logBase,
      pagoId: resultado.pagoId,
      externalId: body.externalId ?? null,
      paypalOrderId: body.paypalOrderId ?? null,
      aplicado: resultado.aplicado,
    })

    return NextResponse.json(
      { ok: true, pagoId: resultado.pagoId },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    if (esPaypalManualError(error)) {
      logger.warn("No se pudo registrar el pago PayPal manual", {
        ...logBase,
        codigo: error.codigo,
        pagoId: error.pagoId,
        externalId: body.externalId ?? null,
        paypalOrderId: body.paypalOrderId ?? null,
      })

      if (error.codigo === "DUPLICADO") {
        return NextResponse.json(
          {
            ok: false,
            error: MENSAJE_POR_CODIGO.DUPLICADO,
            pagoId: error.pagoId,
            duplicado: true,
          },
          { status: error.httpStatus }
        )
      }

      // Los mensajes de LOOKUP_NO_COINCIDE los construye el servicio y son
      // seguros (solo describen la discrepancia, sin ids ni PII).
      return NextResponse.json(
        {
          error:
            error.codigo === "LOOKUP_NO_COINCIDE"
              ? error.message
              : MENSAJE_POR_CODIGO[error.codigo],
        },
        { status: error.httpStatus }
      )
    }

    logger.error("Error inesperado registrando pago PayPal manual", {
      ...logBase,
      error: error instanceof Error ? error.name : "Error desconocido",
    })

    return NextResponse.json(
      { error: MENSAJE_POR_CODIGO.ERROR_INTERNO },
      { status: 500 }
    )
  }
}
