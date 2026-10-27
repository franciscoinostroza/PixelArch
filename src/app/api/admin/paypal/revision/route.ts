/**
 * POST /api/admin/paypal/revision (T-17, AC-11/AC-17/AC-27).
 *
 * El admin acepta o rechaza un pago PayPal que quedo en `REVISION` por una
 * diferencia de monto o de moneda. Solo admin (`requireAdmin` estricto): la
 * asistente recibe 403. Rate limit 20/min.
 *
 * - `RECHAZAR` deja el pago en `REVISION` con `revisionEstado=RECHAZADO`; no
 *   aplica hito/meses ni emite recibo, y limpia un recibo previo si existiera.
 * - `ACEPTAR` aplica el concepto, pasa el pago a `SUCCEEDED`, registra quien
 *   resolvio y emite el recibo. Solo se acepta USD y el pago debe tener
 *   referencia externa.
 * - Una diferencia de moneda no se puede aceptar (ni con nota): se rechaza o se
 *   registra el cobro manualmente (T-15).
 *
 * No se loguean la nota ni datos del pagador: solo ids, accion, estado, montos
 * y referencias internas. Todas las respuestas llevan `Cache-Control:
 * no-store`.
 */

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import {
  esPaypalReviewError,
  resolverRevisionPaypal,
  type PaypalReviewErrorCodigo,
} from "@/lib/paypal/review"
import { paypalRevisionBodySchema } from "@/lib/paypal/validation"

const MENSAJE_POR_CODIGO: Record<PaypalReviewErrorCodigo, string> = {
  ARGUMENTOS_INVALIDOS: "Datos invalidos",
  PAGO_NO_ENCONTRADO: "Pago PayPal en revision no encontrado.",
  ESTADO_NO_REVISION: "El pago no esta pendiente de revision.",
  MONEDA_NO_ACEPTABLE:
    "No se puede aceptar un pago en moneda distinta de USD. Rechaza la revision y registra el cobro manualmente.",
  REFERENCIA_EXTERNA_FALTANTE:
    "El pago no tiene referencia externa de PayPal (externalId o paypalOrderId); no se puede emitir el recibo.",
  MONTO_INVALIDO:
    "El monto capturado del pago no es un entero USD positivo.",
  MESES_INVALIDOS:
    "Los meses del soporte deben ser un entero entre 1 y 12.",
  CONCEPTO_INVALIDO:
    "El pago no tiene un unico concepto (hito o soporte) vinculado.",
  HITO_NO_PENDIENTE:
    "El hito no esta pendiente y no se puede aplicar el pago.",
  SUSCRIPCION_NO_ENCONTRADA:
    "El soporte vinculado al pago no existe.",
  CONFLICTO: "El pago ya fue resuelto por otra operacion.",
  ERROR_INTERNO: "Error al resolver la revision del pago de PayPal.",
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-paypal-revision:${ip}`, 20, 60_000)) {
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

  const parsed = paypalRevisionBodySchema.safeParse(payload)
  if (!parsed.success) {
    return jsonNoStore({ error: "Datos invalidos" }, 400)
  }

  const body = parsed.data
  const staffId = admin.clerkUserId ?? admin.id
  const staffNombre = admin.nombre || "Admin"
  const logBase = {
    pagoId: body.pagoId,
    accion: body.accion,
    staffId,
    pasarela: "PAYPAL",
  }

  try {
    const resultado = await resolverRevisionPaypal({
      pagoId: body.pagoId,
      accion: body.accion,
      nota: body.nota ?? null,
      // `revisionResueltaPor` guarda el nombre visible + el identificador
      // estable del staff; el evento conserva solo el id.
      resueltoPor: staffId
        ? `${staffNombre} (${staffId})`
        : staffNombre,
      resueltoPorId: staffId,
    })

    logger.info("Revision de pago PayPal resuelta", {
      ...logBase,
      externalId: resultado.externalId,
      enlaceId: resultado.enlaceId,
      moneda: resultado.moneda,
      estadoPago: resultado.estadoPago,
      revisionEstado: resultado.revisionEstado,
      reciboId: resultado.reciboId,
      hitoAplicado: resultado.hitoAplicado,
      mesesAcreditados: resultado.mesesAcreditados,
      monto: resultado.monto,
      montoAcordado: resultado.montoAcordado,
      comision: resultado.comision,
    })

    return jsonNoStore({ ok: true, ...resultado })
  } catch (error) {
    if (esPaypalReviewError(error)) {
      const contexto = error.contexto
      logger.warn("No se pudo resolver la revision del pago PayPal", {
        ...logBase,
        externalId: contexto?.externalId ?? null,
        enlaceId: contexto?.enlaceId ?? null,
        moneda: contexto?.moneda ?? null,
        codigo: error.codigo,
      })

      return jsonNoStore(
        { error: MENSAJE_POR_CODIGO[error.codigo] },
        error.httpStatus
      )
    }

    logger.error("Error inesperado resolviendo la revision PayPal", {
      ...logBase,
      externalId: null,
      enlaceId: null,
      moneda: null,
      error: error instanceof Error ? error.name : "Error desconocido",
    })

    return jsonNoStore(
      { error: MENSAJE_POR_CODIGO.ERROR_INTERNO },
      500
    )
  }
}
