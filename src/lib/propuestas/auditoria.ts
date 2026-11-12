/**
 * T-09 (AC-20; RF-31, RF-32): auditoria interna del portal de propuestas.
 *
 * Reglas del plan §2.5 (Auditoria) y de la spec §6.4:
 * - Reutiliza la logica existente (`computeScores`, `buildFindings`) y el
 *   parseo extraido a `src/lib/audit-server.ts`; no duplica criterios.
 * - No llama al endpoint publico de auditoria ni consume su rate limit, y no
 *   usa el `fetch` global. El HTML se obtiene con `fetchHtmlSeguro` (SSRF,
 *   robots, timeout y tamanos) o se recibe ya descargado.
 * - `auditarPagina` reutiliza el HTML/cabeceras/tiempos del home ya obtenido
 *   en el analisis del prospecto: no hace un segundo fetch.
 * - El resumen guardado es serializable y solo incluye `scores`, `findings`,
 *   `finalUrl`, `fecha` y `estado` (mas el motivo saneado si falla). Nunca
 *   incluye HTML, cabeceras crudas, cookies ni datos del certificado.
 * - Un sitio HTTP o un certificado TLS que no se puede validar agrega un
 *   hallazgo sintetico (`SIN_HTTPS`/`TLS_INVALIDO`) y fuerza `ssl: 0`; no se
 *   salta la validacion TLS ni se reintenta con `rejectUnauthorized: false`.
 *
 * Modulo server-only: no toca Prisma, entorno, proveedores ni logs.
 *
 * Para T-15: preferir `auditarPagina` con el `ResultadoWebOk` del home ya
 * descargado. `auditarSitio` queda como conveniencia para casos aislados y
 * hace su propio fetch seguro del home.
 */

import {
  buildFindings,
  computeScores,
  type AuditFinding,
  type AuditScores,
} from "@/lib/audit"
import {
  analizarHtmlAudit,
  certDaysLeft as certDaysLeftReal,
  type CertDaysLeft,
} from "@/lib/audit-server"

import {
  fetchHtmlSeguro,
  type MotivoFalloWeb,
  type OpcionesFetchHtmlSeguro,
  type ResultadoWebOk,
} from "./web"

/** Regla "una auditoria por prospecto/24 h". */
export const AUDITORIA_TTL_MS = 24 * 60 * 60 * 1_000

export type EstadoAuditoria = "OK" | "FALLIDA"

export type CodigoHallazgoSintetico = "SIN_HTTPS" | "TLS_INVALIDO"

/**
 * Hallazgo de auditoria. `codigo` solo aparece en los hallazgos sinteticos que
 * agrega la auditoria interna; los de `buildFindings` conservan su forma.
 */
export interface HallazgoAuditoria extends AuditFinding {
  codigo?: CodigoHallazgoSintetico
}

/**
 * Resumen serializable que se persiste en el prospecto. No contiene HTML,
 * cabeceras, cookies ni el certificado completo.
 */
export interface AuditoriaResumen {
  estado: EstadoAuditoria
  /** ISO 8601 en UTC. */
  fecha: string
  finalUrl: string | null
  scores: AuditScores | null
  findings: HallazgoAuditoria[]
  /** Codigo saneado de `web.ts`; `null` cuando la auditoria termino OK. */
  motivo: MotivoFalloWeb | null
}

export interface OpcionesAuditoria {
  /**
   * Helper TLS inyectable para tests sin red. Default: `certDaysLeft` real
   * (`node:tls`, timeout 6 s, validacion TLS normal).
   */
  certDaysLeft?: CertDaysLeft
  /** Reloj inyectable para la fecha del resumen (Date o fabrica). */
  ahora?: Date | (() => Date)
}

export interface OpcionesAuditarSitio extends OpcionesAuditoria {
  /** Opciones del fetch seguro (transporte/DNS/robots inyectables en tests). */
  fetch?: OpcionesFetchHtmlSeguro
}

const TEXTO_SIN_HTTPS =
  "SIN_HTTPS: el sitio no usa HTTPS; los navegadores lo marcan como no seguro."
const TEXTO_TLS_INVALIDO =
  "TLS_INVALIDO: no se pudo validar el certificado TLS del sitio."

function esNumero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor)
}

function fechaIso(ahora?: Date | (() => Date)): string {
  const valor =
    typeof ahora === "function" ? ahora() : (ahora ?? new Date())
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString()
  }
  return new Date().toISOString()
}

function hostnameHttps(finalUrl: string): string | null {
  try {
    const url = new URL(finalUrl)
    if (url.protocol !== "https:") return null
    return url.hostname
  } catch {
    return null
  }
}

function resumenFallido(
  motivo: MotivoFalloWeb,
  fecha: string,
): AuditoriaResumen {
  return {
    estado: "FALLIDA",
    fecha,
    finalUrl: null,
    scores: null,
    findings: [],
    motivo,
  }
}

/**
 * Audita una pagina cuyo fetch seguro ya termino bien. No vuelve a pedir el
 * home: usa el HTML, las cabeceras y los tiempos del `ResultadoWebOk`.
 *
 * - Si el sitio no es HTTPS, agrega `SIN_HTTPS` y deja `ssl: 0`.
 * - Si es HTTPS y el helper TLS devuelve `null` (timeout, error o certificado
 *   no verificable), agrega `TLS_INVALIDO` y deja `ssl: 0`.
 * - Cualquier fallo interno inesperado devuelve `estado: "FALLIDA"` con scores
 *   `null`, findings `[]` y un motivo del vocabulario de `web.ts`.
 */
export async function auditarPagina(
  resultado: ResultadoWebOk,
  opciones: OpcionesAuditoria = {},
): Promise<AuditoriaResumen> {
  const fecha = fechaIso(opciones.ahora)

  try {
    let cert: number | null = null

    if (resultado.https) {
      const hostname = hostnameHttps(resultado.finalUrl)
      if (hostname !== null) {
        try {
          const consultar = opciones.certDaysLeft ?? certDaysLeftReal
          const dias = await consultar(hostname)
          cert = esNumero(dias) ? dias : null
        } catch {
          cert = null
        }
      }
    }

    const data = analizarHtmlAudit({
      html: resultado.html,
      finalUrl: resultado.finalUrl,
      status: resultado.status,
      redirects: resultado.redirigido,
      ttfbMs: resultado.ttfbMs,
      totalMs: resultado.totalMs,
      https: resultado.https,
      headers: resultado.auditHeaders,
      certDaysLeft: cert,
    })

    let findings: HallazgoAuditoria[] = buildFindings(data)
    let scores = computeScores(data)

    if (!resultado.https) {
      findings = [
        {
          type: "fail",
          codigo: "SIN_HTTPS",
          text: TEXTO_SIN_HTTPS,
        },
        ...findings,
      ]
      scores = { ...scores, ssl: 0 }
    } else if (cert === null) {
      findings = [
        {
          type: "fail",
          codigo: "TLS_INVALIDO",
          text: TEXTO_TLS_INVALIDO,
        },
        ...findings,
      ]
      scores = { ...scores, ssl: 0 }
    }

    return {
      estado: "OK",
      fecha,
      finalUrl: resultado.finalUrl,
      scores,
      findings,
      motivo: null,
    }
  } catch {
    return resumenFallido("RED", fecha)
  }
}

/**
 * Conveniencia para auditar un sitio aislado: descarga el home con
 * `fetchHtmlSeguro` y delega en `auditarPagina`.
 *
 * T-15 debe preferir `auditarPagina` cuando ya descargo el home para el
 * analisis del prospecto y evitar un segundo fetch. Esta funcion nunca lanza:
 * un `ok: false` del fetch se mapea a `estado: "FALLIDA"` con el motivo
 * saneado de `web.ts`.
 */
export async function auditarSitio(
  url: string | null | undefined,
  opciones: OpcionesAuditarSitio = {},
): Promise<AuditoriaResumen> {
  const fecha = fechaIso(opciones.ahora)

  try {
    const resultado = await fetchHtmlSeguro(url, opciones.fetch)
    if (!resultado.ok) return resumenFallido(resultado.motivo, fecha)

    return auditarPagina(resultado, {
      ahora: opciones.ahora,
      certDaysLeft: opciones.certDaysLeft,
    })
  } catch {
    return resumenFallido("RED", fecha)
  }
}

function aFecha(
  valor: Date | string | number | null | undefined,
): Date | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor
  }
  if (typeof valor === "string" && valor.trim().length > 0) {
    const fecha = new Date(valor)
    return Number.isNaN(fecha.getTime()) ? null : fecha
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const fecha = new Date(valor)
    return Number.isNaN(fecha.getTime()) ? null : fecha
  }
  return null
}

/**
 * Regla pura "una auditoria por prospecto/24 h". Devuelve `true` solo si la
 * fecha es valida, no esta en el futuro y su antiguedad es menor que `ttlMs`.
 * Cualquier entrada invalida (o un TTL invalido) devuelve `false` (fail
 * closed: ante la duda se vuelve a auditar, nunca se omite por una fecha rota).
 */
export function auditoriaVigente(
  fecha: Date | string | number | null | undefined,
  ahora: Date = new Date(),
  ttlMs: number = AUDITORIA_TTL_MS,
): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false

  const referencia = aFecha(fecha)
  if (referencia === null) return false
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) return false

  const edad = ahora.getTime() - referencia.getTime()
  return edad >= 0 && edad < ttlMs
}
