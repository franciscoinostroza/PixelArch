/**
 * POST /api/propuestas/arco/[prospectoId] (T-22; AC-37; RF-30, RF-65).
 *
 * Atención de solicitudes ARCO por parte del admin:
 * - `EXPORTAR`: devuelve un JSON descargable (`Content-Disposition`) con datos,
 *   fuentes/fechas, resumen de auditoría, envíos e historial. Sin tokens de
 *   baja, hashes, secretos, notas internas ni datos del CRM.
 * - `ELIMINAR`: exige `confirmado: true` (400 `VALIDACION` si falta, sin leer
 *   ni escribir). Crea la supresión `SOLICITUD_ARCO` si hay email y luego
 *   borra la ficha. La supresión se conserva; la respuesta solo lleva id de
 *   supresión y booleanos de creación/reactivación. El `motivo` opcional nunca
 *   se guarda en claro: queda como SHA-256 + longitud en el historial de la
 *   supresión (o solo en el log sanitizado si no hay email).
 * - `RECTIFICAR`: reutiliza las reglas de T-14, exige `motivo` y deja
 *   historial. No cambia estado, campaña ni score.
 *
 * Orden: guard admin (401/403), origen (403), rate limit (429), Zod (400),
 * lógica de dominio. Todos los errores son genéricos y sin PII; `no-store`.
 */

import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { rateLimitDetalle } from "@/lib/rate-limit"
import {
  ErrorArco,
  eliminarProspecto,
  exportarProspecto,
  rectificarProspecto,
  registrarAccionArco,
} from "@/lib/propuestas/arco"
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
  arcoAccionSchema,
  prospectoPatchSchema,
} from "@/lib/propuestas/validation"

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
  return json({ error: sanitizarError(null, { codigo }).mensaje, codigo }, status, headers)
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

function nombreDescarga(prospectoId: string): string {
  const seguro = prospectoId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)
  return `arco-${seguro || "prospecto"}.json`
}

/**
 * Select explícito de la exportación: no incluye `notas`, `tokenBaja`,
 * `hashContenido`, `aprobadoHash` ni `idempotencyKey`.
 */
function cargarProspectoParaExportar(prospectoId: string) {
  return prisma.prospecto.findUnique({
    where: { id: prospectoId },
    select: {
      id: true,
      nombreNegocio: true,
      sitioWeb: true,
      dominioNormalizado: true,
      ciudad: true,
      rubro: true,
      placeId: true,
      email: true,
      telefono: true,
      contactoNombre: true,
      contactoCargo: true,
      emailFuenteUrl: true,
      emailFechaFuente: true,
      fuenteTipo: true,
      fuenteUrl: true,
      fechaFuente: true,
      estado: true,
      score: true,
      scoreDetalle: true,
      auditoriaResumen: true,
      auditoriaEstado: true,
      auditoriaFecha: true,
      baseLegal: true,
      notaLegal: true,
      motivoSinEnriquecer: true,
      historial: true,
      arcoHistorial: true,
      creadoEn: true,
      actualizadoEn: true,
      ultimaInteraccionEn: true,
      ultimoEnvioEn: true,
      campanaOrigen: {
        select: {
          id: true,
          nombre: true,
          estado: true,
        },
      },
      envios: {
        select: {
          id: true,
          secuencia: true,
          version: true,
          estado: true,
          creadoEn: true,
          aprobadoEn: true,
          enviadoEn: true,
          proveedorMessageId: true,
        },
        orderBy: [{ secuencia: "asc" }, { version: "asc" }],
      },
    },
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ prospectoId: string }> },
) {
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

  const { prospectoId } = await params

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = arcoAccionSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data
  const adminId = admin.admin.userId

  // ELIMINAR es irreversible: sin confirmación explícita se rechaza antes de
  // cualquier lectura, escritura o transacción (no crea supresión ni borra).
  if (body.tipo === "ELIMINAR" && body.confirmado !== true) {
    return errorJson(400, "VALIDACION")
  }

  try {
    if (body.tipo === "EXPORTAR") {
      const prospecto = await cargarProspectoParaExportar(prospectoId)
      if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

      // La acción queda registrada en arcoHistorial. Si esa escritura fallara
      // no se bloquea el derecho de acceso: se deja evidencia operativa en el
      // log (sin PII).
      try {
        await registrarAccionArco({
          id: prospecto.id,
          accion: "EXPORTACION",
          por: adminId,
          historialActual: prospecto.arcoHistorial,
        })
      } catch (error) {
        const sanitizado = sanitizarError(error, { codigo: "DESCONOCIDO" })
        logger.warn("No se pudo registrar la exportacion ARCO", {
          prospectoId: prospecto.id,
          adminId,
          codigo: sanitizado.codigo,
        })
      }

      const exportacion = exportarProspecto(prospecto)

      logger.info("ARCO exportacion", {
        prospectoId: prospecto.id,
        adminId,
        envios: prospecto.envios.length,
      })

      return json(exportacion, 200, {
        "Content-Disposition": `attachment; filename="${nombreDescarga(prospecto.id)}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      })
    }

    if (body.tipo === "ELIMINAR") {
      const resultado = await eliminarProspecto({
        id: prospectoId,
        por: adminId,
        porNombre: admin.admin.nombre,
        motivo: body.motivo,
        secreto: config.secreto,
      })

      if (!resultado.ok) {
        switch (resultado.motivo) {
          case "NO_ENCONTRADO":
            return errorJson(404, "NO_ENCONTRADO")
          case "NO_CONFIGURADO":
            return errorJson(503, "NO_CONFIGURADO")
          default:
            return errorJson(400, "VALIDACION")
        }
      }

      return json(
        {
          eliminado: true,
          supresion: resultado.supresion,
        },
        200,
      )
    }

    // RECTIFICAR: se revalida con las mismas reglas de campos de T-14.
    const parsedCambios = prospectoPatchSchema.safeParse({
      ...(body.cambios ?? {}),
      motivo: body.motivo,
    })
    if (!parsedCambios.success) return errorJson(400, "VALIDACION")

    const { motivo, ...cambios } = parsedCambios.data

    const resultado = await rectificarProspecto({
      id: prospectoId,
      cambios,
      motivo,
      por: adminId,
      secreto: config.secreto,
    })

    if (!resultado.ok) {
      switch (resultado.motivo) {
        case "NO_ENCONTRADO":
          return errorJson(404, "NO_ENCONTRADO")
        case "SUPRIMIDO":
          return errorJson(409, "SUPRIMIDO")
        case "DUPLICADO":
          return errorJson(409, "ESTADO")
        case "NO_CONFIGURADO":
          return errorJson(503, "NO_CONFIGURADO")
        default:
          return errorJson(400, "VALIDACION")
      }
    }

    logger.info("ARCO rectificacion", {
      prospectoId,
      adminId,
      campos: resultado.campos.length,
    })

    return json(
      {
        id: resultado.id,
        rectificado: true,
        campos: resultado.campos,
      },
      200,
    )
  } catch (error) {
    const codigo: CodigoError =
      error instanceof ErrorArco
        ? error.codigo
        : error instanceof ErrorSupresion
          ? error.codigo === "SECRETO"
            ? "NO_CONFIGURADO"
            : "VALIDACION"
          : esErrorTablaFaltante(error)
            ? "ESQUEMA_NO_APLICADO"
            : "DESCONOCIDO"

    const status =
      codigo === "NO_CONFIGURADO" || codigo === "ESQUEMA_NO_APLICADO"
        ? 503
        : codigo === "VALIDACION"
          ? 400
          : 500

    const sanitizado = sanitizarError(error, {
      codigo,
      // Nunca se devuelve el mensaje crudo de Prisma/proveedor: puede incluir
      // nombres de tablas, valores o PII.
      mensaje: sanitizarError(null, { codigo }).mensaje,
    })

    logger.error("Error en solicitud ARCO", {
      prospectoId,
      adminId,
      tipo: body.tipo,
      codigo: sanitizado.codigo,
    })

    return json(
      { error: sanitizado.mensaje, codigo: sanitizado.codigo },
      status,
    )
  }
}
