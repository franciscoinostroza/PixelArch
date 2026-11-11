/**
 * T-06 (AC-15, AC-16, AC-17, AC-18, AC-33, AC-34, AC-35, AC-36; RF-23..28,
 * RF-51, RF-52): supresion por hash, token de baja y contactabilidad.
 *
 * Modulo puro: usa `node:crypto` pero no toca Prisma, red, entorno, logging ni
 * proveedores.
 *
 * Reglas:
 * - El email solo se usa para calcular un HMAC-SHA256; el valor en claro no se
 *   devuelve, no se guarda y no aparece en claves ni tokens.
 * - La supresion por dominio solo se permite para dominios de negocio:
 *   se rechazan proveedores de email publico, sufijos publicos, redes,
 *   marketplaces, agregadores y plataformas multiinquilino.
 * - El token de baja es opaco: `v1.<prospectoId>.<emailHash>.<hmac>`. No
 *   contiene email, nombre ni telefono, y se verifica en tiempo constante.
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import {
  dominioNegocio,
  esHostNoProspectable,
  normalizarEmail,
} from "./normalizar"

const MIN_SECRETO = 32
const MAX_TOKEN = 512
const PREFIJO_EMAIL = "EMAIL:"
const PREFIJO_DOMINIO = "DOMINIO:"

const RE_HASH = /^[0-9a-f]{64}$/
const RE_PROSPECTO_ID = /^[A-Za-z0-9_-]{1,64}$/
const RE_FIRMA = /^[A-Za-z0-9_-]{43}$/

export type CodigoErrorSupresion =
  | "SECRETO"
  | "EMAIL"
  | "DOMINIO"
  | "HASH"
  | "PROSPECTO"

/**
 * Error de entrada invalida. El mensaje solo incluye un codigo fijo: nunca el
 * valor recibido (que podria ser un email o un token).
 */
export class ErrorSupresion extends Error {
  readonly codigo: CodigoErrorSupresion

  constructor(codigo: CodigoErrorSupresion) {
    super(`Entrada de supresion invalida (${codigo}).`)
    this.name = "ErrorSupresion"
    this.codigo = codigo
  }
}

/**
 * Proveedores de email publico adicionales a la lista curada de T-05. Se usan
 * para que una supresion por dominio nunca bloquee a un proveedor (ni a sus
 * variantes por pais).
 */
const PROVEEDORES_PUBLICOS_EXTRA = new Set<string>([
  "web.de",
  "t-online.de",
  "freenet.de",
  "arcor.de",
  "posteo.de",
  "mailbox.org",
  "mail.de",
  "orange.fr",
  "wanadoo.fr",
  "laposte.net",
  "free.fr",
  "sfr.fr",
  "bbox.fr",
  "aliceadsl.fr",
  "voila.fr",
  "numericable.fr",
  "libero.it",
  "virgilio.it",
  "alice.it",
  "tin.it",
  "tiscali.it",
  "fastwebnet.it",
  "email.it",
  "inwind.it",
  "iol.it",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "zipmail.com.br",
  "oi.com.br",
  "globomail.com",
  "click21.com.br",
  "pop.com.br",
  "superig.com.br",
  "itelefonica.com.br",
  "speedy.com.ar",
  "fibertel.com.ar",
  "arnet.com.ar",
  "ciudad.com.ar",
  "cablevision.com.ar",
  "multicanal.com.ar",
  "telecentro.com.ar",
  "prodigy.net.mx",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "rediffmail.com",
  "seznam.cz",
  "centrum.cz",
  "email.cz",
  "azet.sk",
  "zoznam.sk",
  "onet.pl",
  "wp.pl",
  "o2.pl",
  "interia.pl",
  "gazeta.pl",
  "op.pl",
  "tlen.pl",
  "mail.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "internet.ru",
  "rambler.ru",
  "ya.ru",
  "narod.ru",
  "ukr.net",
  "meta.ua",
])

/**
 * Marcas de proveedores globales con variantes por pais (`gmail.com.br`,
 * `hotmail.de`, `outlook.fr`, ...). La comparacion es por la primera etiqueta
 * del dominio registrable, no por substring.
 */
const MARCAS_PROVEEDOR_PUBLICO = new Set<string>([
  "gmail",
  "googlemail",
  "hotmail",
  "outlook",
  "yahoo",
  "ymail",
  "rocketmail",
  "icloud",
  "live",
  "msn",
  "protonmail",
  "proton",
  "tutanota",
  "tuta",
  "gmx",
  "zoho",
  "yandex",
  "fastmail",
  "hushmail",
  "aol",
])

/**
 * Dominios exactos de plataformas donde muchas empresas comparten el mismo
 * dominio registrable. Una supresion `DOMINIO:` sobre estos hosts bloquearia a
 * todos los inquilinos, asi que no se aceptan.
 */
const DOMINIOS_MULTIINQUILINO = new Set<string>([
  "wordpress.com",
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "jimdo.com",
  "webnode.com",
  "webnode.page",
  "strikingly.com",
  "mystrikingly.com",
  "carrd.co",
  "tumblr.com",
  "substack.com",
  "ghost.io",
  "notion.site",
  "notion.so",
  "webflow.io",
  "myshopify.com",
  "shopify.com",
  "squarespace.com",
  "square.site",
  "godaddysites.com",
  "site123.com",
  "site123.me",
  "cargo.site",
  "framer.website",
  "framer.app",
  "bubbleapps.io",
  "softr.app",
  "glideapp.io",
  "business.site",
  "github.io",
  "gitlab.io",
  "bitbucket.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "onrender.com",
  "render.com",
  "railway.app",
  "fly.dev",
  "glitch.me",
  "replit.app",
  "replit.dev",
  "repl.co",
  "ngrok.io",
  "ngrok.app",
  "trycloudflare.com",
  "cloudfront.net",
  "amazonaws.com",
  "elasticbeanstalk.com",
  "appspot.com",
  "azurewebsites.net",
  "cloudapp.azure.com",
  "azure.com",
  "windows.net",
  "azureedge.net",
  "azurestaticapps.net",
  "trafficmanager.net",
  "cloudflarestorage.com",
  "r2.dev",
  "canva.site",
  "canva.com",
  "sendgrid.net",
  "mailgun.org",
  "mandrillapp.com",
  "amazonses.com",
  "postmarkapp.com",
  "mailjet.com",
  "brevo.com",
  "constantcontact.com",
  "campaign-archive.com",
  "createsend.com",
  "mailchimp.com",
  "list-manage.com",
  "hubspotemail.net",
  "hs-sites.com",
  "wixpress.com",
  "sentry.io",
  "weblium.com",
  "ucraft.com",
  "bookmark.com",
  "webstarts.com",
  "yola.com",
  "moonfruit.com",
  "homestead.com",
  "webs.com",
])

/**
 * Marcas multiinquilino con variantes por pais o subdominios propios
 * (`blogspot.com.ar`, `foo.business.site`, ...).
 */
const MARCAS_MULTIINQUILINO = new Set<string>([
  "blogspot",
  "blogger",
  "wordpress",
  "wixsite",
  "weebly",
  "jimdo",
  "webnode",
  "strikingly",
  "carrd",
  "tumblr",
  "substack",
  "ghost",
  "notion",
  "webflow",
  "shopify",
  "myshopify",
  "squarespace",
  "square",
  "godaddysites",
  "site123",
  "cargo",
  "framer",
  "bubbleapps",
  "softr",
  "glideapp",
  "business",
  "canva",
  "github",
  "gitlab",
  "bitbucket",
  "netlify",
  "vercel",
  "pages",
  "workers",
  "web",
  "firebaseapp",
  "herokuapp",
  "onrender",
  "render",
  "railway",
  "fly",
  "glitch",
  "replit",
  "repl",
  "ngrok",
  "trycloudflare",
  "cloudfront",
  "amazonaws",
  "elasticbeanstalk",
  "appspot",
  "azurewebsites",
  "cloudapp",
  "trafficmanager",
  "sendgrid",
  "mailgun",
  "mandrillapp",
  "amazonses",
  "postmarkapp",
  "mailjet",
  "brevo",
  "constantcontact",
  "campaign-archive",
  "createsend",
  "mailchimp",
  "list-manage",
  "hubspotemail",
  "hs-sites",
  "wixpress",
  "sentry",
  "weblium",
  "ucraft",
  "bookmark",
  "webstarts",
  "yola",
  "moonfruit",
  "homestead",
  "webs",
])

function validarSecreto(secreto: string): string {
  if (typeof secreto !== "string" || secreto.length < MIN_SECRETO) {
    throw new ErrorSupresion("SECRETO")
  }
  if (secreto.trim().length === 0) {
    throw new ErrorSupresion("SECRETO")
  }
  return secreto
}

function emailNormalizado(email: string): string {
  const normalizado = normalizarEmail(email)
  if (normalizado === null) {
    throw new ErrorSupresion("EMAIL")
  }
  return normalizado
}

/**
 * Acepta un hash hex de 64 caracteres, con o sin prefijo `EMAIL:`. El prefijo
 * se normaliza para que la clave sea idempotente.
 */
function hashNormalizado(hash: string): string {
  if (typeof hash !== "string") {
    throw new ErrorSupresion("HASH")
  }

  const limpio = hash.trim()
  const sinPrefijo = limpio.toUpperCase().startsWith(PREFIJO_EMAIL)
    ? limpio.slice(PREFIJO_EMAIL.length)
    : limpio

  const valor = sinPrefijo.trim().toLowerCase()
  if (!RE_HASH.test(valor)) {
    throw new ErrorSupresion("HASH")
  }
  return valor
}

function prospectoIdNormalizado(prospectoId: string): string {
  if (typeof prospectoId !== "string") {
    throw new ErrorSupresion("PROSPECTO")
  }

  const valor = prospectoId.trim()
  if (!RE_PROSPECTO_ID.test(valor)) {
    throw new ErrorSupresion("PROSPECTO")
  }
  return valor
}

function esProveedorPublicoSuprimible(dominio: string): boolean {
  if (PROVEEDORES_PUBLICOS_EXTRA.has(dominio)) return true

  const marca = dominio.split(".")[0]
  return MARCAS_PROVEEDOR_PUBLICO.has(marca)
}

/**
 * `true` para plataformas donde el dominio registrable es compartido por
 * muchos negocios. No se puede suprimir por dominio: solo por email.
 */
export function esDominioMultiinquilino(dominio: string): boolean {
  const normalizado = dominioNegocio(dominio)
  if (normalizado === null) return false

  if (DOMINIOS_MULTIINQUILINO.has(normalizado)) return true

  const marca = normalizado.split(".")[0]
  return MARCAS_MULTIINQUILINO.has(marca)
}

/**
 * Devuelve el dominio registrable si es un dominio de negocio suprimible.
 * Devuelve `null` para hostnames invalidos, sufijos publicos, proveedores de
 * email publico, redes/marketplaces/agregadores y plataformas multiinquilino.
 *
 * Acepta un host, una URL o un email (se toma el dominio del email). Tambien
 * acepta el prefijo `DOMINIO:` de una clave ya guardada.
 */
export function dominioSuprimible(
  input: string | null | undefined,
): string | null {
  if (typeof input !== "string") return null

  let valor = input.trim()
  if (valor.length === 0 || valor.length > 2048) return null
  if (/^email:/i.test(valor)) return null
  if (/^dominio:/i.test(valor)) {
    valor = valor.slice(PREFIJO_DOMINIO.length).trim()
    if (valor.length === 0) return null
    if (/^email:/i.test(valor)) return null
  }

  // Acepta un email completo como comodidad (`info@consultora.com`), pero solo
  // si el email es valido: no se parte HTML, `mailto:` ni cadenas corruptas.
  if (valor.includes("@")) {
    const email = normalizarEmail(valor)
    if (email === null) return null
    valor = email.slice(email.lastIndexOf("@") + 1)
  }

  const dominio = dominioNegocio(valor)
  if (dominio === null) return null
  if (esProveedorPublicoSuprimible(dominio)) return null
  if (esHostNoProspectable(dominio)) return null
  if (esDominioMultiinquilino(dominio)) return null

  return dominio
}

/** HMAC-SHA256 del email normalizado. Estable por secreto; nunca reversible. */
export function hashEmail(email: string, secreto: string): string {
  const secretoValido = validarSecreto(secreto)
  const normalizado = emailNormalizado(email)

  return createHmac("sha256", secretoValido)
    .update(`email:${normalizado}`, "utf8")
    .digest("hex")
}

/** Clave unica e idempotente de supresion por email: `EMAIL:<hmac>`. */
export function claveSupresionEmail(hash: string): string {
  return `${PREFIJO_EMAIL}${hashNormalizado(hash)}`
}

/** Clave unica e idempotente de supresion por dominio: `DOMINIO:<dominio>`. */
export function claveSupresionDominio(dominio: string): string {
  const normalizado = dominioSuprimible(dominio)
  if (normalizado === null) {
    throw new ErrorSupresion("DOMINIO")
  }
  return `${PREFIJO_DOMINIO}${normalizado}`
}

/**
 * Email enmascarado para mostrar en la UI. Conserva la primera letra del local
 * part y el dominio de negocio, pero nunca el email completo. Devuelve `""`
 * para un email invalido (no inventa una mascara a partir de HTML o basura).
 */
export function emailEnmascarado(email: string): string {
  const normalizado = normalizarEmail(email)
  if (normalizado === null) return ""

  const separador = normalizado.lastIndexOf("@")
  const local = normalizado.slice(0, separador)
  const dominio = normalizado.slice(separador + 1)

  const inicial = /^[a-z0-9]$/i.test(local.charAt(0))
    ? local.charAt(0)
    : "*"
  const mascara = local.length > 1 ? `${inicial}***` : "***"

  return `${mascara}@${dominio}`
}

export type SupresionEvaluable =
  | { ambito: "EMAIL"; emailHash: string }
  | { ambito: "DOMINIO"; dominioNegocio: string }

export interface EntradaContactabilidad {
  email?: string | null
  dominioNegocio?: string | null
  supresiones: SupresionEvaluable[]
}

export type MotivoNoContactable =
  | "SIN_EMAIL"
  | "SUPRIMIDO_EMAIL"
  | "SUPRIMIDO_DOMINIO"

export interface ResultadoContactabilidad {
  contactable: boolean
  motivo?: MotivoNoContactable
}

/**
 * Evalua si un prospecto puede recibir un envio:
 * 1. sin email valido no es contactable;
 * 2. una supresion global por hash de email manda;
 * 3. una supresion por dominio de negocio bloquea, tanto si el dominio viene
 *    explicito como si se deriva del email;
 * 4. los dominios publicos y multiinquilino nunca bloquean por dominio.
 *
 * Las supresiones invalidas se ignoran: un registro corrupto no debe bloquear
 * ni revelar datos. La supresion por email gana sobre la de dominio.
 */
export function evaluarContactabilidad(
  input: EntradaContactabilidad,
  secreto: string,
): ResultadoContactabilidad {
  const email = input?.email ? normalizarEmail(input.email) : null
  if (email === null) {
    return { contactable: false, motivo: "SIN_EMAIL" }
  }

  const emailHash = hashEmail(email, secreto)
  const supresiones = Array.isArray(input.supresiones)
    ? input.supresiones
    : []

  for (const supresion of supresiones) {
    if (!supresion || supresion.ambito !== "EMAIL") continue

    try {
      if (hashNormalizado(supresion.emailHash) === emailHash) {
        return { contactable: false, motivo: "SUPRIMIDO_EMAIL" }
      }
    } catch {
      // Registro corrupto: se ignora.
    }
  }

  const dominios = new Set<string>()
  const dominioExplicito = dominioSuprimible(input.dominioNegocio)
  if (dominioExplicito !== null) dominios.add(dominioExplicito)

  // Un email de negocio tambien aporta su dominio registrable. Para Gmail y
  // otros proveedores publicos nunca se agrega un dominio.
  const dominioDelEmail = dominioSuprimible(email)
  if (dominioDelEmail !== null) dominios.add(dominioDelEmail)

  if (dominios.size > 0) {
    for (const supresion of supresiones) {
      if (!supresion || supresion.ambito !== "DOMINIO") continue

      const dominio = dominioSuprimible(supresion.dominioNegocio)
      if (dominio !== null && dominios.has(dominio)) {
        return { contactable: false, motivo: "SUPRIMIDO_DOMINIO" }
      }
    }
  }

  return { contactable: true }
}

function firmaBaja(
  prospectoId: string,
  emailHash: string,
  secreto: string,
): string {
  return createHmac("sha256", secreto)
    .update(`baja:v1:${prospectoId}:${emailHash}`, "utf8")
    .digest("base64url")
}

/**
 * Crea un token de baja opaco y determinista:
 * `v1.<prospectoId>.<emailHash>.<hmac>`. No incluye email, nombre ni telefono.
 */
export function crearTokenBaja(
  prospectoId: string,
  emailHash: string,
  secreto: string,
): string {
  const id = prospectoIdNormalizado(prospectoId)
  const hash = hashNormalizado(emailHash)
  const secretoValido = validarSecreto(secreto)

  return `v1.${id}.${hash}.${firmaBaja(id, hash, secretoValido)}`
}

export type TokenBajaVerificado =
  | { ok: true; prospectoId: string; emailHash: string }
  | { ok: false }

function igualdadConstante(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8")
  const bufferB = Buffer.from(b, "utf8")

  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Verifica un token de baja sin consultar la base. Cualquier token invalido
 * (formato, version o firma) devuelve `{ ok: false }`; no lanza y no revela si
 * el prospecto o el email existian.
 */
export function verificarTokenBaja(
  token: string,
  secreto: string,
): TokenBajaVerificado {
  if (typeof token !== "string") return { ok: false }

  const limpio = token.trim()
  if (limpio.length === 0 || limpio.length > MAX_TOKEN) return { ok: false }

  const partes = limpio.split(".")
  if (partes.length !== 4) return { ok: false }

  const [version, prospectoId, emailHash, firma] = partes
  if (version !== "v1") return { ok: false }
  if (!RE_PROSPECTO_ID.test(prospectoId)) return { ok: false }
  if (!RE_HASH.test(emailHash)) return { ok: false }
  if (!RE_FIRMA.test(firma)) return { ok: false }

  let secretoValido: string
  try {
    secretoValido = validarSecreto(secreto)
  } catch {
    return { ok: false }
  }

  const esperada = firmaBaja(prospectoId, emailHash, secretoValido)
  if (!igualdadConstante(firma, esperada)) return { ok: false }

  return { ok: true, prospectoId, emailHash }
}
