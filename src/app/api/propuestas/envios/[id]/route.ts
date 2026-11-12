/**
 * PATCH /api/propuestas/envios/[id] (T-16; AC-24; RF-38).
 *
 * Edición manual del contenido de un envío:
 * - BORRADOR: se actualiza en sitio (misma fila y versión) y se recalcula
 *   `hashContenido`.
 * - APROBADO: se crea una versión nueva (`version+1`, misma secuencia) en
 *   BORRADOR con el contenido/hash nuevos y la anterior queda CANCELADO con
 *   `motivoCancelacion`. La aprobación previa queda invalidada: no se puede
 *   enviar hasta aprobar de nuevo.
 * - Otro estado: 409 ESTADO. Nunca se llama a Resend ni a un LLM y no se
 *   modifica el prospecto ni el CRM.
 *
 * El asunto se limpia de CR/LF/prefijos falsos y el cuerpo se valida sin
 * variables pendientes; el HTML se regenera con escape. Logs sin contenido ni
 * PII.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  EnvioInvalidoError,
  MOTIVO_CANCELACION_EDICION,
  hashContenidoEnvio,
  validarContenidoEnvio,
} from "@/lib/propuestas/envios"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { origenPermitido } from "@/lib/propuestas/origen"
import { evaluarEdicionEnvio } from "@/lib/propuestas/transiciones"
import { envioEdicionSchema } from "@/lib/propuestas/validation"

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

  const parsed = envioEdicionSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  let contenido: ReturnType<typeof validarContenidoEnvio>
  try {
    contenido = validarContenidoEnvio(
      parsed.data.asunto,
      parsed.data.cuerpoTexto,
    )
  } catch (error) {
    if (error instanceof EnvioInvalidoError) {
      logger.info("Edicion de envio rechazada", {
        envioId: id,
        adminId,
        codigo: error.codigo,
      })
      return errorJson(400, "VALIDACION")
    }
    throw error
  }

  try {
    const envio = await prisma.envioPropuesta.findUnique({
      where: { id },
      select: {
        id: true,
        prospectoId: true,
        campanaId: true,
        plantillaId: true,
        plantillaVersion: true,
        secuencia: true,
        version: true,
        destinatario: true,
        estado: true,
        fromEmail: true,
        fromNombre: true,
        replyTo: true,
      },
    })

    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    const edicion = evaluarEdicionEnvio(envio.estado)
    if (!edicion.permitido) return errorJson(409, "ESTADO")

    const hashContenido = hashContenidoEnvio({
      asunto: contenido.asunto,
      cuerpoTexto: contenido.cuerpoTexto,
      cuerpoHtml: contenido.cuerpoHtml,
      destinatario: envio.destinatario,
      plantillaId: envio.plantillaId,
      plantillaVersion: envio.plantillaVersion,
      secuencia: envio.secuencia,
    })

    if (!edicion.crearVersion) {
      const actualizado = await prisma.envioPropuesta.updateMany({
        where: { id, estado: "BORRADOR" },
        data: {
          asunto: contenido.asunto,
          cuerpoTexto: contenido.cuerpoTexto,
          cuerpoHtml: contenido.cuerpoHtml,
          hashContenido,
        },
      })

      if (actualizado.count === 0) {
        const actual = await prisma.envioPropuesta.findUnique({
          where: { id },
          select: { estado: true },
        })
        if (!actual) return errorJson(404, "NO_ENCONTRADO")
        return errorJson(409, "ESTADO")
      }

      logger.info("Borrador editado", {
        envioId: id,
        prospectoId: envio.prospectoId,
        version: envio.version,
        adminId,
      })

      return json({ envioId: id, version: envio.version }, 200)
    }

    const version = envio.version + 1

    const nueva = await prisma.$transaction(async (tx) => {
      // La aprobación anterior se invalida con guarda exacta de estado: si ya
      // cambió (por ejemplo, un envío concurrente), no se crea otra versión.
      const cancelado = await tx.envioPropuesta.updateMany({
        where: { id, estado: "APROBADO" },
        data: {
          estado: "CANCELADO",
          motivoCancelacion: MOTIVO_CANCELACION_EDICION,
        },
      })

      if (cancelado.count === 0) return null

      return tx.envioPropuesta.create({
        data: {
          prospectoId: envio.prospectoId,
          campanaId: envio.campanaId,
          plantillaId: envio.plantillaId,
          plantillaVersion: envio.plantillaVersion,
          secuencia: envio.secuencia,
          version,
          destinatario: envio.destinatario,
          fromEmail: envio.fromEmail,
          fromNombre: envio.fromNombre,
          replyTo: envio.replyTo,
          asunto: contenido.asunto,
          cuerpoHtml: contenido.cuerpoHtml,
          cuerpoTexto: contenido.cuerpoTexto,
          hashContenido,
          estado: "BORRADOR",
        },
        select: { id: true, version: true },
      })
    })

    if (!nueva) return errorJson(409, "ESTADO")

    logger.info("Version de envio creada por edicion", {
      envioId: nueva.id,
      envioAnteriorId: id,
      prospectoId: envio.prospectoId,
      secuencia: envio.secuencia,
      version: nueva.version,
      adminId,
    })

    return json({ envioId: nueva.id, version: nueva.version }, 201)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error editando envio", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
