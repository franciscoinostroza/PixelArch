/**
 * T-09 (AC-20; RF-31, RF-32): extraccion server-side de la logica de la ruta
 * publica de auditoria para reutilizarla sin duplicar criterios.
 *
 * - `analizarHtmlAudit` es puro: recibe el HTML y los metadatos ya obtenidos
 *   del fetch y devuelve exactamente el `AuditData` que arma la ruta publica.
 * - `auditHeadersDesdeHeaders` traduce cabeceras HTTP a los booleanos de
 *   auditoria (mismo criterio que la ruta).
 * - `certDaysLeft` consulta el certificado TLS con timeout de 6 s y devuelve
 *   dias restantes o `null`. La fabrica de socket es inyectable para testear
 *   sin red; en produccion usa `node:tls` con validacion TLS normal.
 *
 * Modulo server-only: importa `node:tls` y `node:buffer`. No toca Prisma,
 * entorno, proveedores ni logs y no hace peticiones HTTP.
 */

import { Buffer } from "node:buffer"
import tls from "node:tls"

import type { AuditData } from "@/lib/audit"

export const TLS_TIMEOUT_MS = 6_000

export interface CabecerasAudit {
  hsts: boolean
  csp: boolean
  xfo: boolean
  xcto: boolean
  referrer: boolean
}

export interface EntradaAnalisisHtmlAudit {
  html: string
  finalUrl: string
  status: number
  redirects: boolean
  ttfbMs: number
  totalMs: number
  /**
   * Protocolo efectivo. Si se omite se deriva de `finalUrl`, igual que la
   * ruta publica.
   */
  https?: boolean
  /** Booleanos de cabeceras; si faltan se asumen ausentes. */
  headers?: CabecerasAudit
  certDaysLeft?: number | null
}

/**
 * Convierte `Headers` (o cualquier objeto con `has`) a los booleanos que usa
 * `AuditData.headers`. Los nombres se consultan en minusculas; `Headers.has`
 * ya es case-insensitive.
 */
export function auditHeadersDesdeHeaders(headers: {
  has(nombre: string): boolean
}): CabecerasAudit {
  return {
    hsts: headers.has("strict-transport-security"),
    csp: headers.has("content-security-policy"),
    xfo: headers.has("x-frame-options"),
    xcto: headers.has("x-content-type-options"),
    referrer: headers.has("referrer-policy"),
  }
}

/**
 * Parseo puro del HTML y armado de `AuditData`. Conserva las mismas regexes,
 * limites y criterios que la ruta publica de auditoria:
 *
 * - titulo: colapsa espacios, `trim` y maximo 120; `null` si queda vacio.
 * - meta description: admite `name` antes o despues de `content`, `trim` y
 *   maximo 200; `null` si queda vacia.
 * - viewport, H1, `lang`, cantidad de imagenes y faltantes de `alt`.
 * - `htmlKb` redondeado desde los bytes UTF-8.
 */
export function analizarHtmlAudit(
  entrada: EntradaAnalisisHtmlAudit,
): AuditData {
  const html = typeof entrada.html === "string" ? entrada.html : ""
  const https =
    typeof entrada.https === "boolean"
      ? entrada.https
      : entrada.finalUrl.startsWith("https://")
  const cabeceras: CabecerasAudit = entrada.headers ?? {
    hsts: false,
    csp: false,
    xfo: false,
    xcto: false,
    referrer: false,
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 120) || null
    : null

  const metaDesc =
    html.match(
      /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
    )
  const metaDescription = metaDesc
    ? metaDesc[1].trim().slice(0, 200) || null
    : null

  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i)
  const lang = langMatch ? langMatch[1] : null
  const imgTags = html.match(/<img[\s>][^>]*>/gi) || []
  const imgCount = imgTags.length
  const imgNoAlt = imgTags.filter(
    (tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag),
  ).length

  return {
    finalUrl: entrada.finalUrl,
    status: entrada.status,
    redirects: entrada.redirects,
    ttfbMs: entrada.ttfbMs,
    totalMs: entrada.totalMs,
    htmlKb: Math.round(Buffer.byteLength(html, "utf8") / 1024),
    title,
    metaDescription,
    hasViewport,
    h1Count,
    lang,
    imgCount,
    imgNoAlt,
    https,
    certDaysLeft: entrada.certDaysLeft ?? null,
    headers: {
      hsts: cabeceras.hsts === true,
      csp: cabeceras.csp === true,
      xfo: cabeceras.xfo === true,
      xcto: cabeceras.xcto === true,
      referrer: cabeceras.referrer === true,
    },
  }
}

export interface OpcionesConexionTls {
  host: string
  port: number
  servername: string
  timeout: number
}

export interface CertificadoTls {
  valid_to?: string | null
}

/**
 * Contrato minimo del socket TLS que necesita `certDaysLeft`. Permite inyectar
 * un socket falso en tests sin abrir red.
 */
export interface SocketTls {
  getPeerCertificate(): CertificadoTls | null
  end(): void
  destroy(): void
  on(
    evento: "secureConnect" | "error" | "timeout",
    listener: () => void,
  ): unknown
}

export type FabricaSocketTls = (opciones: OpcionesConexionTls) => SocketTls

export interface OpcionesCertDaysLeft {
  /** Fabrica de socket inyectable. Default: `tls.connect` real. */
  conectar?: FabricaSocketTls
  timeoutMs?: number
  /** Reloj inyectable para calcular los dias restantes. */
  ahora?: () => number
}

export type CertDaysLeft = (
  hostname: string,
  opciones?: OpcionesCertDaysLeft,
) => Promise<number | null>

const conectarTlsReal: FabricaSocketTls = (opciones) => {
  const socket = tls.connect(opciones)

  return {
    getPeerCertificate: () => socket.getPeerCertificate(),
    end: () => socket.end(),
    destroy: () => socket.destroy(),
    on: (evento, listener) => socket.on(evento, listener),
  }
}

/**
 * Dias restantes del certificado TLS del host. Devuelve `null` ante cualquier
 * fallo (timeout, error de red, certificado ausente o fecha invalida). No
 * desactiva la validacion TLS ni usa `rejectUnauthorized: false`.
 */
export function certDaysLeft(
  hostname: string,
  opciones: OpcionesCertDaysLeft = {},
): Promise<number | null> {
  return new Promise((resolve) => {
    let resuelto = false
    let temporizador: NodeJS.Timeout | null = null

    const resolver = (valor: number | null) => {
      if (resuelto) return
      resuelto = true
      if (temporizador !== null) {
        clearTimeout(temporizador)
        temporizador = null
      }
      resolve(valor)
    }

    const conectar = opciones.conectar ?? conectarTlsReal
    const timeoutMs =
      typeof opciones.timeoutMs === "number" &&
      Number.isFinite(opciones.timeoutMs) &&
      opciones.timeoutMs > 0
        ? opciones.timeoutMs
        : TLS_TIMEOUT_MS
    const ahora = opciones.ahora ?? (() => Date.now())

    try {
      const socket = conectar({
        host: hostname,
        port: 443,
        servername: hostname,
        timeout: timeoutMs,
      })

      socket.on("secureConnect", () => {
        try {
          const cert = socket.getPeerCertificate()
          socket.end()
          if (!cert || !cert.valid_to) {
            resolver(null)
            return
          }

          const vence = new Date(cert.valid_to).getTime()
          if (!Number.isFinite(vence)) {
            resolver(null)
            return
          }

          const dias = Math.round((vence - ahora()) / 86400000)
          resolver(Number.isFinite(dias) ? dias : null)
        } catch {
          resolver(null)
        }
      })

      socket.on("error", () => resolver(null))
      socket.on("timeout", () => {
        try {
          socket.destroy()
        } catch {
          // La conexion ya estaba cerrada.
        }
        resolver(null)
      })

      if (resuelto) return

      // Deadline duro ademas del timeout del socket: un handshake que no
      // responde no puede dejar la auditoria interna colgada. No se hace
      // `unref`: el temporizador esta atado a una request en curso.
      temporizador = setTimeout(() => {
        try {
          socket.destroy()
        } catch {
          // La conexion ya estaba cerrada.
        }
        resolver(null)
      }, timeoutMs)
    } catch {
      resolver(null)
    }
  })
}
