/**
 * T-18 (AC-26, AC-28, AC-29; RF-43..RF-48): wrapper server-only minimo de
 * Resend para el portal de propuestas.
 *
 * Reglas del plan §2.5/§4.6:
 * - `fetch` directo a `https://api.resend.com/emails`, sin SDK ni dependencias
 *   nuevas. Si la version del SDK no expone idempotencia, este wrapper la
 *   implementa con el header `Idempotency-Key`.
 * - Payload exacto: `from`, `reply_to`, `to`, `subject`, `html`, `text`,
 *   `headers` (`List-Unsubscribe` / `List-Unsubscribe-Post`) y tracking
 *   explicitamente apagado (`open_tracking: false`, `click_tracking: false`).
 *   Sin envío programado, adjuntos, copias ocultas ni tracking.
 * - Una sola llamada, timeout de 10 s por defecto y **sin retry**.
 * - Exito solo con `data.id`: cualquier otra respuesta es un error tipado.
 * - Errores sanitizados a codigos (`VALIDACION`, `LIMITE`, `PROVEEDOR`, `RED`,
 *   `DESCONOCIDO`). No se loguea destinatario, asunto, cuerpo ni la API key.
 *
 * El wrapper no toca Prisma, config, logger ni el CRM. La API key se lee de
 * `RESEND_API_KEY` (server-only) o se inyecta por opciones en tests; nunca se
 * devuelve ni se incluye en mensajes.
 */

import { normalizarEmail } from "./normalizar"

export const CODIGOS_ERROR_RESEND = [
  "VALIDACION",
  "LIMITE",
  "PROVEEDOR",
  "RED",
  "DESCONOCIDO",
] as const

export type CodigoErrorResend = (typeof CODIGOS_ERROR_RESEND)[number]

const MENSAJES_RESEND: Record<CodigoErrorResend, string> = {
  VALIDACION: "La solicitud a Resend no es valida.",
  LIMITE: "Se alcanzo el limite de Resend.",
  PROVEEDOR: "Resend no respondio correctamente.",
  RED: "No se pudo conectar con Resend.",
  DESCONOCIDO: "Error inesperado al enviar el email.",
}

/**
 * Error tipado del wrapper. El mensaje solo expone un codigo fijo: nunca la
 * respuesta cruda del proveedor, el destinatario, el asunto, el cuerpo ni la
 * API key.
 */
export class ErrorResend extends Error {
  readonly codigo: CodigoErrorResend

  constructor(codigo: CodigoErrorResend) {
    super(MENSAJES_RESEND[codigo])
    this.name = "ErrorResend"
    this.codigo = codigo
  }
}

export const ENDPOINT_RESEND = "https://api.resend.com/emails"
export const TIMEOUT_RESEND_MS = 10_000
const MAX_API_KEY = 512
const MAX_IDEMPOTENCY = 256
const MAX_EMAIL = 254
const MAX_ASUNTO = 998
const MAX_CUERPO = 500_000
const MAX_HEADER = 2048
const MAX_NOMBRE = 120

export interface HeadersResend {
  "List-Unsubscribe": string
  "List-Unsubscribe-Post": string
}

export interface EntradaEnvioResend {
  fromEmail: string
  fromNombre?: string | null
  replyTo: string
  to: string
  subject: string
  html: string
  text: string
  headers: HeadersResend
  /** Clave estable del envio (`envio:<id>:v<version>`). */
  idempotencyKey: string
}

export interface OpcionesEnvioResend {
  /** Override de tests; si se omite se lee `RESEND_API_KEY`. */
  apiKey?: string | null
  /** Override de tests; default `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** Default 10 s; acotado a 60 s. */
  timeoutMs?: number
  /** Override de tests; default endpoint oficial. */
  endpoint?: string
}

export interface ResultadoEnvioResend {
  messageId: string
}

function errorValidacion(): ErrorResend {
  return new ErrorResend("VALIDACION")
}

function leerApiKey(opciones: OpcionesEnvioResend): string {
  const crudo = opciones.apiKey ?? process.env.RESEND_API_KEY
  if (typeof crudo !== "string") throw errorValidacion()

  const apiKey = crudo.trim()
  if (
    apiKey.length === 0 ||
    apiKey.length > MAX_API_KEY ||
    /[\r\n]/.test(apiKey)
  ) {
    throw errorValidacion()
  }

  return apiKey
}

function emailValido(valor: unknown): string {
  if (typeof valor !== "string" || valor.length > MAX_EMAIL) {
    throw errorValidacion()
  }

  const email = normalizarEmail(valor)
  if (email === null) throw errorValidacion()
  return email
}

function asuntoValido(valor: unknown): string {
  if (typeof valor !== "string") throw errorValidacion()

  const asunto = valor.trim()
  if (
    asunto.length === 0 ||
    asunto.length > MAX_ASUNTO ||
    /[\r\n]/.test(asunto)
  ) {
    throw errorValidacion()
  }

  return asunto
}

function cuerpoValido(valor: unknown): string {
  if (typeof valor !== "string") throw errorValidacion()

  const limpio = valor.trim()
  if (limpio.length === 0 || valor.length > MAX_CUERPO) {
    throw errorValidacion()
  }

  // Se devuelve el contenido original: el snapshot aprobado se envia tal cual.
  return valor
}

function idempotencyValida(valor: unknown): string {
  if (typeof valor !== "string") throw errorValidacion()

  const clave = valor.trim()
  if (
    clave.length === 0 ||
    clave.length > MAX_IDEMPOTENCY ||
    /[\r\n]/.test(clave)
  ) {
    throw errorValidacion()
  }

  return clave
}

/**
 * Nombre visible del remitente. Se eliminan CR/LF, angulos y comillas para no
 * romper el header `From`; si queda vacio se usa solo el email.
 */
function nombreRemitente(valor: unknown): string {
  if (typeof valor !== "string") return ""

  return valor
    .replace(/[\r\n<>"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOMBRE)
}

function formatearFrom(email: string, nombre: string): string {
  return nombre.length > 0 ? `${nombre} <${email}>` : email
}

function headersValidos(valor: unknown): HeadersResend {
  if (!valor || typeof valor !== "object") throw errorValidacion()

  const headers = valor as Record<string, unknown>
  const listUnsubscribe = headers["List-Unsubscribe"]
  const listUnsubscribePost = headers["List-Unsubscribe-Post"]

  if (
    typeof listUnsubscribe !== "string" ||
    listUnsubscribe.trim().length === 0 ||
    listUnsubscribe.length > MAX_HEADER ||
    /[\r\n]/.test(listUnsubscribe)
  ) {
    throw errorValidacion()
  }

  if (listUnsubscribePost !== "List-Unsubscribe=One-Click") {
    throw errorValidacion()
  }

  return {
    "List-Unsubscribe": listUnsubscribe.trim(),
    "List-Unsubscribe-Post": listUnsubscribePost,
  }
}

function timeoutValido(valor: unknown): number {
  if (valor === undefined) return TIMEOUT_RESEND_MS
  if (
    typeof valor !== "number" ||
    !Number.isSafeInteger(valor) ||
    valor < 1_000 ||
    valor > 60_000
  ) {
    throw errorValidacion()
  }

  return valor
}

async function leerMessageId(respuesta: Response): Promise<string> {
  let payload: unknown
  try {
    payload = await respuesta.json()
  } catch {
    throw new ErrorResend("PROVEEDOR")
  }

  if (!payload || typeof payload !== "object") {
    throw new ErrorResend("PROVEEDOR")
  }

  const id = (payload as { id?: unknown }).id
  if (typeof id !== "string") throw new ErrorResend("PROVEEDOR")

  const messageId = id.trim()
  if (messageId.length === 0 || messageId.length > 512) {
    throw new ErrorResend("PROVEEDOR")
  }

  return messageId
}

function codigoHttp(status: number): CodigoErrorResend {
  if (status === 429) return "LIMITE"
  if (status === 400 || status === 422) return "VALIDACION"
  if (status === 401 || status === 403 || status >= 500) return "PROVEEDOR"
  return "DESCONOCIDO"
}

/**
 * Envia un email ya aprobado a Resend. Una sola llamada, idempotente por
 * `Idempotency-Key`, sin retry y con timeout acotado.
 *
 * Lanza `ErrorResend` con un codigo fijo. El llamador decide el estado del
 * envio (`FALLIDO`) y no debe reintentar automaticamente.
 */
export async function enviarEmail(
  entrada: EntradaEnvioResend,
  opciones: OpcionesEnvioResend = {},
): Promise<ResultadoEnvioResend> {
  if (!entrada || typeof entrada !== "object") throw errorValidacion()

  const apiKey = leerApiKey(opciones)
  const fromEmail = emailValido(entrada.fromEmail)
  const replyTo = emailValido(entrada.replyTo)
  const to = emailValido(entrada.to)
  const subject = asuntoValido(entrada.subject)
  const html = cuerpoValido(entrada.html)
  const text = cuerpoValido(entrada.text)
  const headers = headersValidos(entrada.headers)
  const idempotencyKey = idempotencyValida(entrada.idempotencyKey)
  const timeoutMs = timeoutValido(opciones.timeoutMs)
  const endpoint =
    typeof opciones.endpoint === "string" && opciones.endpoint.length > 0
      ? opciones.endpoint
      : ENDPOINT_RESEND

  const fetchImpl = opciones.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new ErrorResend("RED")

  // Sin programacion, adjuntos, copias ocultas ni tracking: el email sale
  // una sola vez, en el momento, y solo al destinatario aprobado. El tracking
  // se apaga explicitamente (RF-47) por si la cuenta lo tiene activo.
  const cuerpo = JSON.stringify({
    from: formatearFrom(fromEmail, nombreRemitente(entrada.fromNombre)),
    reply_to: replyTo,
    to,
    subject,
    html,
    text,
    headers,
    open_tracking: false,
    click_tracking: false,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let respuesta: Response
  try {
    respuesta = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: cuerpo,
      signal: controller.signal,
    })
  } catch {
    // Incluye timeout/abort y errores DNS/TLS: nunca se reintenta aca.
    throw new ErrorResend("RED")
  } finally {
    clearTimeout(timer)
  }

  if (!respuesta.ok) {
    throw new ErrorResend(codigoHttp(respuesta.status))
  }

  const messageId = await leerMessageId(respuesta)
  return { messageId }
}

/** Alias explicito para las rutas del portal. */
export const enviarEmailResend = enviarEmail
