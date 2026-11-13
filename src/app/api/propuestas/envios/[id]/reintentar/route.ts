/**
 * POST /api/propuestas/envios/[id]/reintentar (T-18; AC-28, AC-31; RF-43,
 * RF-49, RF-50).
 *
 * Reintento **manual** de un envio `FALLIDO`. No llama a Resend, no programa
 * nada y no reutiliza la aprobacion anterior:
 * - exige estado `FALLIDO`, un prospecto que no este `SUPRIMIDO` ni
 *   `DESCARTADO` y que no haya otro envio abierto para la misma secuencia
 *   (BORRADOR/APROBADO/ENVIANDO);
 * - crea `version+1` en `BORRADOR` con el mismo contenido y snapshot base,
 *   `hashContenido` recomputado y todos los campos `aprobado*` limpios;
 * - el admin debe editarlo/guardarlo y aprobarlo de nuevo antes de enviar.
 *
 * `201 { envioId, version }`. Logs solo con ids y version; sin PII.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import { hashContenidoEnvio } from "@/lib/propuestas/envios"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { origenPermitido } from "@/lib/propuestas/origen"
import { normalizarEstadoEnvio } from "@/lib/propuestas/transiciones"

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

function cargarEnvio(id: string) {
  return prisma.envioPropuesta.findUnique({
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
      fromEmail: true,
      fromNombre: true,
      replyTo: true,
      asunto: true,
      cuerpoHtml: true,
      cuerpoTexto: true,
      estado: true,
    },
  })
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: { id: true, estado: true },
  })
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

  if (config.urlPublica !== null && !origenPermitido(req, config.urlPublica)) {
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

  try {
    const envio = await cargarEnvio(id)
    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    if (normalizarEstadoEnvio(envio.estado) !== "FALLIDO") {
      logger.info("Reintento rechazado por estado", {
        envioId: id,
        adminId,
        estado: envio.estado,
      })
      return errorJson(409, "ESTADO")
    }

    const prospecto = await cargarProspecto(envio.prospectoId)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    // Un contacto suprimido o descartado no vuelve a generar borradores: la
    // supresion se revoca solo con la accion administrativa de T-20.
    if (prospecto.estado === "SUPRIMIDO") {
      logger.info("Reintento rechazado por supresion", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "SUPRIMIDO")
    }

    if (prospecto.estado === "DESCARTADO") {
      logger.info("Reintento rechazado por prospecto descartado", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "ESTADO")
    }

    const abierto = await prisma.envioPropuesta.findFirst({
      where: {
        prospectoId: envio.prospectoId,
        secuencia: envio.secuencia,
        estado: { in: ["BORRADOR", "APROBADO", "ENVIANDO"] },
      },
      select: { id: true },
    })

    if (abierto) {
      return errorJson(409, "BORRADOR_ABIERTO")
    }

    let hashContenido: string
    try {
      hashContenido = hashContenidoEnvio({
        asunto: envio.asunto,
        cuerpoTexto: envio.cuerpoTexto,
        cuerpoHtml: envio.cuerpoHtml,
        destinatario: envio.destinatario,
        plantillaId: envio.plantillaId,
        plantillaVersion: envio.plantillaVersion,
        secuencia: envio.secuencia,
      })
    } catch {
      return errorJson(409, "REVALIDACION")
    }

    const version = envio.version + 1

    const nueva = await prisma.envioPropuesta.create({
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
        asunto: envio.asunto,
        cuerpoHtml: envio.cuerpoHtml,
        cuerpoTexto: envio.cuerpoTexto,
        hashContenido,
        estado: "BORRADOR",
      },
      select: { id: true, version: true },
    })

    logger.info("Reintento manual creo un borrador", {
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

    logger.error("Error reintentando envio", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
