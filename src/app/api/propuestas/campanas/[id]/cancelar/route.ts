/**
 * POST /api/propuestas/campanas/[id]/cancelar (T-13; AC-11, RF-12, RF-17).
 *
 * Cancela una campana en `BORRADOR` o `EN_CURSO`. La transicion es atomica
 * (`updateMany` filtrado por estado) para que un doble clic o una campana ya
 * terminal no se sobreescriba. Una campana cancelada no se reanuda: para
 * reintentar se crea otra.
 *
 * Guard admin Clerk-only + origen + rate limit + confirmacion explicita. La
 * respuesta no incluye prospectos, consulta ni datos de PII; solo el estado.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { origenPermitido } from "@/lib/propuestas/origen"
import { campanaAccionSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000

function json(
  cuerpo: unknown,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(cuerpo, {
    status,
    headers: { ...NO_STORE, ...headers },
  })
}

function errorJson(
  status: number,
  codigo: CodigoError,
  headers: Record<string, string> = {},
): NextResponse {
  const { mensaje } = sanitizarError(null, { codigo })
  return json({ error: mensaje, codigo }, status, headers)
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await resolverAdminPropuestas()
  if (!admin.ok) {
    return admin.motivo === "SIN_SESION"
      ? errorJson(401, "NO_AUTORIZADO")
      : errorJson(403, "PROHIBIDO")
  }

  if (!origenPermitido(req, configPropuestas().urlPublica)) {
    return errorJson(403, "ORIGEN_INVALIDO")
  }

  const limiteAdmin = rateLimitDetalle(
    `propuestas:${admin.admin.userId}`,
    LIMITE_ADMIN,
    VENTANA_MS,
  )
  if (!limiteAdmin.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteAdmin.retryAfterSegundos),
    })
  }

  const limiteIp = rateLimitDetalle(
    `propuestas:ip:${ipDe(req)}`,
    LIMITE_IP,
    VENTANA_MS,
  )
  if (!limiteIp.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteIp.retryAfterSegundos),
    })
  }

  const { id } = await params
  const adminId = admin.admin.userId

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = campanaAccionSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  try {
    const cancelada = await prisma.campanaProspeccion.updateMany({
      where: { id, estado: { in: ["BORRADOR", "EN_CURSO"] } },
      data: { estado: "CANCELADA", finalizadaEn: new Date() },
    })

    if (cancelada.count === 0) {
      const existe = await prisma.campanaProspeccion.findUnique({
        where: { id },
        select: { id: true },
      })
      return existe
        ? errorJson(409, "ESTADO")
        : errorJson(404, "NO_ENCONTRADO")
    }

    logger.info("Campana de propuestas cancelada", { campanaId: id, adminId })

    return json({ estado: "CANCELADA" }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })
    logger.error("Error cancelando campana de propuestas", {
      codigo: sanitizado.codigo,
      campanaId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
