/**
 * POST /api/propuestas/supresiones/[id]/purga (T-20; AC-15..AC-18, AC-27,
 * AC-36; RF-23..RF-28, RF-56).
 *
 * Purga manual de una supresion **ya revocada**: hard delete de la fila
 * `SupresionProspecto` con motivo explicito. Es una excepcion administrativa;
 * no toca prospectos, envios ni historial de prospecto.
 *
 * El texto del motivo no se persiste ni se loguea: puede contener nombre,
 * telefono u otra PII. El log operativo solo lleva `supresionId`, `ambito`,
 * `adminId`, `motivoLongitud` y un hash SHA-256 del motivo. Una auditoria
 * durable del texto requeriria una tabla dedicada, fuera del alcance de T-20.
 *
 * Orden: guard admin (401/403), origen (403), rate limit 30/60 (429), Zod
 * (400), 404 si no existe, 409 si sigue activa (primero revocar). Sin PII en
 * logs.
 */

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
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
import { purgarSupresion } from "@/lib/propuestas/supresiones"
import { supresionRevocarSchema as supresionPurgaSchema } from "@/lib/propuestas/validation"

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

/** Hash estable del motivo para trazabilidad operativa sin PII. */
function hashMotivo(motivo: string): string {
  return createHash("sha256").update(motivo, "utf8").digest("hex")
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

  const config = configPropuestas()

  if (!origenPermitido(req, config.urlPublica)) {
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

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = supresionPurgaSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const adminId = admin.admin.userId
  const motivo = parsed.data.motivo

  try {
    const resultado = await purgarSupresion({ id, motivo, por: adminId })

    if (!resultado.ok) {
      return resultado.motivo === "NO_ENCONTRADO"
        ? errorJson(404, "NO_ENCONTRADO")
        : errorJson(409, "ESTADO")
    }

    logger.info("Supresion purgada", {
      supresionId: resultado.id,
      ambito: resultado.ambito,
      adminId,
      motivoLongitud: motivo.length,
      motivoHash: hashMotivo(motivo),
    })

    return json({ id: resultado.id, purgada: true }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error purgando supresion", {
      codigo: sanitizado.codigo,
      supresionId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
