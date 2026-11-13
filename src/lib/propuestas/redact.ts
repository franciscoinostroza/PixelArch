/**
 * T-23 (AC-41, AC-44; RF-59, RF-60, RF-61): redaccion de PII y secretos del
 * portal de propuestas para logs y Sentry.
 *
 * Reutiliza el redactor probado de PayPal (`lib/paypal/redact.ts`) y agrega:
 * - token del link publico de baja: `/propuestas/baja/<token>` queda como
 *   `/propuestas/baja/[token]`;
 * - token del opt-out: `/api/opt-out?token=...` queda como `token=[REDACTED]`;
 * - campos propios del portal que PayPal no conoce: cuerpo, HTML, secreto y
 *   token de baja.
 *
 * El modulo es browser-safe (no importa `node:*`), no muta la entrada y tolera
 * ciclos. Los ids internos, estados, codigos, duraciones y metricas se
 * conservan: son justamente los datos que si pueden aparecer en logs/Sentry.
 */

import {
  REDACTED,
  redactSensitiveData,
  redactSensitiveString,
  redactSentryEvent,
} from "../paypal/redact"

export { REDACTED }

/**
 * Claves del portal cuyo valor nunca se loguea. Se comparan normalizadas
 * (minusculas, sin separadores) para cubrir `cuerpo_html`, `tokenBaja`, etc.
 * Las claves de identidad (email, nombre, telefono) y credenciales ya las
 * cubre el redactor de PayPal; se repiten por claridad y defensa en
 * profundidad.
 */
const CLAVES_SENSIBLES_PROPUESTAS = new Set([
  "cuerpo",
  "cuerpotexto",
  "cuerpohtml",
  "body",
  "html",
  "htmlcuerpo",
  "contenido",
  "contenidohtml",
  "secreto",
  "secret",
  "password",
  "contrasena",
  "tokenbaja",
  "bajatoken",
  "email",
  "nombre",
  "name",
  "telefono",
  "phone",
  "token",
  "authorization",
  "apikey",
  "cookies",
])

const PATRON_BAJA =
  /(\/propuestas\/baja\/)(?!\[token\])[^/?#\s"'<>]+/gi

const PATRON_OPT_OUT =
  /([?&](?:token|token_baja|tokenbaja|optout_token)=)(?!\[REDACTED\])[^&#\s"'<>]+/gi

// Credenciales embebidas en una URL: https://usuario:clave@host/...
const PATRON_CREDENCIALES_URL = /(\/\/)(?!\[REDACTED\]@)[^/@\s"'<>]+@/g

// Campos de bloque: el valor es texto libre (una propuesta entera) y puede
// contener comas, punto y coma o ampersands, asi que se redacta hasta el fin
// de la linea (o de la cadena) para no dejar la cola visible. Un documento
// HTML completo ya se descarta entero con PATRON_DOCUMENTO_HTML.
const PATRON_CAMPOS_BLOQUE =
  /\b(cuerpo|cuerpo_texto|cuerpo_html|body|html|contenido|contenido_html)\b(?!\s*[:=]\s*\[REDACTED\])(\s*[:=]\s*)[^\r\n]*/gi

// Campos puntuales que PayPal no redacta (secreto, credenciales, token de
// baja): el valor sin comillas se consume hasta un delimitador razonable para
// no arrastrar texto vecino ni dejar la primera palabra visible.
const PATRON_CAMPOS_PUNTUALES =
  /\b(secreto|secret|password|contrase(?:n|ñ)a|api[_-]?key|authorization|token[_-]?baja)\b(?!\s*[:=]\s*\[REDACTED\])(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^)\]\}\r\n,;&]+)/gi

// Un documento HTML completo nunca debe llegar a un log, ni siquiera recortado:
// puede contener cuerpo, emails, telefonos y datos de la web.
const PATRON_DOCUMENTO_HTML = /<!doctype\s+html|<html\b|<head\b|<body\b/i

function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Indica si una clave del portal debe redactarse completa. */
export function esClaveSensiblePropuestas(clave: string): boolean {
  return CLAVES_SENSIBLES_PROPUESTAS.has(normalizarClave(clave))
}

/**
 * Redacta un string libre: credenciales, emails, asignaciones sensibles, el
 * token del link de baja y el token del opt-out. No toca ids internos
 * (`prospectoId`, `campanaId`, `envioId`) ni estados/codigos.
 *
 * Limitacion de multilinea: los campos de bloque (`cuerpo`, `body`, `html`,
 * `contenido`, etc.) se redactan desde la clave hasta el fin de la linea donde
 * empieza el valor (aunque empiece en la linea siguiente); las lineas de
 * continuacion posteriores no las cubre esta regla (un documento HTML completo
 * si se descarta entero).
 */
export function redactarTextoPropuestas(texto: string): string {
  if (PATRON_DOCUMENTO_HTML.test(texto)) return REDACTED

  // Las credenciales de una URL se quitan antes del redactor de PayPal: si se
  // dejan, el patron de email puede convertir `clave@host` en `[REDACTED]` y
  // dejar el usuario visible.
  const sinCredenciales = texto.replace(
    PATRON_CREDENCIALES_URL,
    `$1${REDACTED}@`,
  )

  return redactSensitiveString(sinCredenciales)
    .replace(PATRON_BAJA, "$1[token]")
    .replace(PATRON_OPT_OUT, `$1${REDACTED}`)
    .replace(
      PATRON_CAMPOS_BLOQUE,
      (_coincidencia, clave: string, separador: string) =>
        `${clave}${separador}${REDACTED}`,
    )
    .replace(
      PATRON_CAMPOS_PUNTUALES,
      (_coincidencia, clave: string, separador: string) =>
        `${clave}${separador}${REDACTED}`,
    )
}

/**
 * Redacta una URL (absoluta o relativa) sin perder host/path utiles para
 * diagnostico. El token de baja nunca queda visible.
 */
export function redactarUrlPropuestas(url: string): string {
  return redactarTextoPropuestas(url)
}

function esObjetoSimple(valor: object): boolean {
  const prototipo = Object.getPrototypeOf(valor)
  return prototipo === Object.prototype || prototipo === null
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function mapearValor(
  valor: unknown,
  vistos: WeakMap<object, unknown>,
): unknown {
  if (typeof valor === "string") return redactarTextoPropuestas(valor)
  if (valor === null || typeof valor !== "object") return valor

  const previo = vistos.get(valor)
  if (previo !== undefined) return previo

  if (Array.isArray(valor)) {
    const copia: unknown[] = new Array(valor.length)
    vistos.set(valor, copia)
    for (let i = 0; i < valor.length; i++) {
      if (i in valor) copia[i] = mapearValor(valor[i], vistos)
    }
    return copia
  }

  if (valor instanceof Date) return new Date(valor.getTime())

  if (valor instanceof Map) {
    const copia = new Map<unknown, unknown>()
    vistos.set(valor, copia)
    for (const [clave, contenido] of valor) {
      const claveSegura =
        typeof clave === "string" ? redactarTextoPropuestas(clave) : clave
      copia.set(
        claveSegura,
        typeof clave === "string" && esClaveSensiblePropuestas(clave)
          ? REDACTED
          : mapearValor(contenido, vistos),
      )
    }
    return copia
  }

  if (valor instanceof Set) {
    const copia = new Set<unknown>()
    vistos.set(valor, copia)
    for (const contenido of valor) {
      copia.add(mapearValor(contenido, vistos))
    }
    return copia
  }

  if (!esRegistro(valor) || !esObjetoSimple(valor)) return valor

  const copia: Record<string, unknown> = {}
  vistos.set(valor, copia)

  for (const clave of Object.keys(valor)) {
    if (esClaveSensiblePropuestas(clave)) {
      copia[clave] = REDACTED
      continue
    }

    try {
      copia[clave] = mapearValor(valor[clave], vistos)
    } catch {
      // Getters/proxies que fallan: se preserva la clave sin valor.
      copia[clave] = REDACTED
    }
  }

  return copia
}

/**
 * Devuelve una copia redactada de una meta de log. Aplica primero el redactor
 * de PayPal (claves sensibles conocidas, emails, credenciales, token PayPal) y
 * despues las reglas propias del portal. La entrada no se muta.
 */
export function redactarMetaPropuestas<T>(meta: T): T {
  const base = redactSensitiveData(meta)
  return mapearValor(base, new WeakMap()) as T
}

/**
 * Redactor para `beforeSend` de Sentry en server, edge y cliente. Compone el
 * redactor de PayPal con el del portal: PII, cuerpos/HTML, tokens de baja y
 * opt-out quedan fuera del evento; ids, estados, codigos y metricas se
 * conservan. Devuelve una copia: el evento original no se muta.
 */
export function redactSentryEventPropuestas<T extends object>(evento: T): T {
  const copia = redactarMetaPropuestas(evento)
  redactSentryEvent(copia as Partial<Record<string, unknown>>)
  return copia
}
