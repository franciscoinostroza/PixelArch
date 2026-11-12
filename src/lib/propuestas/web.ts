/**
 * T-10 (AC-9, AC-10, AC-19; RF-13, RF-14, RF-16): fetch web publica segura,
 * robots.txt, descubrimiento de paginas de contacto y extraccion de datos
 * publicados.
 *
 * Reglas del plan §2.5 / §6.3:
 * - Se reutiliza `normalizeUrl` + `isBlockedHost` de `src/lib/audit.ts` y la
 *   resolucion DNS con `dns.promises.lookup(host, { all: true })`. Se rechaza
 *   cualquier resultado privado, loopback, link-local, site-local, multicast,
 *   reservado, no especificado, IPv4 mapeada privada, rango especial IPv6 o
 *   NAT64 con una IPv4 embebida no publica.
 * - El transporte propio usa `node:https`/`node:http` con un `lookup`
 *   validador en el connect: el DNS se vuelve a comprobar al conectar y se
 *   cierra el DNS rebinding. El lookup respeta `all`/`family` para funcionar
 *   con `autoSelectFamily` (Happy Eyeballs) de Node 20+. No se usa el `fetch`
 *   global.
 * - Redirecciones manuales (maximo 3), cada hop revalidado (URL, host, DNS,
 *   robots) y limitado al mismo dominio registrable del sitio inicial.
 * - Timeout 8 s por request, cuerpo maximo 1 MB, solo HTML, sin cookies, JS,
 *   referrer ni assets. `Accept-Encoding: identity`; una respuesta comprimida
 *   se rechaza.
 * - `robots.txt` por origen con cache en memoria de 24 h; el parser puro
 *   entiende `User-agent: *` y `PixelArchProspectBot`, `Allow`/`Disallow`,
 *   wildcard `*`, ancla `$` y "la regla mas especifica gana".
 * - El contenido HTML es dato no confiable: solo se parsea como texto, nunca
 *   se ejecuta ni se interpretan instrucciones embebidas.
 *
 * Modulo server-only: importa `node:http`, `node:https` y `node:dns`. No toca
 * Prisma, entorno, proveedores ni logs. Todos los colaboradores (transporte,
 * DNS, cache y reloj) son inyectables para testear sin red.
 */

import * as dns from "node:dns"
import * as http from "node:http"
import * as https from "node:https"

import { isBlockedHost, normalizeUrl } from "@/lib/audit"

import {
  dominioRegistrable,
  esHostNoProspectable,
  extraerEmailPublicado,
  extraerTelefonoPublicado,
  limpiarNombreNegocio,
  normalizarDominio,
} from "./normalizar"

export const USER_AGENT_PROSPECT =
  "PixelArchProspectBot/1.0 (+https://pixelarch.dev/propuestas; contacto: hola@pixelarch.dev)"

export const TIMEOUT_WEB_MS = 8_000
export const MAX_BYTES_WEB = 1_048_576
export const MAX_BYTES_ROBOTS = 524_288
export const MAX_REDIRECCIONES_WEB = 3
export const TTL_ROBOTS_MS = 24 * 60 * 60 * 1_000
export const AGENTE_ROBOTS = "PixelArchProspectBot"

const TIPOS_HTML = ["text/html", "application/xhtml+xml"]
// `""` permite un robots.txt sin Content-Type (algunos servidores lo omiten).
const TIPOS_ROBOTS = ["text/plain", "text/html", "application/xhtml+xml", ""]

const SEGMENTOS_LOGIN = new Set([
  "login",
  "signin",
  "sign-in",
  "auth",
  "acceso",
  "ingresar",
])

/** Extensiones que no son una pagina navegable (assets, PDFs, descargas). */
const EXTENSIONES_NO_NAVEGABLES = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "css",
  "js",
  "mjs",
  "json",
  "xml",
  "txt",
  "pdf",
  "zip",
  "rar",
  "7z",
  "gz",
  "tar",
  "mp3",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "webm",
  "ogg",
  "wav",
  "flac",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "rtf",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "exe",
  "msi",
  "dmg",
  "pkg",
  "apk",
  "iso",
  "bin",
])

/**
 * Motivos tipados de fallo. `SIN_EMAIL` no lo emite `fetchHtmlSeguro` (el fetch
 * puede terminar bien y el sitio no publicar email); queda en el union para que
 * el analisis del prospecto (T-15) use el mismo vocabulario.
 */
export const MOTIVOS_FALLO_WEB = [
  "SIN_WEB",
  "URL_INVALIDA",
  "DNS",
  "ROBOTS",
  "LOGIN",
  "TIMEOUT",
  "TAMANIO",
  "NO_HTML",
  "HTTP",
  "ENCODING",
  "DOMINIO_EXTERNO",
  "FUENTE_NO_PERMITIDA",
  "REDIRECCIONES",
  "TLS",
  "RED",
  "SIN_EMAIL",
] as const

export type MotivoFalloWeb = (typeof MOTIVOS_FALLO_WEB)[number]

/**
 * Mensajes saneados: sin URL, sin host, sin PII y sin detalles internos. El
 * llamador puede mostrarlos tal cual o mapearlos a su propio estado.
 */
const MENSAJES_FALLO: Record<MotivoFalloWeb, string> = {
  SIN_WEB: "El prospecto no tiene un sitio web.",
  URL_INVALIDA: "La URL del sitio no es valida o no es publica.",
  DNS: "El host no resuelve a una direccion publica.",
  ROBOTS: "El sitio no permite el acceso segun robots.txt.",
  LOGIN: "El sitio requiere inicio de sesion o autenticacion.",
  TIMEOUT: "El sitio no respondio a tiempo.",
  TAMANIO: "La respuesta del sitio supera el tamano permitido.",
  NO_HTML: "La respuesta del sitio no es una pagina HTML.",
  HTTP: "El sitio respondio con un error HTTP.",
  ENCODING: "La respuesta llego comprimida y no se acepta.",
  DOMINIO_EXTERNO: "La redireccion apunta a otro dominio.",
  FUENTE_NO_PERMITIDA:
    "El sitio es una red social, marketplace, agregador o link-in-bio.",
  REDIRECCIONES: "El sitio supera el maximo de redirecciones permitido.",
  TLS: "El certificado TLS del sitio no es valido.",
  RED: "No se pudo conectar con el sitio.",
  SIN_EMAIL: "El sitio no publica un email de contacto.",
}

export class ErrorCargaWeb extends Error {
  readonly motivo: MotivoFalloWeb

  constructor(motivo: MotivoFalloWeb) {
    super(MENSAJES_FALLO[motivo])
    this.name = "ErrorCargaWeb"
    this.motivo = motivo
  }
}

export interface DireccionDns {
  address: string
  family: number
}

/** Resolver inyectable. En produccion es `dns.promises.lookup(..., { all: true })`. */
export type ResolverDns = (host: string) => Promise<DireccionDns[]>

export type CabecerasRespuesta = Record<
  string,
  string | string[] | undefined
>

/**
 * Firma compatible con el `lookup` de `node:net` (el que usa `http.request`).
 * Respeta `opciones.all` y `opciones.family`: con `all: true` (Node 20+ y
 * `autoSelectFamily`) el callback recibe el arreglo de direcciones validadas;
 * con `all` ausente/false recibe una unica direccion. Cuando la resolucion
 * devuelve una IP no publica se llama con un error con codigo propio.
 */
export type FuncionLookup = (
  hostname: string,
  opciones: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
) => void

export interface SolicitudHttp {
  url: URL
  headers: Record<string, string>
  timeoutMs: number
  maxBytes: number
  /** Tipos de `Content-Type` aceptados (la parte anterior a `;`). */
  tiposPermitidos: string[]
  lookup: FuncionLookup
}

export interface RespuestaHttp {
  status: number
  headers: CabecerasRespuesta
  cuerpo: Buffer | string
  ttfbMs: number
  totalMs: number
}

/** Transporte inyectable. Debe rechazar con `ErrorCargaWeb` ante un limite. */
export type TransporteHttp = (
  solicitud: SolicitudHttp,
) => Promise<RespuestaHttp>

export interface CabecerasAuditoria {
  hsts: boolean
  csp: boolean
  xfo: boolean
  xcto: boolean
  referrer: boolean
}

export interface ResultadoWebOk {
  ok: true
  html: string
  finalUrl: string
  status: number
  /** Cabeceras en minusculas. Se omite `set-cookie`: no se aceptan cookies. */
  headers: Record<string, string>
  /** Booleanos listos para `AuditData.headers` de `@/lib/audit`. */
  auditHeaders: CabecerasAuditoria
  ttfbMs: number
  totalMs: number
  redirigido: boolean
  /** Destinos de cada redireccion seguida (sin incluir la URL inicial). */
  redirects: string[]
  https: boolean
  htmlKb: number
}

export interface ResultadoWebError {
  ok: false
  motivo: MotivoFalloWeb
  mensaje: string
  status: number | null
  redirigido: boolean
  redirects: string[]
}

export type ResultadoWeb = ResultadoWebOk | ResultadoWebError

export interface OpcionesFetchHtmlSeguro {
  transporte?: TransporteHttp
  resolverDns?: ResolverDns
  cacheRobots?: CacheRobots
  /** Solo se usa si no se inyecta `cacheRobots` (cache efimera por llamada). */
  reloj?: () => number
  timeoutMs?: number
  maxBytes?: number
  maxRedirecciones?: number
  userAgent?: string
}

// ---------------------------------------------------------------------------
// Direcciones IP publicas
// ---------------------------------------------------------------------------

function parsearIpv4(address: string): number[] | null {
  const partes = address.split(".")
  if (partes.length !== 4) return null

  const numeros: number[] = []
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null
    const numero = Number(parte)
    if (numero > 255) return null
    numeros.push(numero)
  }

  return numeros
}

function esIpv4Publica(address: string): boolean {
  const partes = parsearIpv4(address)
  if (partes === null) return false

  const [a, b, c] = partes

  // 0.0.0.0/8, 10/8, 127/8 (loopback)
  if (a === 0 || a === 10 || a === 127) return false
  // 100.64/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return false
  // 169.254/16 (link-local), 172.16/12, 192.168/16
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  // 192.0.0.0/24 y 192.0.2.0/24 (IETF / TEST-NET-1)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  // 192.88.99/24 (6to4 relay), 198.18/15 (benchmark), 198.51.100/24
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  // 203.0.113/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return false
  // 224/4 multicast, 240/4 reservada, 255.255.255.255 broadcast
  if (a >= 224) return false

  return true
}

function expandirIpv6(address: string): number[] | null {
  const valor = address.trim().toLowerCase()
  if (!/^[0-9a-f:]+$/.test(valor)) return null

  const partes = valor.split("::")
  if (partes.length > 2) return null

  const izquierda = partes[0] ? partes[0].split(":") : []
  const derecha = partes.length === 2 && partes[1] ? partes[1].split(":") : []

  let hextetos: string[]
  if (partes.length === 2) {
    const faltantes = 8 - izquierda.length - derecha.length
    if (faltantes < 0) return null
    hextetos = [...izquierda, ...new Array<string>(faltantes).fill("0"), ...derecha]
  } else {
    hextetos = izquierda
  }

  if (hextetos.length !== 8) return null

  const numeros: number[] = []
  for (const hexteto of hextetos) {
    if (!/^[0-9a-f]{1,4}$/.test(hexteto)) return null
    numeros.push(Number.parseInt(hexteto, 16))
  }

  return numeros
}

function ipv4DesdeHextetos(alto: number, bajo: number): string {
  return `${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`
}

function esIpv6Publica(address: string): boolean {
  let valor = address.trim().toLowerCase()
  if (valor.startsWith("[") && valor.endsWith("]")) {
    valor = valor.slice(1, -1)
  }

  const zona = valor.indexOf("%")
  if (zona >= 0) valor = valor.slice(0, zona)

  // IPv4 mapeada / compatible en notacion con puntos (::ffff:127.0.0.1).
  const conPuntos = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(valor)
  if (conPuntos) return esIpv4Publica(conPuntos[1])

  const hextetos = expandirIpv6(valor)
  if (hextetos === null) return false

  const ceros = hextetos.slice(0, 5).every((hexteto) => hexteto === 0)
  if (ceros && (hextetos[5] === 0 || hextetos[5] === 0xffff)) {
    // ::, ::1 y IPv4 mapeada/compatible: se valida la parte IPv4 embebida.
    return esIpv4Publica(
      ipv4DesdeHextetos(hextetos[6], hextetos[7]),
    )
  }

  const primero = hextetos[0]
  // ::/8 (direcciones reservadas, loopback y compatibles ya tratadas arriba).
  if (primero === 0) return false
  // fe80::/10 link-local y fec0::/10 site-local (deprecado).
  if (primero >= 0xfe80 && primero <= 0xfebf) return false
  if (primero >= 0xfec0 && primero <= 0xfeff) return false
  // fc00::/7 unique local
  if (primero >= 0xfc00 && primero <= 0xfdff) return false
  // ff00::/8 multicast
  if (primero >= 0xff00) return false
  // 2001:db8::/32 documentacion
  if (primero === 0x2001 && hextetos[1] === 0x0db8) return false
  // 2002::/16 (6to4) y 2001:0000::/32 (Teredo) incrustan IPv4: se rechazan.
  if (primero === 0x2002) return false
  if (primero === 0x2001 && hextetos[1] === 0x0000) return false
  // 2001:2::/48 (benchmark), 2001:10::/28 (ORCHID), 2001:20::/28 (ORCHIDv2)
  // y 2001:30::/28: rangos especiales sin uso publico.
  if (primero === 0x2001 && hextetos[1] === 0x0002) return false
  if (primero === 0x2001 && (hextetos[1] & 0xfff0) === 0x0010) return false
  if (primero === 0x2001 && (hextetos[1] & 0xfff0) === 0x0020) return false
  if (primero === 0x2001 && (hextetos[1] & 0xfff0) === 0x0030) return false
  // 3fff::/20 (documentacion ampliada / reservado).
  if (primero === 0x3fff && (hextetos[1] & 0xf000) === 0) return false
  // 64:ff9b::/96 (NAT64 well-known): la IPv4 embebida en los ultimos 32 bits
  // debe ser publica. La variante local-use 64:ff9b:1::/48 y el resto de los
  // usos fuera del /96 se rechazan (fail closed).
  if (primero === 0x0064 && hextetos[1] === 0xff9b) {
    if (
      hextetos[2] === 0 &&
      hextetos[3] === 0 &&
      hextetos[4] === 0 &&
      hextetos[5] === 0
    ) {
      return esIpv4Publica(ipv4DesdeHextetos(hextetos[6], hextetos[7]))
    }
    return false
  }

  return true
}

/**
 * `true` solo para direcciones IP publicas enroutables. Rechaza privadas,
 * loopback, link-local, site-local, multicast, reservadas, TEST-NET, no
 * especificadas, IPv4 mapeadas privadas, rangos especiales IPv6 (ORCHID,
 * benchmark, 3fff::/20) y NAT64 con una IPv4 embebida no publica. Cualquier
 * valor que no sea una IP valida tambien devuelve `false` (fallar cerrado).
 */
export function esDireccionPublica(address: string): boolean {
  if (typeof address !== "string") return false
  const valor = address.trim()
  if (valor.length === 0) return false
  if (valor.includes(":")) return esIpv6Publica(valor)
  return esIpv4Publica(valor)
}

// ---------------------------------------------------------------------------
// DNS y transporte real
// ---------------------------------------------------------------------------

export const resolverDnsReal: ResolverDns = async (host) => {
  const direcciones = await dns.promises.lookup(host, { all: true })
  return direcciones.map((direccion) => ({
    address: direccion.address,
    family: direccion.family,
  }))
}

function errorDns(codigo: string): NodeJS.ErrnoException {
  const error = new Error(codigo) as NodeJS.ErrnoException
  error.code = codigo
  return error
}

/**
 * `lookup` que se ejecuta en el connect de `node:http`/`node:https`. Vuelve a
 * resolver con el resolver inyectado y exige que TODAS las direcciones sean
 * publicas. Asi un DNS que cambia entre la pre-validacion y el connect no
 * puede alcanzar una IP interna.
 *
 * Node 20+ con `autoSelectFamily` (Happy Eyeballs) llama al lookup con
 * `{ all: true }` y espera `{ address, family }[]`; el resto de los casos
 * espera un string. Se soportan ambos: se validan todas las direcciones, se
 * filtra por `family` cuando viene y se responde en el formato pedido. Si el
 * filtro de familia no deja ninguna direccion se falla con
 * `SIN_DIRECCION_VALIDA`. El rechazo es fail closed: basta una direccion no
 * publica para abortar el connect.
 *
 * Se exporta para poder probar el control de DNS rebinding sin red: un test
 * puede llamarlo con un resolver que devuelve una IP privada y comprobar que
 * el callback recibe un error en vez de una direccion.
 */
export function crearLookupValidadorDns(
  resolver: ResolverDns,
): FuncionLookup {
  return (hostname, opciones, callback) => {
    let resuelto = false
    const todas = opciones.all === true
    const familia =
      opciones.family === 4 || opciones.family === 6
        ? opciones.family
        : undefined

    const fallar = (codigo: string) => {
      callback(errorDns(codigo), todas ? [] : "", todas ? undefined : 0)
    }

    Promise.resolve()
      .then(() => resolver(hostname))
      .then((direcciones) => {
        if (resuelto) return
        resuelto = true

        const lista = Array.isArray(direcciones) ? direcciones : []
        if (lista.length === 0) {
          fallar("DNS_VACIO")
          return
        }

        for (const direccion of lista) {
          if (
            !direccion ||
            typeof direccion.address !== "string" ||
            !esDireccionPublica(direccion.address)
          ) {
            fallar("DIRECCION_NO_PERMITIDA")
            return
          }
        }

        const candidatas =
          familia === undefined
            ? lista
            : lista.filter((direccion) => direccion.family === familia)

        if (candidatas.length === 0) {
          fallar("SIN_DIRECCION_VALIDA")
          return
        }

        if (todas) {
          callback(
            null,
            candidatas.map((direccion) => ({
              address: direccion.address,
              family: direccion.family,
            })),
          )
          return
        }

        // Se prefiere IPv4 para no romper servidores que solo escuchan en v4.
        const elegida =
          candidatas.find((direccion) => direccion.family === 4) ??
          candidatas[0]

        callback(null, elegida.address, elegida.family)
      })
      .catch(() => {
        if (resuelto) return
        resuelto = true
        fallar("DNS")
      })
  }
}

function leerCodigoError(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  const codigo = (error as { code?: unknown }).code
  return typeof codigo === "string" ? codigo : ""
}

function motivoDeErrorRed(error: unknown): MotivoFalloWeb {
  if (error instanceof ErrorCargaWeb) return error.motivo

  const codigo = leerCodigoError(error)
  if (
    codigo === "ENOTFOUND" ||
    codigo === "EAI_AGAIN" ||
    codigo === "EAI_NONAME" ||
    codigo === "EAI_FAIL" ||
    codigo === "DNS_VACIO" ||
    codigo === "DIRECCION_NO_PERMITIDA" ||
    codigo === "SIN_DIRECCION_VALIDA"
  ) {
    return "DNS"
  }
  if (
    codigo === "ETIMEDOUT" ||
    codigo === "ESOCKETTIMEDOUT" ||
    codigo === "ABORT_ERR"
  ) {
    return "TIMEOUT"
  }
  if (
    codigo.startsWith("ERR_TLS") ||
    codigo.includes("CERT") ||
    codigo === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    codigo === "SELF_SIGNED_CERT_IN_CHAIN" ||
    codigo === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    codigo === "EPROTO"
  ) {
    return "TLS"
  }

  return "RED"
}

function obtenerCabecera(
  headers: CabecerasRespuesta,
  nombre: string,
): string | undefined {
  if (!headers || typeof headers !== "object") return undefined
  const buscado = nombre.toLowerCase()

  for (const clave of Object.keys(headers)) {
    if (clave.toLowerCase() !== buscado) continue
    const valor = headers[clave]
    if (valor === undefined) return undefined
    return Array.isArray(valor) ? valor[0] : valor
  }

  return undefined
}

function tipoContenido(valor: string | undefined): string {
  if (typeof valor !== "string") return ""
  return valor.split(";")[0].trim().toLowerCase()
}

function tieneCompresion(valor: string | undefined): boolean {
  if (typeof valor !== "string") return false
  const tokens = valor
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

  return tokens.some((token) => token !== "identity")
}

function comoBuffer(valor: Buffer | string | undefined): Buffer {
  if (Buffer.isBuffer(valor)) return valor
  if (typeof valor === "string") return Buffer.from(valor, "utf8")
  return Buffer.alloc(0)
}

/**
 * Transporte real: `node:https`/`node:http` con `lookup` validador, timeout
 * por request, limite de bytes en streaming y rechazo temprano de respuestas
 * comprimidas o con un `Content-Type` no permitido.
 *
 * No se fija `autoSelectFamily: false`: en Node 20+ el connect puede llamar al
 * `lookup` con `{ all: true }` (Happy Eyeballs). El validador implementa esa
 * firma y comprueba TODAS las direcciones, asi que el cierre del DNS rebinding
 * se mantiene tanto con `all: true` como con una unica direccion. Desactivarlo
 * solo perderia intentos IPv6 sin aportar seguridad adicional.
 */
export const transporteHttpReal: TransporteHttp = (solicitud) =>
  new Promise<RespuestaHttp>((resolve, reject) => {
    const inicio = Date.now()
    let ttfbMs = 0
    let finalizado = false
    let req: http.ClientRequest | null = null
    let temporizador: NodeJS.Timeout | null = null

    const detenerReloj = () => {
      if (temporizador === null) return
      clearTimeout(temporizador)
      temporizador = null
    }

    const abortar = (motivo: MotivoFalloWeb) => {
      if (finalizado) return
      finalizado = true
      detenerReloj()
      try {
        req?.destroy()
      } catch {
        // La conexion ya no importa: el resultado se descarta.
      }
      reject(new ErrorCargaWeb(motivo))
    }

    const esHttps = solicitud.url.protocol === "https:"
    const modulo = esHttps ? https : http
    const puerto =
      solicitud.url.port !== ""
        ? Number(solicitud.url.port)
        : esHttps
          ? 443
          : 80
    const ruta = `${solicitud.url.pathname || "/"}${solicitud.url.search}`

    try {
      req = modulo.request(
        {
          protocol: solicitud.url.protocol,
          hostname: solicitud.url.hostname,
          port: puerto,
          path: ruta,
          method: "GET",
          headers: solicitud.headers,
          lookup: solicitud.lookup,
          // Sin pool: cada request es una conexion nueva y no hay cookies.
          agent: false,
          // `autoSelectFamily` queda en el default de Node: el lookup validador
          // soporta `all: true` y valida todas las direcciones antes de que el
          // connect elija una, sin abrir una segunda resolucion DNS.
        },
        (respuesta) => {
          ttfbMs = Date.now() - inicio
          const status = respuesta.statusCode ?? 0

          // El error del stream no cambia un resultado ya resuelto; se registra
          // un listener para que Node no lo trate como no manejado.
          respuesta.on("error", () => {
            if (!finalizado) abortar("RED")
          })

          if (status < 200 || status >= 300) {
            finalizado = true
            detenerReloj()
            // Las cabeceras ya se leyeron y el cuerpo no se usa: se corta la
            // conexion en vez de `resume()`, que drenaria sin limite una
            // respuesta 3xx/4xx/5xx arbitraria.
            try {
              respuesta.destroy()
            } catch {
              // La respuesta ya estaba cerrada.
            }
            resolve({
              status,
              headers: respuesta.headers,
              cuerpo: Buffer.alloc(0),
              ttfbMs,
              totalMs: Date.now() - inicio,
            })
            return
          }

          if (tieneCompresion(obtenerCabecera(respuesta.headers, "content-encoding"))) {
            abortar("ENCODING")
            return
          }

          const tipo = tipoContenido(
            obtenerCabecera(respuesta.headers, "content-type"),
          )
          if (!solicitud.tiposPermitidos.includes(tipo)) {
            abortar("NO_HTML")
            return
          }

          const trozos: Buffer[] = []
          let bytes = 0

          respuesta.on("data", (trozo: Buffer) => {
            if (finalizado) return
            bytes += trozo.byteLength
            if (bytes > solicitud.maxBytes) {
              abortar("TAMANIO")
              return
            }
            trozos.push(trozo)
          })

          respuesta.on("end", () => {
            if (finalizado) return
            finalizado = true
            detenerReloj()
            resolve({
              status,
              headers: respuesta.headers,
              cuerpo: Buffer.concat(trozos),
              ttfbMs,
              totalMs: Date.now() - inicio,
            })
          })
        },
      )
    } catch {
      reject(new ErrorCargaWeb("RED"))
      return
    }

    // Deadline total ademas del timeout de inactividad del socket: un servidor
    // que gotea bytes no puede mantener la request mas alla del limite.
    temporizador = setTimeout(() => abortar("TIMEOUT"), solicitud.timeoutMs)
    temporizador.unref?.()

    req.setTimeout(solicitud.timeoutMs, () => abortar("TIMEOUT"))
    req.on("error", (error) => abortar(motivoDeErrorRed(error)))
    req.end()
  })

// ---------------------------------------------------------------------------
// Validacion de URL, DNS y descarga
// ---------------------------------------------------------------------------

interface UrlValidada {
  ok: true
  url: URL
  host: string
  dominio: string
}

interface UrlRechazada {
  ok: false
  motivo: MotivoFalloWeb
}

type ValidacionUrl = UrlValidada | UrlRechazada

function esIpLiteral(host: string): boolean {
  if (host.includes(":")) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * Valida la estructura de una URL: protocolo, credenciales, puerto, host con
 * dominio, literales IP, hosts bloqueados y dominio registrable. No hace red.
 */
function validarEstructuraUrl(valor: string | URL): ValidacionUrl {
  let url: URL

  if (valor instanceof URL) {
    url = valor
  } else {
    const normalizada = normalizeUrl(valor)
    if (normalizada === null) return { ok: false, motivo: "URL_INVALIDA" }
    try {
      url = new URL(normalizada)
    } catch {
      return { ok: false, motivo: "URL_INVALIDA" }
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, motivo: "URL_INVALIDA" }
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, motivo: "URL_INVALIDA" }
  }
  // `URL` normaliza los puertos por defecto a ""; cualquier puerto explicito
  // distinto de 80/443 queda rechazado.
  if (url.port !== "") return { ok: false, motivo: "URL_INVALIDA" }

  const host = url.hostname.toLowerCase().replace(/\.+$/, "")
  if (host.length === 0 || host.length > 253) {
    return { ok: false, motivo: "URL_INVALIDA" }
  }
  if (!host.includes(".") || host.includes(":") || host.startsWith("[")) {
    return { ok: false, motivo: "URL_INVALIDA" }
  }
  if (esIpLiteral(host) || isBlockedHost(host)) {
    return { ok: false, motivo: "URL_INVALIDA" }
  }
  if (normalizarDominio(host) === null) {
    return { ok: false, motivo: "URL_INVALIDA" }
  }

  const dominio = dominioRegistrable(host)
  if (dominio === null) return { ok: false, motivo: "URL_INVALIDA" }

  // FQDN con punto final: se normaliza para que el request, el SNI y las
  // comparaciones de dominio usen siempre el mismo host.
  if (url.hostname !== host) url.hostname = host
  url.hash = ""

  return { ok: true, url, host, dominio }
}

async function validarDns(
  host: string,
  resolver: ResolverDns,
): Promise<MotivoFalloWeb | null> {
  let direcciones: DireccionDns[]

  try {
    direcciones = await resolver(host)
  } catch {
    return "DNS"
  }

  if (!Array.isArray(direcciones) || direcciones.length === 0) return "DNS"

  for (const direccion of direcciones) {
    if (
      !direccion ||
      typeof direccion.address !== "string" ||
      !esDireccionPublica(direccion.address)
    ) {
      return "DNS"
    }
  }

  return null
}

/**
 * Pre-resolucion DNS con el mismo deadline que el request. `dns.lookup` no se
 * puede cancelar, pero al vencer el plazo su promesa se descarta y el fetch
 * falla con `TIMEOUT` en vez de quedar colgado.
 */
async function validarDnsConTimeout(
  host: string,
  resolver: ResolverDns,
  timeoutMs: number,
): Promise<MotivoFalloWeb | null> {
  let temporizador: NodeJS.Timeout | null = null

  try {
    return await Promise.race([
      validarDns(host, resolver),
      new Promise<MotivoFalloWeb>((resolve) => {
        temporizador = setTimeout(() => resolve("TIMEOUT"), timeoutMs)
        temporizador.unref?.()
      }),
    ])
  } finally {
    if (temporizador !== null) clearTimeout(temporizador)
  }
}

interface DepsWeb {
  transporte: TransporteHttp
  resolverDns: ResolverDns
  cacheRobots: CacheRobots
  timeoutMs: number
  maxBytes: number
  maxRedirecciones: number
  userAgent: string
}

function enteroPositivo(valor: number | undefined, porDefecto: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return porDefecto
  }
  return Math.floor(valor)
}

function enteroNoNegativo(valor: number | undefined, porDefecto: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) {
    return porDefecto
  }
  return Math.floor(valor)
}

function tiempoSeguro(valor: number): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0
    ? valor
    : 0
}

interface DescargaOk {
  ok: true
  respuesta: RespuestaHttp
}

interface DescargaError {
  ok: false
  motivo: MotivoFalloWeb
}

type ResultadoDescarga = DescargaOk | DescargaError

async function descargar(
  url: URL,
  deps: DepsWeb,
  tipos: string[],
  maxBytes: number,
): Promise<ResultadoDescarga> {
  const motivoDns = await validarDnsConTimeout(
    url.hostname,
    deps.resolverDns,
    deps.timeoutMs,
  )
  if (motivoDns !== null) return { ok: false, motivo: motivoDns }

  const esRobots = tipos.includes("")
  const solicitud: SolicitudHttp = {
    url,
    headers: {
      "User-Agent": deps.userAgent,
      Accept: esRobots
        ? "text/plain,text/html;q=0.9,*/*;q=0.1"
        : "text/html,application/xhtml+xml;q=0.9",
      "Accept-Encoding": "identity",
      Connection: "close",
    },
    timeoutMs: deps.timeoutMs,
    maxBytes,
    tiposPermitidos: tipos,
    lookup: crearLookupValidadorDns(deps.resolverDns),
  }

  try {
    const respuesta = await deps.transporte(solicitud)
    return { ok: true, respuesta }
  } catch (error) {
    return { ok: false, motivo: motivoDeErrorRed(error) }
  }
}

function resolverDestino(
  ubicacion: string | undefined,
  base: URL,
): URL | null {
  if (typeof ubicacion !== "string") return null
  const limpia = ubicacion.trim()
  if (limpia.length === 0) return null

  try {
    const destino = new URL(limpia, base)
    destino.hash = ""
    return destino
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export type EstadoRobotsCache = "TEXTO" | "PERMITE" | "BLOQUEADO"

export interface ValorRobotsCache {
  estado: EstadoRobotsCache
  /** Contenido de robots.txt solo cuando `estado === "TEXTO"`. */
  texto: string | null
}

export interface CacheRobots {
  get(origen: string): ValorRobotsCache | null
  set(origen: string, valor: ValorRobotsCache): void
  limpiar?(): void
}

/**
 * Cache en memoria por origen. `ttlMs` y `reloj` son inyectables: los tests
 * pueden avanzar el reloj para comprobar el vencimiento de 24 h sin esperar.
 */
export function crearCacheRobotsEnMemoria(
  opciones: { ttlMs?: number; reloj?: () => number } = {},
): CacheRobots {
  const ttlMs =
    typeof opciones.ttlMs === "number" && opciones.ttlMs >= 0
      ? opciones.ttlMs
      : TTL_ROBOTS_MS
  const reloj = opciones.reloj ?? (() => Date.now())
  const entradas = new Map<
    string,
    { valor: ValorRobotsCache; expira: number }
  >()

  return {
    get(origen) {
      const entrada = entradas.get(origen)
      if (!entrada) return null
      if (entrada.expira <= reloj()) {
        entradas.delete(origen)
        return null
      }
      return entrada.valor
    },
    set(origen, valor) {
      if (entradas.size >= 200) {
        const ahora = reloj()
        for (const [clave, entrada] of entradas) {
          if (entrada.expira <= ahora) entradas.delete(clave)
        }
        if (entradas.size >= 200) {
          const primera = entradas.keys().next().value
          if (typeof primera === "string") entradas.delete(primera)
        }
      }
      entradas.set(origen, { valor, expira: reloj() + ttlMs })
    },
    limpiar() {
      entradas.clear()
    },
  }
}

const cacheRobotsPorDefecto = crearCacheRobotsEnMemoria()

/** Limpia la cache compartida. Pensado para tests; en runtime no hace falta. */
export function limpiarCacheRobotsPorDefecto(): void {
  cacheRobotsPorDefecto.limpiar?.()
}

interface ReglaRobots {
  tipo: "allow" | "disallow"
  patron: string
}

interface GrupoRobots {
  agentes: string[]
  reglas: ReglaRobots[]
}

export interface DecisionRobots {
  permitido: boolean
  /** Regla que decidio, solo para diagnostico; no contiene datos del sitio. */
  regla: string | null
}

function normalizarTokenAgente(agente: string): string {
  return agente.trim().toLowerCase().split("/")[0].trim()
}

function coincidenciaAgente(
  agenteGrupo: string,
  token: string,
): number | null {
  const valor = normalizarTokenAgente(agenteGrupo)
  if (valor === "*") return 0
  if (valor.length === 0) return null
  // El product token se compara como prefijo (`PixelArch` cubre
  // `PixelArchProspectBot`); asi un grupo generico como `bot` no aplica.
  if (token.startsWith(valor)) return valor.length
  return null
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function coincidePatron(patron: string, ruta: string): boolean {
  // robots.txt es dato no confiable: un patron absurdo no debe alimentar una
  // regex costosa. `**` es equivalente a `*`, asi que se colapsa.
  if (patron.length === 0 || patron.length > 300) return false

  let base = patron.replace(/\*{2,}/g, "*")
  const anclado = base.endsWith("$")
  if (anclado) base = base.slice(0, -1)

  const partes = base.split("*").map(escaparRegex)
  if (partes.length > 20) return false
  const fuente = `^${partes.join(".*")}${anclado ? "$" : ".*"}`

  try {
    return new RegExp(fuente).test(ruta)
  } catch {
    return false
  }
}

function parsearRobots(contenido: string): GrupoRobots[] {
  const grupos: GrupoRobots[] = []
  let actual: GrupoRobots | null = null
  let tieneReglas = false

  for (const lineaCruda of contenido.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const linea = lineaCruda.replace(/#.*$/, "").trim()
    if (linea.length === 0) continue

    const separador = linea.indexOf(":")
    if (separador < 0) continue

    const campo = linea.slice(0, separador).trim().toLowerCase()
    const valor = linea.slice(separador + 1).trim()

    if (campo === "user-agent") {
      if (actual === null || tieneReglas) {
        actual = { agentes: [], reglas: [] }
        grupos.push(actual)
        tieneReglas = false
      }
      if (valor.length > 0) actual.agentes.push(valor)
      continue
    }

    if (actual === null) continue

    if (campo === "allow" || campo === "disallow") {
      tieneReglas = true
      if (valor.length === 0) continue
      actual.reglas.push({
        tipo: campo === "allow" ? "allow" : "disallow",
        patron: valor,
      })
    }
    // `Sitemap`, `Crawl-delay` y directivas desconocidas se ignoran.
  }

  return grupos
}

/**
 * Parser puro de robots.txt. Aplica el grupo de user-agent mas especifico
 * (`PixelArchProspectBot` gana sobre `*`), `Allow`/`Disallow`, wildcard `*`,
 * ancla `$` y la regla mas especifica; en empate gana `Allow`.
 */
export function evaluarRobots(
  contenido: string,
  ruta: string,
  agente: string = AGENTE_ROBOTS,
): DecisionRobots {
  if (typeof contenido !== "string" || contenido.length === 0) {
    return { permitido: true, regla: null }
  }

  const grupos = parsearRobots(contenido)
  const token = normalizarTokenAgente(agente)

  let especificidad = -1
  const aplicables: GrupoRobots[] = []

  for (const grupo of grupos) {
    for (const agenteGrupo of grupo.agentes) {
      const valor = coincidenciaAgente(agenteGrupo, token)
      if (valor === null) continue

      if (valor > especificidad) {
        especificidad = valor
        aplicables.length = 0
        aplicables.push(grupo)
      } else if (valor === especificidad && !aplicables.includes(grupo)) {
        aplicables.push(grupo)
      }
    }
  }

  if (aplicables.length === 0) return { permitido: true, regla: null }

  const rutaEvaluada = ruta.startsWith("/") ? ruta : `/${ruta}`
  let elegida: { regla: ReglaRobots; largo: number } | null = null

  for (const grupo of aplicables) {
    for (const regla of grupo.reglas) {
      if (!coincidePatron(regla.patron, rutaEvaluada)) continue

      const largo = regla.patron.replace(/[*$]/g, "").length
      if (
        elegida === null ||
        largo > elegida.largo ||
        (largo === elegida.largo &&
          regla.tipo === "allow" &&
          elegida.regla.tipo === "disallow")
      ) {
        elegida = { regla, largo }
      }
    }
  }

  if (elegida === null) return { permitido: true, regla: null }

  return {
    permitido: elegida.regla.tipo === "allow",
    regla: `${
      elegida.regla.tipo === "allow" ? "Allow" : "Disallow"
    }: ${elegida.regla.patron}`,
  }
}

async function obtenerRobots(
  origen: string,
  deps: DepsWeb,
): Promise<ValorRobotsCache> {
  const base = origen.endsWith("/") ? origen : `${origen}/`
  const urlInicial = new URL("/robots.txt", base)
  const dominioOrigen = dominioRegistrable(urlInicial.hostname)

  let actual = urlInicial
  let saltos = 0

  while (true) {
    const descarga = await descargar(actual, deps, TIPOS_ROBOTS, MAX_BYTES_ROBOTS)

    // Sin robots utilizable (404, 5xx, timeout, DNS, no HTML) se permite.
    if (!descarga.ok) return { estado: "PERMITE", texto: null }

    const { respuesta } = descarga

    if (respuesta.status === 401 || respuesta.status === 403) {
      return { estado: "BLOQUEADO", texto: null }
    }

    if (respuesta.status >= 300 && respuesta.status < 400) {
      if (saltos >= deps.maxRedirecciones) {
        return { estado: "PERMITE", texto: null }
      }

      const destino = resolverDestino(
        obtenerCabecera(respuesta.headers, "location"),
        actual,
      )
      if (destino === null) return { estado: "PERMITE", texto: null }

      const validado = validarEstructuraUrl(destino)
      if (!validado.ok) return { estado: "PERMITE", texto: null }

      if (dominioOrigen === null || validado.dominio !== dominioOrigen) {
        // Un robots.txt que se va del dominio no aplica: se trata como ausente.
        return { estado: "PERMITE", texto: null }
      }

      actual = validado.url
      saltos += 1
      continue
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      return { estado: "PERMITE", texto: null }
    }

    return {
      estado: "TEXTO",
      texto: comoBuffer(respuesta.cuerpo).toString("utf8"),
    }
  }
}

interface VerificacionRobotsOk {
  ok: true
}

interface VerificacionRobotsError {
  ok: false
  motivo: "ROBOTS"
}

async function verificarRobots(
  url: URL,
  deps: DepsWeb,
): Promise<VerificacionRobotsOk | VerificacionRobotsError> {
  const origen = url.origin

  let politica = deps.cacheRobots.get(origen)
  if (politica === null || politica === undefined) {
    politica = await obtenerRobots(origen, deps)
    deps.cacheRobots.set(origen, politica)
  }

  if (politica.estado === "BLOQUEADO") {
    return { ok: false, motivo: "ROBOTS" }
  }
  if (politica.estado === "PERMITE" || politica.texto === null) {
    return { ok: true }
  }

  const ruta = `${url.pathname || "/"}${url.search}`
  const decision = evaluarRobots(politica.texto, ruta, deps.userAgent)

  return decision.permitido
    ? { ok: true }
    : { ok: false, motivo: "ROBOTS" }
}

// ---------------------------------------------------------------------------
// Deteccion de login
// ---------------------------------------------------------------------------

/** `true` si algun segmento del path es de login/autenticacion. */
export function esRutaLogin(valor: string | URL): boolean {
  let url: URL
  if (valor instanceof URL) {
    url = valor
  } else {
    try {
      url = new URL(valor)
    } catch {
      return false
    }
  }

  for (const segmento of url.pathname.split("/")) {
    if (segmento.length === 0) continue

    let decodificado = segmento
    try {
      decodificado = decodeURIComponent(segmento)
    } catch {
      // Se compara el valor crudo si el escape es invalido.
    }

    if (SEGMENTOS_LOGIN.has(decodificado.toLowerCase())) return true
  }

  return false
}

function quitarRuidoHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
}

function contienePassword(html: string): boolean {
  return /<input\b[^>]*\stype\s*=\s*(?:"password"|'password'|password)(?=[\s/>])/i.test(
    quitarRuidoHtml(html),
  )
}

function extensionNoNavegable(pathname: string): boolean {
  const ultimo = pathname.split("/").pop() ?? ""
  const punto = ultimo.lastIndexOf(".")
  if (punto <= 0 || punto === ultimo.length - 1) return false

  const extension = ultimo.slice(punto + 1).toLowerCase()
  return EXTENSIONES_NO_NAVEGABLES.has(extension)
}

function normalizarCabeceras(
  headers: CabecerasRespuesta,
): Record<string, string> {
  const resultado: Record<string, string> = {}
  if (!headers || typeof headers !== "object") return resultado

  for (const [clave, valor] of Object.entries(headers)) {
    const nombre = clave.toLowerCase()
    // No se aceptan cookies ni se devuelven al llamador.
    if (nombre === "set-cookie") continue
    if (valor === undefined) continue
    resultado[nombre] = Array.isArray(valor) ? valor.join(", ") : String(valor)
  }

  return resultado
}

function cabecerasAuditoria(
  headers: Record<string, string>,
): CabecerasAuditoria {
  return {
    hsts: headers["strict-transport-security"] !== undefined,
    csp: headers["content-security-policy"] !== undefined,
    xfo: headers["x-frame-options"] !== undefined,
    xcto: headers["x-content-type-options"] !== undefined,
    referrer: headers["referrer-policy"] !== undefined,
  }
}

function fallo(
  motivo: MotivoFalloWeb,
  redirects: string[],
  status: number | null = null,
): ResultadoWebError {
  return {
    ok: false,
    motivo,
    mensaje: MENSAJES_FALLO[motivo],
    status,
    redirigido: redirects.length > 0,
    redirects: [...redirects],
  }
}

function crearDeps(opciones: OpcionesFetchHtmlSeguro): DepsWeb {
  const reloj = opciones.reloj ?? (() => Date.now())

  const cacheRobots =
    opciones.cacheRobots ??
    (opciones.reloj === undefined
      ? cacheRobotsPorDefecto
      : crearCacheRobotsEnMemoria({ reloj }))

  return {
    transporte: opciones.transporte ?? transporteHttpReal,
    resolverDns: opciones.resolverDns ?? resolverDnsReal,
    cacheRobots,
    timeoutMs: enteroPositivo(opciones.timeoutMs, TIMEOUT_WEB_MS),
    maxBytes: enteroPositivo(opciones.maxBytes, MAX_BYTES_WEB),
    maxRedirecciones: enteroNoNegativo(
      opciones.maxRedirecciones,
      MAX_REDIRECCIONES_WEB,
    ),
    userAgent: opciones.userAgent ?? USER_AGENT_PROSPECT,
  }
}

/**
 * Descarga una pagina HTML publica aplicando el guard SSRF completo.
 *
 * El resultado `ok: true` trae el HTML, la URL final, status, cabeceras
 * normalizadas, booleanos de auditoria, tiempos y la cadena de redirecciones:
 * alcanza para que la auditoria interna (T-09) construya `AuditData` sin un
 * segundo fetch del home.
 *
 * El `lookup` de `SolicitudHttp` permite testear DNS rebinding: un transporte
 * falso puede invocarlo al "conectar" y comprobar que una IP privada se
 * rechaza aunque la pre-resolucion haya devuelto una publica.
 *
 * Para correr sin red, un test debe inyectar `transporte` Y `resolverDns`
 * (el default resuelve DNS real). Tambien puede inyectar `cacheRobots`; si
 * usa la cache compartida, conviene `limpiarCacheRobotsPorDefecto()` entre
 * casos. Robots se consulta antes de la pagina: el transporte falso debe
 * contemplar la request a `/robots.txt`.
 */
export async function fetchHtmlSeguro(
  url: string | null | undefined,
  opciones: OpcionesFetchHtmlSeguro = {},
): Promise<ResultadoWeb> {
  if (typeof url !== "string" || url.trim().length === 0) {
    return fallo("SIN_WEB", [])
  }

  const validada = validarEstructuraUrl(url)
  if (!validada.ok) return fallo(validada.motivo, [])

  if (esHostNoProspectable(validada.host)) {
    return fallo("FUENTE_NO_PERMITIDA", [])
  }
  if (esRutaLogin(validada.url)) return fallo("LOGIN", [])
  if (extensionNoNavegable(validada.url.pathname)) {
    return fallo("NO_HTML", [])
  }

  const deps = crearDeps(opciones)
  const dominioInicial = validada.dominio
  const redirects: string[] = []
  let actual = validada.url
  let saltos = 0
  let msPrevios = 0

  while (true) {
    const robots = await verificarRobots(actual, deps)
    if (!robots.ok) return fallo("ROBOTS", redirects)

    const descarga = await descargar(actual, deps, TIPOS_HTML, deps.maxBytes)
    if (!descarga.ok) return fallo(descarga.motivo, redirects)

    const { respuesta } = descarga
    const ubicacion = obtenerCabecera(respuesta.headers, "location")

    if (
      respuesta.status >= 300 &&
      respuesta.status < 400 &&
      ubicacion !== undefined
    ) {
      if (saltos >= deps.maxRedirecciones) {
        return fallo("REDIRECCIONES", redirects, respuesta.status)
      }

      const destino = resolverDestino(ubicacion, actual)
      if (destino === null) {
        return fallo("URL_INVALIDA", redirects, respuesta.status)
      }

      const destinoValidado = validarEstructuraUrl(destino)
      if (!destinoValidado.ok) {
        return fallo(destinoValidado.motivo, redirects, respuesta.status)
      }

      if (destinoValidado.dominio !== dominioInicial) {
        return fallo("DOMINIO_EXTERNO", redirects, respuesta.status)
      }
      if (esHostNoProspectable(destinoValidado.host)) {
        return fallo("FUENTE_NO_PERMITIDA", redirects, respuesta.status)
      }
      if (esRutaLogin(destinoValidado.url)) {
        return fallo("LOGIN", redirects, respuesta.status)
      }
      if (extensionNoNavegable(destinoValidado.url.pathname)) {
        return fallo("NO_HTML", redirects, respuesta.status)
      }

      redirects.push(destinoValidado.url.toString())
      saltos += 1
      msPrevios += tiempoSeguro(respuesta.totalMs)
      actual = destinoValidado.url
      continue
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      return fallo("HTTP", redirects, respuesta.status)
    }

    const cuerpo = comoBuffer(respuesta.cuerpo)

    if (cuerpo.byteLength > deps.maxBytes) {
      return fallo("TAMANIO", redirects, respuesta.status)
    }
    if (
      tieneCompresion(
        obtenerCabecera(respuesta.headers, "content-encoding"),
      ) ||
      (cuerpo.length >= 2 && cuerpo[0] === 0x1f && cuerpo[1] === 0x8b)
    ) {
      return fallo("ENCODING", redirects, respuesta.status)
    }

    const tipo = tipoContenido(
      obtenerCabecera(respuesta.headers, "content-type"),
    )
    if (!TIPOS_HTML.includes(tipo)) {
      return fallo("NO_HTML", redirects, respuesta.status)
    }

    const html = cuerpo.toString("utf8")
    if (contienePassword(html)) {
      return fallo("LOGIN", redirects, respuesta.status)
    }

    const headers = normalizarCabeceras(respuesta.headers)
    const ttfbMs = msPrevios + tiempoSeguro(respuesta.ttfbMs)
    const totalMs = msPrevios + tiempoSeguro(respuesta.totalMs)

    return {
      ok: true,
      html,
      finalUrl: actual.toString(),
      status: respuesta.status,
      headers,
      auditHeaders: cabecerasAuditoria(headers),
      ttfbMs,
      totalMs,
      redirigido: redirects.length > 0,
      redirects: [...redirects],
      https: actual.protocol === "https:",
      htmlKb: Math.round(cuerpo.byteLength / 1024),
    }
  }
}

// ---------------------------------------------------------------------------
// Descubrimiento de paginas de contacto
// ---------------------------------------------------------------------------

function extraerAtributo(etiqueta: string, nombre: string): string | null {
  const patron = new RegExp(
    `(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  )
  const match = patron.exec(etiqueta)
  if (!match) return null

  const valor = match[1] ?? match[2] ?? match[3] ?? ""
  return valor.trim()
}

function decodificarUrl(valor: string): string {
  return valor
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .trim()
}

function textoAncla(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

function claveUrl(url: URL): string {
  // La query no distingue una pagina de otra para el descubrimiento: evita
  // gastar uno de los dos cupos en variantes con parametros de tracking.
  const ruta = url.pathname.replace(/\/+$/, "") || "/"
  return `${url.protocol}//${url.host.toLowerCase()}${ruta}`
}

function puntuarEnlace(url: URL, texto: string): number {
  let ruta = url.pathname.toLowerCase()
  try {
    ruta = decodeURIComponent(ruta).toLowerCase()
  } catch {
    // Se usa la ruta cruda si el escape es invalido.
  }

  const contenido = texto.toLowerCase()
  let puntos = 0

  if (/contact|comunic|escribin|atencion|soporte|consulta/.test(ruta)) {
    puntos += 5
  } else if (
    /contact|comunic|escribin|atencion|soporte|consulta/.test(contenido)
  ) {
    puntos += 4
  }

  if (/nosotros|empresa|quienes-somos|about|equipo/.test(ruta)) {
    puntos += 2
  } else if (/nosotros|empresa|quienes-somos|about|equipo/.test(contenido)) {
    puntos += 1
  }

  const segmentos = ruta.split("/").filter((segmento) => segmento.length > 0)
  if (segmentos.length <= 2) puntos += 1

  return puntos
}

/**
 * Descubre hasta `maximo` paginas HTML del mismo dominio registrable que el
 * sitio, para buscar datos de contacto publicados. El tope absoluto es 2
 * (home + 2 paginas de contacto como maximo en el plan).
 *
 * Solo considera enlaces `<a href>` reales: descarta redes sociales,
 * subdominios externos, assets, PDFs, descargas, `mailto:`/`tel:`, fragmentos,
 * formularios (no se leen `<form>`) y rutas de login. Las paginas con indicios
 * de contacto se priorizan, sin romper el orden del documento en empates.
 */
export function descubrirPaginasContacto(
  html: string,
  pageUrl: string,
  maximo = 2,
): string[] {
  if (typeof html !== "string" || html.length === 0) return []

  const limite = Number.isFinite(maximo)
    ? Math.max(0, Math.min(2, Math.floor(maximo)))
    : 0
  if (limite === 0) return []

  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return []
  if (base.username.length > 0 || base.password.length > 0) return []

  const dominioBase = dominioRegistrable(base.hostname)
  if (dominioBase === null) return []

  const limpio = quitarRuidoHtml(html)
  const patronAncla = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
  const claveActual = claveUrl(base)
  const vistos = new Set<string>()
  const candidatos: Array<{ url: string; orden: number; puntos: number }> = []

  let orden = 0
  let match: RegExpExecArray | null

  while ((match = patronAncla.exec(limpio)) !== null) {
    const atributos = match[1] ?? ""
    if (/(?:^|\s)download(?:\s|=|>|$)/i.test(atributos)) continue

    const hrefCrudo = extraerAtributo(atributos, "href")
    if (hrefCrudo === null) continue

    const href = decodificarUrl(hrefCrudo)
    if (href.length === 0 || href.startsWith("#")) continue
    if (/^(?:mailto|tel|sms|whatsapp|skype|javascript|data|file|ftp):/i.test(href)) {
      continue
    }
    // Un href que solo agrega query/fragmento no es una pagina de contacto.
    if (href.startsWith("?") || href.startsWith("#")) continue

    let destino: URL
    try {
      destino = new URL(href, base)
    } catch {
      continue
    }

    if (destino.protocol !== "http:" && destino.protocol !== "https:") {
      continue
    }
    if (destino.username.length > 0 || destino.password.length > 0) continue
    if (destino.port !== "") continue

    const host = destino.hostname.toLowerCase().replace(/\.+$/, "")
    if (host.length === 0 || esIpLiteral(host) || isBlockedHost(host)) continue

    const dominio = dominioRegistrable(host)
    if (dominio === null || dominio !== dominioBase) continue
    if (esHostNoProspectable(host)) continue
    if (esRutaLogin(destino)) continue
    if (extensionNoNavegable(destino.pathname)) continue

    destino.hash = ""
    const clave = claveUrl(destino)
    if (clave === claveActual || vistos.has(clave)) continue

    vistos.add(clave)
    candidatos.push({
      url: destino.toString(),
      orden,
      puntos: puntuarEnlace(destino, textoAncla(match[2] ?? "")),
    })
    orden += 1
  }

  candidatos.sort(
    (a, b) => b.puntos - a.puntos || a.orden - b.orden,
  )

  return candidatos.slice(0, limite).map((candidato) => candidato.url)
}

// ---------------------------------------------------------------------------
// Extraccion de datos publicados
// ---------------------------------------------------------------------------

export interface DatosPublicadosWeb {
  nombre: string | null
  email: string | null
  emailFuenteUrl: string | null
  telefono: string | null
  fuenteUrl: string | null
}

function extraerTitulo(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  if (!match) return ""
  return (match[1] ?? "").trim()
}

function extraerOgSiteName(html: string): string {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? []

  for (const meta of metas) {
    const propiedad =
      extraerAtributo(meta, "property") ?? extraerAtributo(meta, "name")
    if (propiedad === null) continue
    if (propiedad.toLowerCase() !== "og:site_name") continue

    const contenido = extraerAtributo(meta, "content")
    if (contenido !== null && contenido.length > 0) return contenido
  }

  return ""
}

/**
 * Extrae solo datos publicados por el negocio: nombre comercial, email y
 * telefono. Reutiliza `extraerEmailPublicado` (mailto primero, luego texto
 * visible sin `<script>`/`<style>`), `extraerTelefonoPublicado` (solo `tel:`)
 * y `limpiarNombreNegocio` (title / og:site_name / host).
 *
 * No adivina emails por patron ni inventa datos: si la pagina no los publica,
 * devuelve `null`. El HTML se trata como texto no confiable; no se ejecuta ni
 * se interpretan instrucciones embebidas.
 */
export function extraerDatosPublicados(
  html: string,
  pageUrl: string,
): DatosPublicadosWeb {
  const vacio: DatosPublicadosWeb = {
    nombre: null,
    email: null,
    emailFuenteUrl: null,
    telefono: null,
    fuenteUrl: null,
  }

  if (typeof html !== "string" || typeof pageUrl !== "string") return vacio

  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return vacio
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return vacio
  if (url.username.length > 0 || url.password.length > 0) return vacio

  const limpio = quitarRuidoHtml(html)
  const nombrePorDefecto = limpiarNombreNegocio("", url.hostname)
  const candidatos = [extraerOgSiteName(limpio), extraerTitulo(limpio)]

  let nombre = nombrePorDefecto
  for (const candidato of candidatos) {
    if (candidato.length === 0) continue
    const calculado = limpiarNombreNegocio(candidato, url.hostname)
    if (calculado !== nombrePorDefecto) {
      nombre = calculado
      break
    }
  }

  const email = extraerEmailPublicado(html, pageUrl)
  const telefono = extraerTelefonoPublicado(html)

  return {
    nombre,
    email: email?.email ?? null,
    emailFuenteUrl: email?.fuenteUrl ?? null,
    telefono,
    fuenteUrl: url.toString(),
  }
}
