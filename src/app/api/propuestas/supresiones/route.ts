/**
 * POST /api/propuestas/supresiones (T-20; AC-15..AC-18, AC-27, AC-36;
 * RF-23..RF-28, RF-56).
 *
 * Alta manual de una supresion global por email o dominio de negocio. No
 * envia emails, no llama a proveedores y no toca el CRM.
 *
 * Orden deliberado:
 *   1. guard admin Clerk-only (sin sesion 401; asistente 403);
 *   2. origen same-origin (403);
 *   3. rate limit 30/min por admin y 60/min por IP (429 + Retry-After);
 *   4. Zod (400): union discriminada EMAIL/DOMINIO;
 *   5. EMAIL sin `PROPUESTAS_SECRETO` falla cerrado con 503;
 *   6. alta idempotente + cancelacion de pendientes y marca SUPRIMIDO en una
 *      transaccion.
 *
 * La respuesta no incluye email, dominio ni notas: solo
 * `{ id, clave, creada, reactivada }` (201 si la clave es nueva, 200 si ya
 * existia; `reactivada` solo es `true` cuando una fila revocada volvio a
 * quedar activa). Los logs solo llevan ids, ambito y los booleanos de
 * creacion/reactivacion.
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
import { ErrorSupresion } from "@/lib/propuestas/supresion"
import {
  aplicarSupresionAProspectos,
  crearSupresion,
} from "@/lib/propuestas/supresiones"
import { supresionCreateSchema } from "@/lib/propuestas/validation"

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

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = supresionCreateSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data
  const adminId = admin.admin.userId

  // Una supresion por email se apoya en un HMAC: sin secreto no se puede
  // calcular la clave ni comparar el email actual. Falla cerrado.
  if (body.ambito === "EMAIL" && config.secreto === null) {
    return errorJson(503, "NO_CONFIGURADO")
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const creacion = await crearSupresion(
        {
          ambito: body.ambito,
          email: body.ambito === "EMAIL" ? body.email : null,
          dominioNegocio:
            body.ambito === "DOMINIO" ? body.dominioNegocio : null,
          motivo: body.motivo,
          origen: "MANUAL",
          notas: body.notas ?? null,
          creadaPor: adminId,
          creadaPorNombre: admin.admin.nombre,
          secreto: config.secreto,
        },
        { cliente: tx },
      )

      await aplicarSupresionAProspectos(
        {
          ambito: body.ambito,
          email: body.ambito === "EMAIL" ? body.email : null,
          dominioNegocio:
            body.ambito === "DOMINIO" ? body.dominioNegocio : null,
          secreto: config.secreto,
          motivo: body.motivo,
          por: adminId,
        },
        { cliente: tx },
      )

      return creacion
    })

    logger.info("Supresion manual registrada", {
      supresionId: resultado.id,
      adminId,
      ambito: body.ambito,
      creada: resultado.creada,
      reactivada: resultado.reactivada,
    })

    return json(
      {
        id: resultado.id,
        clave: resultado.clave,
        creada: resultado.creada,
        reactivada: resultado.reactivada,
      },
      resultado.creada ? 201 : 200,
    )
  } catch (error) {
    if (error instanceof ErrorSupresion) {
      // `SECRETO` ya se valido antes; se conserva el 503 por si la config
      // cambia entre la lectura y el hash. El resto es dato invalido: dominio
      // publico/multiinquilino o email no normalizable.
      logger.info("Supresion rechazada por datos", {
        adminId,
        ambito: body.ambito,
        codigo: error.codigo,
      })
      return error.codigo === "SECRETO"
        ? errorJson(503, "NO_CONFIGURADO")
        : errorJson(400, "VALIDACION")
    }

    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error registrando supresion manual", {
      codigo: sanitizado.codigo,
      adminId,
      ambito: body.ambito,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
