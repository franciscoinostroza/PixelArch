/**
 * POST /api/propuestas/prospectos (T-14; AC-13, AC-14, AC-19; RF-18, RF-22).
 *
 * Alta manual de un unico prospecto. No hay importacion masiva, no se compran
 * listas, no se scrapea y no se llama a ningun proveedor externo.
 *
 * Orden deliberado:
 *   1. guard admin Clerk-only (sin sesion 401; no admin 403);
 *   2. origen same-origin (403);
 *   3. rate limit 30/min por admin y 60/min por IP (429 + Retry-After);
 *   4. Zod (400);
 *   5. procedencia: nota obligatoria y al menos una fuente; sitio propio de
 *      negocio (nunca red social, marketplace ni agregador); email normalizado
 *      que, si no pertenece al dominio del sitio, exige fuente propia;
 *   6. campana existente (404) y no cancelada (409);
 *   7. supresion por email y por dominio (409), con fallo cerrado 503 si hay
 *      email y falta `PROPUESTAS_SECRETO`;
 *   8. dedupe: email exacto -> 409 sin datos; dominio existente -> se crea
 *      marcado como posible duplicado, nunca se fusiona;
 *   9. creacion con `fuenteTipo=CARGA_MANUAL`, procedencia e historial sin PII.
 *
 * Los logs solo incluyen ids internos y codigos; nunca nombre, email, telefono,
 * nota ni URLs de fuente.
 */

import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import { evaluarDedupe } from "@/lib/propuestas/dedupe"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import {
  agregarEntradaHistorial,
  normalizarSitioManual,
  requiereFuenteDeEmail,
} from "@/lib/propuestas/prospectos"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import { prospectoCreateSchema } from "@/lib/propuestas/validation"

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

  const parsed = prospectoCreateSchema.safeParse(payload)
  if (!parsed.success) {
    return errorJson(400, "VALIDACION")
  }

  const body = parsed.data

  // Procedencia minima: una fuente ademas de la nota (ya exigida por Zod).
  if (!body.fuenteUrl && !body.emailFuenteUrl) {
    return errorJson(400, "VALIDACION")
  }

  // El sitio debe ser la web propia del negocio: http/https publico, dominio
  // registrable de negocio y nunca red social, marketplace o agregador.
  let sitio: ReturnType<typeof normalizarSitioManual> = null
  if (body.sitioWeb) {
    sitio = normalizarSitioManual(body.sitioWeb)
    if (sitio === null) return errorJson(400, "VALIDACION")
  }

  let email: string | null = null
  if (body.email) {
    email = normalizarEmail(body.email)
    if (email === null) return errorJson(400, "VALIDACION")

    // Sin patrones adivinados: si el email no es del dominio del sitio (o no
    // hay sitio de negocio y el email es publico), hace falta su fuente.
    const dominioSitio = sitio?.dominio ?? null
    if (
      requiereFuenteDeEmail(email, dominioSitio) &&
      !body.emailFuenteUrl
    ) {
      return errorJson(400, "VALIDACION")
    }
  }

  const adminId = admin.admin.userId

  try {
    const campana = await prisma.campanaProspeccion.findUnique({
      where: { id: body.campanaId },
      select: { id: true, estado: true },
    })

    if (!campana) return errorJson(404, "NO_ENCONTRADO")

    // Criterio T-14: una campana CANCELADA es terminal y no admite altas
    // manuales. Los demas estados (incluida FALLIDA o COMPLETADA) se aceptan
    // para poder corregir o completar trabajo ya iniciado.
    if (campana.estado === "CANCELADA") return errorJson(409, "ESTADO")

    const config = configPropuestas()
    const supresion = await comprobarSupresion({
      email,
      secreto: config.supresion.disponible ? config.secreto : null,
      dominioSitio: sitio?.dominio ?? null,
    })

    if (supresion.suprimido) {
      return supresion.codigo === "NO_CONFIGURADO"
        ? errorJson(503, "NO_CONFIGURADO")
        : errorJson(409, "SUPRIMIDO")
    }

    let posibleDuplicadoDeId: string | null = null

    if (email !== null || sitio !== null) {
      const condiciones: Prisma.ProspectoWhereInput[] = []
      if (email !== null) condiciones.push({ email })
      if (sitio !== null) {
        condiciones.push({ dominioNormalizado: sitio.dominio })
      }

      const existentes = await prisma.prospecto.findMany({
        where: { OR: condiciones },
        select: { id: true, email: true, dominioNormalizado: true },
        take: 50,
      })

      const dedupe = evaluarDedupe(
        { email, dominioNormalizado: sitio?.dominio ?? null },
        existentes,
      )

      // Un email exacto ya existe: no se revela ningun dato ni se duplica.
      if (dedupe.tipo === "REUTILIZAR") return errorJson(409, "ESTADO")

      // El mismo dominio con otra ficha/sucursal se marca para revision; no
      // se fusiona automaticamente.
      if (dedupe.tipo === "POSIBLE_DUPLICADO") {
        posibleDuplicadoDeId = dedupe.prospectoId
      }
    }

    const ahora = new Date()
    const historial = agregarEntradaHistorial(null, {
      accion: "CREACION",
      por: adminId,
      en: ahora.toISOString(),
    })

    const prospecto = await prisma.prospecto.create({
      data: {
        nombreNegocio: body.nombreNegocio,
        sitioWeb: sitio?.sitioWeb ?? null,
        dominioNormalizado: sitio?.dominio ?? null,
        ciudad: body.ciudad ?? null,
        rubro: body.rubro ?? null,
        telefono: body.telefono ?? null,
        email,
        emailFuenteUrl: body.emailFuenteUrl ?? null,
        emailFechaFuente: email !== null ? ahora : null,
        fuenteTipo: "CARGA_MANUAL",
        fuenteUrl: body.fuenteUrl ?? null,
        fechaFuente: ahora,
        estado: "NUEVO",
        notas: body.nota,
        baseLegal: config.baseLegal,
        notaLegal: null,
        posibleDuplicadoDeId,
        historial: historial as unknown as Prisma.InputJsonValue,
        actualizadoPor: adminId,
        ultimaInteraccionEn: ahora,
        campanaOrigenId: campana.id,
      },
      select: { id: true, estado: true },
    })

    logger.info("Prospecto manual creado", {
      prospectoId: prospecto.id,
      campanaId: campana.id,
      adminId,
      posibleDuplicado: posibleDuplicadoDeId !== null,
    })

    return json({ id: prospecto.id, estado: prospecto.estado }, 201)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) {
      // Carrera de unique por email (u otra restriccion): no se duplica y no
      // se devuelve el id existente.
      return errorJson(409, "ESTADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    // Solo ids internos y codigo: nunca body, nombre, email, nota ni fuente.
    logger.error("Error creando prospecto manual", {
      codigo: sanitizado.codigo,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
