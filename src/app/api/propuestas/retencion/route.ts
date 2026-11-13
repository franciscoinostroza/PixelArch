/**
 * POST /api/propuestas/retencion (T-22; AC-40; RF-30, RF-65).
 *
 * Purga manual de prospectos vencidos. Alternativa administrativa al cron del
 * plan §7.5. Reglas:
 * - guard admin Clerk-only (sin sesión 401; asistente 403);
 * - origen same-origin (403) y rate limit 30/min por admin + 60/min por IP;
 * - ejecuta la misma purga que el cron, con el corte de la config (12 meses);
 * - `200 { eliminados, lotes, omitido }`; `no-store`;
 * - no borra supresiones, no toca el CRM y no devuelve PII ni detalles de
 *   esquema.
 */

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
import {
  ErrorRetencion,
  purgarProspectosVencidos,
} from "@/lib/propuestas/retencion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000

function json(cuerpo: unknown, status: number): NextResponse {
  return NextResponse.json(cuerpo, { status, headers: NO_STORE })
}

function errorJson(
  status: number,
  codigo: CodigoError,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: sanitizarError(null, { codigo }).mensaje, codigo },
    { status, headers: { ...NO_STORE, ...headers } },
  )
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

function statusDeCodigo(codigo: CodigoError): number {
  switch (codigo) {
    case "VALIDACION":
      return 400
    case "NO_CONFIGURADO":
    case "CONFIGURACION":
    case "ESQUEMA_NO_APLICADO":
      return 503
    default:
      return 500
  }
}

export async function POST(req: Request) {
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

  const adminId = admin.admin.userId

  try {
    const resultado = await purgarProspectosVencidos({
      meses: config.limites.retencionMeses,
    })

    logger.info("Retencion de propuestas ejecutada", {
      origen: "ADMIN",
      adminId,
      meses: config.limites.retencionMeses,
      omitido: resultado.omitido,
      eliminados: resultado.eliminados,
      lotes: resultado.lotes,
    })

    return json(
      {
        eliminados: resultado.eliminados,
        lotes: resultado.lotes,
        omitido: resultado.omitido,
      },
      200,
    )
  } catch (error) {
    const codigo: CodigoError =
      error instanceof ErrorRetencion
        ? error.codigo
        : esErrorTablaFaltante(error)
          ? "ESQUEMA_NO_APLICADO"
          : "DESCONOCIDO"

    const sanitizado = sanitizarError(error, {
      codigo,
      // Nunca se devuelve el mensaje crudo de Prisma/proveedor: puede incluir
      // nombres de tablas, valores o PII.
      mensaje: sanitizarError(null, { codigo }).mensaje,
    })

    logger.error("Error en purga manual de propuestas", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json(
      { error: sanitizado.mensaje, codigo: sanitizado.codigo },
      statusDeCodigo(sanitizado.codigo),
    )
  }
}
