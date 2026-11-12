import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildFindings,
  computeScores,
  type AuditData,
  type AuditFinding,
  type AuditScores,
} from "@/lib/audit"
import {
  TLS_TIMEOUT_MS,
  analizarHtmlAudit,
  auditHeadersDesdeHeaders,
  certDaysLeft,
  type CabecerasAudit,
  type CertificadoTls,
  type FabricaSocketTls,
  type OpcionesConexionTls,
  type SocketTls,
} from "@/lib/audit-server"
import { POST } from "@/app/api/audit/route"

/**
 * T-09 (AC-20; RF-31, RF-32): extraccion server-side de la auditoria.
 *
 * Cubre:
 * - `analizarHtmlAudit` como regresion exacta de `AuditData` (mismas regexes,
 *   limites y criterios que usaba `/api/audit`) y de `computeScores` /
 *   `buildFindings` de `@/lib/audit`.
 * - `auditHeadersDesdeHeaders` con `Headers` reales.
 * - `certDaysLeft` con socket TLS falso inyectado (sin red): exito, ausente,
 *   fecha invalida, error, deadline duro y `getPeerCertificate` que lanza.
 * - La ruta publica `/api/audit` sin red: fetch mockeado, IPs unicas por caso,
 *   200/400/429/502, forma de la respuesta, UA y timeout de 12 s.
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const HTML_REGRESION = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <title>   Mi    Negocio
      | Inicio   </title>
  <meta name="description" content="  Descripción   del negocio  ">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <h1>Bienvenido</h1>
  <img src="/logo.png" alt="Logo">
  <img src="/foto.png">
  <img src="/icono.png" alt="">
</body>
</html>`

const CABECERAS_BASE: CabecerasAudit = {
  hsts: true,
  csp: true,
  xfo: false,
  xcto: true,
  referrer: false,
}

describe("analizarHtmlAudit (AC-20) — regresion exacta de AuditData", () => {
  it("reproduce el AuditData historico completo de la ruta publica", () => {
    const entrada = {
      html: HTML_REGRESION,
      finalUrl: "https://negocio-ejemplo.com/inicio",
      status: 200,
      redirects: true,
      ttfbMs: 180,
      totalMs: 640,
      https: true,
      headers: CABECERAS_BASE,
      certDaysLeft: 45,
    }

    const esperado: AuditData = {
      finalUrl: "https://negocio-ejemplo.com/inicio",
      status: 200,
      redirects: true,
      ttfbMs: 180,
      totalMs: 640,
      htmlKb: Math.round(Buffer.byteLength(HTML_REGRESION, "utf8") / 1024),
      title: "Mi Negocio | Inicio",
      metaDescription: "Descripción   del negocio",
      hasViewport: true,
      h1Count: 1,
      lang: "es-AR",
      imgCount: 3,
      imgNoAlt: 2,
      https: true,
      certDaysLeft: 45,
      headers: { hsts: true, csp: true, xfo: false, xcto: true, referrer: false },
    }

    const data = analizarHtmlAudit(entrada)

    expect(data).toEqual(esperado)
    // La ruta publica sigue calculando scores/findings con las funciones puras.
    expect(computeScores(data)).toEqual(computeScores(esperado))
    expect(buildFindings(data)).toEqual(buildFindings(esperado))
  })

  it("colapsa espacios del titulo, lo recorta a 120 y devuelve null si queda vacio", () => {
    const conEspacios = analizarHtmlAudit({
      html: "<html><head><title>  Hola \n  mundo  </title></head></html>",
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    })
    expect(conEspacios.title).toBe("Hola mundo")

    const largo = analizarHtmlAudit({
      html: `<html><head><title>  ${"a".repeat(200)}  </title></head></html>`,
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    })
    expect(largo.title).toHaveLength(120)

    const vacio = analizarHtmlAudit({
      html: "<html><head><title>   </title></head></html>",
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    })
    expect(vacio.title).toBeNull()

    const sinTitulo = analizarHtmlAudit({
      html: "<html><head></head></html>",
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    })
    expect(sinTitulo.title).toBeNull()
  })

  it("lee la meta description en ambos ordenes de atributos y la recorta a 200", () => {
    const base = {
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    }

    const nombrePrimero = analizarHtmlAudit({
      ...base,
      html: '<html><head><meta name="description" content="Primera"></head></html>',
    })
    expect(nombrePrimero.metaDescription).toBe("Primera")

    const contentPrimero = analizarHtmlAudit({
      ...base,
      html: "<html><head><meta content='Segunda' name='description'></head></html>",
    })
    expect(contentPrimero.metaDescription).toBe("Segunda")

    const recortada = analizarHtmlAudit({
      ...base,
      html: `<html><head><meta name="description" content="${"b".repeat(250)}"></head></html>`,
    })
    expect(recortada.metaDescription).toHaveLength(200)

    const vacia = analizarHtmlAudit({
      ...base,
      html: '<html><head><meta name="description" content="   "></head></html>',
    })
    expect(vacia.metaDescription).toBeNull()

    const ausente = analizarHtmlAudit({ ...base, html: "<html><head></head></html>" })
    expect(ausente.metaDescription).toBeNull()
  })

  it("cuenta viewport, H1, lang e imagenes con los mismos criterios historicos", () => {
    const base = {
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    }

    const sinNada = analizarHtmlAudit({ ...base, html: "<html><body></body></html>" })
    expect(sinNada.hasViewport).toBe(false)
    expect(sinNada.h1Count).toBe(0)
    expect(sinNada.lang).toBeNull()
    expect(sinNada.imgCount).toBe(0)
    expect(sinNada.imgNoAlt).toBe(0)

    const varios = analizarHtmlAudit({
      ...base,
      html: [
        '<html lang="en">',
        "<head>",
        '<meta name="viewport" content="width=device-width">',
        "</head>",
        "<body>",
        "<h1>Uno</h1><h1 class=\"x\">Dos</h1><H1>Tres</H1>",
        '<img src="a" alt="ok">',
        '<img src="b">',
        '<img src="c" ALT="tambien ok">',
        '<img src="d" alt="">',
        "</body></html>",
      ].join(""),
    })
    expect(varios.hasViewport).toBe(true)
    expect(varios.h1Count).toBe(3)
    expect(varios.lang).toBe("en")
    expect(varios.imgCount).toBe(4)
    // "b" no tiene alt y "d" lo tiene vacio: ambos cuentan como faltante.
    expect(varios.imgNoAlt).toBe(2)
  })

  it("calcula htmlKb sobre los bytes UTF-8, no sobre la longitud JS", () => {
    // 520 emojis: 4 bytes UTF-8 cada uno (2080 bytes -> 2 KB), pero 1040
    // unidades UTF-16 (-> 1 si se usara `html.length / 1024`).
    const html = "😀".repeat(520)
    const data = analizarHtmlAudit({
      html,
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    })
    expect(Buffer.byteLength(html, "utf8")).toBe(2080)
    expect(html.length).toBe(1040)
    expect(data.htmlKb).toBe(2)
  })

  it("deriva https de finalUrl cuando no se indica y conserva los valores explicitos", () => {
    const base = {
      html: "<html></html>",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    }

    const httpsDerivado = analizarHtmlAudit({
      ...base,
      finalUrl: "https://ejemplo.com/",
    })
    expect(httpsDerivado.https).toBe(true)
    expect(httpsDerivado.certDaysLeft).toBeNull()

    const httpDerivado = analizarHtmlAudit({
      ...base,
      finalUrl: "http://ejemplo.com/",
    })
    expect(httpDerivado.https).toBe(false)

    const explicito = analizarHtmlAudit({
      ...base,
      finalUrl: "https://ejemplo.com/",
      https: false,
      certDaysLeft: 0,
    })
    expect(explicito.https).toBe(false)
    expect(explicito.certDaysLeft).toBe(0)
  })

  it("asume cabeceras ausentes cuando no se entregan y copia las booleanas", () => {
    const base = {
      html: "<html></html>",
      finalUrl: "https://ejemplo.com/",
      status: 200,
      redirects: false,
      ttfbMs: 10,
      totalMs: 20,
    }

    expect(analizarHtmlAudit(base).headers).toEqual({
      hsts: false,
      csp: false,
      xfo: false,
      xcto: false,
      referrer: false,
    })

    expect(
      analizarHtmlAudit({ ...base, headers: CABECERAS_BASE }).headers,
    ).toEqual(CABECERAS_BASE)
  })

  it("transmite status, tiempos, redirects y finalUrl sin transformarlos", () => {
    const data = analizarHtmlAudit({
      html: "<html></html>",
      finalUrl: "https://ejemplo.com/final",
      status: 301,
      redirects: true,
      ttfbMs: 123,
      totalMs: 456,
    })
    expect(data.finalUrl).toBe("https://ejemplo.com/final")
    expect(data.status).toBe(301)
    expect(data.redirects).toBe(true)
    expect(data.ttfbMs).toBe(123)
    expect(data.totalMs).toBe(456)
  })
})

describe("auditHeadersDesdeHeaders (AC-20)", () => {
  it("traduce Headers reales y es case-insensitive", () => {
    const headers = new Headers({
      "Strict-Transport-Security": "max-age=31536000",
      "Content-Security-Policy": "default-src 'self'",
      "X-Content-Type-Options": "nosniff",
    })
    expect(auditHeadersDesdeHeaders(headers)).toEqual({
      hsts: true,
      csp: true,
      xfo: false,
      xcto: true,
      referrer: false,
    })
  })

  it("devuelve todo false con Headers vacias", () => {
    expect(auditHeadersDesdeHeaders(new Headers())).toEqual({
      hsts: false,
      csp: false,
      xfo: false,
      xcto: false,
      referrer: false,
    })
  })
})

// ---------------------------------------------------------------------------
// certDaysLeft con socket TLS falso (sin red)
// ---------------------------------------------------------------------------

type EventoTls = "secureConnect" | "error" | "timeout"

interface SocketFalso {
  socket: SocketTls
  estado: { terminado: boolean; destruido: boolean }
  emitir(evento: EventoTls): void
}

function crearSocketFalso(opciones: {
  cert?: CertificadoTls | null
  lanzarEnCertificado?: boolean
} = {}): SocketFalso {
  const listeners: Record<string, Array<() => void>> = {}
  const estado = { terminado: false, destruido: false }

  const socket: SocketTls = {
    getPeerCertificate() {
      if (opciones.lanzarEnCertificado) {
        throw new Error("getPeerCertificate fallo")
      }
      return opciones.cert ?? null
    },
    end() {
      estado.terminado = true
    },
    destroy() {
      estado.destruido = true
    },
    on(evento, listener) {
      const lista = listeners[evento] ?? []
      lista.push(listener)
      listeners[evento] = lista
      return socket
    },
  }

  return {
    socket,
    estado,
    emitir(evento) {
      for (const listener of listeners[evento] ?? []) listener()
    },
  }
}

function fabricaCon(
  socket: SocketTls,
  capturadas: OpcionesConexionTls[] = [],
): FabricaSocketTls {
  return (opciones) => {
    capturadas.push(opciones)
    return socket
  }
}

describe("certDaysLeft (AC-20) — socket TLS inyectado, sin red", () => {
  it("calcula los dias restantes con reloj inyectado y cierra el socket", async () => {
    const falso = crearSocketFalso({
      cert: { valid_to: "2030-01-11T00:00:00.000Z" },
    })
    const capturadas: OpcionesConexionTls[] = []

    const promesa = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket, capturadas),
      ahora: () => Date.UTC(2030, 0, 1, 0, 0, 0),
      timeoutMs: 1_000,
    })
    falso.emitir("secureConnect")

    await expect(promesa).resolves.toBe(10)
    expect(falso.estado.terminado).toBe(true)
    expect(falso.estado.destruido).toBe(false)
    expect(capturadas).toEqual([
      {
        host: "negocio-ejemplo.com",
        port: 443,
        servername: "negocio-ejemplo.com",
        timeout: 1_000,
      },
    ])
    // El socket inyectado no recibe ninguna opcion que desactive la validacion.
    expect("rejectUnauthorized" in capturadas[0]).toBe(false)
  })

  it("usa el timeout de 6 s cuando el valor inyectado no es valido", async () => {
    const falso = crearSocketFalso({
      cert: { valid_to: "2030-01-11T00:00:00.000Z" },
    })
    const capturadas: OpcionesConexionTls[] = []

    const promesa = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket, capturadas),
      ahora: () => Date.UTC(2030, 0, 1),
      timeoutMs: 0,
    })
    falso.emitir("secureConnect")
    await expect(promesa).resolves.toBe(10)

    expect(TLS_TIMEOUT_MS).toBe(6_000)
    expect(capturadas[0].timeout).toBe(TLS_TIMEOUT_MS)
  })

  it("devuelve null si el certificado esta ausente o sin valid_to", async () => {
    const sinCert = crearSocketFalso({ cert: null })
    const promesaSinCert = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(sinCert.socket),
    })
    sinCert.emitir("secureConnect")
    await expect(promesaSinCert).resolves.toBeNull()
    expect(sinCert.estado.terminado).toBe(true)

    const sinFecha = crearSocketFalso({ cert: {} })
    const promesaSinFecha = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(sinFecha.socket),
    })
    sinFecha.emitir("secureConnect")
    await expect(promesaSinFecha).resolves.toBeNull()
  })

  it("devuelve null ante una fecha de vencimiento invalida", async () => {
    const falso = crearSocketFalso({ cert: { valid_to: "no-es-una-fecha" } })
    const promesa = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket),
    })
    falso.emitir("secureConnect")
    await expect(promesa).resolves.toBeNull()
  })

  it("devuelve null si getPeerCertificate lanza", async () => {
    const falso = crearSocketFalso({ lanzarEnCertificado: true })
    const promesa = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket),
    })
    falso.emitir("secureConnect")
    await expect(promesa).resolves.toBeNull()
  })

  it("devuelve null ante un error de conexion", async () => {
    const falso = crearSocketFalso()
    const promesa = certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket),
      timeoutMs: 1_000,
    })
    falso.emitir("error")
    await expect(promesa).resolves.toBeNull()
    expect(falso.estado.destruido).toBe(false)
  })

  it("respeta el deadline duro cuando el handshake nunca responde", async () => {
    const falso = crearSocketFalso()
    const inicio = Date.now()

    const resultado = await certDaysLeft("negocio-ejemplo.com", {
      conectar: fabricaCon(falso.socket),
      timeoutMs: 25,
    })

    expect(resultado).toBeNull()
    expect(falso.estado.destruido).toBe(true)
    expect(Date.now() - inicio).toBeLessThan(1_000)
  })

  it("devuelve null si la fabrica de sockets lanza", async () => {
    const resultado = await certDaysLeft("negocio-ejemplo.com", {
      conectar: () => {
        throw new Error("no se pudo conectar")
      },
    })
    expect(resultado).toBeNull()
  })
})

describe("certDaysLeft — validacion TLS no se desactiva (AC-20)", () => {
  it("el codigo no usa rejectUnauthorized: false ni desactiva TLS", () => {
    const fuente = readFileSync(
      path.join(process.cwd(), "src/lib/audit-server.ts"),
      "utf8",
    )
    const sinComentarios = fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")

    expect(sinComentarios).not.toMatch(/rejectUnauthorized/)
    expect(sinComentarios).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED")
    expect(sinComentarios).toContain("tls.connect(opciones)")
  })

  it("la fabrica real usa node:tls y no fetch/HTTP", () => {
    const fuente = readFileSync(
      path.join(process.cwd(), "src/lib/audit-server.ts"),
      "utf8",
    )
    expect(fuente).toContain('from "node:tls"')
    expect(fuente).not.toContain("globalThis.fetch")
    expect(fuente).not.toContain('from "node:http"')
    expect(fuente).not.toContain('from "node:https"')
  })
})

// ---------------------------------------------------------------------------
// Regresion de la ruta publica /api/audit (fetch mockeado, sin red)
// ---------------------------------------------------------------------------

interface CuerpoAuditOk {
  ok: boolean
  data: AuditData
  scores: AuditScores
  findings: AuditFinding[]
}

let contadorIp = 0
function ipUnica(): string {
  contadorIp += 1
  return `198.51.100.${contadorIp}`
}

function pedidoAudit(
  ip: string,
  body: unknown,
  opciones: { jsonInvalido?: boolean } = {},
): Request {
  return new Request("http://localhost/api/audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: opciones.jsonInvalido ? "esto no es json" : JSON.stringify(body),
  })
}

function respuestaFalsa(opciones: {
  status?: number
  url?: string
  redirected?: boolean
  html?: string
  headers?: Record<string, string>
} = {}): Response {
  return {
    status: opciones.status ?? 200,
    url: opciones.url ?? "http://audit-ok.ejemplo.com/final",
    redirected: opciones.redirected ?? true,
    headers: new Headers(
      opciones.headers ?? {
        "content-type": "text/html; charset=utf-8",
        "strict-transport-security": "max-age=31536000",
        "content-security-policy": "default-src 'self'",
        "x-content-type-options": "nosniff",
      },
    ),
    text: async () => opciones.html ?? HTML_REGRESION,
  } as unknown as Response
}

function espiarTimeout() {
  const constructor = AbortSignal as unknown as {
    timeout?: (ms: number) => AbortSignal
  }
  if (typeof constructor.timeout !== "function") {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: () => new AbortController().signal,
    })
  }
  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation(() => new AbortController().signal)
}

describe("POST /api/audit — regresion de la ruta publica (AC-20)", () => {
  it("responde 200 con la forma esperada, UA y timeout de 12 s", async () => {
    const timeoutSpy = espiarTimeout()
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa())
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      pedidoAudit(ipUnica(), { url: "http://audit-ok.ejemplo.com" }),
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as CuerpoAuditOk
    expect(body.ok).toBe(true)
    expect(body.data.finalUrl).toBe("http://audit-ok.ejemplo.com/final")
    expect(body.data.redirects).toBe(true)
    expect(body.data.title).toBe("Mi Negocio | Inicio")
    expect(body.data.metaDescription).toBe("Descripción   del negocio")
    expect(body.data.hasViewport).toBe(true)
    expect(body.data.h1Count).toBe(1)
    expect(body.data.imgCount).toBe(3)
    expect(body.data.imgNoAlt).toBe(2)
    expect(body.data.https).toBe(false)
    expect(body.data.certDaysLeft).toBeNull()
    expect(body.data.headers).toEqual({
      hsts: true,
      csp: true,
      xfo: false,
      xcto: true,
      referrer: false,
    })

    // La ruta publica usa exactamente las funciones puras de @/lib/audit.
    expect(body.scores).toEqual(computeScores(body.data))
    expect(body.findings).toEqual(buildFindings(body.data))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [urlPedida, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(urlPedida).toBe("http://audit-ok.ejemplo.com/")
    expect(init.redirect).toBe("follow")
    expect(init.cache).toBe("no-store")
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "Mozilla/5.0 (compatible; PixelArchAudit/1.0; +https://pixelarch.dev/auditoria)",
    )
    expect((init.headers as Record<string, string>).Accept).toBe(
      "text/html,application/xhtml+xml",
    )
    expect(timeoutSpy).toHaveBeenCalledWith(12_000)
  })

  it("responde 400 con JSON invalido", async () => {
    const response = await POST(
      pedidoAudit(ipUnica(), {}, { jsonInvalido: true }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty("error")
  })

  it("responde 400 con URL invalida", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(pedidoAudit(ipUnica(), { url: "sinpunto" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty("error")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("responde 400 con un host bloqueado sin llamar a fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      pedidoAudit(ipUnica(), { url: "http://127.0.0.1" }),
    )
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("limita a 8 auditorias por hora e IP y responde 429 en la novena", async () => {
    const ip = ipUnica()
    for (let i = 0; i < 8; i++) {
      const response = await POST(pedidoAudit(ip, { url: "" }))
      expect(response.status).toBe(400)
    }

    const novena = await POST(pedidoAudit(ip, { url: "" }))
    expect(novena.status).toBe(429)
    const body = (await novena.json()) as { error: string }
    expect(body.error).toContain("límite")
  })

  it("responde 502 saneado cuando el fetch agota el timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("The operation was aborted due to timeout"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      pedidoAudit(ipUnica(), { url: "http://audit-timeout.ejemplo.com" }),
    )
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain("12 segundos")
  })

  it("responde 502 generico ante un error de red", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ENOTFOUND"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      pedidoAudit(ipUnica(), { url: "http://audit-red.ejemplo.com" }),
    )
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain("No pudimos conectar")
  })
})
