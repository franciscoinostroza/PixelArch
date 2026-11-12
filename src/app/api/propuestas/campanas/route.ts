/**
 * POST /api/propuestas/campanas (T-12; AC-7, AC-14; RF-9, RF-12).
 *
 * Crea una campana de prospeccion en `BORRADOR`. No busca en Places, no visita
 * webs, no audita y no envia emails: eso queda para T-13 y el envio detras del
 * gate correspondiente.
 *
 * Orden deliberado:
 *   1. guard admin Clerk-only (sin sesion 401; no admin 403);
 *   2. origen same-origin (403);
 *   3. rate limit 30/min por admin y 60/min por IP (429 + Retry-After);
 *   4. Zod (400);
 *   5. idempotencia por `idempotencyKey`.
 *
 * La campana guarda siempre `filtros.soloConWeb = true`: v1 no crea prospectos
 * de Places sin sitio web, por lo que cualquier filtro enviado por el cliente
 * se ignora. No se registran datos del formulario en logs.
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
import { campanaCreateSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000

interface CampanaIdempotente {
  id: string
  estado: string
  creadaPor: string
}

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

async function buscarPorIdempotencyKey(
  idempotencyKey: string,
): Promise<CampanaIdempotente | null> {
  return prisma.campanaProspeccion.findUnique({
    where: { idempotencyKey },
    select: { id: true, estado: true, creadaPor: true },
  })
}

/**
 * La clave de idempotencia es global. Si pertenece a otro admin no se revela
 * ningun dato de la campana: se responde el 409 generico de estado.
 */
function respuestaExistente(
  campana: CampanaIdempotente,
  adminId: string,
): NextResponse {
  if (campana.creadaPor !== adminId) {
    return errorJson(409, "ESTADO")
  }

  return json(
    { id: campana.id, estado: campana.estado, reutilizada: true },
    200,
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

  const parsed = campanaCreateSchema.safeParse(payload)
  if (!parsed.success) {
    return errorJson(400, "VALIDACION")
  }

  const body = parsed.data
  const adminId = admin.admin.userId

  try {
    // Doble clic o reintento de red: la campana ya existe.
    const existente = await buscarPorIdempotencyKey(body.idempotencyKey)
    if (existente) return respuestaExistente(existente, adminId)

    if (body.plantillaId) {
      const plantilla = await prisma.plantillaPropuesta.findFirst({
        where: { id: body.plantillaId, activa: true },
        select: { id: true },
      })
      if (!plantilla) return errorJson(400, "VALIDACION")
    }

    try {
      const campana = await prisma.campanaProspeccion.create({
        data: {
          nombre: body.nombre,
          consulta: body.consulta,
          zona: body.zona ?? null,
          rubro: body.rubro ?? null,
          estado: "BORRADOR",
          limiteCorrida: body.limiteCorrida,
          plantillaId: body.plantillaId ?? null,
          creadaPor: adminId,
          creadaPorNombre: admin.admin.nombre,
          idempotencyKey: body.idempotencyKey,
          // v1 exige sitio web: el servidor manda y no confia en el cliente.
          filtros: { soloConWeb: true },
        },
        select: { id: true },
      })

      return json({ id: campana.id, estado: "BORRADOR" }, 201)
    } catch (error) {
      // Carrera de unique: otra request gano. Se reutiliza la existente con la
      // misma regla de creador; nunca se crea un duplicado.
      if (esErrorUnique(error)) {
        const ganadora = await buscarPorIdempotencyKey(body.idempotencyKey)
        if (ganadora) return respuestaExistente(ganadora, adminId)
      }
      throw error
    }
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    // Error inesperado: mensaje canonico. No se exponen detalles de Prisma ni
    // de la base; el sanitizador se aplica igual por si el mensaje se loguea.
    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })
    // Solo ids y codigo: nunca body, nombre de campana, consulta ni PII.
    logger.error("Error creando campana de propuestas", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
