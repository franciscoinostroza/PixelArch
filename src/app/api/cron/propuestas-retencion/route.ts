/**
 * GET /api/cron/propuestas-retencion (T-22; AC-40; RF-30, RF-65).
 *
 * Purga programada de prospectos vencidos (plan §7.5). La Railway Function
 * `propuestas-retencion` la invoca con `Authorization: Bearer $CRON_SECRET`.
 *
 * - Sin secreto configurado, sin header o con un token distinto: `401`; no se
 *   ejecuta ninguna consulta.
 * - El advisory lock evita solapamientos; si otra corrida lo tiene, responde
 *   `200 { omitido: true }`.
 * - La respuesta y los logs solo llevan booleanos y contadores: nunca ids de
 *   prospectos, emails, nombres ni detalles de esquema.
 */

import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import {
  ErrorRetencion,
  purgarProspectosVencidos,
} from "@/lib/propuestas/retencion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

function json(cuerpo: unknown, status: number): NextResponse {
  return NextResponse.json(cuerpo, { status, headers: NO_STORE })
}

function autorizado(req: Request): boolean {
  const secreto = process.env.CRON_SECRET
  if (typeof secreto !== "string" || secreto.length === 0) return false

  const header = req.headers.get("authorization")
  if (!header) return false

  const coincidencia = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!coincidencia) return false

  const recibido = coincidencia[1].trim()
  const esperado = secreto.trim()
  if (recibido.length === 0 || esperado.length === 0) return false

  const a = Buffer.from(recibido, "utf8")
  const b = Buffer.from(esperado, "utf8")
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

function statusDeCodigo(codigo: CodigoError): number {
  switch (codigo) {
    case "NO_AUTORIZADO":
      return 401
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

function errorJson(codigo: CodigoError): NextResponse {
  return json({ error: sanitizarError(null, { codigo }).mensaje, codigo }, statusDeCodigo(codigo))
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return errorJson("NO_AUTORIZADO")
  }

  const config = configPropuestas()

  try {
    const resultado = await purgarProspectosVencidos({
      meses: config.limites.retencionMeses,
    })

    logger.info("Retencion de propuestas ejecutada", {
      origen: "CRON",
      meses: config.limites.retencionMeses,
      omitido: resultado.omitido,
      eliminados: resultado.eliminados,
      lotes: resultado.lotes,
    })

    return json(
      {
        ok: true,
        omitido: resultado.omitido,
        eliminados: resultado.eliminados,
        lotes: resultado.lotes,
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

    logger.error("Error en retencion de propuestas", {
      origen: "CRON",
      codigo: sanitizado.codigo,
    })

    return json({ error: sanitizado.mensaje, codigo: sanitizado.codigo }, statusDeCodigo(sanitizado.codigo))
  }
}
