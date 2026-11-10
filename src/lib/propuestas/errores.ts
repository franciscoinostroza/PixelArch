/**
 * T-02/T-04 (AC-6, AC-41, AC-42; RF-8, RF-61, RF-64): errores del portal.
 *
 * - `esErrorTablaFaltante` detecta el esquema no aplicado para fallar cerrado.
 * - `sanitizarError` normaliza un error a un codigo conocido y un mensaje sin
 *   PII, URLs con tokens, credenciales ni valores de secretos del entorno.
 *
 * Este modulo es puro: no toca Prisma, red, logs ni proveedores.
 */

export const CODIGOS_ERROR = [
  "VALIDACION",
  "NO_AUTORIZADO",
  "PROHIBIDO",
  "ORIGEN_INVALIDO",
  "NO_ENCONTRADO",
  "ESTADO",
  "SUPRIMIDO",
  "SIN_EMAIL",
  "MAX_MENSAJES",
  "BORRADOR_ABIERTO",
  "CUPO",
  "RATE_LIMIT",
  "LIMITE",
  "REVALIDACION",
  "PROVEEDOR",
  "NO_CONFIGURADO",
  "CONFIGURACION",
  "CREDENCIALES",
  "CUOTA",
  "TIMEOUT",
  "RED",
  "ESQUEMA_NO_APLICADO",
  "DESCONOCIDO",
] as const

export type CodigoError = (typeof CODIGOS_ERROR)[number]

export const CODIGO_ESQUEMA_NO_APLICADO = "ESQUEMA_NO_APLICADO"

export function esCodigoError(valor: unknown): valor is CodigoError {
  return (
    typeof valor === "string" &&
    (CODIGOS_ERROR as readonly string[]).includes(valor)
  )
}

interface ErrorConCodigo {
  code?: unknown
  meta?: { code?: unknown; message?: unknown }
  message?: unknown
}

/**
 * Prisma reporta una tabla faltante como P2021; una consulta raw puede
 * reportarla como P2010 con `meta.code = "42P01"` o con el mensaje de
 * PostgreSQL. Se aceptan las tres formas para no mostrar datos a medias.
 */
export function esErrorTablaFaltante(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const candidato = error as ErrorConCodigo

  if (candidato.code === "P2021" || candidato.code === "42P01") return true
  if (candidato.meta?.code === "P2021" || candidato.meta?.code === "42P01") {
    return true
  }

  const mensaje =
    typeof candidato.message === "string" ? candidato.message : ""
  return /relation .* does not exist|table .* does not exist|no existe la relaci[oó]n/i.test(
    mensaje,
  )
}

export interface ErrorSanitizado {
  codigo: CodigoError
  mensaje: string
}

export interface OpcionesSanitizarError {
  codigo?: CodigoError
  mensaje?: string
}

const MENSAJES: Record<CodigoError, string> = {
  VALIDACION: "Los datos enviados no son validos.",
  NO_AUTORIZADO: "No autorizado.",
  PROHIBIDO: "Prohibido.",
  ORIGEN_INVALIDO: "El origen de la solicitud no es valido.",
  NO_ENCONTRADO: "No se encontro el recurso.",
  ESTADO: "La operacion no es valida en el estado actual.",
  SUPRIMIDO: "El contacto esta suprimido.",
  SIN_EMAIL: "El prospecto no tiene un email de contacto.",
  MAX_MENSAJES: "Se alcanzo el maximo de mensajes para el prospecto.",
  BORRADOR_ABIERTO: "Ya existe un borrador abierto para el prospecto.",
  CUPO: "Se alcanzo el cupo configurado.",
  RATE_LIMIT: "Demasiadas solicitudes.",
  LIMITE: "Se alcanzo un limite del proveedor.",
  REVALIDACION: "La aprobacion ya no coincide con el contenido actual.",
  PROVEEDOR: "El proveedor no respondio correctamente.",
  NO_CONFIGURADO: "La funcion solicitada no esta configurada.",
  CONFIGURACION: "La configuracion del proveedor es invalida.",
  CREDENCIALES: "Las credenciales del proveedor son invalidas.",
  CUOTA: "Se alcanzo la cuota del proveedor.",
  TIMEOUT: "El proveedor no respondio a tiempo.",
  RED: "Error de red.",
  ESQUEMA_NO_APLICADO: "El esquema del portal no esta aplicado.",
  DESCONOCIDO: "Error inesperado.",
}

const MAX_MENSAJE = 240

/**
 * Variables cuyo valor nunca debe aparecer en un mensaje devuelto o logueado.
 * Se incluyen secretos de integraciones ya existentes y del portal.
 */
const ENVS_SECRETAS = [
  "PROPUESTAS_SECRETO",
  "PROPUESTAS_PLACES_API_KEY",
  "RESEND_API_KEY",
  "CLERK_SECRET_KEY",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "SANITY_API_TOKEN",
  "SANITY_REVALIDATE_SECRET",
  "CRON_SECRET",
  "SENTRY_AUTH_TOKEN",
  "RAILWAY_API_TOKEN",
  "VERCEL_API_TOKEN",
] as const

const PATRON_EMAIL =
  /[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}/g
const PATRON_CREDENCIAL =
  /\b(api[_-]?key|token|secret|secreto|password|authorization)\b\s*[:=]\s*\S+/gi
const PATRON_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

function redactar(texto: string): string {
  let resultado = texto

  try {
    for (const key of ENVS_SECRETAS) {
      const valor = process.env[key]?.trim()
      if (valor && valor.length >= 8) {
        resultado = resultado.split(valor).join("[secreto]")
      }
    }
  } catch {
    // Si el entorno no esta disponible, siguen las redacciones por patron.
  }

  return resultado
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[url]")
    .replace(PATRON_EMAIL, "[email]")
    .replace(PATRON_BEARER, "Bearer [token]")
    .replace(PATRON_CREDENCIAL, "$1=[redactado]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MENSAJE)
}

function codigoConocido(valor: unknown): CodigoError | null {
  return esCodigoError(valor) ? valor : null
}

function codigoDe(error: unknown): CodigoError | null {
  if (!error || typeof error !== "object") return null

  const registro = error as Record<string, unknown>
  return codigoConocido(registro.codigo) ?? codigoConocido(registro.code)
}

function mensajeDe(error: unknown): string | null {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message

  if (error && typeof error === "object") {
    const mensaje = (error as { message?: unknown }).message
    if (typeof mensaje === "string") return mensaje
  }

  return null
}

/**
 * Devuelve solo `{ codigo, mensaje }`:
 * - nunca incluye stack, payloads, cabeceras ni el objeto original;
 * - redacta emails, URLs (incluidos tokens de baja), credenciales y valores de
 *   secretos del entorno;
 * - acota el mensaje a 240 caracteres.
 */
export function sanitizarError(
  error: unknown,
  opciones: OpcionesSanitizarError = {},
): ErrorSanitizado {
  const codigo =
    codigoConocido(opciones.codigo) ??
    codigoDe(error) ??
    (esErrorTablaFaltante(error) ? "ESQUEMA_NO_APLICADO" : "DESCONOCIDO")

  // Para esquema no aplicado se prefiere el mensaje operativo generico: no
  // aporta nada exponer nombres de tablas ni detalles de Prisma.
  const crudo =
    opciones.mensaje ??
    (codigo === "ESQUEMA_NO_APLICADO" ? null : mensajeDe(error))
  const redactado = crudo === null ? "" : redactar(crudo)

  return {
    codigo,
    mensaje: redactado.length > 0 ? redactado : MENSAJES[codigo],
  }
}
