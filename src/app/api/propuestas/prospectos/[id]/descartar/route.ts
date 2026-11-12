/**
 * POST /api/propuestas/prospectos/[id]/descartar (T-14; AC-13, RF-18).
 *
 * Descarta un prospecto con motivo obligatorio y cancela, en la misma
 * transaccion, los envios BORRADOR/APROBADO pendientes del prospecto. No borra
 * el prospecto, no borra supresiones y no toca el CRM.
 *
 * - guard admin, origen y rate limit;
 * - 404 si no existe; 409 SUPRIMIDO si esta suprimido; 409 ESTADO si ya esta
 *   descartado;
 * - la transicion usa `updateMany` filtrado para no pisar un SUPRIMIDO
 *   concurrente;
 * - el historial guarda accion, motivo, autor y fecha, sin datos del prospecto.
 */

import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
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
import { agregarEntradaHistorial } from "@/lib/propuestas/prospectos"
import { prospectoDescartarSchema } from "@/lib/propuestas/validation"

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

  const parsed = prospectoDescartarSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const motivo = parsed.data.motivo

  try {
    const prospecto = await prisma.prospecto.findUnique({
      where: { id },
      select: { id: true, estado: true, historial: true },
    })

    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")
    if (prospecto.estado === "SUPRIMIDO") return errorJson(409, "SUPRIMIDO")
    if (prospecto.estado === "DESCARTADO") return errorJson(409, "ESTADO")

    const ahora = new Date()
    const historial = agregarEntradaHistorial(prospecto.historial, {
      accion: "DESCARTE",
      motivo,
      por: adminId,
      en: ahora.toISOString(),
    })

    const resultado = await prisma.$transaction(async (tx) => {
      // El filtro de estado evita pisar un SUPRIMIDO o un DESCARTADO que
      // hayan ganado la carrera entre la lectura y esta escritura.
      const actualizado = await tx.prospecto.updateMany({
        where: {
          id,
          estado: { notIn: ["SUPRIMIDO", "DESCARTADO"] },
        },
        data: {
          estado: "DESCARTADO",
          historial: historial as unknown as Prisma.InputJsonValue,
          actualizadoPor: adminId,
          ultimaInteraccionEn: ahora,
        },
      })

      if (actualizado.count === 0) {
        return { actualizado: false, cancelados: 0 }
      }

      const cancelados = await tx.envioPropuesta.updateMany({
        where: {
          prospectoId: id,
          estado: { in: ["BORRADOR", "APROBADO"] },
        },
        data: {
          estado: "CANCELADO",
          motivoCancelacion: motivo,
        },
      })

      return { actualizado: true, cancelados: cancelados.count }
    })

    if (!resultado.actualizado) {
      const actual = await prisma.prospecto.findUnique({
        where: { id },
        select: { estado: true },
      })

      if (!actual) return errorJson(404, "NO_ENCONTRADO")
      return actual.estado === "SUPRIMIDO"
        ? errorJson(409, "SUPRIMIDO")
        : errorJson(409, "ESTADO")
    }

    logger.info("Prospecto descartado", {
      prospectoId: id,
      adminId,
      enviosCancelados: resultado.cancelados,
    })

    return json({ estado: "DESCARTADO" }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error descartando prospecto", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
