import { describe, expect, it } from "vitest"

import type { ConfigPropuestas } from "@/lib/propuestas/config"
import {
  FIELD_MASK_PLACES,
  MAX_TEXTO_CONSULTA,
  PAGE_SIZE_PLACES_DEFAULT,
  PAGE_SIZE_PLACES_MAX,
  PAGE_SIZE_PLACES_MIN,
  TIMEOUT_PLACES_MS,
  URL_PLACES_SEARCH_TEXT,
  buscarLugaresPlaces,
} from "@/lib/propuestas/places"
import type {
  FetchPlaces,
  ResultadoPlaces,
  ResultadoPlacesError,
} from "@/lib/propuestas/places"

/**
 * T-11 (AC-8, AC-11, AC-12; RF-10, RF-11, RF-17, RF-57, RF-58): cliente de
 * Google Places Text Search.
 *
 * Todo corre sin red: el `fetch`, la clave, la config y el timeout se inyectan.
 * Los casos verifican la request exacta (URL/metodo/headers/body sin paginar),
 * la validacion de entrada, el parseo, el mapeo de errores sin reintentos y
 * que los mensajes nunca incluyan el body del proveedor, la clave ni PII.
 */

type ConfigPlaces = Pick<ConfigPropuestas, "places">

const CLAVE = "clave-places-de-prueba"

const CONFIG_CON_CLAVE: ConfigPlaces = {
  places: { disponible: true, motivo: null, apiKey: CLAVE },
}

const CONFIG_SIN_CLAVE: ConfigPlaces = {
  places: {
    disponible: false,
    motivo: "Busqueda deshabilitada: falta PROPUESTAS_PLACES_API_KEY.",
    apiKey: null,
  },
}

interface CapturaFetch {
  url: string
  init: RequestInit
}

interface OpcionesFetchFalso {
  status?: number
  cuerpo?: unknown
  /** Error con el que se rechaza el `fetch` inyectado. */
  error?: unknown
  /** El `fetch` nunca resuelve (para forzar el timeout). */
  nuncaResuelve?: boolean
  /** El `json()` de la respuesta falla con este error. */
  errorJson?: unknown
}

interface FetchFalso {
  fetchImpl: FetchPlaces
  llamadas: CapturaFetch[]
}

function crearRespuesta(status: number, cuerpo: unknown): Response {
  return {
    status,
    json: async () => cuerpo,
  } as unknown as Response
}

function crearFetchFalso(opciones: OpcionesFetchFalso = {}): FetchFalso {
  const llamadas: CapturaFetch[] = []

  const fetchImpl: FetchPlaces = async (url, init) => {
    llamadas.push({ url, init })

    if (opciones.nuncaResuelve) {
      return new Promise<Response>(() => {})
    }
    if (opciones.error !== undefined) {
      throw opciones.error
    }

    const status = opciones.status ?? 200

    if (opciones.errorJson !== undefined) {
      return {
        status,
        json: async () => {
          throw opciones.errorJson
        },
      } as unknown as Response
    }

    return crearRespuesta(
      status,
      opciones.cuerpo === undefined ? { places: [] } : opciones.cuerpo,
    )
  }

  return { fetchImpl, llamadas }
}

function cuerpoDe(llamada: CapturaFetch): Record<string, unknown> {
  const crudo = llamada.init.body
  expect(typeof crudo).toBe("string")
  return JSON.parse(String(crudo)) as Record<string, unknown>
}

function esError(
  resultado: ResultadoPlaces,
): resultado is ResultadoPlacesError {
  return resultado.ok === false
}

async function buscar(
  entrada: Parameters<typeof buscarLugaresPlaces>[0],
  opciones: Parameters<typeof buscarLugaresPlaces>[1] = {},
): Promise<ResultadoPlaces> {
  return buscarLugaresPlaces(entrada, opciones)
}

describe("T-11 Places: request exacta a la API oficial (AC-8, RF-10)", () => {
  it("AC-8: hace una sola request POST con URL, headers y body exactos, sin pageToken", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso({ cuerpo: { places: [] } })

    const resultado = await buscar(
      { textQuery: "  cafeterias en Palermo  ", pageSize: 7 },
      { fetchImpl, apiKey: CLAVE, config: CONFIG_SIN_CLAVE },
    )

    expect(resultado).toEqual({ ok: true, lugares: [] })
    expect(llamadas).toHaveLength(1)

    const [llamada] = llamadas
    expect(llamada.url).toBe(URL_PLACES_SEARCH_TEXT)
    expect(llamada.url).toBe(
      "https://places.googleapis.com/v1/places:searchText",
    )
    expect(llamada.init.method).toBe("POST")
    expect(llamada.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": CLAVE,
      "X-Goog-FieldMask":
        "places.id,places.displayName.text,places.websiteUri",
    })
    expect(llamada.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": CLAVE,
      "X-Goog-FieldMask": FIELD_MASK_PLACES,
    })

    const body = cuerpoDe(llamada)
    expect(body).toEqual({
      textQuery: "cafeterias en Palermo",
      languageCode: "es",
      regionCode: "AR",
      pageSize: 7,
    })
    expect(body).not.toHaveProperty("pageToken")
    expect(Object.keys(body).sort()).toEqual([
      "languageCode",
      "pageSize",
      "regionCode",
      "textQuery",
    ])
  })

  it("AC-8: usa pageSize 20 por defecto y acepta 1..20", async () => {
    expect(PAGE_SIZE_PLACES_DEFAULT).toBe(20)
    expect(PAGE_SIZE_PLACES_MIN).toBe(1)
    expect(PAGE_SIZE_PLACES_MAX).toBe(20)

    for (const pageSize of [undefined, 1, 20]) {
      const { fetchImpl, llamadas } = crearFetchFalso()

      await buscar(
        pageSize === undefined
          ? { textQuery: "panaderias en Caballito" }
          : { textQuery: "panaderias en Caballito", pageSize },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(llamadas).toHaveLength(1)
      expect(cuerpoDe(llamadas[0]).pageSize).toBe(
        pageSize ?? PAGE_SIZE_PLACES_DEFAULT,
      )
    }
  })

  it("AC-8: no pide detalles, fotos, resenas, horarios ni ratings", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    await buscar(
      { textQuery: "gimnasios en Rosario" },
      { fetchImpl, apiKey: CLAVE },
    )

    const serializado = JSON.stringify(llamadas[0])
    expect(serializado).not.toMatch(/placeDetails|photos|reviews|rating|openingHours/i)
    expect(llamadas[0].init.headers).not.toHaveProperty("X-Goog-FieldMask-2")
  })
})

describe("T-11 Places: validacion de entrada (AC-8, RF-10)", () => {
  it.each([0, -1, 21, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "AC-8: pageSize fuera de rango (%s) -> VALIDACION sin fetch",
    async (pageSize) => {
      const { fetchImpl, llamadas } = crearFetchFalso({ cuerpo: { places: [] } })

      const resultado = await buscar(
        { textQuery: "consultorio en La Plata", pageSize },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) {
        expect(resultado.codigo).toBe("VALIDACION")
        expect(resultado.status).toBeNull()
      }
      expect(llamadas).toHaveLength(0)
    },
  )

  it("AC-8: pageSize no numerico -> VALIDACION sin fetch", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: "kiosco en Quilmes", pageSize: "10" as unknown as number },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("VALIDACION")
    expect(llamadas).toHaveLength(0)
  })

  it.each(["", "   ", "\t", "\n"])(
    "AC-8: textQuery vacio o solo espacios (%j) -> VALIDACION sin fetch",
    async (textQuery) => {
      const { fetchImpl, llamadas } = crearFetchFalso()

      const resultado = await buscar(
        { textQuery },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) expect(resultado.codigo).toBe("VALIDACION")
      expect(llamadas).toHaveLength(0)
    },
  )

  it("AC-8: textQuery demasiado largo -> VALIDACION sin fetch", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: "a".repeat(MAX_TEXTO_CONSULTA + 1) },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(MAX_TEXTO_CONSULTA).toBe(1000)
    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("VALIDACION")
    expect(llamadas).toHaveLength(0)
  })

  it("AC-8: textQuery en el limite exacto si se envia", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()
    const texto = "a".repeat(MAX_TEXTO_CONSULTA)

    const resultado = await buscar(
      { textQuery: texto },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(resultado.ok).toBe(true)
    expect(llamadas).toHaveLength(1)
    expect(cuerpoDe(llamadas[0]).textQuery).toBe(texto)
  })

  it.each(["\u0000", "\u0007", "\u001f", "cafe\u0000central"])(
    "AC-8: textQuery con caracteres de control (%j) -> VALIDACION sin fetch",
    async (textQuery) => {
      const { fetchImpl, llamadas } = crearFetchFalso()

      const resultado = await buscar(
        { textQuery },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) expect(resultado.codigo).toBe("VALIDACION")
      expect(llamadas).toHaveLength(0)
    },
  )

  it("AC-8: textQuery no string -> VALIDACION sin fetch", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: 42 as unknown as string },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("VALIDACION")
    expect(llamadas).toHaveLength(0)
  })
})

describe("T-11 Places: parseo de respuesta (AC-8)", () => {
  it("AC-8: mapea places[] a placeId, nombre transitorio y sitio", async () => {
    const { fetchImpl } = crearFetchFalso({
      cuerpo: {
        places: [
          {
            id: " place-1 ",
            displayName: { text: "  Cafe Uno  " },
            websiteUri: "  https://cafe-uno.example  ",
          },
          {
            id: "place-2",
            displayName: { text: "Panaderia Dos" },
            websiteUri: "https://panaderia-dos.example",
          },
        ],
      },
    })

    const resultado = await buscar(
      { textQuery: "cafeterias" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(resultado).toEqual({
      ok: true,
      lugares: [
        {
          placeId: "place-1",
          nombreTransitorio: "Cafe Uno",
          sitioWeb: "https://cafe-uno.example",
        },
        {
          placeId: "place-2",
          nombreTransitorio: "Panaderia Dos",
          sitioWeb: "https://panaderia-dos.example",
        },
      ],
    })
  })

  it("AC-8: nombre y sitio faltantes o invalidos quedan en null", async () => {
    const { fetchImpl } = crearFetchFalso({
      cuerpo: {
        places: [
          { id: "solo-id" },
          { id: "display-vacio", displayName: { text: "   " } },
          { id: "display-raro", displayName: "Cafe" },
          { id: "display-numero", displayName: { text: 123 } },
          { id: "sitio-vacio", websiteUri: "   " },
          { id: "sitio-numero", websiteUri: 42 },
          { id: "sitio-null", websiteUri: null },
        ],
      },
    })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    expect(resultado.lugares).toHaveLength(7)
    for (const lugar of resultado.lugares) {
      expect(lugar.nombreTransitorio).toBeNull()
      expect(lugar.sitioWeb).toBeNull()
    }
    expect(resultado.lugares.map((l) => l.placeId)).toEqual([
      "solo-id",
      "display-vacio",
      "display-raro",
      "display-numero",
      "sitio-vacio",
      "sitio-numero",
      "sitio-null",
    ])
  })

  it("AC-8: places ausente o vacio -> lista vacia", async () => {
    for (const cuerpo of [{}, { places: [] }]) {
      const { fetchImpl } = crearFetchFalso({ cuerpo })

      const resultado = await buscar(
        { textQuery: "sin resultados" },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(resultado).toEqual({ ok: true, lugares: [] })
    }
  })

  it.each([
    { places: null },
    { places: {} },
    { places: "texto" },
    { places: [null] },
    { places: ["texto"] },
    { places: [[]] },
    { places: [{ displayName: { text: "Sin id" } }] },
    { places: [{ id: "" }] },
    { places: [{ id: "   " }] },
    { places: [{ id: 123 }] },
    { places: [{ id: "ok" }, { id: "" }] },
    null,
    [],
    "texto",
    42,
  ])(
    "AC-8: payload invalido (%j) -> PROVEEDOR",
    async (cuerpo) => {
      const { fetchImpl, llamadas } = crearFetchFalso({ cuerpo })

      const resultado = await buscar(
        { textQuery: "negocios" },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) {
        expect(resultado.codigo).toBe("PROVEEDOR")
        expect(resultado.status).toBe(200)
      }
      expect(llamadas).toHaveLength(1)
    },
  )

  it("AC-12: JSON invalido del proveedor -> PROVEEDOR, no excepcion", async () => {
    const { fetchImpl } = crearFetchFalso({
      errorJson: new SyntaxError("Unexpected token < in JSON"),
      status: 200,
    })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) {
      expect(resultado.codigo).toBe("PROVEEDOR")
      expect(resultado.status).toBe(200)
    }
  })
})

describe("T-11 Places: clave ausente (AC-8, RF-57)", () => {
  it("AC-8: apiKey null -> NO_CONFIGURADO sin fetch", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: null },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) {
      expect(resultado.codigo).toBe("NO_CONFIGURADO")
      expect(resultado.status).toBeNull()
    }
    expect(llamadas).toHaveLength(0)
  })

  it("AC-8: config sin clave -> NO_CONFIGURADO sin fetch", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, config: CONFIG_SIN_CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("NO_CONFIGURADO")
    expect(llamadas).toHaveLength(0)
  })

  it.each(["", "   ", "clave\nsecreta", "clave\rsecreta"])(
    "AC-8: clave vacia o con saltos de linea (%j) -> NO_CONFIGURADO sin fetch",
    async (apiKey) => {
      const { fetchImpl, llamadas } = crearFetchFalso()

      const resultado = await buscar(
        { textQuery: "negocios" },
        { fetchImpl, apiKey },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) expect(resultado.codigo).toBe("NO_CONFIGURADO")
      expect(llamadas).toHaveLength(0)
    },
  )

  it("AC-8: usa la clave de la config cuando no se inyecta apiKey", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso()

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, config: CONFIG_CON_CLAVE },
    )

    expect(resultado.ok).toBe(true)
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].init.headers).toMatchObject({
      "X-Goog-Api-Key": CLAVE,
    })
  })
})

describe("T-11 Places: mapeo de errores sin reintentos (AC-12)", () => {
  const CASOS: Array<[number, string]> = [
    [400, "CONFIGURACION"],
    [401, "CREDENCIALES"],
    [403, "CREDENCIALES"],
    [429, "CUOTA"],
    [500, "PROVEEDOR"],
    [502, "PROVEEDOR"],
    [503, "PROVEEDOR"],
    [504, "PROVEEDOR"],
    [404, "PROVEEDOR"],
  ]

  it.each(CASOS)(
    "AC-12: status %s -> %s con una sola llamada",
    async (status, codigo) => {
      const { fetchImpl, llamadas } = crearFetchFalso({
        status,
        cuerpo: { error: { message: "detalle interno del proveedor" } },
      })

      const resultado = await buscar(
        { textQuery: "negocios" },
        { fetchImpl, apiKey: CLAVE },
      )

      expect(esError(resultado)).toBe(true)
      if (esError(resultado)) {
        expect(resultado.codigo).toBe(codigo)
        expect(resultado.status).toBe(status)
      }
      expect(llamadas).toHaveLength(1)
    },
  )

  it("AC-12: 429 se llama una sola vez (sin retry ni bucle)", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso({ status: 429 })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("CUOTA")
    expect(llamadas).toHaveLength(1)
  })

  it("AC-12: 5xx se llama una sola vez (sin retry ni bucle)", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso({ status: 503 })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) expect(resultado.codigo).toBe("PROVEEDOR")
    expect(llamadas).toHaveLength(1)
  })

  it("AC-12: timeout con fetch que nunca resuelve -> TIMEOUT sin colgar", async () => {
    const { fetchImpl, llamadas } = crearFetchFalso({ nuncaResuelve: true })
    const inicio = Date.now()

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE, timeoutMs: 10 },
    )

    const transcurrido = Date.now() - inicio
    expect(TIMEOUT_PLACES_MS).toBe(8_000)
    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) {
      expect(resultado.codigo).toBe("TIMEOUT")
      expect(resultado.status).toBeNull()
    }
    expect(llamadas).toHaveLength(1)
    expect(transcurrido).toBeLessThan(2_000)
    expect(llamadas[0].init.signal?.aborted).toBe(true)
  })

  it("AC-12: abort del transporte -> TIMEOUT", async () => {
    const abortError = Object.assign(new Error("abortado"), {
      name: "AbortError",
    })
    const { fetchImpl } = crearFetchFalso({ error: abortError })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) {
      expect(resultado.codigo).toBe("TIMEOUT")
      expect(resultado.status).toBeNull()
    }
  })

  it.each([
    new Error("fetch failed"),
    new TypeError("network error"),
    Object.assign(new Error("socket"), { code: "ECONNRESET" }),
  ])("AC-12: error de red (%s) -> RED", async (error) => {
    const { fetchImpl, llamadas } = crearFetchFalso({ error })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (esError(resultado)) {
      expect(resultado.codigo).toBe("RED")
      expect(resultado.status).toBeNull()
    }
    expect(llamadas).toHaveLength(1)
  })
})

describe("T-11 Places: mensajes seguros (AC-12, RF-58)", () => {
  it("AC-12: el mensaje no incluye body, clave, URLs ni PII del proveedor", async () => {
    const cuerpoConSecretos = {
      error: {
        message:
          "API key " +
          CLAVE +
          " invalida para cliente@example.com https://places.googleapis.com/v1/places:searchText?key=" +
          CLAVE,
      },
    }
    const { fetchImpl } = crearFetchFalso({
      status: 500,
      cuerpo: cuerpoConSecretos,
    })

    const resultado = await buscar(
      { textQuery: "negocios" },
      { fetchImpl, apiKey: CLAVE },
    )

    expect(esError(resultado)).toBe(true)
    if (!esError(resultado)) return

    const serializado = JSON.stringify(resultado)

    expect(resultado.mensaje.length).toBeGreaterThan(0)
    expect(resultado.mensaje).not.toContain(CLAVE)
    expect(resultado.mensaje).not.toContain("cliente@example.com")
    expect(resultado.mensaje).not.toContain("Cuerpo del proveedor")
    expect(serializado).not.toContain(CLAVE)
    expect(serializado).not.toContain("cliente@example.com")
    expect(serializado).not.toContain("https://places.googleapis.com")
    expect(Object.keys(resultado).sort()).toEqual([
      "codigo",
      "mensaje",
      "ok",
      "status",
    ])
  })

  it("AC-12: los mensajes de timeout y red son genericos y sin datos internos", async () => {
    const casos: Array<ResultadoPlacesError> = []

    const timeout = await buscar(
      { textQuery: "negocios" },
      {
        fetchImpl: crearFetchFalso({ nuncaResuelve: true }).fetchImpl,
        apiKey: CLAVE,
        timeoutMs: 5,
      },
    )
    if (esError(timeout)) casos.push(timeout)

    const red = await buscar(
      { textQuery: "negocios" },
      {
        fetchImpl: crearFetchFalso({
          error: new Error("connect ECONNREFUSED 10.0.0.5:443"),
        }).fetchImpl,
        apiKey: CLAVE,
      },
    )
    if (esError(red)) casos.push(red)

    expect(casos).toHaveLength(2)
    for (const caso of casos) {
      expect(caso.mensaje.length).toBeGreaterThan(0)
      expect(caso.mensaje).not.toContain("10.0.0.5")
      expect(caso.mensaje).not.toContain(CLAVE)
      expect(caso.mensaje).not.toMatch(/@/)
    }
  })
})
