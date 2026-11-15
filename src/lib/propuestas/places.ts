/**
 * T-11 (AC-8, AC-11, AC-12; RF-10, RF-11, RF-17, RF-57, RF-58): cliente del
 * endpoint oficial de Google Places Text Search.
 *
 * Reglas del plan §2.5 / §6.2:
 * - Solo API oficial: `POST https://places.googleapis.com/v1/places:searchText`.
 * - Field mask minimo: `places.id,places.displayName.text,places.websiteUri`.
 *   No se piden fotos, reseñas, horarios, ratings ni Place Details.
 * - Body exacto `{ textQuery, languageCode: "es", regionCode: "AR", pageSize }`;
 *   sin `pageToken` y sin paginacion. Una request por llamada.
 * - Se persiste `placeId`; el nombre (`nombreTransitorio`) no se persiste. La
 *   URL del sitio se usa para enriquecer el prospecto, no como contenido de
 *   Places (D-5/Q-12).
 * - Sin clave se falla cerrado (`NO_CONFIGURADO`) sin tocar la red. Timeout
 *   explicito de 8 s con `AbortController`; sin reintentos ni backoff.
 * - Los errores del proveedor se mapean a codigos propios. El mensaje devuelto
 *   es generico (sin PII, sin body del proveedor, sin headers ni clave).
 * - Un rechazo del proveedor se diagnostica con `logger.warn` usando solo el
 *   status HTTP, el codigo propio, `error.status` y hasta 5
 *   `error.details[].reason` (80 chars). Nunca se loguean headers, clave,
 *   `error.message` ni el body completo.
 *
 * Modulo server-only: usa `fetch` y lee la clave server-only
 * `PROPUESTAS_PLACES_API_KEY` a traves de `configPropuestas()`. No toca
 * Prisma. El `fetch`, la clave, la config y el timeout son inyectables para
 * testear sin red ni entorno.
 */

import { logger } from "@/lib/logger"

import { configPropuestas, type ConfigPropuestas } from "./config"
import { sanitizarError, type CodigoError } from "./errores"

export const URL_PLACES_SEARCH_TEXT =
  "https://places.googleapis.com/v1/places:searchText"

export const FIELD_MASK_PLACES =
  "places.id,places.displayName.text,places.websiteUri"

export const TIMEOUT_PLACES_MS = 8_000
export const PAGE_SIZE_PLACES_MIN = 1
export const PAGE_SIZE_PLACES_MAX = 20
export const PAGE_SIZE_PLACES_DEFAULT = PAGE_SIZE_PLACES_MAX
export const MAX_TEXTO_CONSULTA = 1_000

/**
 * Resultado transitorio de una busqueda. `nombreTransitorio` se muestra en la
 * respuesta de la corrida con atribucion y no se persiste (D-5/Q-12).
 */
export interface LugarPlaces {
  placeId: string
  nombreTransitorio: string | null
  sitioWeb: string | null
}

export type CodigoErrorPlaces = Extract<
  CodigoError,
  | "VALIDACION"
  | "NO_CONFIGURADO"
  | "CONFIGURACION"
  | "CREDENCIALES"
  | "CUOTA"
  | "PROVEEDOR"
  | "TIMEOUT"
  | "RED"
  | "DESCONOCIDO"
>

export interface ResultadoPlacesOk {
  ok: true
  lugares: LugarPlaces[]
}

export interface ResultadoPlacesError {
  ok: false
  codigo: CodigoErrorPlaces
  /** Status HTTP de Google, o `null` si no hubo respuesta. */
  status: number | null
  mensaje: string
}

export type ResultadoPlaces = ResultadoPlacesOk | ResultadoPlacesError

/** Firma compatible con el `fetch` global; inyectable en tests. */
export type FetchPlaces = (
  input: string,
  init: RequestInit,
) => Promise<Response>

export interface EntradaBuscarLugares {
  /** Consulta compuesta por el llamador (rubro, zona, etc.). */
  textQuery: string
  /** 1..20. Default 20 (una sola request, sin paginacion). */
  pageSize?: number
}

export interface OpcionesBuscarLugares {
  /** Si se omite, se usa `configPropuestas().places.apiKey`. */
  apiKey?: string | null
  fetchImpl?: FetchPlaces
  timeoutMs?: number
  /** Config inyectable; si se omite se lee `configPropuestas()`. */
  config?: Pick<ConfigPropuestas, "places">
}

function errorPlaces(
  codigo: CodigoErrorPlaces,
  status: number | null,
): ResultadoPlacesError {
  return {
    ok: false,
    codigo,
    status,
    mensaje: sanitizarError(null, { codigo }).mensaje,
  }
}

function normalizarApiKey(valor: unknown): string | null {
  if (typeof valor !== "string") return null

  const limpio = valor.trim()
  if (limpio.length === 0 || /[\r\n]/.test(limpio)) return null

  return limpio
}

function resolverApiKey(
  opciones: OpcionesBuscarLugares,
): string | null {
  if (opciones.apiKey !== undefined) {
    return normalizarApiKey(opciones.apiKey)
  }

  const config = opciones.config ?? configPropuestas()
  return normalizarApiKey(config.places.apiKey)
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function esErrorDeAborto(error: unknown): boolean {
  if (!esRegistro(error) && !(error instanceof Error)) return false

  const nombre = (error as { name?: unknown }).name
  const codigo = (error as { code?: unknown }).code

  return (
    nombre === "AbortError" ||
    nombre === "TimeoutError" ||
    codigo === "ABORT_ERR" ||
    codigo === 20
  )
}

function crearErrorAborto(): Error {
  const error = new Error("La solicitud fue abortada por timeout.")
  error.name = "AbortError"
  return error
}

/**
 * Carrera entre la promesa del fetch y el abort. Refuerza el timeout aunque el
 * transporte inyectado ignore la señal; el abort del `fetch` real sigue activo.
 */
async function conTimeout<T>(
  promesa: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw crearErrorAborto()

  let quitarListener: () => void = () => {}

  const aborto = new Promise<never>((_, reject) => {
    const alAbortar = () => reject(crearErrorAborto())
    signal.addEventListener("abort", alAbortar, { once: true })
    quitarListener = () => signal.removeEventListener("abort", alAbortar)
  })

  try {
    return await Promise.race([promesa, aborto])
  } finally {
    quitarListener()
  }
}

function mapearStatus(status: number): CodigoErrorPlaces | null {
  if (status === 400) return "CONFIGURACION"
  if (status === 401 || status === 403) return "CREDENCIALES"
  if (status === 429) return "CUOTA"
  if (status >= 500) return "PROVEEDOR"
  if (status < 200 || status >= 300) return "PROVEEDOR"
  return null
}

/** Solo se conservan los primeros 5 motivos y 80 chars por motivo. */
const MAX_MOTIVOS_LOG = 5
const MAX_TEXTO_MOTIVO_LOG = 80

interface MotivoRechazoPlaces {
  googleStatus: string | null
  reasons: string[]
}

function recortarMotivo(valor: string): string {
  return valor.trim().slice(0, MAX_TEXTO_MOTIVO_LOG)
}

/**
 * Extrae unicamente `error.status` y `error.details[].reason` del body de error.
 * Nunca devuelve `error.message` (puede contener datos) ni el body completo.
 */
function leerMotivoRechazoPlaces(cuerpo: unknown): MotivoRechazoPlaces {
  if (!esRegistro(cuerpo)) return { googleStatus: null, reasons: [] }

  const error = cuerpo.error
  if (!esRegistro(error)) return { googleStatus: null, reasons: [] }

  const status = error.status
  const googleStatus =
    typeof status === "string" && status.trim().length > 0
      ? recortarMotivo(status)
      : null

  const reasons: string[] = []

  if (Array.isArray(error.details)) {
    for (const detalle of error.details) {
      if (reasons.length >= MAX_MOTIVOS_LOG) break
      if (!esRegistro(detalle) || typeof detalle.reason !== "string") continue

      const motivo = recortarMotivo(detalle.reason)
      if (motivo.length > 0) reasons.push(motivo)
    }
  }

  return { googleStatus, reasons }
}

/**
 * Lee el body de rechazo con el mismo signal/timeout de la request. Cualquier
 * fallo (clone no disponible, JSON invalido, abort) deja el diagnostico vacio
 * sin cambiar el resultado ni lanzar.
 */
async function inspeccionarRechazoPlaces(
  respuesta: Response,
  signal: AbortSignal,
): Promise<MotivoRechazoPlaces> {
  try {
    const cuerpo = await conTimeout(respuesta.clone().json(), signal)
    return leerMotivoRechazoPlaces(cuerpo)
  } catch {
    return { googleStatus: null, reasons: [] }
  }
}

function leerNombre(registro: Record<string, unknown>): string | null {
  const displayName = registro.displayName
  if (!esRegistro(displayName)) return null

  const texto = displayName.text
  if (typeof texto !== "string") return null

  const limpio = texto.trim()
  return limpio.length > 0 ? limpio : null
}

function leerSitioWeb(registro: Record<string, unknown>): string | null {
  const sitio = registro.websiteUri
  if (typeof sitio !== "string") return null

  const limpio = sitio.trim()
  return limpio.length > 0 ? limpio : null
}

/**
 * Busca lugares con Places Text Search. Una sola request; no pagina ni pide
 * detalles. Devuelve un resultado discriminado: los fallos esperados no son
 * excepciones y nunca incluyen el body del proveedor.
 */
export async function buscarLugaresPlaces(
  entrada: EntradaBuscarLugares,
  opciones: OpcionesBuscarLugares = {},
): Promise<ResultadoPlaces> {
  const texto =
    typeof entrada.textQuery === "string" ? entrada.textQuery.trim() : ""
  if (
    texto.length === 0 ||
    texto.length > MAX_TEXTO_CONSULTA ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto)
  ) {
    return errorPlaces("VALIDACION", null)
  }

  const pageSize = entrada.pageSize ?? PAGE_SIZE_PLACES_DEFAULT
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < PAGE_SIZE_PLACES_MIN ||
    pageSize > PAGE_SIZE_PLACES_MAX
  ) {
    return errorPlaces("VALIDACION", null)
  }

  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_PLACES_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return errorPlaces("VALIDACION", null)
  }

  const apiKey = resolverApiKey(opciones)
  if (apiKey === null) return errorPlaces("NO_CONFIGURADO", null)

  const fetchImpl = opciones.fetchImpl ?? fetch
  const controller = new AbortController()
  const temporizador = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let respuesta: Response
    try {
      respuesta = await conTimeout(
        fetchImpl(URL_PLACES_SEARCH_TEXT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK_PLACES,
          },
          body: JSON.stringify({
            textQuery: texto,
            languageCode: "es",
            regionCode: "AR",
            pageSize,
          }),
          signal: controller.signal,
        }),
        controller.signal,
      )
    } catch (error) {
      return errorPlaces(esErrorDeAborto(error) ? "TIMEOUT" : "RED", null)
    }

    const codigoStatus = mapearStatus(respuesta.status)
    if (codigoStatus !== null) {
      const { googleStatus, reasons } = await inspeccionarRechazoPlaces(
        respuesta,
        controller.signal,
      )

      logger.warn("Places rechazo la solicitud", {
        httpStatus: respuesta.status,
        codigo: codigoStatus,
        googleStatus,
        reasons,
      })

      return errorPlaces(codigoStatus, respuesta.status)
    }

    let json: unknown
    try {
      json = await conTimeout(respuesta.json(), controller.signal)
    } catch (error) {
      return errorPlaces(
        esErrorDeAborto(error) ? "TIMEOUT" : "PROVEEDOR",
        respuesta.status,
      )
    }

    if (!esRegistro(json)) {
      return errorPlaces("PROVEEDOR", respuesta.status)
    }

    const places = json.places
    if (places === undefined) {
      return { ok: true, lugares: [] }
    }
    if (!Array.isArray(places)) {
      return errorPlaces("PROVEEDOR", respuesta.status)
    }

    const lugares: LugarPlaces[] = []

    for (const item of places) {
      if (!esRegistro(item)) {
        return errorPlaces("PROVEEDOR", respuesta.status)
      }

      const id = item.id
      if (typeof id !== "string" || id.trim().length === 0) {
        return errorPlaces("PROVEEDOR", respuesta.status)
      }

      lugares.push({
        placeId: id.trim(),
        nombreTransitorio: leerNombre(item),
        sitioWeb: leerSitioWeb(item),
      })
    }

    return { ok: true, lugares }
  } finally {
    clearTimeout(temporizador)
  }
}
