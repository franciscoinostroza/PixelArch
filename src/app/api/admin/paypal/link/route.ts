/**
 * POST /api/admin/paypal/link (T-08).
 *
 * Genera o reutiliza el link estable de PayPal de un hito o soporte. Solo
 * staff (admin/asistente). La ruta valida el body, verifica que el concepto
 * exista y siga pendiente (hito no pagado; soporte SOPORTE en ACTIVE/PAST_DUE)
 * y que no tenga un pago en revision sin resolver; despues delega en
 * `crearEnlacePaypal`, que aplica el gross-up y crea/reutiliza el enlace.
 *
 * No modifica el hito ni la suscripcion, no crea `Pago` y no toca Mercado Pago.
 * Los errores de configuracion devuelven un 503 generico: nunca se exponen
 * nombres de variables de entorno ni motivos internos.
 *
 * Rate limit: 20/min por IP antes de autenticar (plan §5.1).
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import { paypalConfig } from "@/lib/paypal/config"
import {
  MENSAJE_SOPORTE_NO_ELEGIBLE,
  crearEnlacePaypal,
  esPaypalLinkError,
  type PaypalLinkErrorCodigo,
} from "@/lib/paypal/links"
import { paypalLinkBodySchema } from "@/lib/paypal/validation"

const MENSAJE_NO_DISPONIBLE =
  "PayPal no disponible: configuracion incompleta o invalida."

const MENSAJE_POR_CODIGO: Record<PaypalLinkErrorCodigo, string> = {
  ARGUMENTOS_INVALIDOS: "Datos invalidos.",
  CONCEPTO_NO_ENCONTRADO: "Concepto no encontrado.",
  CONCEPTO_NO_ELEGIBLE: MENSAJE_SOPORTE_NO_ELEGIBLE,
  NO_CONFIGURADO: MENSAJE_NO_DISPONIBLE,
  REQUIERE_REGENERAR:
    "Ya existe un link PayPal vigente con otros datos. Regenerelo para aplicar el cambio.",
  PAYPAL_ERROR: "PayPal no pudo crear el checkout.",
  ERROR_INTERNO: "Error al generar el link de PayPal.",
}

interface ConceptoVerificado {
  clienteId: string
  hitoPagado: boolean
  suscripcionNoElegible: boolean
}

/**
 * Verifica que el concepto exista, este vinculado a un cliente y sea elegible:
 * los hitos no deben estar pagados; los soportes deben ser plan SOPORTE y estar
 * en ACTIVE o PAST_DUE. El 404 de inexistente/sin cliente tiene prioridad.
 */
async function verificarConcepto(
  hitoId: string | null,
  suscripcionId: string | null
): Promise<ConceptoVerificado | null> {
  if (hitoId) {
    const hito = await prisma.hito.findUnique({
      where: { id: hitoId },
      select: {
        id: true,
        estado: true,
        proyecto: { select: { clienteId: true } },
      },
    })

    if (!hito || !hito.proyecto?.clienteId) return null

    return {
      clienteId: hito.proyecto.clienteId,
      hitoPagado: hito.estado === "PAGADO",
      suscripcionNoElegible: false,
    }
  }

  if (!suscripcionId) return null

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { id: suscripcionId },
    select: { id: true, clienteId: true, estado: true, plan: true },
  })

  if (!suscripcion || !suscripcion.clienteId) return null

  const elegible =
    suscripcion.plan === "SOPORTE" &&
    (suscripcion.estado === "ACTIVE" || suscripcion.estado === "PAST_DUE")

  return {
    clienteId: suscripcion.clienteId,
    hitoPagado: false,
    suscripcionNoElegible: !elegible,
  }
}

async function tienePagoEnRevision(
  hitoId: string | null,
  suscripcionId: string | null
): Promise<boolean> {
  // Solo bloquea una revision PENDIENTE: T-17 deja los pagos RECHAZADOS en
  // estadoPago=REVISION y un link nuevo debe poder generarse.
  const where = hitoId
    ? {
        hitoId,
        estadoPago: "REVISION" as const,
        revisionEstado: "PENDIENTE" as const,
      }
    : {
        suscripcionId,
        estadoPago: "REVISION" as const,
        revisionEstado: "PENDIENTE" as const,
      }

  const pago = await prisma.pago.findFirst({
    where,
    select: { id: true },
  })

  return pago !== null
}

function respuestaErrorPaypal(error: {
  codigo: PaypalLinkErrorCodigo
  httpStatus: number
}): NextResponse {
  return NextResponse.json(
    { error: MENSAJE_POR_CODIGO[error.codigo] },
    { status: error.httpStatus }
  )
}

function fechaIso(valor: Date | string): string {
  return (valor instanceof Date ? valor : new Date(valor)).toISOString()
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-paypal-link:${ip}`, 20, 60_000)) {
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

  const parsed = paypalLinkBodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 })
  }

  const body = parsed.data
  const hitoId = body.hitoId ?? null
  const suscripcionId = body.suscripcionId ?? null

  if ((hitoId === null) === (suscripcionId === null)) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 })
  }

  const config = paypalConfig()
  if (!config.disponible) {
    return NextResponse.json({ error: MENSAJE_NO_DISPONIBLE }, { status: 503 })
  }

  let baseUrl: string
  try {
    baseUrl = new URL(req.url).origin
  } catch {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 })
  }

  try {
    const concepto = await verificarConcepto(hitoId, suscripcionId)
    if (!concepto) {
      return NextResponse.json({ error: "Concepto no encontrado." }, { status: 404 })
    }

    if (concepto.hitoPagado) {
      return NextResponse.json({ error: "El hito ya esta pagado." }, { status: 409 })
    }

    if (concepto.suscripcionNoElegible) {
      return NextResponse.json(
        { error: MENSAJE_SOPORTE_NO_ELEGIBLE },
        { status: 409 }
      )
    }

    if (await tienePagoEnRevision(hitoId, suscripcionId)) {
      return NextResponse.json(
        { error: "El concepto tiene un pago en revision pendiente de resolver." },
        { status: 409 }
      )
    }

    const resultado = await crearEnlacePaypal({
      hitoId,
      suscripcionId,
      montoAcordadoCents: body.montoAcordadoCents ?? null,
      meses: body.meses ?? null,
      descripcion: body.descripcion ?? null,
      notaInterna: body.notaInterna ?? null,
      generadoPor: staff.userId,
      generadoPorNombre: staff.nombre,
      idioma: body.idioma,
      regenerar: body.regenerar,
      baseUrl,
    })

    logger.info("Link PayPal generado", {
      enlaceId: resultado.enlace.id,
      hitoId,
      suscripcionId,
      monto: resultado.enlace.montoAcordado,
      comision: resultado.enlace.comision,
      total: resultado.enlace.total,
      moneda: resultado.enlace.moneda,
      reutilizado: resultado.reutilizado,
      staffId: staff.userId,
    })

    // El body incluye el link con su token: nunca debe quedar en caches.
    return NextResponse.json(
      {
        ok: true,
        enlaceId: resultado.enlace.id,
        url: resultado.url,
        montoAcordado: resultado.enlace.montoAcordado,
        comision: resultado.enlace.comision,
        total: resultado.enlace.total,
        moneda: resultado.enlace.moneda,
        expiraEn: fechaIso(resultado.enlace.expiraEn),
        reutilizado: resultado.reutilizado,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    if (esPaypalLinkError(error)) {
      logger.warn("No se pudo generar el link PayPal", {
        codigo: error.codigo,
        enlaceId: error.enlaceId,
        hitoId,
        suscripcionId,
        staffId: staff.userId,
      })
      return respuestaErrorPaypal(error)
    }

    logger.error("Error inesperado generando link PayPal", {
      error: error instanceof Error ? error.name : "Error desconocido",
      hitoId,
      suscripcionId,
      staffId: staff.userId,
    })
    return NextResponse.json(
      { error: "Error al generar el link de PayPal." },
      { status: 500 }
    )
  }
}
