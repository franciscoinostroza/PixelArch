/**
 * POST /api/propuestas/plantillas (T-16; AC-22; RF-34, RF-37).
 *
 * Crea la versión 1 de una plantilla determinista. Reglas:
 * - guard admin Clerk-only, origen same-origin y rate limit 30/min por admin +
 *   60/min por IP (además del límite del portal);
 * - Zod valida longitudes antes de tocar Prisma;
 * - `validarPlantilla` aplica la lista blanca de variables, limpia el asunto de
 *   CR/LF/prefijos falsos y exige máximo 120;
 * - se guarda la lista canónica de variables realmente usadas, `version: 1` y
 *   `activa: true`;
 * - un P2002 por `(nombre, version)` responde 409 sin crear duplicados;
 * - no se envía ningún email ni se llama a un proveedor.
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
import {
  PlantillaInvalidaError,
  validarPlantilla,
} from "@/lib/propuestas/plantillas"
import { plantillaCreateSchema } from "@/lib/propuestas/validation"

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

function esErrorUnique(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  )
}

export async function POST(req: Request) {
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

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = plantillaCreateSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data
  const adminId = admin.admin.userId

  let validada: ReturnType<typeof validarPlantilla>
  try {
    validada = validarPlantilla({
      asunto: body.asunto,
      cuerpo: body.cuerpo,
      variablesPermitidas: body.variablesPermitidas,
      version: 1,
    })
  } catch (error) {
    if (error instanceof PlantillaInvalidaError) {
      // El codigo de plantilla no incluye contenido: es seguro loguearlo.
      logger.info("Plantilla rechazada", {
        adminId,
        codigo: error.codigo,
      })
      return errorJson(400, "VALIDACION")
    }
    throw error
  }

  try {
    const plantilla = await prisma.plantillaPropuesta.create({
      data: {
        nombre: body.nombre,
        idioma: body.idioma,
        asunto: validada.asunto,
        cuerpo: validada.cuerpo,
        variablesPermitidas: validada.variablesPermitidas,
        version: 1,
        activa: true,
        creadaPor: adminId,
        creadaPorNombre: admin.admin.nombre,
      },
      select: { id: true, version: true },
    })

    logger.info("Plantilla creada", {
      plantillaId: plantilla.id,
      version: plantilla.version,
      adminId,
      variables: validada.variablesPermitidas.length,
    })

    return json({ id: plantilla.id, version: plantilla.version }, 201)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error creando plantilla", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
