import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetRateLimit } from "@/lib/rate-limit"
import {
  CAMPANA_LIMITE_DEFAULT,
  CAMPANA_LIMITE_MAX,
  CAMPANA_NOMBRE_MAX,
  campanaCreateSchema,
} from "@/lib/propuestas/validation"

/**
 * T-12 (AC-7, AC-14; RF-9, RF-12): alta de campana de prospeccion.
 *
 * `POST /api/propuestas/campanas` se ejercita con Clerk y Prisma mockeados:
 * - 201 BORRADOR con creador/límites/plantilla y `filtros.soloConWeb=true`;
 * - idempotencia por `idempotencyKey` (doble submit y carrera P2002);
 * - 401/403/409/400/429/503/500 con cuerpo canonico y `Cache-Control: no-store`;
 * - sin llamadas a Places, Resend ni a la web.
 *
 * La suite corre en memoria: el rate limiter real se limpia por clave en cada
 * test para no acoplar casos.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  getUser: vi.fn(),
  campanaFindUnique: vi.fn(),
  campanaCreate: vi.fn(),
  plantillaFindFirst: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campanaProspeccion: {
      findUnique: mocks.campanaFindUnique,
      create: mocks.campanaCreate,
    },
    plantillaPropuesta: { findFirst: mocks.plantillaFindFirst },
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}))

import { POST } from "@/app/api/propuestas/campanas/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.24"
const IP_RATE_LIMIT = "198.51.100.77"
const URL_API = `${ORIGEN}/api/propuestas/campanas`

interface FilaCampana {
  id: string
  estado: string
  creadaPor: string
  creadaPorNombre: string
  idempotencyKey: string
  nombre: string
  consulta: string
  zona: string | null
  rubro: string | null
  limiteCorrida: number
  plantillaId: string | null
  filtros: { soloConWeb: boolean }
}

type DatosCampana = Omit<FilaCampana, "id">

let campanas: FilaCampana[] = []
let plantillas: Array<{ id: string; activa: boolean }> = []
let fetchMock: ReturnType<typeof vi.fn>
let urlOriginal: string | undefined

function uuid(n = 1): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

function cuerpo(overrides: Record<string, unknown> = {}) {
  return {
    nombre: "Estudios contables Palermo",
    consulta: "estudios contables en Palermo, CABA",
    zona: "Palermo, CABA",
    rubro: "Contabilidad",
    limiteCorrida: 10,
    idempotencyKey: uuid(1),
    ...overrides,
  }
}

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function pedido(
  body: unknown = cuerpo(),
  opciones: OpcionesPedido = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" })

  if (opciones.origin !== null) {
    headers.set("origin", opciones.origin ?? ORIGEN)
  }
  if (opciones.ip !== null) {
    headers.set("x-forwarded-for", opciones.ip ?? IP)
  }

  return new Request(URL_API, {
    method: "POST",
    headers,
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function simularAdmin(
  role: unknown = "admin",
  userId = "user_1",
  nombre = "Ana Pérez",
): void {
  mocks.auth.mockResolvedValue({ userId })
  mocks.getUser.mockResolvedValue({
    id: userId,
    fullName: nombre,
    firstName: nombre.split(" ")[0],
    publicMetadata: { role },
  })
}

async function jsonDe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function esperarNoStore(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("no-store")
}

beforeEach(() => {
  vi.clearAllMocks()

  campanas = []
  plantillas = []
  urlOriginal = process.env.NEXT_PUBLIC_URL
  process.env.NEXT_PUBLIC_URL = ORIGEN

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({
    users: { getUser: mocks.getUser },
  })

  // Base falsa en memoria: la idempotencia se prueba de punta a punta.
  mocks.campanaFindUnique.mockImplementation(
    (args: { where: { idempotencyKey: string } }) => {
      const encontrada = campanas.find(
        (campana) => campana.idempotencyKey === args.where.idempotencyKey,
      )
      return Promise.resolve(
        encontrada
          ? {
              id: encontrada.id,
              estado: encontrada.estado,
              creadaPor: encontrada.creadaPor,
            }
          : null,
      )
    },
  )

  mocks.campanaCreate.mockImplementation(
    (args: { data: DatosCampana }) => {
      const fila: FilaCampana = {
        id: `camp_${campanas.length + 1}`,
        ...args.data,
      }
      campanas.push(fila)
      return Promise.resolve({ id: fila.id })
    },
  )

  mocks.plantillaFindFirst.mockImplementation(
    (args: { where: { id: string; activa?: boolean } }) => {
      const encontrada = plantillas.find(
        (plantilla) =>
          plantilla.id === args.where.id &&
          (args.where.activa !== true || plantilla.activa),
      )
      return Promise.resolve(encontrada ? { id: encontrada.id } : null)
    },
  )

  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    "propuestas:user_3",
    `propuestas:ip:${IP}`,
    `propuestas:ip:${IP_RATE_LIMIT}`,
  ]) {
    resetRateLimit(clave)
  }

  // Ninguna prueba puede salir a la red: si la ruta llamara a fetch, el mock
  // lo registraría y las aserciones fallarían.
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (urlOriginal === undefined) {
    delete process.env.NEXT_PUBLIC_URL
  } else {
    process.env.NEXT_PUBLIC_URL = urlOriginal
  }
})

describe("campanaCreateSchema (AC-7, AC-14)", () => {
  it("hace trim y convierte opcionales vacios en undefined", () => {
    const parsed = campanaCreateSchema.parse({
      nombre: "  Campaña Palermo  ",
      consulta: "  estudios contables  ",
      zona: "  CABA  ",
      rubro: "   ",
      plantillaId: "  plantilla_1  ",
      idempotencyKey: uuid(1),
    })

    expect(parsed.nombre).toBe("Campaña Palermo")
    expect(parsed.consulta).toBe("estudios contables")
    expect(parsed.zona).toBe("CABA")
    expect(parsed.rubro).toBeUndefined()
    expect(parsed.plantillaId).toBe("plantilla_1")
  })

  it("usa 20 por defecto y acepta los limites 1 y 20", () => {
    const porDefecto = campanaCreateSchema.parse(cuerpo({ limiteCorrida: undefined }))
    expect(porDefecto.limiteCorrida).toBe(CAMPANA_LIMITE_DEFAULT)
    expect(CAMPANA_LIMITE_DEFAULT).toBe(20)

    expect(
      campanaCreateSchema.parse(cuerpo({ limiteCorrida: 1 })).limiteCorrida,
    ).toBe(1)
    expect(
      campanaCreateSchema.parse(cuerpo({ limiteCorrida: CAMPANA_LIMITE_MAX }))
        .limiteCorrida,
    ).toBe(CAMPANA_LIMITE_MAX)
  })

  it("rechaza nombres, consultas y opcionales fuera de rango", () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ["nombre vacio", { nombre: "" }],
      ["nombre solo espacios", { nombre: "   " }],
      ["nombre demasiado largo", { nombre: "x".repeat(CAMPANA_NOMBRE_MAX + 1) }],
      ["consulta vacia", { consulta: "" }],
      ["consulta solo espacios", { consulta: "   " }],
      ["consulta demasiado larga", { consulta: "x".repeat(501) }],
      ["zona demasiado larga", { zona: "x".repeat(121) }],
      ["rubro demasiado largo", { rubro: "x".repeat(121) }],
      ["plantilla demasiado larga", { plantillaId: "x".repeat(129) }],
      ["sin nombre", { nombre: undefined }],
      ["sin consulta", { consulta: undefined }],
    ]

    for (const [etiqueta, overrides] of casos) {
      expect(
        campanaCreateSchema.safeParse(cuerpo(overrides)).success,
        etiqueta,
      ).toBe(false)
    }
  })

  it("exige limiteCorrida entero entre 1 y 20", () => {
    for (const limiteCorrida of [0, 21, 1.5, -1, Number.NaN]) {
      expect(
        campanaCreateSchema.safeParse(cuerpo({ limiteCorrida })).success,
        String(limiteCorrida),
      ).toBe(false)
    }
  })

  it("exige un idempotencyKey UUID valido", () => {
    // El UUID nil (todo ceros) es estructuralmente valido en Zod 4; se prueban
    // cadenas que no cumplen el formato.
    for (const idempotencyKey of [
      "",
      "no-es-un-uuid",
      "123",
      "00000000-0000-4000-8000-00000000000z",
      "00000000-0000-4000-8000-00000000000",
      undefined,
    ]) {
      expect(
        campanaCreateSchema.safeParse(cuerpo({ idempotencyKey })).success,
        String(idempotencyKey),
      ).toBe(false)
    }
  })
})

describe("POST /api/propuestas/campanas - alta BORRADOR (AC-7)", () => {
  it("crea la campana con creador, limites, plantilla e idempotencia", async () => {
    plantillas = [{ id: "plantilla_1", activa: true }]

    const res = await POST(
      pedido(
        cuerpo({
          plantillaId: "plantilla_1",
          limiteCorrida: 7,
          idempotencyKey: uuid(7),
        }),
      ),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({
      id: "camp_1",
      estado: "BORRADOR",
    })

    expect(campanas).toHaveLength(1)
    const campana = campanas[0]
    expect(campana.nombre).toBe("Estudios contables Palermo")
    expect(campana.consulta).toBe("estudios contables en Palermo, CABA")
    expect(campana.zona).toBe("Palermo, CABA")
    expect(campana.rubro).toBe("Contabilidad")
    expect(campana.estado).toBe("BORRADOR")
    expect(campana.limiteCorrida).toBe(7)
    expect(campana.plantillaId).toBe("plantilla_1")
    expect(campana.creadaPor).toBe("user_1")
    expect(campana.creadaPorNombre).toBe("Ana Pérez")
    expect(campana.idempotencyKey).toBe(uuid(7))
    expect(mocks.plantillaFindFirst).toHaveBeenCalledWith({
      where: { id: "plantilla_1", activa: true },
      select: { id: true },
    })
  })

  it("aplica trim y guarda limiteCorrida 20 por defecto", async () => {
    const res = await POST(
      pedido({
        nombre: "  Campaña Palermo  ",
        consulta: "  estudios contables  ",
        zona: "  CABA  ",
        rubro: "   ",
        idempotencyKey: uuid(2),
      }),
    )

    expect(res.status).toBe(201)
    expect(campanas[0].nombre).toBe("Campaña Palermo")
    expect(campanas[0].consulta).toBe("estudios contables")
    expect(campanas[0].zona).toBe("CABA")
    expect(campanas[0].rubro).toBeNull()
    expect(campanas[0].limiteCorrida).toBe(CAMPANA_LIMITE_DEFAULT)
  })

  it("fuerza filtros.soloConWeb=true e ignora filtros y campos del cliente", async () => {
    const res = await POST(
      pedido(
        cuerpo({
          filtros: { soloConWeb: false, zona: "Mendoza", ciudad: "Godoy Cruz" },
          estado: "PAGADA",
          creadaPor: "otro_admin",
          creadaPorNombre: "Intruso",
        }),
      ),
    )

    expect(res.status).toBe(201)
    expect(campanas).toHaveLength(1)
    expect(campanas[0].filtros).toEqual({ soloConWeb: true })
    expect(campanas[0].estado).toBe("BORRADOR")
    expect(campanas[0].creadaPor).toBe("user_1")
    expect(campanas[0].creadaPorNombre).toBe("Ana Pérez")
  })

  it("responde 400 VALIDACION con cuerpos invalidos y no crea", async () => {
    const invalidos: Array<Record<string, unknown>> = [
      cuerpo({ nombre: "" }),
      cuerpo({ consulta: "   " }),
      cuerpo({ limiteCorrida: 0 }),
      cuerpo({ limiteCorrida: 21 }),
      cuerpo({ limiteCorrida: 1.5 }),
      cuerpo({ idempotencyKey: "no-es-uuid" }),
      cuerpo({ zona: "x".repeat(121) }),
    ]

    for (const body of invalidos) {
      const res = await POST(pedido(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      esperarNoStore(res)
      const json = await jsonDe(res)
      expect(json.codigo).toBe("VALIDACION")
      expect(Object.keys(json).sort()).toEqual(["codigo", "error"])
    }

    expect(mocks.campanaCreate).not.toHaveBeenCalled()
  })

  it("responde 400 VALIDACION si el cuerpo no es JSON", async () => {
    const res = await POST(pedido(undefined, { rawBody: "{no-json" }))

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.campanaCreate).not.toHaveBeenCalled()
  })

  it("responde 400 sin crear si la plantilla no existe o esta inactiva", async () => {
    plantillas = [
      { id: "plantilla_inactiva", activa: false },
      { id: "plantilla_activa", activa: true },
    ]

    for (const plantillaId of ["plantilla_inactiva", "plantilla_fantasma"]) {
      const res = await POST(pedido(cuerpo({ plantillaId })))
      expect(res.status, plantillaId).toBe(400)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    expect(mocks.plantillaFindFirst).toHaveBeenCalledWith({
      where: { id: "plantilla_inactiva", activa: true },
      select: { id: true },
    })
    expect(mocks.campanaCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/campanas - idempotencia (AC-7, RF-12)", () => {
  it("doble submit con la misma clave crea una sola campana y responde 200", async () => {
    const body = cuerpo({ idempotencyKey: uuid(11) })

    const primera = await POST(pedido(body))
    expect(primera.status).toBe(201)
    const creada = await jsonDe(primera)

    const segunda = await POST(pedido(body))
    expect(segunda.status).toBe(200)
    esperarNoStore(segunda)
    await expect(jsonDe(segunda)).resolves.toEqual({
      id: creada.id,
      estado: "BORRADOR",
      reutilizada: true,
    })

    expect(campanas).toHaveLength(1)
    expect(mocks.campanaCreate).toHaveBeenCalledTimes(1)
  })

  it("clave de otro creador responde 409 ESTADO sin revelar id ni datos", async () => {
    const body = cuerpo({ idempotencyKey: uuid(12) })
    const primera = await POST(pedido(body))
    expect(primera.status).toBe(201)
    const creada = await jsonDe(primera)

    simularAdmin("admin", "user_2", "Beto Gómez")
    const res = await POST(pedido(body))

    expect(res.status).toBe(409)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json.codigo).toBe("ESTADO")
    expect(json).not.toHaveProperty("id")
    expect(json).not.toHaveProperty("estado")
    expect(json).not.toHaveProperty("reutilizada")
    expect(JSON.stringify(json)).not.toContain(String(creada.id))
    expect(campanas).toHaveLength(1)
    expect(mocks.campanaCreate).toHaveBeenCalledTimes(1)
  })

  it("carrera P2002: re-busca la ganadora, responde 200 y no duplica", async () => {
    mocks.campanaFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "camp_ganadora",
        estado: "BORRADOR",
        creadaPor: "user_1",
      })
    mocks.campanaCreate.mockRejectedValueOnce({ code: "P2002" })

    const res = await POST(pedido(cuerpo({ idempotencyKey: uuid(13) })))

    expect(res.status).toBe(200)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({
      id: "camp_ganadora",
      estado: "BORRADOR",
      reutilizada: true,
    })
    expect(mocks.campanaCreate).toHaveBeenCalledTimes(1)
    expect(campanas).toHaveLength(0)
  })

  it("carrera P2002 con clave de otro creador responde 409 sin datos", async () => {
    mocks.campanaFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "camp_ajena",
        estado: "BORRADOR",
        creadaPor: "user_2",
      })
    mocks.campanaCreate.mockRejectedValueOnce({ code: "P2002" })

    const res = await POST(pedido(cuerpo({ idempotencyKey: uuid(14) })))

    expect(res.status).toBe(409)
    const json = await jsonDe(res)
    expect(json.codigo).toBe("ESTADO")
    expect(JSON.stringify(json)).not.toContain("camp_ajena")
  })
})

describe("POST /api/propuestas/campanas - autenticacion y origen (AC-7)", () => {
  it("sin sesion responde 401 NO_AUTORIZADO", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await POST(pedido())

    expect(res.status).toBe(401)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_AUTORIZADO" })
    expect(mocks.clerkClient).not.toHaveBeenCalled()
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("la asistente responde 403 PROHIBIDO", async () => {
    simularAdmin("asistente")

    const res = await POST(pedido())

    expect(res.status).toBe(403)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "PROHIBIDO" })
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("no acepta el alias assistant ni roles desconocidos", async () => {
    for (const role of ["assistant", "user", "ADMIN", null]) {
      simularAdmin(role)
      const res = await POST(pedido())
      expect(res.status, String(role)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("PROHIBIDO")
    }
  })

  it("la autenticacion se evalua antes del origen", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await POST(pedido(undefined, { origin: "https://evil.example" }))

    expect(res.status).toBe(401)
    expect((await jsonDe(res)).codigo).toBe("NO_AUTORIZADO")
  })

  it("rechaza origen ausente o cross-site con 403 ORIGEN_INVALIDO", async () => {
    const sinOrigen = await POST(pedido(undefined, { origin: null }))
    expect(sinOrigen.status).toBe(403)
    esperarNoStore(sinOrigen)
    expect((await jsonDe(sinOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    const otroOrigen = await POST(
      pedido(undefined, { origin: "https://evil.example" }),
    )
    expect(otroOrigen.status).toBe(403)
    expect((await jsonDe(otroOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("falla cerrado si NEXT_PUBLIC_URL no es una URL publica valida", async () => {
    process.env.NEXT_PUBLIC_URL = "http://localhost:3000"

    const res = await POST(pedido())

    expect(res.status).toBe(403)
    expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/campanas - rate limit (AC-7)", () => {
  it("bloquea la solicitud 31 del mismo admin con 429 y Retry-After", async () => {
    for (let i = 1; i <= 30; i += 1) {
      const res = await POST(pedido(cuerpo({ idempotencyKey: uuid(i) })))
      expect(res.status, `solicitud ${i}`).toBeLessThan(400)
    }

    const bloqueada = await POST(
      pedido(cuerpo({ idempotencyKey: uuid(31) })),
    )

    expect(bloqueada.status).toBe(429)
    esperarNoStore(bloqueada)
    expect((await jsonDe(bloqueada)).codigo).toBe("RATE_LIMIT")
    const retryAfter = bloqueada.headers.get("retry-after")
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1)
    expect(campanas).toHaveLength(30)
  })

  it("bloquea la solicitud 61 de la misma IP con 429 y Retry-After", async () => {
    simularAdmin("admin", "user_1", "Ana Pérez")
    for (let i = 1; i <= 30; i += 1) {
      await POST(
        pedido(cuerpo({ idempotencyKey: uuid(i) }), { ip: IP_RATE_LIMIT }),
      )
    }

    simularAdmin("admin", "user_2", "Beto Gómez")
    for (let i = 31; i <= 60; i += 1) {
      await POST(
        pedido(cuerpo({ idempotencyKey: uuid(i) }), { ip: IP_RATE_LIMIT }),
      )
    }

    simularAdmin("admin", "user_3", "Caro Díaz")
    const bloqueada = await POST(
      pedido(cuerpo({ idempotencyKey: uuid(61) }), { ip: IP_RATE_LIMIT }),
    )

    expect(bloqueada.status).toBe(429)
    esperarNoStore(bloqueada)
    expect((await jsonDe(bloqueada)).codigo).toBe("RATE_LIMIT")
    expect(Number(bloqueada.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
  })
})

describe("POST /api/propuestas/campanas - errores de infraestructura (AC-7)", () => {
  it("P2021 al leer responde 503 ESQUEMA_NO_APLICADO", async () => {
    mocks.campanaFindUnique.mockRejectedValueOnce({ code: "P2021" })

    const res = await POST(pedido())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json.codigo).toBe("ESQUEMA_NO_APLICADO")
    expect(Object.keys(json).sort()).toEqual(["codigo", "error"])
    expect(mocks.campanaCreate).not.toHaveBeenCalled()
  })

  it("tabla faltante al crear responde 503 ESQUEMA_NO_APLICADO", async () => {
    mocks.campanaFindUnique.mockResolvedValueOnce(null)
    mocks.campanaCreate.mockRejectedValueOnce({
      code: "P2010",
      meta: { code: "42P01" },
    })

    const res = await POST(pedido())

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
  })

  it("error inesperado responde 500 DESCONOCIDO sin PII ni detalles", async () => {
    mocks.campanaFindUnique.mockRejectedValueOnce(
      new Error(
        "fallo de Prisma con juan@example.com en https://interno.test/db?token=secreto",
      ),
    )

    const res = await POST(pedido())

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json.codigo).toBe("DESCONOCIDO")
    expect(json.error).toBe("Error inesperado.")
    expect(Object.keys(json).sort()).toEqual(["codigo", "error"])

    const crudo = JSON.stringify(json)
    expect(crudo).not.toContain("juan@example.com")
    expect(crudo).not.toContain("interno.test")
    expect(crudo).not.toContain("Prisma")
    expect(crudo).not.toContain("secreto")

    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    const [, contexto] = mocks.loggerError.mock.calls[0]
    expect(contexto).toEqual({ codigo: "DESCONOCIDO", adminId: "user_1" })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "juan@example.com",
    )
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "interno.test",
    )
  })
})

describe("aislamiento y efectos de red (AC-7)", () => {
  it("no llama a Places, Resend ni a la web al crear una campana", async () => {
    const res = await POST(pedido())

    expect(res.status).toBe(201)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("la ruta no importa integraciones ni modelos del CRM", () => {
    const fuente = readFileSync(
      join(
        process.cwd(),
        "src",
        "app",
        "api",
        "propuestas",
        "campanas",
        "route.ts",
      ),
      "utf8",
    )

    expect(fuente).not.toMatch(
      /from "@\/lib\/propuestas\/(places|web|resend|auditoria)"/,
    )
    expect(fuente).not.toMatch(/@\/lib\/resend/)
    expect(fuente).not.toMatch(
      /prisma\.(cliente|pago|suscripcion|enlacePago|proyecto|hito)\b/i,
    )
    expect(fuente).not.toMatch(/requireStaff|requireAdmin/)
  })
})
