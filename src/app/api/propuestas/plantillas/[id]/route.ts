/**
 * PATCH /api/propuestas/plantillas/[id] (T-16; AC-22, AC-24; RF-37, RF-38).
 *
 * Editar una plantilla NUNCA modifica la versión existente: crea una versión
 * nueva (`version+1`) con el mismo nombre, desactiva la anterior y conserva el
 * historial. Los borradores y envíos ya creados mantienen su snapshot y su
 * `plantillaVersion`; no se reescriben ni se envían.
 *
 * - guard admin, origen y rate limit;
 * - 404 si la plantilla no existe;
 * - Zod + `validarPlantilla` (lista blanca, asunto limpio y máximo 120);
 * - la versión se calcula dentro de una transacción y se reintenta ante un
 *   P2002 por `(nombre, version)`; si el choque persiste responde 409;
 * - la anterior (y cualquier versión previa con el mismo nombre) queda
 *   `activa: false`, así solo hay una versión activa por nombre.
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
import {
  PlantillaInvalidaError,
  validarPlantilla,
  type PlantillaValidada,
} from "@/lib/propuestas/plantillas"
import { plantillaPatchSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000
const MAX_INTENTOS_VERSION = 3

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

interface VersionCreada {
  id: string
  version: number
}

/**
 * Crea la siguiente versión y desactiva las anteriores en la misma transacción.
 * Ante un P2002 (otra request calculó el mismo `version`) reintenta con el
 * máximo ya persistido; nunca actualiza la fila original.
 */
async function crearVersion(
  nombre: string,
  datos: {
    idioma: string
    asunto: string
    cuerpo: string
    variablesPermitidas: string[]
    creadaPor: string
    creadaPorNombre: string
  },
): Promise<VersionCreada> {
  let ultimoError: unknown = null

  for (let intento = 0; intento < MAX_INTENTOS_VERSION; intento += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ultima = await tx.plantillaPropuesta.findFirst({
          where: { nombre },
          orderBy: { version: "desc" },
          select: { version: true },
        })

        const version = (ultima?.version ?? 0) + 1
        const nueva = await tx.plantillaPropuesta.create({
          data: {
            nombre,
            idioma: datos.idioma,
            asunto: datos.asunto,
            cuerpo: datos.cuerpo,
            variablesPermitidas:
              datos.variablesPermitidas as unknown as Prisma.InputJsonValue,
            version,
            activa: true,
            creadaPor: datos.creadaPor,
            creadaPorNombre: datos.creadaPorNombre,
          },
          select: { id: true, version: true },
        })

        await tx.plantillaPropuesta.updateMany({
          where: { nombre, activa: true, id: { not: nueva.id } },
          data: { activa: false },
        })

        return nueva
      })
    } catch (error) {
      if (esErrorUnique(error)) {
        ultimoError = error
        continue
      }
      throw error
    }
  }

  throw ultimoError ?? new Error("No se pudo crear la version de la plantilla.")
}

export async function PATCH(
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

  const parsed = plantillaPatchSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data

  let validada: PlantillaValidada
  try {
    validada = validarPlantilla({
      asunto: body.asunto,
      cuerpo: body.cuerpo,
      variablesPermitidas: body.variablesPermitidas,
    })
  } catch (error) {
    if (error instanceof PlantillaInvalidaError) {
      logger.info("Version de plantilla rechazada", {
        plantillaId: id,
        adminId,
        codigo: error.codigo,
      })
      return errorJson(400, "VALIDACION")
    }
    throw error
  }

  try {
    const actual = await prisma.plantillaPropuesta.findUnique({
      where: { id },
      select: { id: true, nombre: true },
    })

    if (!actual) return errorJson(404, "NO_ENCONTRADO")

    const nueva = await crearVersion(actual.nombre, {
      idioma: body.idioma,
      asunto: validada.asunto,
      cuerpo: validada.cuerpo,
      variablesPermitidas: validada.variablesPermitidas,
      creadaPor: adminId,
      creadaPorNombre: admin.admin.nombre,
    })

    logger.info("Version de plantilla creada", {
      plantillaId: nueva.id,
      plantillaAnteriorId: actual.id,
      version: nueva.version,
      adminId,
    })

    return json({ id: nueva.id, version: nueva.version }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error versionando plantilla", {
      codigo: sanitizado.codigo,
      plantillaId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
