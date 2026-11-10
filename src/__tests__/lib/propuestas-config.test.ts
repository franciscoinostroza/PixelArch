import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  configPropuestas,
  estadoEnvio,
  normalizarUrlPublica,
} from "@/lib/propuestas/config"
import {
  CODIGOS_ERROR,
  esCodigoError,
  esErrorTablaFaltante,
  sanitizarError,
} from "@/lib/propuestas/errores"
import { origenPermitido } from "@/lib/propuestas/origen"

/**
 * T-04 (AC-42; RF-8, RF-46, RF-63): configuracion, errores y origen.
 *
 * La configuracion se lee de `process.env` en cada llamada y nunca lanza. Sin
 * piezas criticas, el envio y las integraciones quedan deshabilitados con un
 * motivo; los secretos no aparecen en motivos, advertencias ni errores.
 */

const ENV_KEYS = [
  "PROPUESTAS_ENVIO_HABILITADO",
  "PROPUESTAS_PLACES_API_KEY",
  "PROPUESTAS_FROM_EMAIL",
  "PROPUESTAS_FROM_NOMBRE",
  "PROPUESTAS_REPLY_TO",
  "PROPUESTAS_SECRETO",
  "PROPUESTAS_TEXTO_LEGAL",
  "PROPUESTAS_BASE_LEGAL",
  "PROPUESTAS_ETIQUETA_PUBLICIDAD",
  "PROPUESTAS_CUPO_ENVIOS_DIA",
  "PROPUESTAS_CUPO_PLACES_DIA",
  "PROPUESTAS_CUPO_FETCHES_DIA",
  "PROPUESTAS_CUPO_AUDITORIAS_DIA",
  "PROPUESTAS_CUPO_BORRADORES_DIA",
  "PROPUESTAS_MAX_ENVIOS_PROSPECTO",
  "PROPUESTAS_PAGINAS_POR_PROSPECTO",
  "PROPUESTAS_COSTO_PLACES_CENTAVOS",
  "PROPUESTAS_COSTO_RESEND_CENTAVOS",
  "PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS",
  "PROPUESTAS_RETENCION_MESES",
  "PROPUESTAS_LLM_HABILITADO",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_URL",
] as const

type EnvKey = (typeof ENV_KEYS)[number]

const originalEnv = new Map<EnvKey, string | undefined>()

const SECRETO_VALIDO = "s".repeat(64)

const BASE: Record<string, string> = {
  PROPUESTAS_ENVIO_HABILITADO: "true",
  PROPUESTAS_PLACES_API_KEY: "places-key-de-prueba",
  PROPUESTAS_FROM_EMAIL: "propuestas@pixelarch.dev",
  PROPUESTAS_FROM_NOMBRE: "PixelArch",
  PROPUESTAS_REPLY_TO: "hola@pixelarch.dev",
  PROPUESTAS_SECRETO: SECRETO_VALIDO,
  PROPUESTAS_TEXTO_LEGAL: "Texto legal aprobado para pruebas.",
  PROPUESTAS_BASE_LEGAL: "Base legal aprobada para pruebas.",
  NEXT_PUBLIC_URL: "https://pixelarch.dev",
  RESEND_API_KEY: "re_test_dummy",
}

function configurar(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
    process.env[key] = value
  }
}

function limpiarEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
  limpiarEnv()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  originalEnv.clear()
})

describe("configPropuestas (AC-42)", () => {
  it("no lanza y deshabilita cada pieza faltante con su motivo", () => {
    expect(() => configPropuestas()).not.toThrow()

    const config = configPropuestas()

    expect(config.places).toMatchObject({ disponible: false, apiKey: null })
    expect(config.places.motivo).toContain("PROPUESTAS_PLACES_API_KEY")

    expect(config.resend.disponible).toBe(false)
    expect(config.resend.motivo).toContain("RESEND_API_KEY")

    expect(config.supresion.disponible).toBe(false)
    expect(config.supresion.motivo).toContain("PROPUESTAS_SECRETO")

    expect(config.baja.disponible).toBe(false)
    expect(config.baja.motivo).toContain("PROPUESTAS_SECRETO")
    expect(config.baja.motivo).toContain("NEXT_PUBLIC_URL")

    expect(config.llm.disponible).toBe(false)
    expect(config.llm.habilitado).toBe(false)

    expect(config.envioHabilitado).toBe(false)
    expect(config.fromEmail).toBeNull()
    expect(config.replyTo).toBeNull()
    expect(config.secreto).toBeNull()
    expect(config.urlPublica).toBeNull()
    expect(config.textoLegal).toBeNull()
    expect(config.baseLegal).toBeNull()
  })

  it("aplica los defaults del plan §4.7", () => {
    const config = configPropuestas()

    expect(config.cupos).toEqual({
      enviosDia: 20,
      placesDia: 20,
      fetchesDia: 100,
      auditoriasDia: 20,
      borradoresDia: 20,
    })
    expect(config.limites).toEqual({
      maxEnviosProspecto: 2,
      paginasPorProspecto: 3,
      retencionMeses: 12,
    })
    expect(config.costos).toEqual({
      placesCentavos: 0,
      resendCentavos: 0,
      presupuestoMensualCentavos: 0,
    })
    expect(config.fromNombre).toBe("PixelArch")
    expect(config.etiquetaPublicidad).toBe(true)
    expect(config.advertencias).toEqual([])
  })

  it("lee el entorno en cada llamada y no cachea valores", () => {
    process.env.PROPUESTAS_PLACES_API_KEY = "clave-1"
    expect(configPropuestas().places.disponible).toBe(true)

    delete process.env.PROPUESTAS_PLACES_API_KEY
    expect(configPropuestas().places.disponible).toBe(false)

    process.env.PROPUESTAS_PLACES_API_KEY = "clave-2"
    expect(configPropuestas().places.apiKey).toBe("clave-2")

    process.env.PROPUESTAS_CUPO_ENVIOS_DIA = "7"
    expect(configPropuestas().cupos.enviosDia).toBe(7)

    process.env.PROPUESTAS_CUPO_ENVIOS_DIA = "8"
    expect(configPropuestas().cupos.enviosDia).toBe(8)
  })

  it("acepta una configuracion completa y normaliza la URL publica", () => {
    configurar({ NEXT_PUBLIC_URL: "https://pixelarch.dev/" })

    const config = configPropuestas()

    expect(config.places.disponible).toBe(true)
    expect(config.resend.disponible).toBe(true)
    expect(config.supresion.disponible).toBe(true)
    expect(config.baja.disponible).toBe(true)
    expect(config.envioHabilitado).toBe(true)
    expect(config.fromEmail).toBe("propuestas@pixelarch.dev")
    expect(config.replyTo).toBe("hola@pixelarch.dev")
    expect(config.secreto).toBe(SECRETO_VALIDO)
    expect(config.urlPublica).toBe("https://pixelarch.dev")
    expect(config.textoLegal).toBe("Texto legal aprobado para pruebas.")
    expect(config.baseLegal).toBe("Base legal aprobada para pruebas.")
    expect(estadoEnvio(config)).toEqual({ ok: true, motivos: [] })
  })

  it("etiqueta publicidad por defecto y respeta el valor explicito", () => {
    expect(configPropuestas().etiquetaPublicidad).toBe(true)

    configurar({ PROPUESTAS_ETIQUETA_PUBLICIDAD: "false" })
    expect(configPropuestas().etiquetaPublicidad).toBe(false)

    configurar({ PROPUESTAS_ETIQUETA_PUBLICIDAD: "valor-raro" })
    expect(configPropuestas().etiquetaPublicidad).toBe(true)
  })

  it("el LLM queda reservado: habilitado por env no lo vuelve disponible en v1", () => {
    configurar({ PROPUESTAS_LLM_HABILITADO: "true" })

    const config = configPropuestas()
    expect(config.llm.habilitado).toBe(true)
    expect(config.llm.disponible).toBe(false)
    expect(config.llm.motivo).toContain("v1")
  })

  it("rechaza remitente/reply invalidos o con inyeccion de headers", () => {
    const invalidos = [
      "sin-arroba",
      "a@b",
      "@pixelarch.dev",
      "propuestas@pixelarch.dev\r\nBcc: otro@example.com",
      "propuestas@pixelarch.dev\nBcc: otro@example.com",
      "propuestas@",
    ]

    for (const valor of invalidos) {
      configurar({ PROPUESTAS_FROM_EMAIL: valor })
      const config = configPropuestas()

      expect(config.fromEmail, valor).toBeNull()
      expect(estadoEnvio(config).motivos.join(" "), valor).toContain(
        "PROPUESTAS_FROM_EMAIL",
      )
    }

    configurar({ PROPUESTAS_REPLY_TO: "   " })
    expect(configPropuestas().replyTo).toBeNull()
  })

  it("exige un secreto de al menos 32 caracteres", () => {
    configurar({ PROPUESTAS_SECRETO: "x".repeat(31) })
    expect(configPropuestas().secreto).toBeNull()
    expect(configPropuestas().supresion.disponible).toBe(false)

    configurar({ PROPUESTAS_SECRETO: "x".repeat(32) })
    expect(configPropuestas().secreto).toBe("x".repeat(32))
    expect(configPropuestas().supresion.disponible).toBe(true)
  })

  it("rechaza URLs publicas no HTTPS, relativas o con credenciales/query/hash", () => {
    const invalidas = [
      "http://pixelarch.dev",
      "pixelarch.dev",
      "ftp://pixelarch.dev",
      "https://usuario:clave@pixelarch.dev",
      "https://pixelarch.dev?destino=otro",
      "https://pixelarch.dev#fragmento",
      "https://pixelarch.dev/portal",
      "",
      "   ",
    ]

    for (const valor of invalidas) {
      expect(normalizarUrlPublica(valor), valor).toBeNull()

      configurar({ NEXT_PUBLIC_URL: valor })
      expect(configPropuestas().urlPublica, valor).toBeNull()
      expect(configPropuestas().baja.disponible, valor).toBe(false)
    }

    expect(normalizarUrlPublica("https://PIXELARCH.DEV/")).toBe(
      "https://pixelarch.dev",
    )
  })

  it("un cupo invalido bloquea la accion y no lanza", () => {
    configurar({
      PROPUESTAS_CUPO_ENVIOS_DIA: "0",
      PROPUESTAS_CUPO_PLACES_DIA: "-1",
      PROPUESTAS_CUPO_FETCHES_DIA: "abc",
      PROPUESTAS_CUPO_AUDITORIAS_DIA: "1.5",
      PROPUESTAS_CUPO_BORRADORES_DIA: "99999999999999999999",
      PROPUESTAS_MAX_ENVIOS_PROSPECTO: "0",
      PROPUESTAS_PAGINAS_POR_PROSPECTO: "abc",
      PROPUESTAS_RETENCION_MESES: "-1",
      PROPUESTAS_COSTO_PLACES_CENTAVOS: "-5",
      PROPUESTAS_COSTO_RESEND_CENTAVOS: "abc",
      PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS: "-1",
    })

    expect(() => configPropuestas()).not.toThrow()

    const config = configPropuestas()

    expect(config.cupos).toEqual({
      enviosDia: 0,
      placesDia: 0,
      fetchesDia: 0,
      auditoriasDia: 0,
      borradoresDia: 0,
    })
    expect(config.limites).toEqual({
      maxEnviosProspecto: 0,
      paginasPorProspecto: 0,
      retencionMeses: 0,
    })
    expect(config.costos).toEqual({
      placesCentavos: 0,
      resendCentavos: 0,
      presupuestoMensualCentavos: 0,
    })

    const advertencias = config.advertencias.join(" ")
    for (const key of [
      "PROPUESTAS_CUPO_ENVIOS_DIA",
      "PROPUESTAS_CUPO_PLACES_DIA",
      "PROPUESTAS_CUPO_FETCHES_DIA",
      "PROPUESTAS_CUPO_AUDITORIAS_DIA",
      "PROPUESTAS_CUPO_BORRADORES_DIA",
      "PROPUESTAS_MAX_ENVIOS_PROSPECTO",
      "PROPUESTAS_PAGINAS_POR_PROSPECTO",
      "PROPUESTAS_RETENCION_MESES",
      "PROPUESTAS_COSTO_PLACES_CENTAVOS",
      "PROPUESTAS_COSTO_RESEND_CENTAVOS",
      "PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS",
    ]) {
      expect(advertencias, key).toContain(key)
    }
  })

  it("acepta overrides validos de cupos y costos", () => {
    configurar({
      PROPUESTAS_CUPO_ENVIOS_DIA: "5",
      PROPUESTAS_CUPO_PLACES_DIA: "6",
      PROPUESTAS_CUPO_FETCHES_DIA: "7",
      PROPUESTAS_CUPO_AUDITORIAS_DIA: "8",
      PROPUESTAS_CUPO_BORRADORES_DIA: "9",
      PROPUESTAS_MAX_ENVIOS_PROSPECTO: "3",
      PROPUESTAS_PAGINAS_POR_PROSPECTO: "4",
      PROPUESTAS_RETENCION_MESES: "24",
      PROPUESTAS_COSTO_PLACES_CENTAVOS: "25",
      PROPUESTAS_COSTO_RESEND_CENTAVOS: "10",
      PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS: "5000",
    })

    const config = configPropuestas()

    expect(config.cupos).toEqual({
      enviosDia: 5,
      placesDia: 6,
      fetchesDia: 7,
      auditoriasDia: 8,
      borradoresDia: 9,
    })
    expect(config.limites).toEqual({
      maxEnviosProspecto: 3,
      paginasPorProspecto: 4,
      retencionMeses: 24,
    })
    expect(config.costos).toEqual({
      placesCentavos: 25,
      resendCentavos: 10,
      presupuestoMensualCentavos: 5000,
    })
    expect(config.advertencias).toEqual([])
  })

  it("no expone secretos ni claves en motivos, advertencias o errores de envio", () => {
    const secreto = "secreto-que-no-debe-filtrarse-1234567890"
    const clavePlaces = "clave-places-que-no-debe-filtrarse"
    configurar({
      PROPUESTAS_SECRETO: secreto,
      PROPUESTAS_PLACES_API_KEY: clavePlaces,
      PROPUESTAS_TEXTO_LEGAL: "",
      PROPUESTAS_BASE_LEGAL: "",
    })

    const config = configPropuestas()
    const visible = JSON.stringify({
      places: config.places.motivo,
      supresion: config.supresion.motivo,
      baja: config.baja.motivo,
      estadoEnvio: estadoEnvio(config),
      advertencias: config.advertencias,
    })

    expect(visible).not.toContain(secreto)
    expect(visible).not.toContain(clavePlaces)
  })
})

describe("estadoEnvio (AC-42)", () => {
  it("acumula un motivo por cada pieza faltante", () => {
    const estado = estadoEnvio()

    expect(estado.ok).toBe(false)
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_ENVIO_HABILITADO")
    expect(estado.motivos.join(" ")).toContain("RESEND_API_KEY")
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_FROM_EMAIL")
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_REPLY_TO")
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_SECRETO")
    expect(estado.motivos.join(" ")).toContain("NEXT_PUBLIC_URL")
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_TEXTO_LEGAL")
    expect(estado.motivos.join(" ")).toContain("PROPUESTAS_BASE_LEGAL")
  })

  it("con todo configurado menos el gate, falla cerrado por el gate", () => {
    configurar({ PROPUESTAS_ENVIO_HABILITADO: "false" })

    const estado = estadoEnvio(configPropuestas())

    expect(estado.ok).toBe(false)
    expect(estado.motivos).toHaveLength(1)
    expect(estado.motivos[0]).toContain("PROPUESTAS_ENVIO_HABILITADO")
  })

  it("exige cada pieza de forma independiente aunque el resto este configurado", () => {
    const casos: Array<{
      clave: (typeof ENV_KEYS)[number]
      valor: string
      motivo: string
    }> = [
      {
        clave: "PROPUESTAS_FROM_EMAIL",
        valor: "",
        motivo: "PROPUESTAS_FROM_EMAIL",
      },
      {
        clave: "PROPUESTAS_REPLY_TO",
        valor: "",
        motivo: "PROPUESTAS_REPLY_TO",
      },
      {
        clave: "PROPUESTAS_SECRETO",
        valor: "corto",
        motivo: "PROPUESTAS_SECRETO",
      },
      {
        clave: "NEXT_PUBLIC_URL",
        valor: "http://pixelarch.dev",
        motivo: "NEXT_PUBLIC_URL",
      },
      {
        clave: "PROPUESTAS_TEXTO_LEGAL",
        valor: "",
        motivo: "PROPUESTAS_TEXTO_LEGAL",
      },
      {
        clave: "PROPUESTAS_BASE_LEGAL",
        valor: "",
        motivo: "PROPUESTAS_BASE_LEGAL",
      },
      {
        clave: "RESEND_API_KEY",
        valor: "",
        motivo: "RESEND_API_KEY",
      },
    ]

    for (const caso of casos) {
      configurar({ [caso.clave]: caso.valor })

      const estado = estadoEnvio(configPropuestas())

      expect(estado.ok, caso.clave).toBe(false)
      expect(estado.motivos, caso.clave).toHaveLength(1)
      expect(estado.motivos[0], caso.clave).toContain(caso.motivo)
    }
  })

  it("solo acepta el gate con el valor true explicito", () => {
    configurar({ PROPUESTAS_ENVIO_HABILITADO: "TRUE" })
    expect(estadoEnvio(configPropuestas()).ok).toBe(true)

    configurar({ PROPUESTAS_ENVIO_HABILITADO: "1" })
    expect(estadoEnvio(configPropuestas()).ok).toBe(false)
  })

  it("sin texto legal o base legal no se puede aprobar ni enviar", () => {
    configurar({ PROPUESTAS_TEXTO_LEGAL: "" })
    expect(estadoEnvio(configPropuestas()).motivos.join(" ")).toContain(
      "PROPUESTAS_TEXTO_LEGAL",
    )

    configurar({
      PROPUESTAS_TEXTO_LEGAL: "Texto legal aprobado para pruebas.",
      PROPUESTAS_BASE_LEGAL: "",
    })
    expect(estadoEnvio(configPropuestas()).motivos.join(" ")).toContain(
      "PROPUESTAS_BASE_LEGAL",
    )
  })
})

describe("errores del portal (AC-42)", () => {
  it("detecta P2021 y las variantes de tabla faltante", () => {
    expect(esErrorTablaFaltante({ code: "P2021" })).toBe(true)
    expect(esErrorTablaFaltante({ code: "42P01" })).toBe(true)
    expect(
      esErrorTablaFaltante({ code: "P2010", meta: { code: "42P01" } }),
    ).toBe(true)
    expect(
      esErrorTablaFaltante(
        new Error('relation "Prospecto" does not exist'),
      ),
    ).toBe(true)

    expect(esErrorTablaFaltante(new Error("timeout"))).toBe(false)
    expect(esErrorTablaFaltante({ code: "P2002" })).toBe(false)
    expect(esErrorTablaFaltante(null)).toBe(false)
    expect(esErrorTablaFaltante(undefined)).toBe(false)
    expect(esErrorTablaFaltante("P2021")).toBe(false)
  })

  it("mantiene los codigos del plan y reconoce solo codigos conocidos", () => {
    for (const codigo of [
      "VALIDACION",
      "NO_AUTORIZADO",
      "PROHIBIDO",
      "ORIGEN_INVALIDO",
      "NO_ENCONTRADO",
      "ESTADO",
      "SUPRIMIDO",
      "SIN_EMAIL",
      "MAX_MENSAJES",
      "BORRADOR_ABIERTO",
      "CUPO",
      "RATE_LIMIT",
      "PROVEEDOR",
      "NO_CONFIGURADO",
      "ESQUEMA_NO_APLICADO",
    ]) {
      expect(CODIGOS_ERROR, codigo).toContain(codigo)
      expect(esCodigoError(codigo), codigo).toBe(true)
    }

    expect(esCodigoError("OTRO")).toBe(false)
    expect(esCodigoError(null)).toBe(false)
    expect(esCodigoError(500)).toBe(false)
  })

  it("mapea P2021 a ESQUEMA_NO_APLICADO sin devolver el error original", () => {
    const salida = sanitizarError({ code: "P2021", message: "tabla rota" })

    expect(salida.codigo).toBe("ESQUEMA_NO_APLICADO")
    expect(salida.mensaje).toBe("El esquema del portal no esta aplicado.")
  })

  it("respeta el codigo explicito y el mensaje del llamador", () => {
    expect(
      sanitizarError(new Error("detalle interno"), {
        codigo: "VALIDACION",
        mensaje: "Falta el nombre del negocio.",
      }),
    ).toEqual({
      codigo: "VALIDACION",
      mensaje: "Falta el nombre del negocio.",
    })

    expect(sanitizarError({ codigo: "CUPO", message: "cupo agotado" })).toEqual({
      codigo: "CUPO",
      mensaje: "cupo agotado",
    })
  })

  it("usa un mensaje generico para errores desconocidos o sin mensaje", () => {
    expect(sanitizarError(null)).toEqual({
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    expect(sanitizarError({ code: "NO_CONFIGURADO" })).toEqual({
      codigo: "NO_CONFIGURADO",
      mensaje: "La funcion solicitada no esta configurada.",
    })
  })

  it("redacta email, URL, bearer, credenciales y secretos del entorno", () => {
    const secreto = "secreto-del-entorno-que-no-debe-salir-123456"
    process.env.PROPUESTAS_SECRETO = secreto

    const salida = sanitizarError(
      new Error(
        `Fallo para juan@example.com en https://pixelarch.dev/api?token=abc123 ` +
          `con api_key=${secreto} y Authorization: Bearer abc.def`,
      ),
    )

    expect(salida.mensaje).not.toContain("juan@example.com")
    expect(salida.mensaje).not.toContain("https://pixelarch.dev")
    expect(salida.mensaje).not.toContain("abc123")
    expect(salida.mensaje).not.toContain("Bearer abc.def")
    expect(salida.mensaje).not.toContain(secreto)
    expect(salida.mensaje).toContain("[email]")
    expect(salida.mensaje).toContain("[url]")
    expect(salida.mensaje).toContain("[redactado]")
  })

  it("tambien redacta un mensaje provisto por el llamador", () => {
    const secreto = "otro-secreto-del-entorno-1234567890"
    process.env.PROPUESTAS_SECRETO = secreto

    const salida = sanitizarError(null, {
      codigo: "VALIDACION",
      mensaje:
        `Fallo con juan@example.com y ${secreto} ` +
        "en https://pixelarch.dev/propuestas/baja/v1.token",
    })

    expect(salida.codigo).toBe("VALIDACION")
    expect(salida.mensaje).not.toContain("juan@example.com")
    expect(salida.mensaje).not.toContain(secreto)
    expect(salida.mensaje).not.toContain("https://pixelarch.dev")
  })

  it("no devuelve stack, acota el mensaje y no lanza con entradas raras", () => {
    const error = new Error("visible")
    error.stack = "Error: visible\n    at STACK_SECRETO"

    const salida = sanitizarError(error)
    expect(salida.mensaje).not.toContain("STACK_SECRETO")
    expect(salida.mensaje).not.toContain("at ")

    expect(
      sanitizarError(new Error("x".repeat(500))).mensaje.length,
    ).toBeLessThanOrEqual(240)

    for (const entrada of [
      undefined,
      42,
      Symbol("x"),
      { message: { no: "es texto" } },
      Object.create(null),
    ]) {
      expect(() => sanitizarError(entrada)).not.toThrow()
    }
  })
})

describe("origenPermitido (AC-42)", () => {
  function pedido(origin?: string | null): Request {
    const headers = new Headers()
    if (origin !== undefined && origin !== null) {
      headers.set("origin", origin)
    }
    return new Request("https://pixelarch.dev/api/propuestas/campanas", {
      method: "POST",
      headers,
    })
  }

  it("acepta el mismo origen y normaliza mayusculas/barra final", () => {
    expect(origenPermitido(pedido("https://pixelarch.dev"), "https://pixelarch.dev")).toBe(true)
    expect(origenPermitido(pedido("https://PIXELARCH.DEV"), "https://pixelarch.dev/")).toBe(true)
    expect(origenPermitido(pedido("https://pixelarch.dev/"), "https://pixelarch.dev")).toBe(true)
  })

  it("rechaza otro origen, esquema, puerto o subdominio", () => {
    const casos = [
      "https://evil.example",
      "http://pixelarch.dev",
      "https://pixelarch.dev:8443",
      "https://staging.pixelarch.dev",
      "https://pixelarch.dev.evil.example",
    ]

    for (const origen of casos) {
      expect(origenPermitido(pedido(origen), "https://pixelarch.dev"), origen).toBe(false)
    }
  })

  it("falla cerrado sin Origin, con Origin nulo o invalido", () => {
    expect(origenPermitido(pedido(), "https://pixelarch.dev")).toBe(false)
    expect(origenPermitido(pedido(null), "https://pixelarch.dev")).toBe(false)
    expect(origenPermitido(pedido("null"), "https://pixelarch.dev")).toBe(false)
    expect(origenPermitido(pedido("no-es-una-url"), "https://pixelarch.dev")).toBe(false)
    expect(
      origenPermitido(pedido("https://user:pass@pixelarch.dev"), "https://pixelarch.dev"),
    ).toBe(false)
    expect(
      origenPermitido(pedido("https://pixelarch.dev?x=1"), "https://pixelarch.dev"),
    ).toBe(false)
  })

  it("falla cerrado si la URL publica falta o no es HTTPS valida", () => {
    const original = pedido("https://pixelarch.dev")

    for (const url of [
      null,
      undefined,
      "",
      "http://pixelarch.dev",
      "pixelarch.dev",
      "ftp://pixelarch.dev",
      "https://pixelarch.dev/portal",
    ]) {
      expect(origenPermitido(original, url), String(url)).toBe(false)
    }
  })
})

describe(".env.example y envs server-only (RF-63)", () => {
  const ruta = join(process.cwd(), ".env.example")

  it("documenta todas las variables del portal y los valores acordados", () => {
    const contenido = readFileSync(ruta, "utf8")

    for (const key of ENV_KEYS.filter((key) => key !== "RESEND_API_KEY" && key !== "NEXT_PUBLIC_URL")) {
      expect(contenido, key).toMatch(new RegExp(`^${key}=`, "m"))
    }

    expect(contenido).toContain("PROPUESTAS_ENVIO_HABILITADO=false")
    expect(contenido).toContain("PROPUESTAS_FROM_EMAIL=propuestas@pixelarch.dev")
    expect(contenido).toContain("PROPUESTAS_REPLY_TO=hola@pixelarch.dev")
  })

  it("no declara variables NEXT_PUBLIC_* nuevas para propuestas", () => {
    const contenido = readFileSync(ruta, "utf8")

    expect(contenido).not.toMatch(/NEXT_PUBLIC_[A-Z0-9_]*PROPUESTAS/)
    expect(contenido).toMatch(/NEXT_PUBLIC_URL=/)
  })

  it("conserva exactamente las NEXT_PUBLIC_* preexistentes", () => {
    const contenido = readFileSync(ruta, "utf8")

    const publicas = [
      ...new Set(
        (contenido.match(/^NEXT_PUBLIC_[A-Z0-9_]+(?==)/gm) ?? []).sort(),
      ),
    ]

    expect(publicas).toEqual([
      "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
      "NEXT_PUBLIC_SANITY_DATASET",
      "NEXT_PUBLIC_SANITY_PROJECT_ID",
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_URL",
    ])
  })

  it("no commitea valores reales para los secretos del portal", () => {
    const contenido = readFileSync(ruta, "utf8")

    expect(contenido).toMatch(/^PROPUESTAS_PLACES_API_KEY=\s*$/m)
    expect(contenido).toMatch(/^PROPUESTAS_SECRETO=\s*$/m)
  })

  it("el modulo de configuracion solo lee NEXT_PUBLIC_URL como variable publica", () => {
    const fuente = readFileSync(
      join(process.cwd(), "src", "lib", "propuestas", "config.ts"),
      "utf8",
    )

    const publicas = fuente.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []
    expect(new Set(publicas)).toEqual(new Set(["NEXT_PUBLIC_URL"]))
  })
})
