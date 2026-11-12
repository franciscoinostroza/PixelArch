/**
 * PATCH /api/propuestas/prospectos/[id] (T-14; AC-13, AC-14, AC-19;
 * RF-18, RF-22).
 *
 * Corrige un prospecto existente con motivo obligatorio. Reglas:
 * - guard admin, origen y rate limit;
 * - 404 si no existe; 409 SUPRIMIDO si esta suprimido (no se toca sin revocar);
 * - solo se aplican los campos de `PROSPECTO_CAMPOS_CORREGIBLES`;
 * - si cambia el email se exige una fuente (`emailFuenteUrl` o `fuenteUrl`,
 *   del body o ya registrada), se normaliza, se comprueba supresion y no se
 *   permite un email exacto de otro prospecto;
 * - si cambia el sitio se recalcula `dominioNormalizado` y se rechazan redes,
 *   marketplaces, agregadores y proveedores publicos;
 * - el historial guarda accion, nombres de campos, motivo, autor y fecha,
 *   nunca los valores (sin PII).
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
import { dominioNegocio, normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import {
  agregarEntradaHistorial,
  normalizarSitioManual,
} from "@/lib/propuestas/prospectos"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import { prospectoPatchSchema } from "@/lib/propuestas/validation"

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

  const parsed = prospectoPatchSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data

  try {
    const prospecto = await prisma.prospecto.findUnique({
      where: { id },
      select: {
        id: true,
        estado: true,
        nombreNegocio: true,
        sitioWeb: true,
        dominioNormalizado: true,
        email: true,
        telefono: true,
        ciudad: true,
        rubro: true,
        contactoNombre: true,
        contactoCargo: true,
        fuenteUrl: true,
        emailFuenteUrl: true,
        historial: true,
      },
    })

    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    // Un prospecto suprimido no se edita sin revocar la supresion: la
    // excepcion es una accion administrativa aparte (T-20).
    if (prospecto.estado === "SUPRIMIDO") return errorJson(409, "SUPRIMIDO")

    const ahora = new Date()
    const data: Prisma.ProspectoUpdateManyMutationInput = {}
    const campos: string[] = []

    const dominioActual =
      prospecto.dominioNormalizado ??
      (prospecto.sitioWeb ? dominioNegocio(prospecto.sitioWeb) : null)

    let dominioNuevo = dominioActual

    if (body.sitioWeb !== undefined) {
      const sitio = normalizarSitioManual(body.sitioWeb)
      if (sitio === null) return errorJson(400, "VALIDACION")

      if (
        sitio.sitioWeb !== prospecto.sitioWeb ||
        sitio.dominio !== prospecto.dominioNormalizado
      ) {
        data.sitioWeb = sitio.sitioWeb
        data.dominioNormalizado = sitio.dominio
        dominioNuevo = sitio.dominio
        campos.push("sitioWeb")
      }
    }

    const emailActual = prospecto.email
      ? normalizarEmail(prospecto.email)
      : null

    if (body.email !== undefined) {
      const emailNuevo = normalizarEmail(body.email)
      if (emailNuevo === null) return errorJson(400, "VALIDACION")

      if (emailNuevo !== emailActual) {
        // Sin fuente no se acepta un cambio de email: podria ser un patron
        // adivinado. Vale una fuente nueva o la que ya estaba registrada.
        const fuenteEmail =
          body.emailFuenteUrl ??
          prospecto.emailFuenteUrl ??
          body.fuenteUrl ??
          prospecto.fuenteUrl

        if (!fuenteEmail) return errorJson(400, "VALIDACION")

        const config = configPropuestas()
        const supresion = await comprobarSupresion({
          email: emailNuevo,
          secreto: config.supresion.disponible ? config.secreto : null,
          dominioSitio: dominioNuevo,
        })

        if (supresion.suprimido) {
          return supresion.codigo === "NO_CONFIGURADO"
            ? errorJson(503, "NO_CONFIGURADO")
            : errorJson(409, "SUPRIMIDO")
        }

        const duplicado = await prisma.prospecto.findUnique({
          where: { email: emailNuevo },
          select: { id: true },
        })

        // El email exacto pertenece a otro prospecto: no se fusiona ni se
        // revela su id.
        if (duplicado && duplicado.id !== prospecto.id) {
          return errorJson(409, "ESTADO")
        }

        data.email = emailNuevo
        data.emailFechaFuente = ahora
        campos.push("email")
      }
    }

    if (
      body.nombreNegocio !== undefined &&
      body.nombreNegocio !== prospecto.nombreNegocio
    ) {
      data.nombreNegocio = body.nombreNegocio
      campos.push("nombreNegocio")
    }

    if (
      body.telefono !== undefined &&
      body.telefono !== prospecto.telefono
    ) {
      data.telefono = body.telefono
      campos.push("telefono")
    }

    if (body.ciudad !== undefined && body.ciudad !== prospecto.ciudad) {
      data.ciudad = body.ciudad
      campos.push("ciudad")
    }

    if (body.rubro !== undefined && body.rubro !== prospecto.rubro) {
      data.rubro = body.rubro
      campos.push("rubro")
    }

    if (
      body.contactoNombre !== undefined &&
      body.contactoNombre !== prospecto.contactoNombre
    ) {
      data.contactoNombre = body.contactoNombre
      campos.push("contactoNombre")
    }

    if (
      body.contactoCargo !== undefined &&
      body.contactoCargo !== prospecto.contactoCargo
    ) {
      data.contactoCargo = body.contactoCargo
      campos.push("contactoCargo")
    }

    if (
      body.fuenteUrl !== undefined &&
      body.fuenteUrl !== prospecto.fuenteUrl
    ) {
      data.fuenteUrl = body.fuenteUrl
      campos.push("fuenteUrl")
    }

    if (
      body.emailFuenteUrl !== undefined &&
      body.emailFuenteUrl !== prospecto.emailFuenteUrl
    ) {
      data.emailFuenteUrl = body.emailFuenteUrl
      campos.push("emailFuenteUrl")
    }

    // Nada cambio efectivamente (por ejemplo, solo se envio el motivo): no se
    // escribe historial vacio ni se mueve `ultimaInteraccionEn`.
    if (campos.length === 0) return errorJson(400, "VALIDACION")

    const historial = agregarEntradaHistorial(prospecto.historial, {
      accion: "CORRECCION",
      campos,
      motivo: body.motivo,
      por: adminId,
      en: ahora.toISOString(),
    })

    data.historial = historial as unknown as Prisma.InputJsonValue
    data.actualizadoPor = adminId
    data.ultimaInteraccionEn = ahora

    const actualizado = await prisma.prospecto.updateMany({
      where: { id, estado: { not: "SUPRIMIDO" } },
      data,
    })

    if (actualizado.count === 0) {
      const actual = await prisma.prospecto.findUnique({
        where: { id },
        select: { estado: true },
      })

      if (!actual) return errorJson(404, "NO_ENCONTRADO")
      return actual.estado === "SUPRIMIDO"
        ? errorJson(409, "SUPRIMIDO")
        : errorJson(409, "ESTADO")
    }

    logger.info("Prospecto corregido", {
      prospectoId: id,
      adminId,
      campos: campos.length,
    })

    return json({ id, estado: prospecto.estado }, 200)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error corrigiendo prospecto", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
