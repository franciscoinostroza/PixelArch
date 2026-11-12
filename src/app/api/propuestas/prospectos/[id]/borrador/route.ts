/**
 * POST /api/propuestas/prospectos/[id]/borrador (T-16; AC-22, AC-23, AC-24;
 * RF-34..RF-39).
 *
 * Fase C del plan §2.3: genera un borrador determinista (v1 sin LLM) a partir
 * de la plantilla activa, datos verificados del prospecto y hallazgos de la
 * auditoría. NO envía nada y no importa Resend.
 *
 * Orden:
 *   1. guard admin Clerk-only, origen y rate limit;
 *   2. 404 si el prospecto no existe;
 *   3. `modo: "LLM"` responde 503 NO_CONFIGURADO sin escribir ninguna fila;
 *   4. exige email normalizado (409 SIN_EMAIL) y no suprimido (409 SUPRIMIDO;
 *      sin secreto se falla cerrado con 503 NO_CONFIGURADO);
 *   5. exige plantilla activa (body o campaña; si no, 409 ESTADO);
 *   6. exige estado que permita BORRADOR (T-07) y ningún envío BORRADOR /
 *      APROBADO abierto (409 BORRADOR_ABIERTO);
 *   7. valida la secuencia con `evaluarNuevoMensaje` y
 *      `PROPUESTAS_MAX_ENVIOS_PROSPECTO` (409 MAX_MENSAJES);
 *   8. renderiza con `renderPlantilla` + `datosPlantillaDesdeProspecto`, sin
 *      inventar métricas ni completar datos ausentes;
 *   9. crea `EnvioPropuesta` BORRADOR con hash del contenido, `version: 1` y
 *      from/reply-to de la config (pueden ser null). No guarda footer legal ni
 *      token de baja: eso se materializa al aprobar (T-17);
 *  10. actualiza el prospecto a BORRADOR y `ultimaInteraccionEn` en la misma
 *      transacción; si `baseLegal` era null y hay `PROPUESTAS_BASE_LEGAL`, se
 *      guarda. Un cambio concurrente de estado aborta sin dejar borrador.
 *
 * Logs solo con ids internos, secuencia, versión y códigos; nunca email,
 * nombre, asunto, cuerpo ni hallazgos.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  EnvioInvalidoError,
  datosPlantillaDesdeProspecto,
  hashContenidoEnvio,
  validarContenidoEnvio,
} from "@/lib/propuestas/envios"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { dominioNegocio, normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import {
  PlantillaInvalidaError,
  renderPlantilla,
} from "@/lib/propuestas/plantillas"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import {
  evaluarNuevoMensaje,
  transicionProspectoPermitida,
  type EstadoProspecto,
} from "@/lib/propuestas/transiciones"
import { borradorCreateSchema } from "@/lib/propuestas/validation"

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

function variablesDePlantilla(valor: unknown): string[] | null {
  if (valor === null || valor === undefined) return null
  if (!Array.isArray(valor)) return null
  return valor.filter((item): item is string => typeof item === "string")
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: {
      id: true,
      nombreNegocio: true,
      sitioWeb: true,
      dominioNormalizado: true,
      ciudad: true,
      rubro: true,
      email: true,
      contactoNombre: true,
      score: true,
      auditoriaResumen: true,
      estado: true,
      baseLegal: true,
      campanaOrigenId: true,
      campanaOrigen: {
        select: {
          id: true,
          nombre: true,
          rubro: true,
          zona: true,
          plantillaId: true,
        },
      },
    },
  })
}

/**
 * Estados desde los que se puede iniciar un borrador. Además de la transición
 * del mapa de T-07, se acepta BORRADOR como estado ya alcanzado (por ejemplo,
 * tras cancelar un borrador previo): el objetivo ya es BORRADOR y no se trata
 * como un salto inválido.
 */
function permiteBorrador(estado: EstadoProspecto): boolean {
  return (
    estado === "BORRADOR" || transicionProspectoPermitida(estado, "BORRADOR")
  )
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

  const parsed = borradorCreateSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const body = parsed.data

  // v1 no tiene proveedor LLM: se falla cerrado antes de leer o escribir nada.
  if (body.modo === "LLM") {
    logger.info("Borrador LLM no configurado", { prospectoId: id, adminId })
    return json(
      {
        error: "La redacción por LLM no está configurada.",
        codigo: "NO_CONFIGURADO",
      },
      503,
    )
  }

  try {
    const prospecto = await cargarProspecto(id)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    const config = configPropuestas()
    const email = normalizarEmail(prospecto.email ?? "")
    if (email === null) return errorJson(409, "SIN_EMAIL")

    const dominio =
      prospecto.dominioNormalizado ??
      (prospecto.sitioWeb ? dominioNegocio(prospecto.sitioWeb) : null)

    const supresion = await comprobarSupresion({
      email,
      secreto: config.supresion.disponible ? config.secreto : null,
      dominioSitio: dominio,
    })

    if (supresion.suprimido) {
      return supresion.codigo === "NO_CONFIGURADO"
        ? errorJson(503, "NO_CONFIGURADO")
        : errorJson(409, "SUPRIMIDO")
    }

    const plantillaId = body.plantillaId ?? prospecto.campanaOrigen.plantillaId
    if (!plantillaId) return errorJson(409, "ESTADO")

    const plantilla = await prisma.plantillaPropuesta.findFirst({
      where: { id: plantillaId, activa: true },
      select: {
        id: true,
        asunto: true,
        cuerpo: true,
        variablesPermitidas: true,
        version: true,
      },
    })

    if (!plantilla) return errorJson(409, "ESTADO")

    const estadoActual = prospecto.estado as EstadoProspecto
    if (!permiteBorrador(estadoActual)) return errorJson(409, "ESTADO")

    const envios = await prisma.envioPropuesta.findMany({
      where: { prospectoId: id },
      select: { id: true, estado: true, secuencia: true },
    })

    if (
      envios.some(
        (envio) => envio.estado === "BORRADOR" || envio.estado === "APROBADO",
      )
    ) {
      return errorJson(409, "BORRADOR_ABIERTO")
    }

    const nuevoMensaje = evaluarNuevoMensaje({
      secuencias: envios.map((envio) => envio.secuencia),
      maximo: config.limites.maxEnviosProspecto,
    })
    if (!nuevoMensaje.ok) return errorJson(409, "MAX_MENSAJES")

    let salida: ReturnType<typeof renderPlantilla>
    try {
      const datos = datosPlantillaDesdeProspecto(
        prospecto,
        prospecto.campanaOrigen,
        { remitenteNombre: config.fromNombre },
      )

      salida = renderPlantilla(
        {
          asunto: plantilla.asunto,
          cuerpo: plantilla.cuerpo,
          variablesPermitidas: variablesDePlantilla(
            plantilla.variablesPermitidas,
          ),
          version: plantilla.version,
        },
        datos,
      )
    } catch (error) {
      if (error instanceof PlantillaInvalidaError) {
        logger.warn("Plantilla activa invalida al generar borrador", {
          prospectoId: id,
          plantillaId: plantilla.id,
          adminId,
          codigo: error.codigo,
        })
        return errorJson(409, "ESTADO")
      }
      throw error
    }

    let contenido: ReturnType<typeof validarContenidoEnvio>
    try {
      contenido = validarContenidoEnvio(salida.asunto, salida.cuerpoTexto)
    } catch (error) {
      if (error instanceof EnvioInvalidoError) {
        logger.warn("Contenido de borrador invalido", {
          prospectoId: id,
          plantillaId: plantilla.id,
          adminId,
          codigo: error.codigo,
        })
        return errorJson(409, "ESTADO")
      }
      throw error
    }

    const hashContenido = hashContenidoEnvio({
      asunto: contenido.asunto,
      cuerpoTexto: contenido.cuerpoTexto,
      cuerpoHtml: contenido.cuerpoHtml,
      destinatario: email,
      plantillaId: plantilla.id,
      plantillaVersion: plantilla.version,
      secuencia: nuevoMensaje.secuencia,
    })

    const ahora = new Date()
    const baseLegal =
      prospecto.baseLegal === null ? config.baseLegal : null

    const creado = await prisma.$transaction(async (tx) => {
      // Guarda exacta del estado leído: si otro proceso lo cambió, no se crea
      // un borrador huérfano ni se pisa una aprobación concurrente.
      const actualizado = await tx.prospecto.updateMany({
        where: { id, estado: estadoActual },
        data: {
          estado: "BORRADOR",
          ultimaInteraccionEn: ahora,
          actualizadoPor: adminId,
          ...(baseLegal !== null && prospecto.baseLegal === null
            ? { baseLegal }
            : {}),
        },
      })

      if (actualizado.count === 0) return null

      return tx.envioPropuesta.create({
        data: {
          prospectoId: id,
          campanaId: prospecto.campanaOrigen.id,
          plantillaId: plantilla.id,
          plantillaVersion: plantilla.version,
          secuencia: nuevoMensaje.secuencia,
          version: 1,
          destinatario: email,
          fromEmail: config.fromEmail,
          fromNombre: config.fromNombre,
          replyTo: config.replyTo,
          asunto: contenido.asunto,
          cuerpoHtml: contenido.cuerpoHtml,
          cuerpoTexto: contenido.cuerpoTexto,
          hashContenido,
          estado: "BORRADOR",
        },
        select: { id: true, secuencia: true, version: true },
      })
    })

    if (!creado) return errorJson(409, "ESTADO")

    logger.info("Borrador generado", {
      prospectoId: id,
      campanaId: prospecto.campanaOrigen.id,
      envioId: creado.id,
      plantillaId: plantilla.id,
      secuencia: creado.secuencia,
      version: creado.version,
      adminId,
    })

    return json(
      {
        envioId: creado.id,
        secuencia: creado.secuencia,
        version: creado.version,
      },
      201,
    )
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    // Carrera de `(prospectoId, secuencia, version)`: no se duplica.
    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error generando borrador", {
      codigo: sanitizado.codigo,
      prospectoId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
