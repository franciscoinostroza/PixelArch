/**
 * POST /api/propuestas/envios/[id]/enviar (T-18; AC-26, AC-27, AC-28, AC-29,
 * AC-31; RF-43..RF-49).
 *
 * Segunda confirmacion explicita del admin: es la **unica** ruta que llama a
 * Resend. No hay scheduler, cola, envio programado ni reintento automatico.
 *
 * Orden:
 *   1. guard admin Clerk-only, origen same-origin, rate limit 30/min por admin
 *      + 60/min por IP y 10/min adicional por admin para envios; body exacto
 *      `{ confirmacion: "ENVIAR" }`; 404 si el envio no existe;
 *   2. solo `APROBADO`: un doble clic o un envio concurrente recibe 409;
 *   3. revalida la configuracion completa de envio (`estadoEnvio`: gate,
 *      Resend, from/reply-to, secreto, URL publica, texto y base legal). Sin
 *      todo eso no se llama a ningun proveedor (409 CONFIGURACION);
 *   4. email normalizado del prospecto y destinatario aprobado identicos;
 *      supresion por email/dominio (fail-closed sin secreto);
 *   5. reconstruye el token de baja y los headers `List-Unsubscribe` desde el
 *      snapshot persistido + URL + reply-to actuales, y recomputa
 *      `aprobadoHash` (fail-closed: si la config cambio, 409 REVALIDACION);
 *   6. recomputa `hashContenido` del borrador y exige que coincida con el
 *      persistido; valida plantilla activa, cupo y `puedeEnviar`;
 *   7. reserva cupo `RESEND` 1 y hace la transicion atomica
 *      `APROBADO -> ENVIANDO` (`updateMany`, `intentos+1`, idempotencyKey
 *      deterministica `envio:<id>:v<version>`) dentro de una transaccion; un
 *      `count = 0` (doble clic) aborta y revierte el cupo;
 *   8. llama a Resend **una sola vez** con `Idempotency-Key`;
 *      - exito -> `ENVIADO` + `proveedorMessageId` + prospecto `ENVIADO`;
 *      - fallo -> `FALLIDO` + error sanitizado, sin retry y sin tocar el
 *        prospecto.
 *
 * `200 { estado: "ENVIADO", messageId }` o `502 { codigo: "PROVEEDOR" }`.
 * Logs solo con ids, estado, codigo y duracion; nunca email, asunto, cuerpo,
 * token ni secretos.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import {
  configPropuestas,
  estadoEnvio,
  type ConfigPropuestas,
} from "@/lib/propuestas/config"
import {
  esErrorCupo,
  estadoCupos,
  reservarCupo,
} from "@/lib/propuestas/consumo"
import {
  hashContenidoEnvio,
  hashSnapshotAprobado,
} from "@/lib/propuestas/envios"
import type { HeadersEmail } from "@/lib/propuestas/email"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { dominioNegocio, normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import {
  ErrorResend,
  enviarEmail,
} from "@/lib/propuestas/resend"
import { hashEmail, verificarTokenBaja } from "@/lib/propuestas/supresion"
import {
  normalizarEstadoEnvio,
  puedeEnviar,
} from "@/lib/propuestas/transiciones"
import { envioEnviarSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const LIMITE_ENVIO = 10
const VENTANA_MS = 60_000

/** Aborta la transaccion sin exponer detalles: la ruta responde 409 ESTADO. */
class EnvioAbortado extends Error {
  constructor() {
    super("Envio abortado.")
    this.name = "EnvioAbortado"
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

function esErrorUnique(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  )
}

interface ConfigEnvioLista {
  fromEmail: string
  fromNombre: string
  replyTo: string
  secreto: string
  urlPublica: string
  textoLegal: string
}

/**
 * Defensa en profundidad: `estadoEnvio` ya exige estas piezas, pero TypeScript
 * no lo sabe. Sin todas se falla cerrado sin tocar datos ni red.
 */
function configuracionEnvioLista(
  config: ConfigPropuestas,
): ConfigEnvioLista | null {
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

/**
 * Headers `List-Unsubscribe` reconstruidos desde el token persistido, la URL
 * publica actual y el reply-to actual. No se guardan en la base: se recalculan
 * y se comparan con `aprobadoHash` en cada envio (fail-closed).
 *
 * El reply-to se normaliza igual que en la aprobacion (`construirEmail` usa
 * `normalizarEmail`), para que una env con mayusculas no produzca headers
 * distintos y un 409 permanente.
 */
function headersDesdeSnapshot(
  tokenBaja: string,
  urlPublica: string,
  replyTo: string,
): HeadersEmail {
  const token = encodeURIComponent(tokenBaja)
  const canal = normalizarEmail(replyTo) ?? replyTo

  return {
    "List-Unsubscribe": `<${urlPublica}/api/opt-out?token=${token}>, <mailto:${canal}?subject=Baja>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
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
      asunto: true,
      cuerpoTexto: true,
      cuerpoHtml: true,
      hashContenido: true,
      estado: true,
      tokenBaja: true,
      aprobadoAsunto: true,
      aprobadoCuerpoHtml: true,
      aprobadoCuerpoTexto: true,
      aprobadoHash: true,
      fromEmail: true,
      fromNombre: true,
      replyTo: true,
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
      sitioWeb: true,
      fuenteUrl: true,
      emailFuenteUrl: true,
      dominioNormalizado: true,
    },
  })
}

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

  // Limite adicional de envios: un admin no puede disparar mas de 10 intentos
  // por minuto aunque el limite general de APIs siga disponible.
  const limiteEnvio = rateLimitDetalle(
    `propuestas:envio:${admin.admin.userId}`,
    LIMITE_ENVIO,
    VENTANA_MS,
  )
  if (!limiteEnvio.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteEnvio.retryAfterSegundos),
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

  const parsed = envioEnviarSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  try {
    const envio = await cargarEnvio(id)
    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    if (normalizarEstadoEnvio(envio.estado) !== "APROBADO") {
      logger.info("Envio rechazado por estado", {
        envioId: id,
        adminId,
        estado: envio.estado,
      })
      return errorJson(409, "ESTADO")
    }

    const estadoConfig = estadoEnvio(config)
    const lista = configuracionEnvioLista(config)
    if (!estadoConfig.ok || lista === null || config.baseLegal === null) {
      logger.warn("Envio rechazado por configuracion", {
        envioId: id,
        adminId,
        codigo: "CONFIGURACION",
      })
      return rechazoJson(
        409,
        "CONFIGURACION",
        estadoConfig.ok
          ? ["La configuracion de envio esta incompleta."]
          : estadoConfig.motivos,
      )
    }

    const prospecto = await cargarProspecto(envio.prospectoId)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    const email = normalizarEmail(prospecto.email ?? "")
    if (email === null) {
      logger.info("Envio rechazado sin email", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "SIN_EMAIL")
    }

    const destinatario = normalizarEmail(envio.destinatario)
    if (destinatario === null || destinatario !== email) {
      return rechazoJson(409, "REVALIDACION", [
        "El destinatario aprobado no coincide con el email actual del prospecto.",
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
      logger.info("Envio rechazado por supresion", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
      })
      return errorJson(409, "SUPRIMIDO")
    }

    const tokenBaja = envio.tokenBaja
    if (
      typeof tokenBaja !== "string" ||
      tokenBaja.trim().length === 0 ||
      envio.aprobadoAsunto === null ||
      envio.aprobadoCuerpoHtml === null ||
      envio.aprobadoCuerpoTexto === null ||
      envio.aprobadoHash === null
    ) {
      return rechazoJson(409, "REVALIDACION", [
        "El snapshot aprobado esta incompleto. Volvé a aprobar el borrador.",
      ])
    }

    // El token se verifica con el secreto actual y se exige que pertenezca al
    // prospecto y al email actual: un cambio de secreto/email invalida el
    // enlace de baja y bloquea el envio en vez de mandar un email sin baja.
    let emailHash: string
    try {
      emailHash = hashEmail(email, lista.secreto)
    } catch {
      return rechazoJson(409, "CONFIGURACION", [
        "No se pudo verificar el token de baja con el secreto configurado.",
      ])
    }

    const token = verificarTokenBaja(tokenBaja, lista.secreto)
    if (
      !token.ok ||
      token.prospectoId !== prospecto.id ||
      token.emailHash !== emailHash
    ) {
      return rechazoJson(409, "REVALIDACION", [
        "El token de baja ya no coincide con el prospecto o su secreto. Volvé a aprobar el borrador.",
      ])
    }

    const headers = headersDesdeSnapshot(
      tokenBaja,
      lista.urlPublica,
      lista.replyTo,
    )

    let snapshotHash: string
    try {
      snapshotHash = hashSnapshotAprobado({
        asunto: envio.aprobadoAsunto,
        cuerpoHtml: envio.aprobadoCuerpoHtml,
        cuerpoTexto: envio.aprobadoCuerpoTexto,
        destinatario: envio.destinatario,
        fromEmail: lista.fromEmail,
        fromNombre: lista.fromNombre,
        replyTo: lista.replyTo,
        tokenBaja,
        headers,
        plantillaId: envio.plantillaId,
        plantillaVersion: envio.plantillaVersion,
        secuencia: envio.secuencia,
      })
    } catch {
      return rechazoJson(409, "REVALIDACION", [
        "No se pudo reconstruir el snapshot aprobado con la configuracion actual.",
      ])
    }

    let hashContenidoActual: string
    try {
      hashContenidoActual = hashContenidoEnvio({
        asunto: envio.asunto,
        cuerpoTexto: envio.cuerpoTexto,
        cuerpoHtml: envio.cuerpoHtml,
        destinatario: envio.destinatario,
        plantillaId: envio.plantillaId,
        plantillaVersion: envio.plantillaVersion,
        secuencia: envio.secuencia,
      })
    } catch {
      return rechazoJson(409, "REVALIDACION", [
        "El contenido del borrador esta incompleto o cambio desde la aprobacion.",
      ])
    }

    const plantilla = await cargarPlantillaActiva(envio.plantillaId)
    const plantillaValida =
      plantilla !== null &&
      envio.plantillaVersion !== null &&
      plantilla.version === envio.plantillaVersion

    if (!plantillaValida) {
      return rechazoJson(409, "REVALIDACION", [
        "La plantilla del envio no esta activa o cambio de version. Volvé a aprobar el borrador.",
      ])
    }

    // Prechequeo legible del cupo. El tope duro se aplica igual dentro de la
    // transaccion con `reservarCupo`; nunca se encola para el dia siguiente.
    const cupos = await estadoCupos(new Date(), { cliente: prisma, config })
    const cupoResend = cupos.proveedores.find(
      (proveedor) => proveedor.proveedor === "RESEND",
    )
    const cupoPermitido =
      cupoResend !== undefined &&
      cupoResend.cap > 0 &&
      cupoResend.restante >= 1

    if (!cupoPermitido) {
      logger.info("Envio rechazado por cupo", { envioId: id, adminId })
      return errorJson(429, "CUPO")
    }

    const permiso = puedeEnviar({
      estadoEnvio: envio.estado,
      aprobadoHash: envio.aprobadoHash,
      snapshotHash,
      hashContenido: envio.hashContenido,
      hashContenidoActual,
      destinatario: envio.destinatario,
      email,
      contactabilidad: { contactable: true },
      cupo: { permitido: true, restantes: cupoResend.restante },
      config: {
        secreto: true,
        urlPublica: true,
        fromEmail: true,
        replyTo: true,
        textoLegal: true,
        baseLegal: true,
        envioHabilitado: true,
        resend: true,
      },
    })

    if (!permiso.ok) {
      logger.warn("Envio rechazado por revalidacion", {
        envioId: id,
        prospectoId: prospecto.id,
        adminId,
        codigo: "REVALIDACION",
      })
      return rechazoJson(409, "REVALIDACION", permiso.motivos)
    }

    const idempotencyKey = `envio:${envio.id}:v${envio.version}`
    const ahora = new Date()

    // Reserva de cupo + transicion atomica en la misma transaccion: si el
    // updateMany no afecta la fila (doble clic), se revierte la reserva.
    const iniciado = await prisma.$transaction(async (tx) => {
      await reservarCupo(tx, {
        campanaId: envio.campanaId,
        proveedor: "RESEND",
        prospectoId: envio.prospectoId,
        fecha: ahora,
        cantidad: 1,
        llamadas: 1,
        capDiario: config.cupos.enviosDia,
      })

      const actualizado = await tx.envioPropuesta.updateMany({
        where: { id: envio.id, estado: "APROBADO" },
        data: {
          estado: "ENVIANDO",
          enviadoPor: adminId,
          enviadoPorNombre: admin.admin.nombre,
          enviadoEn: ahora,
          intentos: { increment: 1 },
          idempotencyKey,
        },
      })

      if (actualizado.count === 0) throw new EnvioAbortado()
      return true
    })

    if (iniciado !== true) return errorJson(409, "ESTADO")

    const inicio = Date.now()
    let messageId: string
    try {
      const resultado = await enviarEmail({
        fromEmail: lista.fromEmail,
        fromNombre: lista.fromNombre,
        replyTo: lista.replyTo,
        to: email,
        subject: envio.aprobadoAsunto,
        html: envio.aprobadoCuerpoHtml,
        text: envio.aprobadoCuerpoTexto,
        headers,
        idempotencyKey,
      })
      messageId = resultado.messageId
    } catch (error) {
      const codigo = error instanceof ErrorResend ? error.codigo : "DESCONOCIDO"
      const sanitizado = sanitizarError(error, { codigo })

      await prisma.envioPropuesta.updateMany({
        where: { id: envio.id, estado: "ENVIANDO" },
        data: { estado: "FALLIDO", error: `${codigo}: ${sanitizado.mensaje}` },
      })

      logger.error("Envio fallido en Resend", {
        envioId: envio.id,
        prospectoId: envio.prospectoId,
        adminId,
        codigo,
        duracionMs: Date.now() - inicio,
      })

      const proveedor = sanitizarError(null, { codigo: "PROVEEDOR" })
      return json(
        { error: proveedor.mensaje, codigo: "PROVEEDOR" },
        502,
      )
    }

    const fin = new Date()

    const marcado = await prisma.envioPropuesta.updateMany({
      where: { id: envio.id, estado: "ENVIANDO" },
      data: {
        estado: "ENVIADO",
        proveedorMessageId: messageId,
        error: null,
      },
    })

    if (marcado.count === 0) {
      // El proveedor ya acepto el email. Se conserva al menos el message ID
      // aunque una reconciliacion concurrente haya cambiado el estado.
      await prisma.envioPropuesta.updateMany({
        where: { id: envio.id, proveedorMessageId: null },
        data: { proveedorMessageId: messageId },
      })

      logger.warn("Envio aceptado por Resend con estado local distinto", {
        envioId: envio.id,
        adminId,
      })
    }

    const prospectoMarcado = await prisma.prospecto.updateMany({
      where: { id: prospecto.id, estado: "APROBADO" },
      data: {
        estado: "ENVIADO",
        ultimoEnvioEn: fin,
        ultimaInteraccionEn: fin,
      },
    })

    // Carrera de estado: si el email ya salio, no se pierde la fecha real del
    // envio aunque el prospecto haya cambiado de estado en paralelo.
    if (prospectoMarcado.count === 0) {
      await prisma.prospecto.updateMany({
        where: { id: prospecto.id },
        data: {
          ultimoEnvioEn: fin,
          ultimaInteraccionEn: fin,
        },
      })
    }

    logger.info("Envio confirmado por Resend", {
      envioId: envio.id,
      prospectoId: prospecto.id,
      secuencia: envio.secuencia,
      version: envio.version,
      adminId,
      duracionMs: fin.getTime() - inicio,
    })

    return json({ estado: "ENVIADO", messageId }, 200)
  } catch (error) {
    if (error instanceof EnvioAbortado) {
      logger.info("Envio abortado por estado", { envioId: id, adminId })
      return errorJson(409, "ESTADO")
    }

    if (esErrorCupo(error)) {
      logger.info("Envio rechazado por cupo en reserva", {
        envioId: id,
        adminId,
        codigo: error.codigo,
      })
      return errorJson(429, "CUPO")
    }

    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    if (esErrorUnique(error)) {
      return errorJson(409, "ESTADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error enviando propuesta", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
