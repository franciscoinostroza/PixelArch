import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildFindings, computeScores } from "@/lib/audit"
import { analizarHtmlAudit } from "@/lib/audit-server"
import {
  AUDITORIA_TTL_MS,
  auditarPagina,
  auditarSitio,
  auditoriaVigente,
  resumenTlsFallido,
  type AuditoriaResumen,
} from "@/lib/propuestas/auditoria"
import {
  ErrorCargaWeb,
  crearCacheRobotsEnMemoria,
  type OpcionesFetchHtmlSeguro,
  type RespuestaHttp,
  type ResultadoWebOk,
  type SolicitudHttp,
  type TransporteHttp,
} from "@/lib/propuestas/web"

/**
 * T-09 (AC-20; RF-31, RF-32): auditoria interna del portal de propuestas.
 *
 * Cubre:
 * - `auditarPagina` reutiliza el HTML/cabeceras/tiempos recibidos sin fetch,
 *   con resumen serializable sin HTML/cabeceras/cookies/certificado y fecha
 *   ISO UTC.
 * - Hallazgos sinteticos `SIN_HTTPS`/`TLS_INVALIDO` con `ssl: 0`; un
 *   certificado inyectado nunca desactiva la validacion TLS.
 * - `auditarSitio` con transporte/DNS/cache inyectados: exito y fallos
 *   (DNS/robots/timeout/HTTP) con `FALLIDA`, scores null y motivo saneado.
 * - Nunca se llama a `/api/audit` ni al `fetch` global.
 * - `auditoriaVigente` (24 h exactas, vencida, futura, invalida).
 * - Estatico: `auditoria.ts` no toca Prisma/CRM ni `process.env`;
 *   `audit-server.ts` es server-only y no importa la ruta publica.
 */

const FECHA_FIJA = new Date("2026-11-12T15:30:00.000Z")

const HTML_PAGINA = [
  "<!doctype html>",
  '<html lang="es">',
  "<head>",
  "<title>Negocio Ejemplo</title>",
  '<meta name="description" content="Servicios profesionales">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="HTML_SECRETO_MARCADOR" content="HTML_SECRETO_MARCADOR">',
  "</head>",
  "<body>",
  "<h1>Hola</h1>",
  '<img src="/logo.png" alt="Logo">',
  "</body></html>",
].join("")

const HTML_SITIO_DESCARGADO = [
  "<!doctype html>",
  '<html lang="es">',
  "<head>",
  "<title>Negocio Descargado</title>",
  '<meta name="description" content="Contenido obtenido por fetchHtmlSeguro">',
  '<meta name="viewport" content="width=device-width">',
  "</head>",
  "<body><h1>Bienvenido</h1></body></html>",
].join("")

function resultadoOk(overrides: Partial<ResultadoWebOk> = {}): ResultadoWebOk {
  return {
    ok: true,
    html: HTML_PAGINA,
    finalUrl: "https://negocio-ejemplo.com/",
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "strict-transport-security": "max-age=31536000",
      "x-cabecera-cruda": "CABECERA_SECRETA",
      "set-cookie": "cookie=secreta",
    },
    auditHeaders: {
      hsts: true,
      csp: false,
      xfo: false,
      xcto: true,
      referrer: false,
    },
    ttfbMs: 120,
    totalMs: 480,
    redirigido: false,
    redirects: [],
    https: true,
    htmlKb: 2,
    ...overrides,
  }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async (entrada: unknown) => {
    throw new Error(`fetch global inesperado: ${String(entrada)}`)
  })
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function clavesResumen(resumen: AuditoriaResumen): string[] {
  return Object.keys(resumen).sort()
}

const CLAVES_RESUMEN = [
  "estado",
  "fecha",
  "finalUrl",
  "findings",
  "motivo",
  "scores",
]

describe("auditarPagina (AC-20) — reutiliza el fetch del analisis", () => {
  it("usa el HTML/cabeceras/tiempos recibidos y no hace fetch", async () => {
    const cert = vi.fn(async () => 75)
    const resultado = resultadoOk()

    const resumen = await auditarPagina(resultado, {
      certDaysLeft: cert,
      ahora: () => FECHA_FIJA,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(cert).toHaveBeenCalledTimes(1)
    expect(cert).toHaveBeenCalledWith("negocio-ejemplo.com")

    const data = analizarHtmlAudit({
      html: resultado.html,
      finalUrl: resultado.finalUrl,
      status: resultado.status,
      redirects: resultado.redirigido,
      ttfbMs: resultado.ttfbMs,
      totalMs: resultado.totalMs,
      https: resultado.https,
      headers: resultado.auditHeaders,
      certDaysLeft: 75,
    })

    expect(resumen.estado).toBe("OK")
    expect(resumen.finalUrl).toBe("https://negocio-ejemplo.com/")
    expect(resumen.motivo).toBeNull()
    expect(resumen.scores).toEqual(computeScores(data))
    expect(resumen.findings).toEqual(buildFindings(data))
  })

  it("guarda un resumen serializable con solo las claves permitidas", async () => {
    const resumen = await auditarPagina(resultadoOk(), {
      certDaysLeft: async () => 75,
      ahora: () => FECHA_FIJA,
    })

    expect(clavesResumen(resumen)).toEqual(CLAVES_RESUMEN)

    const serializado = JSON.stringify(resumen)
    expect(() => JSON.parse(serializado)).not.toThrow()
    expect(serializado).not.toContain("HTML_SECRETO_MARCADOR")
    expect(serializado).not.toContain("CABECERA_SECRETA")
    expect(serializado).not.toContain("cookie=secreta")
    expect(serializado).not.toContain("set-cookie")
    expect(serializado).not.toContain("valid_to")
    expect(serializado).not.toContain("BEGIN CERTIFICATE")
    expect(resumen).not.toHaveProperty("headers")
    expect(resumen).not.toHaveProperty("html")
  })

  it("guarda la fecha como ISO 8601 UTC", async () => {
    const resumen = await auditarPagina(resultadoOk(), {
      certDaysLeft: async () => 75,
      ahora: () => FECHA_FIJA,
    })

    expect(resumen.fecha).toBe("2026-11-12T15:30:00.000Z")
    expect(resumen.fecha.endsWith("Z")).toBe(true)
    expect(Number.isNaN(Date.parse(resumen.fecha))).toBe(false)
  })

  it("agrega SIN_HTTPS y deja ssl 0 cuando el sitio es HTTP", async () => {
    const cert = vi.fn(async () => 90)
    const resultado = resultadoOk({
      https: false,
      finalUrl: "http://negocio-ejemplo.com/",
    })

    const resumen = await auditarPagina(resultado, {
      certDaysLeft: cert,
      ahora: () => FECHA_FIJA,
    })

    expect(cert).not.toHaveBeenCalled()
    expect(resumen.estado).toBe("OK")
    expect(resumen.scores?.ssl).toBe(0)
    expect(resumen.findings[0]).toMatchObject({
      type: "fail",
      codigo: "SIN_HTTPS",
    })
    expect(resumen.findings[0].text).toContain("SIN_HTTPS")

    const data = analizarHtmlAudit({
      html: resultado.html,
      finalUrl: resultado.finalUrl,
      status: resultado.status,
      redirects: resultado.redirigido,
      ttfbMs: resultado.ttfbMs,
      totalMs: resultado.totalMs,
      https: false,
      headers: resultado.auditHeaders,
      certDaysLeft: null,
    })
    expect(resumen.findings.slice(1)).toEqual(buildFindings(data))
    expect(resumen.scores).toEqual({ ...computeScores(data), ssl: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("HTTPS sin certificado valido: FALLIDA con motivo TLS, TLS_INVALIDO y ssl 0", async () => {
    const resumen = await auditarPagina(resultadoOk(), {
      certDaysLeft: async () => null,
      ahora: () => FECHA_FIJA,
    })

    expect(resumen.estado).toBe("FALLIDA")
    expect(resumen.motivo).toBe("TLS")
    expect(resumen.scores?.ssl).toBe(0)
    expect(resumen.findings[0]).toMatchObject({
      type: "fail",
      codigo: "TLS_INVALIDO",
    })
    expect(resumen.findings[0].text).toContain("TLS_INVALIDO")
    expect(resumen.finalUrl).toBe("https://negocio-ejemplo.com/")
  })

  it("un helper TLS que lanza o devuelve NaN no desactiva la validacion y deja FALLIDA", async () => {
    const lanza = await auditarPagina(resultadoOk(), {
      certDaysLeft: async () => {
        throw new Error("handshake roto")
      },
      ahora: () => FECHA_FIJA,
    })
    expect(lanza.estado).toBe("FALLIDA")
    expect(lanza.motivo).toBe("TLS")
    expect(lanza.findings[0]).toMatchObject({ codigo: "TLS_INVALIDO" })
    expect(lanza.scores?.ssl).toBe(0)

    const nan = await auditarPagina(resultadoOk(), {
      certDaysLeft: async () => Number.NaN,
      ahora: () => FECHA_FIJA,
    })
    expect(nan.estado).toBe("FALLIDA")
    expect(nan.motivo).toBe("TLS")
    expect(nan.findings[0]).toMatchObject({ codigo: "TLS_INVALIDO" })
    expect(nan.scores?.ssl).toBe(0)

    // El helper solo recibe el hostname: no puede cambiar opciones de TLS.
    const cert = vi.fn(async () => null)
    await auditarPagina(resultadoOk(), { certDaysLeft: cert })
    expect(cert.mock.calls[0]).toEqual(["negocio-ejemplo.com"])
  })

  it("resumenTlsFallido deja un resumen sintetico saneado sin HTML ni certificado (AC-20)", () => {
    const resumen = resumenTlsFallido(
      "https://negocio-ejemplo.com/",
      () => FECHA_FIJA,
    )

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: "https://negocio-ejemplo.com/",
      scores: null,
      findings: [
        {
          type: "fail",
          codigo: "TLS_INVALIDO",
          text: expect.stringContaining("TLS_INVALIDO"),
        },
      ],
      motivo: "TLS",
    })
    expect(clavesResumen(resumen)).toEqual(CLAVES_RESUMEN)
    expect(JSON.stringify(resumen)).not.toContain("BEGIN CERTIFICATE")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("un HTML vacio o roto no lanza y devuelve un resumen serializable (AC-20)", async () => {
    const resumen = await auditarPagina(
      resultadoOk({
        html: "",
        finalUrl: "https://negocio-ejemplo.com/",
        https: true,
      }),
      { certDaysLeft: async () => 30, ahora: () => FECHA_FIJA },
    )

    expect(resumen.estado).toBe("OK")
    expect(clavesResumen(resumen)).toEqual(CLAVES_RESUMEN)
    expect(resumen.scores).not.toBeNull()
    expect(JSON.stringify(resumen)).not.toContain("BEGIN CERTIFICATE")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("con certificado valido no agrega hallazgos sinteticos y respeta scores", async () => {
    const resultado = resultadoOk()
    const resumen = await auditarPagina(resultado, {
      certDaysLeft: async () => 90,
      ahora: () => FECHA_FIJA,
    })

    expect(resumen.findings.some((hallazgo) => hallazgo.codigo)).toBe(false)
    expect(resumen.scores?.ssl).toBe(100)

    const data = analizarHtmlAudit({
      html: resultado.html,
      finalUrl: resultado.finalUrl,
      status: resultado.status,
      redirects: resultado.redirigido,
      ttfbMs: resultado.ttfbMs,
      totalMs: resultado.totalMs,
      https: true,
      headers: resultado.auditHeaders,
      certDaysLeft: 90,
    })
    expect(resumen.findings).toEqual(buildFindings(data))
    expect(resumen.scores).toEqual(computeScores(data))
  })
})

// ---------------------------------------------------------------------------
// auditarSitio con transporte/DNS/cache inyectados
// ---------------------------------------------------------------------------

interface SitioFalso {
  transporte: TransporteHttp
  llamadas: SolicitudHttp[]
}

function respuestaPagina(
  html: string,
  status = 200,
  headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
  },
): RespuestaHttp {
  return {
    status,
    headers,
    cuerpo: html,
    ttfbMs: 90,
    totalMs: 250,
  }
}

function crearSitioFalso(opciones: {
  robots?: string | RespuestaHttp
  pagina?: RespuestaHttp | ((solicitud: SolicitudHttp) => RespuestaHttp)
}): SitioFalso {
  const llamadas: SolicitudHttp[] = []

  const transporte: TransporteHttp = async (solicitud) => {
    llamadas.push(solicitud)

    if (solicitud.tiposPermitidos.includes("")) {
      if (opciones.robots === undefined) {
        return {
          status: 404,
          headers: {},
          cuerpo: "",
          ttfbMs: 1,
          totalMs: 1,
        }
      }
      if (typeof opciones.robots === "string") {
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          cuerpo: opciones.robots,
          ttfbMs: 1,
          totalMs: 1,
        }
      }
      return opciones.robots
    }

    if (opciones.pagina === undefined) {
      throw new Error("pagina falsa no configurada")
    }
    return typeof opciones.pagina === "function"
      ? opciones.pagina(solicitud)
      : opciones.pagina
  }

  return { transporte, llamadas }
}

function opcionesFetch(sitio: SitioFalso): OpcionesFetchHtmlSeguro {
  return {
    transporte: sitio.transporte,
    resolverDns: async () => [{ address: "93.184.216.34", family: 4 }],
    cacheRobots: crearCacheRobotsEnMemoria(),
  }
}

describe("auditarSitio (AC-20) — exito y fallos saneados", () => {
  it("usa el HTML descargado por fetchHtmlSeguro y no llama a /api/audit", async () => {
    const sitio = crearSitioFalso({ pagina: respuestaPagina(HTML_SITIO_DESCARGADO) })

    const resumen = await auditarSitio("https://negocio-ejemplo.com/", {
      fetch: opcionesFetch(sitio),
      certDaysLeft: async () => 120,
      ahora: () => FECHA_FIJA,
    })

    expect(resumen.estado).toBe("OK")
    expect(resumen.finalUrl).toBe("https://negocio-ejemplo.com/")
    expect(resumen.motivo).toBeNull()
    expect(resumen.scores).not.toBeNull()
    expect(resumen.findings.some((f) => f.text.includes("Negocio Descargado"))).toBe(
      true,
    )
    expect(sitio.llamadas).toHaveLength(2) // robots.txt + home
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fallo DNS: FALLIDA, scores null, findings vacios y motivo DNS", async () => {
    const sitio = crearSitioFalso({})

    const resumen = await auditarSitio("https://sitio-fallido.com/", {
      fetch: {
        transporte: sitio.transporte,
        resolverDns: async () => {
          throw new Error("ENOTFOUND")
        },
        cacheRobots: crearCacheRobotsEnMemoria(),
      },
      ahora: () => FECHA_FIJA,
    })

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: null,
      scores: null,
      findings: [],
      motivo: "DNS",
    })
    expect(sitio.llamadas).toHaveLength(0)
    expect(JSON.stringify(resumen)).not.toContain("sitio-fallido.com")
  })

  it("fallo por robots: FALLIDA con motivo ROBOTS y sin pedir la pagina", async () => {
    const sitio = crearSitioFalso({
      robots: "User-agent: *\nDisallow: /",
      pagina: respuestaPagina(HTML_SITIO_DESCARGADO),
    })

    const resumen = await auditarSitio("https://sitio-fallido.com/", {
      fetch: opcionesFetch(sitio),
      ahora: () => FECHA_FIJA,
    })

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: null,
      scores: null,
      findings: [],
      motivo: "ROBOTS",
    })
    expect(sitio.llamadas).toHaveLength(1)
    expect(JSON.stringify(resumen)).not.toContain("sitio-fallido.com")
  })

  it("fallo por timeout: FALLIDA con motivo TIMEOUT", async () => {
    const sitio = crearSitioFalso({
      pagina: () => {
        throw new ErrorCargaWeb("TIMEOUT")
      },
    })

    const resumen = await auditarSitio("https://sitio-fallido.com/", {
      fetch: opcionesFetch(sitio),
      ahora: () => FECHA_FIJA,
    })

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: null,
      scores: null,
      findings: [],
      motivo: "TIMEOUT",
    })
    expect(JSON.stringify(resumen)).not.toContain("sitio-fallido.com")
  })

  it("fallo TLS del transporte: FALLIDA con motivo TLS y sin resumen sintetico (AC-20)", async () => {
    const sitio = crearSitioFalso({
      pagina: () => {
        throw new ErrorCargaWeb("TLS")
      },
    })

    const resumen = await auditarSitio("https://sitio-fallido.com/", {
      fetch: opcionesFetch(sitio),
      certDaysLeft: async () => 90,
      ahora: () => FECHA_FIJA,
    })

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: null,
      scores: null,
      findings: [],
      motivo: "TLS",
    })
    expect(JSON.stringify(resumen)).not.toContain("sitio-fallido.com")
    expect(JSON.stringify(resumen)).not.toContain("BEGIN CERTIFICATE")
  })

  it("fallo HTTP: FALLIDA con motivo HTTP", async () => {
    const sitio = crearSitioFalso({
      pagina: respuestaPagina("error interno", 500),
    })

    const resumen = await auditarSitio("https://sitio-fallido.com/", {
      fetch: opcionesFetch(sitio),
      ahora: () => FECHA_FIJA,
    })

    expect(resumen).toEqual({
      estado: "FALLIDA",
      fecha: FECHA_FIJA.toISOString(),
      finalUrl: null,
      scores: null,
      findings: [],
      motivo: "HTTP",
    })
    expect(sitio.llamadas).toHaveLength(2) // robots.txt + pagina
    expect(JSON.stringify(resumen)).not.toContain("sitio-fallido.com")
  })

  it("nunca llama al fetch global ni a una URL con /api/audit", async () => {
    const sitio = crearSitioFalso({ pagina: respuestaPagina(HTML_SITIO_DESCARGADO) })

    await auditarPagina(resultadoOk(), { certDaysLeft: async () => 90 })
    await auditarSitio("https://negocio-ejemplo.com/", {
      fetch: opcionesFetch(sitio),
      certDaysLeft: async () => 90,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    const urls = fetchSpy.mock.calls.map(([entrada]) => String(entrada))
    expect(urls.every((url) => !url.includes("/api/audit"))).toBe(true)
  })
})

describe("auditoriaVigente (AC-20) — una auditoria por prospecto/24 h", () => {
  const ahora = new Date("2026-11-12T12:00:00.000Z")

  it("acepta una fecha reciente y rechaza las 24 h exactas", () => {
    expect(AUDITORIA_TTL_MS).toBe(86_400_000)
    expect(
      auditoriaVigente(new Date(ahora.getTime() - 60 * 60 * 1000), ahora),
    ).toBe(true)
    expect(
      auditoriaVigente(new Date(ahora.getTime() - AUDITORIA_TTL_MS + 1), ahora),
    ).toBe(true)
    expect(
      auditoriaVigente(new Date(ahora.getTime() - AUDITORIA_TTL_MS), ahora),
    ).toBe(false)
  })

  it("rechaza fechas vencidas, futuras, invalidas o nulas", () => {
    expect(
      auditoriaVigente(new Date(ahora.getTime() - 25 * 60 * 60 * 1000), ahora),
    ).toBe(false)
    expect(
      auditoriaVigente(new Date(ahora.getTime() + 60 * 60 * 1000), ahora),
    ).toBe(false)
    expect(auditoriaVigente(new Date("no-es-fecha"), ahora)).toBe(false)
    expect(auditoriaVigente(null, ahora)).toBe(false)
    expect(auditoriaVigente(undefined, ahora)).toBe(false)
    expect(auditoriaVigente("", ahora)).toBe(false)
  })

  it("acepta fechas ISO/numericas validas y un TTL custom", () => {
    expect(
      auditoriaVigente("2026-11-12T11:59:30.000Z", ahora, 60_000),
    ).toBe(true)
    expect(auditoriaVigente(ahora.getTime() - 30_000, ahora, 60_000)).toBe(true)
    expect(auditoriaVigente(ahora.getTime() - 90_000, ahora, 60_000)).toBe(false)
  })

  it("falla cerrado con un TTL invalido", () => {
    expect(auditoriaVigente(ahora, ahora, 0)).toBe(false)
    expect(auditoriaVigente(ahora, ahora, -1)).toBe(false)
    expect(auditoriaVigente(ahora, ahora, Number.NaN)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Estatico: aislamiento del modulo
// ---------------------------------------------------------------------------

function leerFuente(relativa: string): string {
  return readFileSync(path.join(process.cwd(), relativa), "utf8")
}

function importsDe(fuente: string): string[] {
  return Array.from(fuente.matchAll(/from\s+["']([^"']+)["']/g), (m) => m[1])
}

describe("auditoria.ts — aislamiento (AC-20)", () => {
  it("no importa Prisma ni modulos del CRM y no lee process.env", () => {
    const fuente = leerFuente("src/lib/propuestas/auditoria.ts")
    const imports = importsDe(fuente)

    expect(imports).toContain("@/lib/audit-server")
    expect(
      imports.some((modulo) =>
        /prisma|@\/lib\/(?:pagos|clientes|cobros)|crm/i.test(modulo),
      ),
    ).toBe(false)
    expect(fuente).not.toContain("prisma.")
    expect(fuente).not.toContain("process.env")
  })

  it("no llama al endpoint publico /api/audit", () => {
    const fuente = leerFuente("src/lib/propuestas/auditoria.ts")
    expect(fuente).not.toContain("/api/audit")
    expect(fuente).not.toContain("globalThis.fetch")
  })
})

describe("audit-server.ts — server-only (AC-20)", () => {
  it("importa node:tls y no depende de la ruta publica ni de Next", () => {
    const fuente = leerFuente("src/lib/audit-server.ts")
    const imports = importsDe(fuente)

    expect(imports).toContain("node:tls")
    expect(imports).toContain("node:buffer")
    expect(
      imports.some(
        (modulo) =>
          modulo.startsWith("@/app") ||
          modulo.startsWith("next/") ||
          modulo.includes("api/audit"),
      ),
    ).toBe(false)
    expect(fuente).not.toContain('"use client"')
    expect(imports.some((modulo) => /prisma/i.test(modulo))).toBe(false)
  })
})
