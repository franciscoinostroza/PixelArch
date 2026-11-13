/**
 * POST /api/propuestas/envios/[id]/reconciliar (T-18; AC-28; RF-43, RF-49).
 *
 * Desbloqueo **manual** de un envio que quedo en `ENVIANDO` (por ejemplo, si
 * el proceso murio entre la transicion y la respuesta de Resend). No consulta
 * al proveedor, no reintenta y no envia nada: el admin verifica el estado en
 * el panel de Resend y deja una nota. El envio pasa a `FALLIDO`, desde donde
 * el unico camino es el reintento manual (`version+1` + nueva aprobacion).
 *
 * Solo se acepta `ENVIANDO` y que hayan pasado mas de 10 minutos desde
 * `enviadoEn` (o `actualizadoEn`). `200 { estado: "FALLIDO" }`.
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
import { normalizarEstadoEnvio } from "@/lib/propuestas/transiciones"
import { envioReconciliarSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000
const ESPERA_MINIMA_MS = 10 * 60_000

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

function notaSanitizada(nota: string): string {
  const sanitizada = sanitizarError(nota, {
    codigo: "VALIDACION",
    mensaje: nota,
  })
  return sanitizada.mensaje
}

function cargarEnvio(id: string) {
  return prisma.envioPropuesta.findUnique({
    where: { id },
    select: {
      id: true,
      estado: true,
      enviadoEn: true,
      actualizadoEn: true,
    },
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

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = envioReconciliarSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  try {
    const envio = await cargarEnvio(id)
    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    if (normalizarEstadoEnvio(envio.estado) !== "ENVIANDO") {
      return errorJson(409, "ESTADO")
    }

    const referencia = envio.enviadoEn ?? envio.actualizadoEn
    const transcurrido = Date.now() - referencia.getTime()
    if (!Number.isFinite(transcurrido) || transcurrido < ESPERA_MINIMA_MS) {
      logger.info("Reconciliacion rechazada por antiguedad", {
        envioId: id,
        adminId,
      })
      return errorJson(409, "ESTADO")
    }

    const actualizado = await prisma.envioPropuesta.updateMany({
      where: { id: envio.id, estado: "ENVIANDO" },
      data: {
        estado: "FALLIDO",
        error: notaSanitizada(parsed.data.nota),
      },
    })

    if (actualizado.count === 0) return errorJson(409, "ESTADO")

    logger.info("Envio reconciliado manualmente", {
      envioId: envio.id,
      adminId,
    })

    return json({ estado: "FALLIDO" }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error reconciliando envio", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
