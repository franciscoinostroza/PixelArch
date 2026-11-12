import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import {
  ErrorCupo,
  type AmbitoErrorCupo,
  type CodigoErrorCupo,
} from "@/lib/propuestas/consumo"
import { sanitizarError } from "@/lib/propuestas/errores"
import {
  CAMPANA_LIMITE_DEFAULT,
  CAMPANA_LIMITE_MAX,
  CAMPANA_NOMBRE_MAX,
  campanaCreateSchema,
} from "@/lib/propuestas/validation"

/**
 * T-12 (AC-7, AC-14; RF-9, RF-12): alta de campana de prospeccion.
 * T-13 (AC-8, AC-11, AC-12, AC-14; RF-10..12, RF-16, RF-17): ejecucion y
 * cancelacion de una campana.
 *
 * `POST /api/propuestas/campanas` se ejercita con Clerk y Prisma mockeados:
 * - 201 BORRADOR con creador/límites/plantilla y `filtros.soloConWeb=true`;
 * - idempotencia por `idempotencyKey` (doble submit y carrera P2002);
 * - 401/403/409/400/429/503/500 con cuerpo canonico y `Cache-Control: no-store`;
 * - sin llamadas a Places, Resend ni a la web.
 *
 * Para `/ejecutar` y `/cancelar` se simula la base en memoria (transiciones
 * atomicas incluidas) y se mockean el cliente de Places y la reserva de cupo.
 * `prisma.$transaction` se mockea para verificar que `reservarCupo` recibe el
 * `tx` de la transaccion. Ningun test hace fetch real.
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
  campanaUpdateMany: vi.fn(),
  prospectoFindMany: vi.fn(),
  prospectoCreate: vi.fn(),
  prospectoFindUnique: vi.fn(),
  supresionFindFirst: vi.fn(),
  transaction: vi.fn(),
  reservarCupo: vi.fn(),
  buscarLugaresPlaces: vi.fn(),
  plantillaFindFirst: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    consumoProveedor: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
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
      updateMany: mocks.campanaUpdateMany,
    },
    prospecto: {
      findMany: mocks.prospectoFindMany,
      create: mocks.prospectoCreate,
      findUnique: mocks.prospectoFindUnique,
    },
    supresionProspecto: { findFirst: mocks.supresionFindFirst },
    plantillaPropuesta: { findFirst: mocks.plantillaFindFirst },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

// Sin red: el cliente de Places se reemplaza por un mock controlable.
vi.mock("@/lib/propuestas/places", () => ({
  buscarLugaresPlaces: mocks.buscarLugaresPlaces,
}))

// Se conserva la implementacion real de `ErrorCupo`/`esErrorCupo`; solo se
// intercepta la reserva para verificar la transaccion y simular cupo agotado.
vi.mock("@/lib/propuestas/consumo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/propuestas/consumo")>()
  return { ...actual, reservarCupo: mocks.reservarCupo }
})

import { POST } from "@/app/api/propuestas/campanas/route"
import { POST as ejecutarCampana } from "@/app/api/propuestas/campanas/[id]/ejecutar/route"
import { POST as cancelarCampana } from "@/app/api/propuestas/campanas/[id]/cancelar/route"

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

/* ------------------------------------------------------------------ */
/* Simulacion de base y helpers de T-13 (ejecutar / cancelar)          */
/* ------------------------------------------------------------------ */

interface CampanaBd {
  id: string
  consulta: string
  zona: string | null
  rubro: string | null
  estado: string
  limiteCorrida: number
  iniciadaEn: Date | null
  finalizadaEn: Date | null
  ultimoError: string | null
}

let campanasBd: Map<string, CampanaBd>
let prospectosCreados: Array<Record<string, unknown>>
let placesKeyOriginal: string | undefined
let cupoPlacesOriginal: string | undefined

function campanaBd(overrides: Partial<CampanaBd> = {}): CampanaBd {
  return {
    id: "camp_1",
    consulta: "estudios contables en Palermo, CABA",
    zona: "Palermo, CABA",
    rubro: "Contabilidad",
    estado: "BORRADOR",
    limiteCorrida: 10,
    iniciadaEn: null,
    finalizadaEn: null,
    ultimoError: null,
    ...overrides,
  }
}

function instalarCampana(campana: CampanaBd): CampanaBd {
  campanasBd.set(campana.id, campana)
  return campana
}

function contexto(id = "camp_1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function pedidoAccion(
  accion: "ejecutar" | "cancelar",
  id = "camp_1",
  body: unknown = { confirmado: true },
  opciones: OpcionesPedido = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" })

  if (opciones.origin !== null) {
    headers.set("origin", opciones.origin ?? ORIGEN)
  }
  if (opciones.ip !== null) {
    headers.set("x-forwarded-for", opciones.ip ?? IP)
  }

  return new Request(
    `${ORIGEN}/api/propuestas/campanas/${id}/${accion}`,
    {
      method: "POST",
      headers,
      body: opciones.rawBody ?? JSON.stringify(body),
    },
  )
}

async function esperarLlamada(
  mock: ReturnType<typeof vi.fn>,
  veces = 1,
): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(veces))
}

beforeEach(() => {
  vi.clearAllMocks()

  campanas = []
  plantillas = []
  campanasBd = new Map()
  prospectosCreados = []

  urlOriginal = process.env.NEXT_PUBLIC_URL
  process.env.NEXT_PUBLIC_URL = ORIGEN
  placesKeyOriginal = process.env.PROPUESTAS_PLACES_API_KEY
  cupoPlacesOriginal = process.env.PROPUESTAS_CUPO_PLACES_DIA
  process.env.PROPUESTAS_PLACES_API_KEY = "test-places-key"
  process.env.PROPUESTAS_CUPO_PLACES_DIA = "20"

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({
    users: { getUser: mocks.getUser },
  })

  // Base falsa en memoria: la idempotencia se prueba de punta a punta y las
  // transiciones de estado de T-13 se comportan como `updateMany` reales.
  mocks.campanaFindUnique.mockImplementation(
    (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {}

      if (typeof where.id === "string") {
        const campana = campanasBd.get(where.id)
        return Promise.resolve(campana ? { ...campana } : null)
      }

      if (typeof where.idempotencyKey === "string") {
        const encontrada = campanas.find(
          (campana) => campana.idempotencyKey === where.idempotencyKey,
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
      }

      return Promise.resolve(null)
    },
  )

  mocks.campanaUpdateMany.mockImplementation(
    (args: {
      where?: Record<string, unknown>
      data?: Record<string, unknown>
    }) => {
      const where = args?.where ?? {}
      const campana =
        typeof where.id === "string" ? campanasBd.get(where.id) : undefined
      if (!campana) return Promise.resolve({ count: 0 })

      const estadoWhere = where.estado
      let coincide: boolean

      if (typeof estadoWhere === "string") {
        coincide = campana.estado === estadoWhere
      } else if (
        estadoWhere &&
        typeof estadoWhere === "object" &&
        Array.isArray((estadoWhere as { in?: unknown[] }).in)
      ) {
        coincide = (estadoWhere as { in: string[] }).in.includes(campana.estado)
      } else {
        coincide = true
      }

      if (!coincide) return Promise.resolve({ count: 0 })

      Object.assign(campana, args.data ?? {})
      return Promise.resolve({ count: 1 })
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

  mocks.prospectoFindMany.mockResolvedValue([])
  mocks.supresionFindFirst.mockResolvedValue(null)
  mocks.prospectoFindUnique.mockResolvedValue(null)
  mocks.prospectoCreate.mockImplementation(
    (args: { data: Record<string, unknown> }) => {
      prospectosCreados.push(args.data)
      return Promise.resolve({ id: `pros_${prospectosCreados.length}` })
    },
  )

  // La reserva real se prueba en propuestas-consumo.test.ts. Aca se verifica
  // que la ruta la ejecute dentro de `$transaction` con el `tx` correcto.
  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )
  mocks.reservarCupo.mockResolvedValue({ restantes: 19 })
  mocks.buscarLugaresPlaces.mockResolvedValue({ ok: true, lugares: [] })

  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    "propuestas:user_3",
    "propuestas:busqueda:user_1",
    "propuestas:busqueda:user_2",
    "propuestas:busqueda:user_3",
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

  for (const [clave, valor] of [
    ["NEXT_PUBLIC_URL", urlOriginal],
    ["PROPUESTAS_PLACES_API_KEY", placesKeyOriginal],
    ["PROPUESTAS_CUPO_PLACES_DIA", cupoPlacesOriginal],
  ] as const) {
    if (valor === undefined) {
      delete process.env[clave]
    } else {
      process.env[clave] = valor
    }
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

/* ------------------------------------------------------------------ */
/* T-13 (AC-8, AC-11, AC-12, AC-14; RF-10..12, RF-16, RF-17)           */
/* POST /api/propuestas/campanas/[id]/ejecutar                         */
/* ------------------------------------------------------------------ */

function candidatosDe(json: Record<string, unknown>): Array<{
  placeId: string
  nombreTransitorio: string | null
  sitioWeb: string | null
  resultado: string
}> {
  return json.candidatos as Array<{
    placeId: string
    nombreTransitorio: string | null
    sitioWeb: string | null
    resultado: string
  }>
}

function datosDeCreacion(indice = 0): Record<string, unknown> {
  const llamada = mocks.prospectoCreate.mock.calls[indice] as
    | [{ data: Record<string, unknown> }]
    | undefined
  expect(llamada).toBeDefined()
  return llamada![0].data
}

describe("POST /api/propuestas/campanas/[id]/ejecutar - corrida (AC-8, AC-11, AC-14)", () => {
  it("hace una sola llamada a Places con pageSize=limiteCorrida y crea prospectos con fuente PLACES", async () => {
    const campana = instalarCampana(
      campanaBd({
        consulta: "estudios contables en Palermo",
        zona: "Palermo, CABA",
        rubro: "Contabilidad",
        limiteCorrida: 7,
      }),
    )

    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p1",
          nombreTransitorio: "Alfa (Places)",
          sitioWeb: "https://www.alfa.com.ar/contacto",
        },
        {
          placeId: "p2",
          nombreTransitorio: "Facebook",
          sitioWeb: "https://facebook.com/alfa",
        },
        {
          placeId: "p3",
          nombreTransitorio: "Sin web",
          sitioWeb: null,
        },
        {
          placeId: "p4",
          nombreTransitorio: "Basura",
          sitioWeb: "no-es-url",
        },
      ],
    })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(200)
    esperarNoStore(res)

    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 1,
      reutilizados: 0,
      duplicados: 0,
      omitidos: 3,
    })
    expect(candidatosDe(json).map((c) => c.resultado)).toEqual([
      "CREADO",
      "FUENTE_NO_PERMITIDA",
      "SIN_WEB",
      "FUENTE_NO_PERMITIDA",
    ])
    expect(candidatosDe(json)[0].placeId).toBe("p1")
    expect(candidatosDe(json)[0].nombreTransitorio).toBe("Alfa (Places)")
    expect(candidatosDe(json)[0].sitioWeb).toBe(
      "https://www.alfa.com.ar/contacto",
    )

    // Una sola request a Places, acotada al limite guardado de la campana.
    expect(mocks.buscarLugaresPlaces).toHaveBeenCalledTimes(1)
    expect(mocks.buscarLugaresPlaces).toHaveBeenCalledWith({
      textQuery: "estudios contables en Palermo",
      pageSize: 7,
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // La reserva corre dentro de $transaction y recibe el tx.
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(typeof mocks.transaction.mock.calls[0][0]).toBe("function")
    expect(mocks.reservarCupo).toHaveBeenCalledTimes(1)
    expect(mocks.reservarCupo.mock.calls[0][0]).toBe(mocks.tx)
    expect(mocks.reservarCupo).toHaveBeenCalledWith(mocks.tx, {
      campanaId: "camp_1",
      proveedor: "GOOGLE_PLACES",
      cantidad: 1,
      llamadas: 1,
    })

    const data = datosDeCreacion()
    expect(data).toMatchObject({
      nombreNegocio: "Alfa",
      sitioWeb: "https://alfa.com.ar/contacto",
      dominioNormalizado: "alfa.com.ar",
      ciudad: "Palermo, CABA",
      rubro: "Contabilidad",
      placeId: "p1",
      estado: "NUEVO",
      fuenteTipo: "PLACES",
      fuenteUrl: "https://alfa.com.ar/contacto",
      posibleDuplicadoDeId: null,
      campanaOrigenId: "camp_1",
      fechaFuente: expect.any(Date),
    })
    // El nombre transitorio de Places no se persiste (D-5/Q-12).
    expect(data).not.toHaveProperty("nombreTransitorio")
    expect(JSON.stringify(data)).not.toContain("Alfa (Places)")

    expect(campana.estado).toBe("COMPLETADA")
    expect(campana.ultimoError).toBeNull()
    expect(campana.finalizadaEn).toBeInstanceOf(Date)
  })

  it("usa el limite por defecto si el valor guardado es invalido", async () => {
    instalarCampana(campanaBd({ limiteCorrida: 99 }))

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(200)
    expect(mocks.buscarLugaresPlaces).toHaveBeenCalledWith({
      textQuery: "estudios contables en Palermo, CABA",
      pageSize: CAMPANA_LIMITE_DEFAULT,
    })
  })
})

describe("POST /api/propuestas/campanas/[id]/ejecutar - transicion atomica (AC-11, RF-12)", () => {
  it("un doble clic concurrente recibe 409 y Places se llama una sola vez", async () => {
    instalarCampana(campanaBd())

    let resolver: (valor: unknown) => void = () => undefined
    mocks.buscarLugaresPlaces.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )

    const primera = ejecutarCampana(pedidoAccion("ejecutar"), contexto())
    await esperarLlamada(mocks.buscarLugaresPlaces)

    const segunda = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())
    expect(segunda.status).toBe(409)
    esperarNoStore(segunda)
    expect((await jsonDe(segunda)).codigo).toBe("ESTADO")
    expect(mocks.buscarLugaresPlaces).toHaveBeenCalledTimes(1)

    resolver({ ok: true, lugares: [] })
    const primeraRes = await primera
    expect(primeraRes.status).toBe(200)
    expect((await jsonDe(primeraRes)).estado).toBe("COMPLETADA")
  })

  it("una campana que ya no esta en BORRADOR responde 409 sin llamar a Places", async () => {
    for (const estado of [
      "EN_CURSO",
      "COMPLETADA",
      "PARCIAL",
      "CANCELADA",
      "FALLIDA",
    ]) {
      campanasBd.clear()
      instalarCampana(campanaBd({ estado }))

      const res = await ejecutarCampana(
        pedidoAccion("ejecutar"),
        contexto(),
      )

      expect(res.status, estado).toBe(409)
      expect((await jsonDe(res)).codigo).toBe("ESTADO")
    }

    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("si updateMany no gana la transicion responde 409 y no reserva cupo", async () => {
    const campana = instalarCampana(campanaBd())

    mocks.campanaUpdateMany.mockResolvedValueOnce({ count: 0 })
    mocks.campanaFindUnique
      .mockResolvedValueOnce({ ...campana })
      .mockResolvedValueOnce({ id: "camp_1", estado: "EN_CURSO" })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.reservarCupo).not.toHaveBeenCalled()
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
  })

  it("una cancelacion durante la reserva responde 409 ESTADO y no llama a Places (AC-11, RF-12)", async () => {
    const campana = instalarCampana(campanaBd())

    // La campana se cancela despues de la transicion y de reservar cupo, pero
    // antes de la llamada a Places: la revalidacion debe cortar la corrida.
    mocks.transaction.mockImplementationOnce(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => {
        const resultado = await callback(mocks.tx)
        campana.estado = "CANCELADA"
        campana.finalizadaEn = new Date()
        return resultado
      },
    )

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(campana.estado).toBe("CANCELADA")
    expect(mocks.reservarCupo).toHaveBeenCalledTimes(1)
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/campanas/[id]/ejecutar - guard, origen y rate (AC-8)", () => {
  it("sin sesion responde 401 y no consulta la campana", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(401)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_AUTORIZADO")
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("la asistente responde 403 PROHIBIDO", async () => {
    simularAdmin("asistente")

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(403)
    expect((await jsonDe(res)).codigo).toBe("PROHIBIDO")
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403 ORIGEN_INVALIDO", async () => {
    for (const opciones of [
      { origin: null },
      { origin: "https://evil.example" },
    ]) {
      const res = await ejecutarCampana(
        pedidoAccion("ejecutar", "camp_1", { confirmado: true }, opciones),
        contexto(),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea la 11.ª corrida por minuto del mismo admin con 429", async () => {
    instalarCampana(campanaBd())

    // Los 10 primeros intentos cuentan para el rate limit aunque el body sea
    // invalido; la 11.ª solicitud se corta antes de validar y mutar.
    for (let i = 1; i <= 10; i += 1) {
      const res = await ejecutarCampana(
        pedidoAccion("ejecutar", "camp_1", { confirmado: false }),
        contexto(),
      )
      expect(res.status, `intento ${i}`).toBe(400)
    }

    const bloqueada = await ejecutarCampana(
      pedidoAccion("ejecutar"),
      contexto(),
    )

    expect(bloqueada.status).toBe(429)
    esperarNoStore(bloqueada)
    expect((await jsonDe(bloqueada)).codigo).toBe("RATE_LIMIT")
    expect(
      Number(bloqueada.headers.get("retry-after")),
    ).toBeGreaterThanOrEqual(1)
    expect(campanasBd.get("camp_1")?.estado).toBe("BORRADOR")
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("el limite general de 30/min por admin responde 429", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
  })

  it("el limite de 60/min por IP responde 429", async () => {
    for (let i = 0; i < 60; i += 1) {
      expect(rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000).permitido).toBe(
        true,
      )
    }

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
  })
})

describe("POST /api/propuestas/campanas/[id]/ejecutar - configuracion y cupo (AC-11, AC-12, AC-42)", () => {
  it("sin clave de Places responde 503 y deja la campana en BORRADOR sin consumir cupo", async () => {
    delete process.env.PROPUESTAS_PLACES_API_KEY
    const campana = instalarCampana(campanaBd())

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_CONFIGURADO")
    expect(campana.estado).toBe("BORRADOR")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.reservarCupo).not.toHaveBeenCalled()
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it.each(["0", "-1", "abc", "1.5", "99999999999999999999"])(
    "cupo Places invalido (%s) responde 503 CONFIGURACION sin mover la campana (AC-11, AC-42)",
    async (valor) => {
      process.env.PROPUESTAS_CUPO_PLACES_DIA = valor
      const campana = instalarCampana(campanaBd())

      const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

      expect(res.status).toBe(503)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("CONFIGURACION")
      expect(campana.estado).toBe("BORRADOR")
      expect(campana.iniciadaEn).toBeNull()
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.reservarCupo).not.toHaveBeenCalled()
      expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    },
  )

  const casosAmbitoErrorCupo: Array<{
    ambito: AmbitoErrorCupo
    codigo: CodigoErrorCupo
    status: number
    codigoEsperado: string
  }> = [
    // Configuracion/validacion no son un tope alcanzado: 503 CONFIGURACION.
    {
      ambito: "CONFIGURACION",
      codigo: "LIMITE",
      status: 503,
      codigoEsperado: "CONFIGURACION",
    },
    {
      ambito: "CONFIGURACION",
      codigo: "CUPO",
      status: 503,
      codigoEsperado: "CONFIGURACION",
    },
    {
      ambito: "VALIDACION",
      codigo: "LIMITE",
      status: 503,
      codigoEsperado: "CONFIGURACION",
    },
    {
      ambito: "VALIDACION",
      codigo: "CUPO",
      status: 503,
      codigoEsperado: "CONFIGURACION",
    },
    // Topes reales: se conserva el 429 con CUPO/LIMITE.
    {
      ambito: "CAMPANA",
      codigo: "CUPO",
      status: 429,
      codigoEsperado: "CUPO",
    },
    {
      ambito: "PRESUPUESTO",
      codigo: "LIMITE",
      status: 429,
      codigoEsperado: "LIMITE",
    },
  ]

  it.each(casosAmbitoErrorCupo)(
    "ErrorCupo $ambito/$codigo responde $status $codigoEsperado y deja FALLIDA (AC-11, AC-12)",
    async ({ ambito, codigo, status, codigoEsperado }) => {
      const campana = instalarCampana(campanaBd())
      mocks.reservarCupo.mockRejectedValueOnce(
        new ErrorCupo({ codigo, ambito }),
      )

      const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

      expect(res.status).toBe(status)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe(codigoEsperado)
      expect(campana.estado).toBe("FALLIDA")
      expect(campana.finalizadaEn).toBeInstanceOf(Date)
      expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    },
  )

  it("ErrorCupo deja la campana FALLIDA y responde 429 CUPO sin llamar a Places", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.reservarCupo.mockRejectedValueOnce(new ErrorCupo({ codigo: "CUPO" }))

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(429)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json.codigo).toBe("CUPO")
    expect(campana.estado).toBe("FALLIDA")
    expect(campana.ultimoError).toBe("Se alcanzo el cupo configurado.")
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("ErrorCupo de presupuesto responde 429 LIMITE y deja FALLIDA", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.reservarCupo.mockRejectedValueOnce(new ErrorCupo({ codigo: "LIMITE" }))

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("LIMITE")
    expect(campana.estado).toBe("FALLIDA")
    expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
  })

  it.each([
    ["CUOTA", 429, 429],
    ["PROVEEDOR", 503, 502],
    ["TIMEOUT", null, 502],
    ["CREDENCIALES", 401, 502],
    ["CONFIGURACION", 400, 503],
  ])(
    "Places falla con %s: campana FALLIDA, HTTP %i y sin prospectos",
    async (codigo, statusPlaces, httpEsperado) => {
      const campana = instalarCampana(campanaBd())
      mocks.buscarLugaresPlaces.mockResolvedValueOnce({
        ok: false,
        codigo,
        status: statusPlaces,
        mensaje: "detalle crudo que no debe salir",
      })

      const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

      expect(res.status).toBe(httpEsperado)
      esperarNoStore(res)
      const json = await jsonDe(res)
      expect(json.codigo).toBe(codigo)
      expect(JSON.stringify(json)).not.toContain("detalle crudo")
      expect(campana.estado).toBe("FALLIDA")
      expect(campana.ultimoError).toBe(
        sanitizarError(null, { codigo: codigo as never }).mensaje,
      )
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    },
  )

  it("una excepcion inesperada del cliente Places responde 502 sin PII", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockRejectedValueOnce(
      new Error("places caido para juan@example.com"),
    )

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(502)
    expect((await jsonDe(res)).codigo).toBe("PROVEEDOR")
    expect(campana.estado).toBe("FALLIDA")
    expect(campana.ultimoError).not.toContain("juan@example.com")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/campanas/[id]/ejecutar - procesamiento y dedupe (AC-12, AC-14)", () => {
  it("omite sin web, fuentes sociales/agregadores y dominios suprimidos", async () => {
    instalarCampana(campanaBd())

    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        { placeId: "p1", nombreTransitorio: "Sin web", sitioWeb: null },
        {
          placeId: "p2",
          nombreTransitorio: "Facebook",
          sitioWeb: "https://facebook.com/alfa",
        },
        {
          placeId: "p3",
          nombreTransitorio: "Linktree",
          sitioWeb: "https://linktr.ee/alfa",
        },
        {
          placeId: "p4",
          nombreTransitorio: "Alfa",
          sitioWeb: "https://www.alfa.com.ar",
        },
      ],
    })
    mocks.supresionFindFirst.mockImplementation(
      (args: { where: { dominioNegocio?: string } }) =>
        Promise.resolve(
          args.where.dominioNegocio === "alfa.com.ar" ? { id: "sup_1" } : null,
        ),
    )

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(200)
    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 0,
      omitidos: 4,
    })
    expect(candidatosDe(json).map((c) => c.resultado)).toEqual([
      "SIN_WEB",
      "FUENTE_NO_PERMITIDA",
      "FUENTE_NO_PERMITIDA",
      "SUPRIMIDO",
    ])
    expect(mocks.supresionFindFirst).toHaveBeenCalledWith({
      where: {
        ambito: "DOMINIO",
        activa: true,
        dominioNegocio: "alfa.com.ar",
      },
      select: { id: true },
    })
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("reutiliza un placeId existente sin crear ni duplicar", async () => {
    instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p1",
          nombreTransitorio: "Alfa",
          sitioWeb: "https://www.alfa.com.ar",
        },
      ],
    })
    mocks.prospectoFindMany.mockResolvedValue([
      { id: "pros_1", placeId: "p1", dominioNormalizado: "alfa.com.ar" },
    ])

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 0,
      reutilizados: 1,
      duplicados: 0,
    })
    expect(candidatosDe(json)[0].resultado).toBe("REUTILIZADO")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("marca POSIBLE_DUPLICADO cuando el dominio pertenece a otro placeId", async () => {
    instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p_nuevo",
          nombreTransitorio: "Alfa sucursal",
          sitioWeb: "https://www.alfa.com.ar/sucursal",
        },
      ],
    })
    mocks.prospectoFindMany.mockResolvedValue([
      {
        id: "pros_previo",
        placeId: "p_previo",
        dominioNormalizado: "alfa.com.ar",
      },
    ])

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 0,
      duplicados: 1,
    })
    expect(candidatosDe(json)[0].resultado).toBe("POSIBLE_DUPLICADO")
    // Se guarda el dominio registrable (no el host ni `www`) y `sitioWeb`
    // conserva el host canonico; el prospecto existente no se fusiona solo.
    expect(datosDeCreacion()).toMatchObject({
      placeId: "p_nuevo",
      sitioWeb: "https://alfa.com.ar/sucursal",
      dominioNormalizado: "alfa.com.ar",
      posibleDuplicadoDeId: "pros_previo",
    })
    expect(mocks.prospectoCreate).toHaveBeenCalledTimes(1)
  })

  it("trata un dominio de proveedor publico como FUENTE_NO_PERMITIDA sin deduplicar (AC-14)", async () => {
    instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p_gmail",
          nombreTransitorio: "Alfa Gmail",
          sitioWeb: "https://www.gmail.com/alfa",
        },
      ],
    })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(200)
    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 0,
      omitidos: 1,
    })
    expect(candidatosDe(json)[0].resultado).toBe("FUENTE_NO_PERMITIDA")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    expect(mocks.prospectoFindMany).not.toHaveBeenCalled()
    expect(mocks.supresionFindFirst).not.toHaveBeenCalled()
  })

  it("una carrera P2002 por placeId se resuelve reutilizando el ganador", async () => {
    instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p1",
          nombreTransitorio: "Alfa",
          sitioWeb: "https://www.alfa.com.ar",
        },
      ],
    })
    mocks.prospectoCreate.mockRejectedValueOnce({ code: "P2002" })
    mocks.prospectoFindUnique.mockResolvedValueOnce({ id: "pros_ganador" })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "COMPLETADA",
      creados: 0,
      reutilizados: 1,
    })
    expect(candidatosDe(json)[0].resultado).toBe("REUTILIZADO")
    expect(mocks.prospectoCreate).toHaveBeenCalledTimes(1)
    expect(mocks.prospectoFindUnique).toHaveBeenCalledWith({
      where: { placeId: "p1" },
      select: { id: true },
    })
  })

  it("un error de creacion aislado deja PARCIAL conservando los creados", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValue({
      ok: true,
      lugares: [
        {
          placeId: "p1",
          nombreTransitorio: "Alfa",
          sitioWeb: "https://www.alfa.com.ar",
        },
        {
          placeId: "p2",
          nombreTransitorio: "Beta",
          sitioWeb: "https://www.beta.com.ar",
        },
        {
          placeId: "p3",
          nombreTransitorio: "Gamma",
          sitioWeb: "https://www.gamma.com.ar",
        },
      ],
    })
    mocks.prospectoCreate
      .mockResolvedValueOnce({ id: "pros_1" })
      .mockRejectedValueOnce(new Error("fallo puntual de escritura"))
      .mockResolvedValueOnce({ id: "pros_3" })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(200)
    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "PARCIAL",
      creados: 2,
      omitidos: 1,
      duplicados: 0,
    })
    expect(candidatosDe(json).map((c) => c.resultado)).toEqual([
      "CREADO",
      "ERROR",
      "CREADO",
    ])
    expect(campana.estado).toBe("PARCIAL")
    expect(campana.ultimoError).toBe(
      "Algunos resultados no se pudieron guardar.",
    )
    expect(mocks.prospectoCreate).toHaveBeenCalledTimes(3)
    expect(mocks.loggerWarn).toHaveBeenCalled()
  })

  it("respeta CANCELADA si cancelan la campana durante la corrida", async () => {
    const campana = instalarCampana(campanaBd())

    let resolver: (valor: unknown) => void = () => undefined
    mocks.buscarLugaresPlaces.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )

    const corrida = ejecutarCampana(pedidoAccion("ejecutar"), contexto())
    await esperarLlamada(mocks.buscarLugaresPlaces)
    expect(campana.estado).toBe("EN_CURSO")

    const cancelacion = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(cancelacion.status).toBe(200)
    expect(campana.estado).toBe("CANCELADA")

    resolver({
      ok: true,
      lugares: [
        {
          placeId: "p1",
          nombreTransitorio: "Alfa",
          sitioWeb: "https://www.alfa.com.ar",
        },
      ],
    })
    const res = await corrida

    expect(res.status).toBe(200)
    expect((await jsonDe(res)).estado).toBe("CANCELADA")
    expect(campana.estado).toBe("CANCELADA")
  })
})

describe("POST /api/propuestas/campanas/[id]/ejecutar - errores (AC-12, AC-41)", () => {
  it("campaña inexistente responde 404 NO_ENCONTRADO", async () => {
    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("esquema faltante responde 503 ESQUEMA_NO_APLICADO", async () => {
    mocks.campanaFindUnique.mockRejectedValueOnce({ code: "P2021" })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
  })

  it.each(["transaction", "reserva"] as const)(
    "P2021 en la %s responde 503 ESQUEMA_NO_APLICADO, cierra FALLIDA y no llama a Places (AC-11, AC-12)",
    async (origen) => {
      const campana = instalarCampana(campanaBd())
      if (origen === "transaction") {
        mocks.transaction.mockRejectedValueOnce({ code: "P2021" })
      } else {
        mocks.reservarCupo.mockRejectedValueOnce({ code: "P2021" })
      }

      const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

      expect(res.status).toBe(503)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
      // La transicion a EN_CURSO ya ocurrio: el cierre de mejor esfuerzo debe
      // dejar la campana FALLIDA y no colgada.
      expect(campana.estado).toBe("FALLIDA")
      expect(campana.estado).not.toBe("EN_CURSO")
      expect(campana.finalizadaEn).toBeInstanceOf(Date)
      expect(campana.ultimoError).toBe(
        "El esquema del portal no esta aplicado.",
      )
      // 1.ª llamada: transicion BORRADOR -> EN_CURSO; 2.ª: cierre FALLIDA.
      expect(mocks.campanaUpdateMany).toHaveBeenCalledTimes(2)
      expect(mocks.campanaUpdateMany.mock.calls[1]?.[0]).toMatchObject({
        where: { id: "camp_1", estado: "EN_CURSO" },
        data: { estado: "FALLIDA" },
      })
      expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
      if (origen === "transaction") {
        expect(mocks.reservarCupo).not.toHaveBeenCalled()
      } else {
        expect(mocks.reservarCupo).toHaveBeenCalledTimes(1)
      }
    },
  )

  it("si el cierre por fallo de Places lanza, igual intenta el cierre de mejor esfuerzo (AC-12, AC-42)", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.buscarLugaresPlaces.mockResolvedValueOnce({
      ok: false,
      codigo: "CUOTA",
      status: 429,
    })
    // La 1.ª llamada de `updateMany` es la transicion (se resuelve); la 2.ª es
    // el cierre por el fallo de Places y lanza P2021; la 3.ª es el cierre de
    // mejor esfuerzo del catch exterior (vuelve a la implementacion base).
    mocks.campanaUpdateMany
      .mockImplementationOnce(async () => {
        campana.estado = "EN_CURSO"
        campana.iniciadaEn = new Date()
        return { count: 1 }
      })
      .mockRejectedValueOnce({ code: "P2021" })

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
    // Primer cierre (fallo de Places) lanza P2021; el catch exterior vuelve a
    // intentar el cierre de mejor esfuerzo.
    expect(mocks.campanaUpdateMany).toHaveBeenCalledTimes(3)
    expect(mocks.campanaUpdateMany.mock.calls[2]?.[0]).toMatchObject({
      where: { id: "camp_1", estado: "EN_CURSO" },
      data: { estado: "FALLIDA" },
    })
    expect(campana.estado).toBe("FALLIDA")
    expect(mocks.buscarLugaresPlaces).toHaveBeenCalledTimes(1)
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("error inesperado responde 500 sanitizado y deja la campana FALLIDA", async () => {
    const campana = instalarCampana(campanaBd())
    mocks.transaction.mockRejectedValueOnce(
      new Error(
        "fallo con juan@example.com en https://interno.test/db?token=secreto",
      ),
    )

    const res = await ejecutarCampana(pedidoAccion("ejecutar"), contexto())

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json).toEqual({
      error: "Error inesperado.",
      codigo: "DESCONOCIDO",
    })
    expect(JSON.stringify(json)).not.toContain("juan@example.com")
    expect(JSON.stringify(json)).not.toContain("interno.test")
    expect(JSON.stringify(json)).not.toContain("secreto")

    expect(campana.estado).toBe("FALLIDA")
    expect(campana.ultimoError).not.toContain("juan@example.com")
    expect(campana.ultimoError).not.toContain("interno.test")
  })
})

/* ------------------------------------------------------------------ */
/* T-13 (AC-11, RF-12, RF-17)                                          */
/* POST /api/propuestas/campanas/[id]/cancelar                         */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/campanas/[id]/cancelar (AC-11, RF-12)", () => {
  it.each(["BORRADOR", "EN_CURSO"])(
    "cancela una campana en %s y responde solo el estado",
    async (estado) => {
      const campana = instalarCampana(campanaBd({ estado }))

      const res = await cancelarCampana(
        pedidoAccion("cancelar"),
        contexto(),
      )

      expect(res.status).toBe(200)
      esperarNoStore(res)
      await expect(jsonDe(res)).resolves.toEqual({ estado: "CANCELADA" })
      expect(campana.estado).toBe("CANCELADA")
      expect(campana.finalizadaEn).toBeInstanceOf(Date)

      expect(mocks.campanaUpdateMany).toHaveBeenCalledWith({
        where: {
          id: "camp_1",
          estado: { in: ["BORRADOR", "EN_CURSO"] },
        },
        data: { estado: "CANCELADA", finalizadaEn: expect.any(Date) },
      })
      expect(mocks.buscarLugaresPlaces).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    },
  )

  it.each(["COMPLETADA", "PARCIAL", "FALLIDA", "CANCELADA"])(
    "una campana terminal (%s) responde 409 ESTADO sin cambiar el estado",
    async (estado) => {
      const campana = instalarCampana(campanaBd({ estado }))

      const res = await cancelarCampana(
        pedidoAccion("cancelar"),
        contexto(),
      )

      expect(res.status).toBe(409)
      esperarNoStore(res)
      const json = await jsonDe(res)
      expect(json.codigo).toBe("ESTADO")
      expect(json).not.toHaveProperty("estado")
      expect(campana.estado).toBe(estado)
    },
  )

  it("campaña inexistente responde 404", async () => {
    const res = await cancelarCampana(pedidoAccion("cancelar"), contexto())

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
  })

  it("sin sesion 401 y asistente 403", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const sinSesion = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(sinSesion.status).toBe(401)
    expect((await jsonDe(sinSesion)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")
  })

  it("rechaza origen ausente con 403 ORIGEN_INVALIDO", async () => {
    const res = await cancelarCampana(
      pedidoAccion("cancelar", "camp_1", { confirmado: true }, { origin: null }),
      contexto(),
    )

    expect(res.status).toBe(403)
    expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
  })

  it("exige confirmacion explicita y JSON valido", async () => {
    for (const body of [{}, { confirmado: false }, { confirmado: "true" }]) {
      const res = await cancelarCampana(
        pedidoAccion("cancelar", "camp_1", body),
        contexto(),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    const noJson = await cancelarCampana(
      pedidoAccion("cancelar", "camp_1", undefined, { rawBody: "{no-json" }),
      contexto(),
    )
    expect(noJson.status).toBe(400)
    expect((await jsonDe(noJson)).codigo).toBe("VALIDACION")
  })

  it("aplica el rate limit general por admin e IP", async () => {
    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const porAdmin = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(porAdmin.status).toBe(429)
    expect((await jsonDe(porAdmin)).codigo).toBe("RATE_LIMIT")
    expect(
      Number(porAdmin.headers.get("retry-after")),
    ).toBeGreaterThanOrEqual(1)

    resetRateLimit("propuestas:user_1")
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await cancelarCampana(pedidoAccion("cancelar"), contexto())
    expect(porIp.status).toBe(429)
  })

  it("esquema faltante 503 y error inesperado 500 sanitizado", async () => {
    mocks.campanaUpdateMany.mockRejectedValueOnce({ code: "P2021" })
    const sinEsquema = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(sinEsquema.status).toBe(503)
    expect((await jsonDe(sinEsquema)).codigo).toBe("ESQUEMA_NO_APLICADO")

    mocks.campanaUpdateMany.mockRejectedValueOnce(
      new Error("fallo con juan@example.com"),
    )
    const inesperado = await cancelarCampana(
      pedidoAccion("cancelar"),
      contexto(),
    )
    expect(inesperado.status).toBe(500)
    const json = await jsonDe(inesperado)
    expect(json).toEqual({
      error: "Error inesperado.",
      codigo: "DESCONOCIDO",
    })
    expect(JSON.stringify(json)).not.toContain("juan@example.com")
  })
})

