/**
 * T-08 (AC-32; RF-47, RF-53): estructura del aviso legal del email.
 *
 * Reglas:
 * - El texto literal aprobado NO se escribe en el codigo: llega desde
 *   `configPropuestas().textoLegal` (env `PROPUESTAS_TEXTO_LEGAL`).
 * - La fuente de los datos es la web publicada por el negocio o la URL de la
 *   que se cargo el email; no se inventa.
 * - El canal ARCO por defecto es `hola@pixelarch.dev` (Q-11) y puede recibir
 *   el reply-to configurado.
 *
 * Modulo puro: no lee entorno, no toca Prisma, red ni proveedores.
 */

import { normalizarEmail } from "./normalizar"

export const CANAL_ARCO = "hola@pixelarch.dev"
export const IDENTIFICACION_REMITENTE = "PixelArch"
export const FINALIDAD_PROPUESTA =
  "Propuesta de servicios de diseño y desarrollo web."
export const AVISO_PUBLICIDAD =
  "Este mensaje es publicidad directa no solicitada."

const MAX_FUENTE = 2048

export interface EntradaAvisoLegal {
  /** Texto literal aprobado (`PROPUESTAS_TEXTO_LEGAL`). */
  textoLegal?: string | null
  /** Sitio publicado por el negocio. */
  sitioWeb?: string | null
  /** URL donde se publico/cargo el email de contacto. */
  fuenteUrl?: string | null
  /** Canal ARCO visible; por defecto `hola@pixelarch.dev`. */
  canalArco?: string | null
}

export interface AvisoLegal {
  identificacion: string
  finalidad: string
  fuente: string | null
  canalArco: string
  textoLegal: string | null
  /** `true` solo si estan el texto legal y la fuente de los datos. */
  completo: boolean
  motivos: string[]
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

/**
 * URL http(s) publica y mostrable como fuente. No exige que sea el origen:
 * una fuente de email puede incluir path (`/contacto`). Rechaza credenciales,
 * esquemas distintos y hosts sin punto.
 */
function urlFuente(valor: unknown): string | null {
  const raw = textoNoVacio(valor)
  if (raw === null || raw.length > MAX_FUENTE) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    if (!url.hostname.includes(".")) return null
    return url.toString()
  } catch {
    return null
  }
}

function canalArco(valor: unknown): string {
  const email = normalizarEmail(typeof valor === "string" ? valor : "")
  return email ?? CANAL_ARCO
}

/**
 * Construye la estructura del aviso. No lanza: devuelve `completo: false` y
 * los motivos cuando falta el texto legal o la fuente, para que el render del
 * email falle cerrado sin inventar contenido.
 */
export function construirAvisoLegal(
  input?: EntradaAvisoLegal | null,
): AvisoLegal {
  const datos = input && typeof input === "object" ? input : {}
  const textoLegal =
    textoNoVacio(datos.textoLegal)?.replace(/\r\n?/g, "\n") ?? null
  const fuente = urlFuente(datos.sitioWeb) ?? urlFuente(datos.fuenteUrl)
  const motivos: string[] = []

  if (textoLegal === null) {
    motivos.push("Falta el texto legal aprobado (PROPUESTAS_TEXTO_LEGAL).")
  }
  if (fuente === null) {
    motivos.push("Falta la fuente de los datos del prospecto.")
  }

  return {
    identificacion: IDENTIFICACION_REMITENTE,
    finalidad: FINALIDAD_PROPUESTA,
    fuente,
    canalArco: canalArco(datos.canalArco),
    textoLegal,
    completo: motivos.length === 0,
    motivos,
  }
}
