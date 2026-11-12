/**
 * T-08 (AC-32, AC-34; RF-47, RF-52, RF-53): email final de una propuesta.
 *
 * Reglas del plan §4.5:
 * - HTML y texto equivalente, con identificacion, finalidad, fuente, canal
 *   ARCO, enlace visible de baja y texto legal literal aprobado.
 * - Encabezados `List-Unsubscribe` y `List-Unsubscribe-Post` (RFC 8058).
 * - Prefijo `[publicidad]` en el asunto cuando corresponde, sin duplicarlo.
 * - Sin tracking, pixeles, adjuntos, enlaces programados ni HTML arbitrario.
 *
 * Modulo puro: no envia, no lee entorno y no toca Prisma, Resend ni red. La
 * URL publica y el texto legal los aporta la configuracion ya validada.
 */

import { normalizarUrlPublica } from "./config"
import {
  AVISO_PUBLICIDAD,
  construirAvisoLegal,
  type AvisoLegal,
} from "./legal"
import {
  escaparHtml,
  prepararAsunto,
  textoAHtmlSeguro,
} from "./plantillas"

export const HEADER_LIST_UNSUBSCRIBE = "List-Unsubscribe"
export const HEADER_LIST_UNSUBSCRIBE_POST = "List-Unsubscribe-Post"
export const LIST_UNSUBSCRIBE_POST = "List-Unsubscribe=One-Click"

const MAX_TOKEN = 512
const RE_TOKEN = /^v1\.[A-Za-z0-9_-]{1,64}\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/

export type CodigoErrorEmail =
  | "ASUNTO"
  | "CUERPO"
  | "URL_PUBLICA"
  | "TOKEN"
  | "AVISO_LEGAL"

export class EmailInvalidoError extends Error {
  readonly codigo: CodigoErrorEmail

  constructor(codigo: CodigoErrorEmail) {
    super(`Email invalido (${codigo}).`)
    this.name = "EmailInvalidoError"
    this.codigo = codigo
  }
}

export interface EntradaEmail {
  asunto: string
  /** Cuerpo en texto plano, ya renderizado con datos verificados. */
  cuerpoTexto: string
  sitioWeb?: string | null
  fuenteUrl?: string | null
  /** Texto literal aprobado (`PROPUESTAS_TEXTO_LEGAL`). */
  textoLegal?: string | null
  /** Origen HTTPS validado (sin path) usado para la baja. */
  urlPublica?: string | null
  tokenBaja?: string | null
  etiquetaPublicidad?: boolean
  canalArco?: string | null
}

export interface HeadersEmail {
  "List-Unsubscribe": string
  "List-Unsubscribe-Post": string
}

export interface EmailRenderizado {
  asunto: string
  html: string
  text: string
  headers: HeadersEmail
  /** Enlace visible de baja (pagina publica). */
  enlaceBaja: string
  /** Endpoint publico one-click de baja. */
  optOutUrl: string
  avisoLegal: AvisoLegal
  etiquetaPublicidad: boolean
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function tokenValido(valor: unknown): string | null {
  const raw = textoNoVacio(valor)
  if (raw === null || raw.length > MAX_TOKEN) return null
  return RE_TOKEN.test(raw) ? raw : null
}

function asuntoFinal(asunto: string, etiquetaPublicidad: boolean): string {
  try {
    return prepararAsunto(asunto, etiquetaPublicidad)
  } catch {
    throw new EmailInvalidoError("ASUNTO")
  }
}

function enlacesBaja(
  urlPublica: string,
  token: string,
): { enlaceBaja: string; optOutUrl: string } {
  const tokenCodificado = encodeURIComponent(token)

  return {
    enlaceBaja: `${urlPublica}/propuestas/baja/${tokenCodificado}`,
    optOutUrl: `${urlPublica}/api/opt-out?token=${tokenCodificado}`,
  }
}

function footerHtml(
  aviso: AvisoLegal,
  fuente: string,
  textoLegal: string,
  enlaceBaja: string,
  etiquetaPublicidad: boolean,
): string {
  const lineas = [
    `<p style="margin:0 0 8px;"><strong>${escaparHtml(aviso.identificacion)}</strong> — ${escaparHtml(aviso.finalidad)}</p>`,
    `<p style="margin:0 0 8px;">Fuente de los datos: <a href="${escaparHtml(fuente)}">${escaparHtml(fuente)}</a></p>`,
    `<p style="margin:0 0 8px;">Derechos de acceso, rectificación y supresión: <a href="mailto:${escaparHtml(aviso.canalArco)}">${escaparHtml(aviso.canalArco)}</a></p>`,
    textoAHtmlSeguro(textoLegal),
    etiquetaPublicidad
      ? `<p style="margin:8px 0;"><strong>${escaparHtml(AVISO_PUBLICIDAD)}</strong></p>`
      : "",
    `<p style="margin:8px 0 0;"><a href="${escaparHtml(enlaceBaja)}">Darse de baja</a></p>`,
  ]

  return lineas.filter((linea) => linea.length > 0).join("\n")
}

function footerTexto(
  aviso: AvisoLegal,
  fuente: string,
  textoLegal: string,
  enlaceBaja: string,
  etiquetaPublicidad: boolean,
): string {
  const lineas = [
    `${aviso.identificacion} — ${aviso.finalidad}`,
    `Fuente de los datos: ${fuente}`,
    `Derechos de acceso, rectificación y supresión: ${aviso.canalArco}`,
    textoLegal,
    etiquetaPublicidad ? AVISO_PUBLICIDAD : "",
    `Darse de baja: ${enlaceBaja}`,
  ]

  return lineas.filter((linea) => linea.length > 0).join("\n")
}

/**
 * Genera el snapshot final del email (asunto, HTML, texto y headers). Falla
 * cerrado si falta el texto legal, la fuente, la URL publica o el token: no se
 * produce un email a medias y no se inventa contenido legal.
 */
export function construirEmail(input: EntradaEmail): EmailRenderizado {
  if (!input || typeof input !== "object") {
    throw new EmailInvalidoError("CUERPO")
  }

  const cuerpoTexto = textoNoVacio(input.cuerpoTexto)
  if (cuerpoTexto === null) {
    throw new EmailInvalidoError("CUERPO")
  }

  const etiquetaPublicidad = input.etiquetaPublicidad === true
  const asunto = asuntoFinal(
    typeof input.asunto === "string" ? input.asunto : "",
    etiquetaPublicidad,
  )

  const urlPublica = normalizarUrlPublica(input.urlPublica)
  if (urlPublica === null) {
    throw new EmailInvalidoError("URL_PUBLICA")
  }

  const token = tokenValido(input.tokenBaja)
  if (token === null) {
    throw new EmailInvalidoError("TOKEN")
  }

  const aviso = construirAvisoLegal({
    textoLegal: input.textoLegal,
    sitioWeb: input.sitioWeb,
    fuenteUrl: input.fuenteUrl,
    canalArco: input.canalArco,
  })

  const fuente = aviso.fuente
  const textoLegal = aviso.textoLegal
  if (!aviso.completo || fuente === null || textoLegal === null) {
    throw new EmailInvalidoError("AVISO_LEGAL")
  }

  const { enlaceBaja, optOutUrl } = enlacesBaja(urlPublica, token)

  const html = [
    "<!doctype html>",
    '<html lang="es">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escaparHtml(asunto)}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background:#f4f4f4;">',
    '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;">',
    textoAHtmlSeguro(cuerpoTexto),
    '<hr style="border:none;border-top:1px solid #dddddd;margin:24px 0;" />',
    '<div style="font-size:12px;line-height:1.5;color:#555555;">',
    footerHtml(aviso, fuente, textoLegal, enlaceBaja, etiquetaPublicidad),
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n")

  const text = [
    cuerpoTexto,
    "",
    "--",
    footerTexto(aviso, fuente, textoLegal, enlaceBaja, etiquetaPublicidad),
    "",
  ].join("\n")

  return {
    asunto,
    html,
    text,
    headers: {
      [HEADER_LIST_UNSUBSCRIBE]: `<${optOutUrl}>, <mailto:${aviso.canalArco}?subject=Baja>`,
      [HEADER_LIST_UNSUBSCRIBE_POST]: LIST_UNSUBSCRIBE_POST,
    },
    enlaceBaja,
    optOutUrl,
    avisoLegal: aviso,
    etiquetaPublicidad,
  }
}
