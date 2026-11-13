/**
 * T-14 (AC-13, AC-14, AC-19; RF-18, RF-22): helpers puros del prospecto
 * manual.
 *
 * No toca Prisma, red, entorno ni logs. Se usan en las rutas de alta y
 * correccion para:
 * - normalizar el sitio del negocio (solo http/https, host canonico y dominio
 *   registrable de negocio; redes/agregadores y proveedores publicos quedan
 *   fuera);
 * - decidir si un email necesita fuente propia porque no pertenece al dominio
 *   del sitio o porque es un proveedor publico (nunca se adivina un patron);
 * - agregar entradas al historial JSON acotando su tamano y sin guardar PII.
 */

import {
  dominioNegocio,
  dominioRegistrable,
  esHostNoProspectable,
  esProveedorPublico,
  normalizarDominio,
  normalizarEmail,
} from "./normalizar"

/** Maximo de entradas retenidas en `Prospecto.historial`. */
export const MAX_HISTORIAL_PROSPECTO = 100

export interface SitioManual {
  /** URL canonica http/https, sin hash ni credenciales. */
  sitioWeb: string
  /** Host canonico (lowercase, sin `www.`, sin puerto). */
  host: string
  /** Dominio registrable de negocio (nunca un proveedor publico). */
  dominio: string
}

/**
 * Normaliza el sitio de un prospecto cargado a mano. Devuelve `null` para
 * cualquier valor que no sea una web propia de negocio: esquema invalido,
 * credenciales, host sin dominio registrable, proveedor de email publico,
 * red social, marketplace, agregador o link-in-bio.
 */
export function normalizarSitioManual(raw: string): SitioManual | null {
  const valor = raw.trim()
  if (valor.length === 0) return null

  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null

  const host = normalizarDominio(url.toString())
  if (host === null) return null

  const dominio = dominioNegocio(url.toString())
  if (dominio === null) return null
  if (esHostNoProspectable(dominio)) return null

  const canonica = new URL(url.toString())
  canonica.hash = ""
  canonica.hostname = host

  return { sitioWeb: canonica.toString(), host, dominio }
}

function dominioDeEmail(email: string): string | null {
  const normalizado = normalizarEmail(email)
  if (normalizado === null) return null

  return normalizado.slice(normalizado.lastIndexOf("@") + 1)
}

/**
 * `true` si el email usa el mismo dominio registrable que el sitio del
 * negocio (incluye subdominios de correo como `mail.empresa.com`).
 */
export function emailPerteneceAlDominio(
  email: string,
  dominioSitio: string,
): boolean {
  const dominioEmail = dominioDeEmail(email)
  if (dominioEmail === null) return false

  return dominioRegistrable(dominioEmail) === dominioSitio
}

/**
 * `true` cuando el email requiere una fuente propia (`emailFuenteUrl`):
 * - el dominio del email no coincide con el dominio de negocio del sitio;
 * - o no hay sitio y el email es de un proveedor publico.
 *
 * Un email de dominio propio sin sitio cargado no exige fuente adicional: la
 * nota y la fuente general siguen siendo obligatorias en el alta. No se
 * infiere ningun patron (`nombre@dominio`).
 */
export function requiereFuenteDeEmail(
  email: string,
  dominioSitio: string | null,
): boolean {
  const dominioEmail = dominioDeEmail(email)
  if (dominioEmail === null) return true

  if (dominioSitio === null) return esProveedorPublico(dominioEmail)

  return !emailPerteneceAlDominio(email, dominioSitio)
}

export interface EntradaHistorialProspecto {
  accion:
    | "CREACION"
    | "CORRECCION"
    | "DESCARTE"
    | "RESULTADO_ENVIO"
    | "OPT_OUT"
    | "SUPRESION"
    | "REACTIVADA"
  por: string
  en: string
  /** Solo nombres de campos, nunca valores (sin PII). */
  campos?: readonly string[]
  motivo?: string
}

/**
 * Agrega una entrada al historial JSON conservando las anteriores y
 * descartando valores que no sean objetos. El historial queda acotado para no
 * crecer sin limite. No guarda valores de campos ni datos del prospecto.
 */
export function agregarEntradaHistorial(
  actual: unknown,
  entrada: EntradaHistorialProspecto,
): EntradaHistorialProspecto[] {
  const previas = Array.isArray(actual)
    ? actual.filter(
        (item): item is EntradaHistorialProspecto =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : []

  return [...previas, entrada].slice(-MAX_HISTORIAL_PROSPECTO)
}
