/**
 * POST /api/propuestas/envios/[id]/aprobar (T-17; AC-25, AC-27; RF-40..RF-42,
 * RF-44).
 *
 * Aprobacion explicita de un borrador con snapshot inmutable. **No envia
 * nada**: no importa Resend, no llama a ningun proveedor y no existe
 * `scheduledAt`. El envio real es una accion separada (T-18).
 *
 * Orden:
 *   1. guard admin Clerk-only, origen (si hay URL publica), rate limit
 *      30/min por admin + 60/min por IP y body `{ confirmado: true }`;
 *   2. 404 si el envio no existe; 409 ESTADO si no esta en BORRADOR (doble
 *      aprobacion, ENVIANDO o terminal incluidos);
 *   3. revalida la configuracion de aprobacion: secreto, URL publica HTTPS,
 *      from/reply-to validos, texto legal y base legal (409 CONFIGURACION con
 *      motivos sin PII). Aprobar no envia; el gate y Resend se validan en
 *      T-18 (`puedeEnviar`), no aca;
 *   4. revalida email normalizado y no suprimido (`comprobarSupresion`,
 *      fail-closed sin secreto), destinatario igual al email del prospecto,
 *      plantilla activa, secuencia dentro del maximo y que ningun otro envio
 *      APROBADO/ENVIANDO exista para el mismo prospecto/secuencia;
 *   5. recomputa `hashContenido` desde el borrador actual y exige que coincida
 *      con el persistido (409 REVALIDACION si muto);
 *   6. genera `emailHash` + `tokenBaja` y re-renderiza el email final con
 *      `construirEmail` (footer legal, fuente, ARCO, enlace visible y headers
 *      `List-Unsubscribe`/`-Post`), sin duplicar esa logica;
 *   7. actualiza el envio BORRADOR -> APROBADO guardando `aprobado*`,
 *      `aprobadoHash`, aprobador/fecha, `tokenBaja`, from/reply-to con guarda
 *      atomica (`updateMany` + `count`), y el prospecto a APROBADO con
 *      transicion valida, `ultimaInteraccionEn` y `baseLegal` si falta.
 *
 * Los `aprobado*` no se pueden editar: una edicion crea otra version (T-16).
 * Logs solo con ids, estado y codigo; nunca email, asunto, cuerpo, token ni
 * secretos.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import {
  configPropuestas,
  type ConfigPropuestas,
} from "@/lib/propuestas/config"
import {
  EnvioInvalidoError,
  construirSnapshotAprobado,
  verificarHashContenido,
} from "@/lib/propuestas/envios"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { dominioNegocio, normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import { crearTokenBaja, hashEmail } from "@/lib/propuestas/supresion"
import {
  normalizarEstadoEnvio,
  normalizarEstadoProspecto,
  puedeAprobar,
  transicionProspectoPermitida,
} from "@/lib/propuestas/transiciones"
import { campanaAccionSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000

/** Aborta la transaccion sin exponer detalles: la ruta responde 409 ESTADO. */
class AprobacionAbortada extends Error {
  constructor() {
    super("Aprobacion abortada.")
    this.name = "AprobacionAbortada"
  }
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

/**
 * Rechazo de dominio con motivos fijos (sin email, asunto, cuerpo ni token).
 * Se usa para REVALIDACION y CONFIGURACION.
 */
function rechazoJson(
  status: number,
  codigo: CodigoError,
  motivos: string[],
): NextResponse {
  const { mensaje } = sanitizarError(null, { codigo })
  const limpios = motivos
    .filter((motivo): motivo is string => typeof motivo === "string")
    .map((motivo) => motivo.trim().slice(0, 240))
    .filter((motivo) => motivo.length > 0)

  return json(
    {
      error: mensaje,
      codigo,
      motivos: limpios.length > 0 ? limpios : [mensaje],
    },
    status,
  )
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

interface ConfigAprobacionLista {
  fromEmail: string
  fromNombre: string
  replyTo: string
  secreto: string
  urlPublica: string
  textoLegal: string
}

/**
 * Motivos de configuracion que bloquean la aprobacion. Aprobar no envia: el
 * gate `PROPUESTAS_ENVIO_HABILITADO` y `RESEND_API_KEY` son requisitos de
 * T-18 y no se exigen aca.
 */
function motivosConfiguracionAprobacion(config: ConfigPropuestas): string[] {
  const motivos: string[] = []

  if (config.secreto === null) {
    motivos.push("Falta PROPUESTAS_SECRETO o no es valido.")
  }
  if (config.urlPublica === null) {
    motivos.push("Falta NEXT_PUBLIC_URL https absoluta.")
  }
  if (config.fromEmail === null) {
    motivos.push("Falta PROPUESTAS_FROM_EMAIL o no es valido.")
  }
  if (config.replyTo === null) {
    motivos.push("Falta PROPUESTAS_REPLY_TO o no es valido.")
  }
  if (config.textoLegal === null) {
    motivos.push("Falta PROPUESTAS_TEXTO_LEGAL aprobado.")
  }
  if (config.baseLegal === null) {
    motivos.push("Falta PROPUESTAS_BASE_LEGAL aprobado.")
  }

  return motivos
}

/**
 * Defensa en profundidad: los motivos ya exigen estas piezas, pero el
 * TypeScript no lo sabe. Si falta alguna se falla cerrado sin tocar datos.
 */
function configuracionLista(
  config: ConfigPropuestas,
): ConfigAprobacionLista | null {
  const {
    fromEmail,
    fromNombre,
    replyTo,
    secreto,
    urlPublica,
    textoLegal,
  } = config

  if (
    fromEmail === null ||
    replyTo === null ||
    secreto === null ||
    urlPublica === null ||
    textoLegal === null
  ) {
    return null
  }

  return { fromEmail, fromNombre, replyTo, secreto, urlPublica, textoLegal }
}

function cargarEnvio(id: string) {
  return prisma.envioPropuesta.findUnique({
    where: { id },
    select: {
      id: true,
      prospectoId: true,
      plantillaId: true,
      plantillaVersion: true,
      secuencia: true,
      version: true,
      destinatario: true,
      asunto: true,
      cuerpoTexto: true,
      cuerpoHtml: true,
      hashContenido: true,
      estado: true,
    },
  })
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      estado: true,
      baseLegal: true,
      sitioWeb: true,
      fuenteUrl: true,
      emailFuenteUrl: true,
      dominioNormalizado: true,
    },
  })
}

/**
 * Plantilla activa del borrador. Se consulta con `activa: true` para fallar
 * cerrado si fue desactivada por una version nueva; no se infiere del snapshot.
 */
function cargarPlantillaActiva(plantillaId: string | null) {
  if (plantillaId === null) return Promise.resolve(null)

  return prisma.plantillaPropuesta.findFirst({
    where: { id: plantillaId, activa: true },
    select: { version: true },
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

  // Sin URL publica no hay origen confiable para comparar. Se omite el chequeo
  // de origen y la configuracion incompleta se rechaza mas abajo con 409: no
  // se muta nada. Con URL configurada, un origen ausente o distinto es 403.
  if (
    config.urlPublica !== null &&
    !origenPermitido(req, config.urlPublica)
  ) {
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

  // Contrato comun de confirmacion explicita `{ confirmado: true }` (T-13).
  const parsed = campanaAccionSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  try {
    const envio = await cargarEnvio(id)
    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    if (normalizarEstadoEnvio(envio.estado) !== "BORRADOR") {
      logger.info("Aprobacion rechazada por estado", {
        envioId: id,
        adminId,
        estado: envio.estado,
      })
      return errorJson(409, "ESTADO")
    }

    const motivosConfiguracion = motivosConfiguracionAprobacion(config)
    const lista = configuracionLista(config)
    if (lista === null || motivosConfiguracion.length > 0) {
      logger.warn("Aprobacion rechazada por configuracion", {
        envioId: id,
        adminId,
        codigo: "CONFIGURACION",
      })
      return rechazoJson(
        409,
        "CONFIGURACION",
        motivosConfiguracion.length > 0
          ? motivosConfiguracion
          : ["La configuracion de aprobacion esta incompleta."],
      )
    }

    const prospecto = await cargarProspecto(envio.prospectoId)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    const plantilla = await cargarPlantillaActiva(envio.plantillaId)

    const email = normalizarEmail(prospecto.email ?? "")
    if (email === null) {
      logger.info("Aprobacion rechazada sin email", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "SIN_EMAIL")
    }

    const destinatario = normalizarEmail(envio.destinatario)
    if (destinatario === null || destinatario !== email) {
      return rechazoJson(409, "REVALIDACION", [
        "El destinatario del borrador no coincide con el email actual del prospecto.",
      ])
    }

    const dominio =
      prospecto.dominioNormalizado ??
      (prospecto.sitioWeb ? dominioNegocio(prospecto.sitioWeb) : null)

    const supresion = await comprobarSupresion({
      email,
      secreto: lista.secreto,
      dominioSitio: dominio,
    })

    if (supresion.suprimido) {
      if (supresion.codigo === "NO_CONFIGURADO") {
        return rechazoJson(409, "CONFIGURACION", [
          "No se pudo verificar la supresion: falta PROPUESTAS_SECRETO.",
        ])
      }
      logger.info("Aprobacion rechazada por supresion", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "SUPRIMIDO")
    }

    // Recomputo desde el borrador actual: detecta mutaciones directas que no
    // pasaron por la edicion versionada.
    const hashIntacto = verificarHashContenido(
      {
        asunto: envio.asunto,
        cuerpoTexto: envio.cuerpoTexto,
        cuerpoHtml: envio.cuerpoHtml,
        destinatario: envio.destinatario,
        plantillaId: envio.plantillaId,
        plantillaVersion: envio.plantillaVersion,
        secuencia: envio.secuencia,
      },
      envio.hashContenido,
    )

    if (!hashIntacto) {
      logger.warn("Aprobacion rechazada por hash del borrador", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
        codigo: "REVALIDACION",
      })
      return rechazoJson(409, "REVALIDACION", [
        "El contenido del borrador cambio desde que se genero o esta incompleto. Regeneralo o guardalo antes de aprobar.",
      ])
    }

    const otros = await prisma.envioPropuesta.findMany({
      where: {
        prospectoId: prospecto.id,
        secuencia: envio.secuencia,
        id: { not: id },
        estado: { in: ["APROBADO", "ENVIANDO"] },
      },
      select: { id: true },
    })

    const permiso = puedeAprobar({
      estadoEnvio: envio.estado,
      hashContenido: envio.hashContenido,
      email,
      prospectoEstado: prospecto.estado,
      contactabilidad: { contactable: true },
      plantilla: plantilla
        ? { activa: true, version: plantilla.version }
        : null,
      hayOtroEnvioPendiente: otros.length > 0,
      secuencia: {
        numero: envio.secuencia,
        maximo: config.limites.maxEnviosProspecto,
      },
      config: {
        secreto: true,
        urlPublica: true,
        fromEmail: true,
        replyTo: true,
        textoLegal: true,
        baseLegal: config.baseLegal !== null,
      },
    })

    if (!permiso.ok) {
      logger.warn("Aprobacion rechazada por revalidacion", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
        codigo: "REVALIDACION",
      })
      return rechazoJson(409, "REVALIDACION", permiso.motivos)
    }

    const estadoProspecto = normalizarEstadoProspecto(prospecto.estado)
    const transicionValida =
      estadoProspecto !== null &&
      (estadoProspecto === "APROBADO" ||
        transicionProspectoPermitida(estadoProspecto, "APROBADO"))

    if (!transicionValida) {
      return rechazoJson(409, "REVALIDACION", [
        "El prospecto no esta en un estado que permita aprobar el envio.",
      ])
    }

    let tokenBaja: string
    try {
      const emailHash = hashEmail(email, lista.secreto)
      tokenBaja = crearTokenBaja(prospecto.id, emailHash, lista.secreto)
    } catch {
      logger.warn("Aprobacion rechazada por token de baja", {
        envioId: id,
        adminId,
        codigo: "CONFIGURACION",
      })
      return rechazoJson(409, "CONFIGURACION", [
        "No se pudo generar el token de baja con el secreto configurado.",
      ])
    }

    let snapshot: ReturnType<typeof construirSnapshotAprobado>
    try {
      snapshot = construirSnapshotAprobado({
        asunto: envio.asunto,
        cuerpoTexto: envio.cuerpoTexto,
        destinatario: envio.destinatario,
        fromEmail: lista.fromEmail,
        fromNombre: lista.fromNombre,
        replyTo: lista.replyTo,
        tokenBaja,
        plantillaId: envio.plantillaId,
        plantillaVersion: envio.plantillaVersion,
        secuencia: envio.secuencia,
        sitioWeb: prospecto.sitioWeb,
        fuenteUrl: prospecto.fuenteUrl ?? prospecto.emailFuenteUrl,
        textoLegal: lista.textoLegal,
        urlPublica: lista.urlPublica,
        etiquetaPublicidad: config.etiquetaPublicidad,
        canalArco: lista.replyTo,
      })
    } catch (error) {
      if (error instanceof EnvioInvalidoError) {
        logger.warn("Aprobacion rechazada por snapshot", {
          envioId: id,
          prospectoId: prospecto.id,
          adminId,
          codigo: error.codigo,
        })
        return rechazoJson(409, "REVALIDACION", [
          "No se pudo construir el email final (contenido, token o aviso legal incompletos). Revisa el borrador y la fuente de los datos.",
        ])
      }
      throw error
    }

    const ahora = new Date()

    const aprobado = await prisma.$transaction(async (tx) => {
      // Guarda exacta de estado: un doble clic o un envio concurrente no
      // re-aprueba ni pisa un snapshot existente.
      const actualizado = await tx.envioPropuesta.updateMany({
        where: { id, estado: "BORRADOR" },
        data: {
          estado: "APROBADO",
          aprobadoAsunto: snapshot.asunto,
          aprobadoCuerpoHtml: snapshot.cuerpoHtml,
          aprobadoCuerpoTexto: snapshot.cuerpoTexto,
          aprobadoHash: snapshot.aprobadoHash,
          aprobadoPor: adminId,
          aprobadoPorNombre: admin.admin.nombre,
          aprobadoEn: ahora,
          tokenBaja: snapshot.tokenBaja,
          fromEmail: lista.fromEmail,
          fromNombre: lista.fromNombre,
          replyTo: lista.replyTo,
        },
      })

      if (actualizado.count === 0) return null

      const prospectoActualizado = await tx.prospecto.updateMany({
        where: { id: prospecto.id, estado: prospecto.estado },
        data: {
          estado: "APROBADO",
          ultimaInteraccionEn: ahora,
          actualizadoPor: adminId,
          ...(prospecto.baseLegal === null && config.baseLegal !== null
            ? { baseLegal: config.baseLegal }
            : {}),
        },
      })

      if (prospectoActualizado.count === 0) {
        // El prospecto cambio de estado en paralelo: se revierte la aprobacion
        // del envio para no dejar un snapshot huerfano.
        throw new AprobacionAbortada()
      }

      return true
    })

    if (aprobado !== true) {
      logger.info("Aprobacion rechazada por carrera de estado", {
        envioId: id,
        adminId,
      })
      return errorJson(409, "ESTADO")
    }

    logger.info("Envio aprobado", {
      envioId: id,
      prospectoId: prospecto.id,
      secuencia: envio.secuencia,
      version: envio.version,
      adminId,
    })

    return json({ estado: "APROBADO", aprobadoEn: ahora }, 200)
  } catch (error) {
    if (error instanceof AprobacionAbortada) {
      logger.info("Aprobacion abortada por estado del prospecto", {
        envioId: id,
        adminId,
      })
      return errorJson(409, "ESTADO")
    }

    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error aprobando envio", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
