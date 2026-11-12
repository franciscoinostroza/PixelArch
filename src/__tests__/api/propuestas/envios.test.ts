import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import { hashContenidoEnvio } from "@/lib/propuestas/envios"

/**
 * T-16 (AC-22, AC-23, AC-24; RF-34..RF-39): plantillas, borrador determinista
 * y edicion versionada de envios.
 *
 * Rutas ejercitadas con Clerk, Prisma y logger mockeados:
 * - `POST /api/propuestas/plantillas`: 201 version 1 con variables canonicas,
 *   validacion de asunto/cuerpo/lista blanca, auth/origen/rate y P2002.
 * - `PATCH /api/propuestas/plantillas/[id]`: version+1, desactiva anteriores,
 *   conserva historial, reintenta ante P2002 y responde 404/409.
 * - `POST /api/propuestas/prospectos/[id]/borrador`: datos reales sin claims,
 *   hash estable, base legal, estados de error, `LLM` -> 503 sin escrituras,
 *   XSS escapado y asunto saneado.
 * - `PATCH /api/propuestas/envios/[id]`: BORRADOR en sitio con hash nuevo;
 *   APROBADO crea version+1 y cancela la anterior; otros estados 409.
 *
 * Ningun test hace fetch real ni importa Resend/LLM: ademas del `fetch`
 * stubbeado, se comprueba el codigo fuente de las rutas.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    plantillaPropuesta: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    prospecto: { updateMany: vi.fn() },
    envioPropuesta: { create: vi.fn(), updateMany: vi.fn() },
  }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    plantillaCreate: vi.fn(),
    plantillaFindFirst: vi.fn(),
    plantillaFindUnique: vi.fn(),
    prospectoFindUnique: vi.fn(),
    envioFindUnique: vi.fn(),
    envioFindMany: vi.fn(),
    envioUpdateMany: vi.fn(),
    supresionFindMany: vi.fn(),
    transaction: vi.fn(),
    tx,
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  }
})

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    plantillaPropuesta: {
      create: mocks.plantillaCreate,
      findFirst: mocks.plantillaFindFirst,
      findUnique: mocks.plantillaFindUnique,
    },
    prospecto: { findUnique: mocks.prospectoFindUnique },
    envioPropuesta: {
      findUnique: mocks.envioFindUnique,
      findMany: mocks.envioFindMany,
      updateMany: mocks.envioUpdateMany,
    },
    supresionProspecto: { findMany: mocks.supresionFindMany },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

import { POST as crearPlantilla } from "@/app/api/propuestas/plantillas/route"
import { PATCH as editarPlantilla } from "@/app/api/propuestas/plantillas/[id]/route"
import { POST as crearBorrador } from "@/app/api/propuestas/prospectos/[id]/borrador/route"
import { PATCH as editarEnvio } from "@/app/api/propuestas/envios/[id]/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.51"
const SECRETO = "secreto-de-pruebas-propuestas-1234567890"
const BASE_LEGAL = "Base legal de prueba aprobada para prospeccion B2B."
const FROM_EMAIL = "propuestas@pixelarch.dev"
const REPLY_TO = "hola@pixelarch.dev"
const FROM_NOMBRE = "PixelArch"

const ENVS = [
  "NEXT_PUBLIC_URL",
  "PROPUESTAS_SECRETO",
  "PROPUESTAS_BASE_LEGAL",
  "PROPUESTAS_MAX_ENVIOS_PROSPECTO",
  "PROPUESTAS_FROM_EMAIL",
  "PROPUESTAS_REPLY_TO",
  "PROPUESTAS_FROM_NOMBRE",
] as const

type EntornoOriginal = Record<(typeof ENVS)[number], string | undefined>

let entornoOriginal: EntornoOriginal

const URL_PLANTILLAS = `${ORIGEN}/api/propuestas/plantillas`
const URL_PROSPECTOS = `${ORIGEN}/api/propuestas/prospectos`
const URL_ENVIOS = `${ORIGEN}/api/propuestas/envios`

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function pedido(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  opciones: OpcionesPedido = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (opciones.origin !== null) headers.set("origin", opciones.origin ?? ORIGEN)
  if (opciones.ip !== null) headers.set("x-forwarded-for", opciones.ip ?? IP)

  return new Request(url, {
    method,
    headers,
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

function argumento(
  mock: ReturnType<typeof vi.fn>,
  indice = 0,
): Record<string, unknown> {
  const llamada = mock.mock.calls[indice] as unknown[] | undefined
  expect(llamada).toBeDefined()
  return llamada![0] as Record<string, unknown>
}

function datosDe(mock: ReturnType<typeof vi.fn>, indice = 0): Record<string, unknown> {
  const args = argumento(mock, indice)
  return (args.data ?? {}) as Record<string, unknown>
}

function cuerpoPlantilla(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nombre: "Primer contacto",
    idioma: "es",
    asunto: "Una idea para {{nombreNegocio}}",
    cuerpo:
      "Hola {{contactoNombre}},\n\nVi {{sitioWeb}} y noté: {{hallazgoPrincipal}}.\n\n{{remitenteNombre}}",
    variablesPermitidas: [
      "nombreNegocio",
      "contactoNombre",
      "sitioWeb",
      "hallazgoPrincipal",
      "remitenteNombre",
    ],
    ...overrides,
  }
}

function cuerpoPatchPlantilla(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    idioma: "es",
    asunto: "Propuesta para {{nombreNegocio}}",
    cuerpo: "Hola {{contactoNombre}},\n\nTe escribo de nuevo.",
    variablesPermitidas: ["nombreNegocio", "contactoNombre"],
    ...overrides,
  }
}

function prospectoBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pros_1",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    email: "Ventas@Alfa.com.ar",
    contactoNombre: "Ana",
    score: 88,
    auditoriaResumen: {
      findings: [
        { type: "warn", text: "La velocidad del sitio puede mejorar." },
      ],
    },
    estado: "PUNTUADO",
    baseLegal: null,
    campanaOrigenId: "camp_1",
    campanaOrigen: {
      id: "camp_1",
      nombre: "Estudios contables Palermo",
      rubro: "Consultoría",
      zona: "Palermo, CABA",
      plantillaId: "pl_1",
    },
    ...overrides,
  }
}

function plantillaBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pl_1",
    asunto: "Una idea para {{nombreNegocio}}",
    cuerpo:
      "{{saludo}},\n\nVi {{sitioWeb}} en {{ciudad}} ({{rubro}}): {{hallazgoPrincipal}}. Score: {{score}}.",
    variablesPermitidas: [
      "nombreNegocio",
      "saludo",
      "sitioWeb",
      "ciudad",
      "rubro",
      "hallazgoPrincipal",
      "score",
    ],
    version: 1,
    ...overrides,
  }
}

function envioBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "env_1",
    prospectoId: "pros_1",
    campanaId: "camp_1",
    plantillaId: "pl_1",
    plantillaVersion: 1,
    secuencia: 1,
    version: 1,
    destinatario: "ventas@alfa.com.ar",
    estado: "BORRADOR",
    fromEmail: FROM_EMAIL,
    fromNombre: FROM_NOMBRE,
    replyTo: REPLY_TO,
    ...overrides,
  }
}

function limpiarRateLimits(): void {
  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    `propuestas:ip:${IP}`,
    `propuestas:ip:198.51.100.123`,
  ]) {
    resetRateLimit(clave)
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  entornoOriginal = {
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    PROPUESTAS_SECRETO: process.env.PROPUESTAS_SECRETO,
    PROPUESTAS_BASE_LEGAL: process.env.PROPUESTAS_BASE_LEGAL,
    PROPUESTAS_MAX_ENVIOS_PROSPECTO:
      process.env.PROPUESTAS_MAX_ENVIOS_PROSPECTO,
    PROPUESTAS_FROM_EMAIL: process.env.PROPUESTAS_FROM_EMAIL,
    PROPUESTAS_REPLY_TO: process.env.PROPUESTAS_REPLY_TO,
    PROPUESTAS_FROM_NOMBRE: process.env.PROPUESTAS_FROM_NOMBRE,
  }

  process.env.NEXT_PUBLIC_URL = ORIGEN
  process.env.PROPUESTAS_SECRETO = SECRETO
  process.env.PROPUESTAS_BASE_LEGAL = BASE_LEGAL
  process.env.PROPUESTAS_MAX_ENVIOS_PROSPECTO = "2"
  process.env.PROPUESTAS_FROM_EMAIL = FROM_EMAIL
  process.env.PROPUESTAS_REPLY_TO = REPLY_TO
  process.env.PROPUESTAS_FROM_NOMBRE = FROM_NOMBRE

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })

  mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })
  mocks.plantillaFindUnique.mockResolvedValue(null)
  mocks.plantillaFindFirst.mockResolvedValue(plantillaBd())
  mocks.prospectoFindUnique.mockResolvedValue(prospectoBd())
  mocks.envioFindUnique.mockResolvedValue(envioBd())
  mocks.envioFindMany.mockResolvedValue([])
  mocks.envioUpdateMany.mockResolvedValue({ count: 1 })
  mocks.supresionFindMany.mockResolvedValue([])

  mocks.tx.plantillaPropuesta.findFirst.mockResolvedValue({ version: 1 })
  mocks.tx.plantillaPropuesta.create.mockResolvedValue({
    id: "pl_2",
    version: 2,
  })
  mocks.tx.plantillaPropuesta.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.envioPropuesta.create.mockResolvedValue({
    id: "env_1",
    secuencia: 1,
    version: 1,
  })
  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )

  vi.stubGlobal("fetch", vi.fn())
  limpiarRateLimits()
})

afterEach(() => {
  for (const clave of ENVS) {
    const valor = entornoOriginal[clave]
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* POST /api/propuestas/plantillas                                     */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/plantillas (T-16, AC-22; RF-34, RF-37)", () => {
  it("crea la version 1 con la lista canonica de variables usadas", async () => {
    mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ id: "pl_1", version: 1 })

    expect(mocks.plantillaCreate).toHaveBeenCalledTimes(1)
    const data = datosDe(mocks.plantillaCreate)
    expect(data).toMatchObject({
      nombre: "Primer contacto",
      idioma: "es",
      asunto: "Una idea para {{nombreNegocio}}",
      cuerpo:
        "Hola {{contactoNombre}},\n\nVi {{sitioWeb}} y noté: {{hallazgoPrincipal}}.\n\n{{remitenteNombre}}",
      version: 1,
      activa: true,
      creadaPor: "user_1",
      creadaPorNombre: "Ana Pérez",
    })
    // La lista guardada es la usada realmente, no la declarada de mas.
    expect(data.variablesPermitidas).toEqual([
      "nombreNegocio",
      "contactoNombre",
      "sitioWeb",
      "hallazgoPrincipal",
      "remitenteNombre",
    ])
    expect(mocks.plantillaCreate.mock.calls[0][0]).not.toHaveProperty(
      "data.tokenBaja",
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Una idea para")
    expect(logs).not.toContain("Vi https://alfa.com.ar/")
  })

  it("normaliza el asunto (CR/LF y prefijos falsos) y descarta variables declaradas sin uso", async () => {
    mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })

    const res = await crearPlantilla(
      pedido(
        URL_PLANTILLAS,
        "POST",
        cuerpoPlantilla({
          asunto: "Re: Fwd: Fw: Una propuesta\r\npara {{nombreNegocio}}",
          cuerpo: "Hola {{nombreNegocio}}, ¿te interesa?",
          variablesPermitidas: [
            "nombreNegocio",
            "ciudad",
            "rubro",
            "hallazgoPrincipal",
          ],
        }),
      ),
    )

    expect(res.status).toBe(201)
    const data = datosDe(mocks.plantillaCreate)
    expect(data.asunto).toBe("Una propuesta para {{nombreNegocio}}")
    expect(String(data.asunto)).not.toMatch(/[\r\n]/)
    expect(data.variablesPermitidas).toEqual(["nombreNegocio"])
  })

  it.each([
    ["asunto vacio", { asunto: "   " }, "VALIDACION"],
    ["cuerpo vacio", { cuerpo: "   " }, "VALIDACION"],
    [
      "variable desconocida",
      { asunto: "Propuesta", cuerpo: "Hola {{email}}" },
      "VALIDACION",
    ],
    [
      "variable no permitida",
      {
        asunto: "Propuesta",
        cuerpo: "Hola {{ciudad}}",
        variablesPermitidas: ["nombreNegocio"],
      },
      "VALIDACION",
    ],
    [
      "placeholder mal formado",
      { asunto: "Propuesta", cuerpo: "Hola {{nombreNegocio" },
      "VALIDACION",
    ],
    [
      "asunto demasiado largo antes de limpiar",
      { asunto: "a".repeat(121), cuerpo: "Hola" },
      "VALIDACION",
    ],
  ])("no guarda una plantilla invalida: %s", async (_caso, override, codigo) => {
    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla(override)),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo })
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("exige admin, origen same-origin y rate limit", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(anonimo.status).toBe(401)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    simularAdmin()
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await crearPlantilla(
        pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla(), opciones),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 31 por admin y la 61 por IP con 429 y Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }
    const porAdmin = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(porAdmin.status).toBe(429)
    expect((await jsonDe(porAdmin)).codigo).toBe("RATE_LIMIT")
    expect(Number(porAdmin.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()

    resetRateLimit("propuestas:user_1")
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(porIp.status).toBe(429)
    expect((await jsonDe(porIp)).codigo).toBe("RATE_LIMIT")
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("un nombre+version duplicado responde 409 sin crear otra fila", async () => {
    mocks.plantillaCreate.mockRejectedValue({ code: "P2002" })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaCreate).toHaveBeenCalledTimes(1)
  })

  it("con el esquema faltante responde 503 y no filtra detalles", async () => {
    mocks.plantillaCreate.mockRejectedValue({ code: "P2021" })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/propuestas/plantillas/[id]                               */
/* ------------------------------------------------------------------ */

describe("PATCH /api/propuestas/plantillas/[id] (T-16, AC-22, AC-24; RF-37, RF-38)", () => {
  beforeEach(() => {
    mocks.plantillaFindUnique.mockResolvedValue({
      id: "pl_1",
      nombre: "Primer contacto",
    })
  })

  it("crea la version+1 con el mismo nombre y desactiva las anteriores", async () => {
    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ id: "pl_2", version: 2 })

    const findUnique = argumento(mocks.plantillaFindUnique)
    expect(findUnique).toMatchObject({ where: { id: "pl_1" } })
    // Solo se leen id y nombre: no se reescribe la version existente.
    expect(findUnique).not.toHaveProperty("data")

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.plantillaPropuesta.findFirst).toHaveBeenCalledWith({
      where: { nombre: "Primer contacto" },
      orderBy: { version: "desc" },
      select: { version: true },
    })

    const creada = datosDe(mocks.tx.plantillaPropuesta.create)
    expect(creada).toMatchObject({
      nombre: "Primer contacto",
      idioma: "es",
      asunto: "Propuesta para {{nombreNegocio}}",
      cuerpo: "Hola {{contactoNombre}},\n\nTe escribo de nuevo.",
      version: 2,
      activa: true,
      creadaPor: "user_1",
      creadaPorNombre: "Ana Pérez",
    })
    expect(creada.variablesPermitidas).toEqual([
      "nombreNegocio",
      "contactoNombre",
    ])

    const desactivadas = argumento(mocks.tx.plantillaPropuesta.updateMany)
    expect(desactivadas).toEqual({
      where: { nombre: "Primer contacto", activa: true, id: { not: "pl_2" } },
      data: { activa: false },
    })
    // El historial previo conserva sus filas: nunca se actualiza contenido.
    expect(mocks.tx.plantillaPropuesta.updateMany).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Propuesta para")
    expect(logs).not.toContain("Te escribo de nuevo")
  })

  it("ante P2002 reintenta con el maximo ya persistido", async () => {
    mocks.tx.plantillaPropuesta.findFirst
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 })
    mocks.tx.plantillaPropuesta.create
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({ id: "pl_3", version: 3 })

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ id: "pl_3", version: 3 })
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(mocks.tx.plantillaPropuesta.create).toHaveBeenCalledTimes(2)
    expect(
      datosDe(mocks.tx.plantillaPropuesta.create, 1).version,
    ).toBe(3)
    expect(mocks.tx.plantillaPropuesta.updateMany).toHaveBeenCalledTimes(1)
  })

  it("si el P2002 persiste en los 3 intentos responde 409", async () => {
    mocks.tx.plantillaPropuesta.create.mockRejectedValue({ code: "P2002" })

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.plantillaPropuesta.create).toHaveBeenCalledTimes(3)
    expect(mocks.tx.plantillaPropuesta.updateMany).not.toHaveBeenCalled()
  })

  it("responde 404 si la plantilla no existe y no abre transaccion", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(null)

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/no-existe`, "PATCH", cuerpoPatchPlantilla()),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["asunto vacio", { asunto: "   " }],
    ["cuerpo vacio", { cuerpo: "   " }],
    ["variable desconocida", { cuerpo: "Hola {{email}}" }],
    ["variable no permitida", { variablesPermitidas: ["nombreNegocio"] }],
  ])("no versiona una edicion invalida: %s", async (_caso, override) => {
    const res = await editarPlantilla(
      pedido(
        `${URL_PLANTILLAS}/pl_1`,
        "PATCH",
        cuerpoPatchPlantilla(override),
      ),
      contexto("pl_1"),
    )

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.plantillaFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit y no loguea contenido", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const sinOrigen = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla(), {
        origin: null,
      }),
      contexto("pl_1"),
    )
    expect(sinOrigen.status).toBe(403)
    expect((await jsonDe(sinOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(limitado.status).toBe(429)

    expect(mocks.plantillaFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Propuesta para")
    expect(logs).not.toContain("Te escribo de nuevo")
  })
})

/* ------------------------------------------------------------------ */
/* POST /api/propuestas/prospectos/[id]/borrador                       */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/prospectos/[id]/borrador (T-16, AC-22, AC-23; RF-34..RF-39)", () => {
  it("crea un borrador BORRADOR con datos verificados, hash estable y base legal", async () => {
    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        modo: "PLANTILLA",
        plantillaId: "pl_1",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      envioId: "env_1",
      secuencia: 1,
      version: 1,
    })

    expect(mocks.plantillaFindFirst).toHaveBeenCalledWith({
      where: { id: "pl_1", activa: true },
      select: {
        id: true,
        asunto: true,
        cuerpo: true,
        variablesPermitidas: true,
        version: true,
      },
    })

    const data = datosDe(mocks.tx.envioPropuesta.create)
    expect(data).toMatchObject({
      prospectoId: "pros_1",
      campanaId: "camp_1",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      secuencia: 1,
      version: 1,
      destinatario: "ventas@alfa.com.ar",
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
      estado: "BORRADOR",
    })
    expect(data.asunto).toBe("Una idea para Consultora Alfa")

    const cuerpo = String(data.cuerpoTexto)
    expect(cuerpo).toContain("Hola Ana")
    expect(cuerpo).toContain("https://alfa.com.ar/")
    expect(cuerpo).toContain("Palermo, CABA")
    expect(cuerpo).toContain("Consultoría")
    expect(cuerpo).toContain("La velocidad del sitio puede mejorar.")
    expect(cuerpo).toContain("Score: 88.")
    // Sin claims inventados: el texto es exactamente la plantilla sustituida.
    expect(cuerpo).not.toMatch(/garantiz|100%|líder|nº1|mejor del mercado/i)

    expect(String(data.cuerpoHtml)).toContain("<p>Hola Ana")
    expect(String(data.cuerpoHtml)).not.toContain("{{")
    // El footer legal y el token de baja se materializan al aprobar (T-17).
    expect(data).not.toHaveProperty("tokenBaja")
    expect(data).not.toHaveProperty("aprobadoHash")
    expect(String(data.cuerpoHtml).toLowerCase()).not.toContain("unsubscribe")
    expect(String(data.cuerpoHtml).toLowerCase()).not.toContain("baja")

    const hash = String(data.hashContenido)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(
      hashContenidoEnvio({
        asunto: String(data.asunto),
        cuerpoTexto: String(data.cuerpoTexto),
        cuerpoHtml: String(data.cuerpoHtml),
        destinatario: String(data.destinatario),
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )

    const actualizado = argumento(mocks.tx.prospecto.updateMany)
    expect(actualizado.where).toEqual({ id: "pros_1", estado: "PUNTUADO" })
    const datosProspecto = (actualizado.data ?? {}) as Record<string, unknown>
    expect(datosProspecto).toMatchObject({
      estado: "BORRADOR",
      actualizadoPor: "user_1",
      baseLegal: BASE_LEGAL,
    })
    expect(datosProspecto.ultimaInteraccionEn).toBeInstanceOf(Date)

    expect(globalThis.fetch).not.toHaveBeenCalled()
    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("ventas@alfa.com.ar")
    expect(logs).not.toContain("Consultora Alfa")
  })

  it("conserva la base legal existente y no la sobrescribe", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ baseLegal: "Base legal previa." }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        plantillaId: "pl_1",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    const datosProspecto = (argumento(mocks.tx.prospecto.updateMany).data ??
      {}) as Record<string, unknown>
    expect(datosProspecto).not.toHaveProperty("baseLegal")
  })

  it("modo LLM responde 503 NO_CONFIGURADO sin consultas ni escrituras", async () => {
    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", { modo: "LLM" }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit antes de tocar datos", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(anonimo.status).toBe(401)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    simularAdmin()
    const sinOrigen = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}, { origin: null }),
      contexto("pros_1"),
    )
    expect(sinOrigen.status).toBe(403)
    expect((await jsonDe(sinOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(limitado.status).toBe(429)
    expect(Number(limitado.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin email responde 409 SIN_EMAIL sin consultar plantilla ni escribir", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoBd({ email: null }))

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SIN_EMAIL")
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un contacto suprimido responde 409 SUPRIMIDO sin escribir", async () => {
    mocks.supresionFindMany.mockResolvedValue([
      {
        ambito: "DOMINIO",
        emailHash: null,
        dominioNegocio: "alfa.com.ar",
      },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin secreto para verificar supresion falla cerrado con 503", async () => {
    delete process.env.PROPUESTAS_SECRETO

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("NO_CONFIGURADO")
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin plantilla activa o inexistente responde 409 ESTADO", async () => {
    mocks.plantillaFindFirst.mockResolvedValue(null)

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        plantillaId: "pl_inexistente",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin plantilla en el body ni en la campana responde 409 sin consultar", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({
        campanaOrigen: {
          id: "camp_1",
          nombre: "Estudios contables Palermo",
          rubro: "Consultoría",
          zona: "Palermo, CABA",
          plantillaId: null,
        },
      }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("con un BORRADOR/APROBADO abierto responde 409 BORRADOR_ABIERTO", async () => {
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_prev", estado: "BORRADOR", secuencia: 1 },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("BORRADOR_ABIERTO")
    expect(mocks.envioFindMany).toHaveBeenCalledWith({
      where: { prospectoId: "pros_1" },
      select: { id: true, estado: true, secuencia: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("al alcanzar el maximo de mensajes responde 409 MAX_MENSAJES", async () => {
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_1", estado: "ENVIADO", secuencia: 1 },
      { id: "env_2", estado: "RESPONDIDO", secuencia: 2 },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("MAX_MENSAJES")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un estado no transicionable a BORRADOR responde 409 ESTADO", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoBd({ estado: "NUEVO" }))

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("escapa XSS de los datos y sanea asunto sin CR/LF ni prefijos falsos", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({
        nombreNegocio: '<script>alert("x")</script>',
        ciudad: '<img src=x onerror="alert(1)">',
        contactoNombre: '<b onmouseover="alert(1)">Ana</b>',
        auditoriaResumen: {
          findings: [
            { type: "fail", text: "<script>robaCookies()</script>" },
          ],
        },
      }),
    )
    mocks.plantillaFindFirst.mockResolvedValue(
      plantillaBd({
        asunto: "Fw: Oferta\r\npara {{nombreNegocio}}",
        cuerpo:
          "Hola {{contactoNombre}} de {{ciudad}}: {{hallazgoPrincipal}}. {{nombreNegocio}}. Plantilla dice: <script>plantilla()</script>",
        variablesPermitidas: [
          "nombreNegocio",
          "contactoNombre",
          "ciudad",
          "hallazgoPrincipal",
        ],
      }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    const data = datosDe(mocks.tx.envioPropuesta.create)
    const asunto = String(data.asunto)
    const html = String(data.cuerpoHtml)
    const texto = String(data.cuerpoTexto)

    expect(asunto).toBe('Oferta para <script>alert("x")</script>')
    expect(asunto).not.toMatch(/[\r\n]/)
    expect(asunto).not.toMatch(/^(?:re|fwd|fw)\s*:/i)

    // El HTML nunca interpreta el contenido hostil: todo queda escapado.
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<b ")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;img")
    expect(html).toContain("&lt;b ")
    // El HTML hostil de la propia plantilla tampoco se interpreta.
    expect(html).toContain("&lt;script&gt;plantilla()&lt;/script&gt;")
    // En texto plano el contenido hostil es solo texto, no se evalua.
    expect(texto).toContain("<script>alert")
    expect(texto).toContain("<script>plantilla()</script>")
    expect(texto).toContain("robaCookies")
    expect(texto).toContain("onerror")
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("responde 404 si el prospecto no existe", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/no-existe/borrador`, "POST", {}),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("si el prospecto cambia de estado en la transaccion responde 409 y no deja borrador", async () => {
    mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 0 })

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
  })

  it("no importa Resend ni realiza llamadas de red", () => {
    const borrador = readFileSync(
      join(
        process.cwd(),
        "src/app/api/propuestas/prospectos/[id]/borrador/route.ts",
      ),
      "utf8",
    )
    const envio = readFileSync(
      join(process.cwd(), "src/app/api/propuestas/envios/[id]/route.ts"),
      "utf8",
    )

    for (const fuente of [borrador, envio]) {
      expect(fuente).not.toMatch(/@\/lib\/propuestas\/resend/)
      expect(fuente).not.toMatch(/sendEmail|enviarEmail|sendPaymentReceipt/)
      expect(fuente).not.toMatch(/\bfetch\s*\(/)
    }
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/propuestas/envios/[id]                                   */
/* ------------------------------------------------------------------ */

describe("PATCH /api/propuestas/envios/[id] (T-16, AC-24; RF-38)", () => {
  it("en BORRADOR edita en sitio y recomputa el hash", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioBd())
    mocks.envioUpdateMany.mockResolvedValue({ count: 1 })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Re: Fw: Propuesta\r\npara vos",
        cuerpoTexto: "Hola Ana,\n\nTe escribo de nuevo.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ envioId: "env_1", version: 1 })

    const actualizacion = argumento(mocks.envioUpdateMany)
    expect(actualizacion.where).toEqual({ id: "env_1", estado: "BORRADOR" })
    const data = (actualizacion.data ?? {}) as Record<string, unknown>
    expect(data.asunto).toBe("Propuesta para vos")
    expect(data.cuerpoTexto).toBe("Hola Ana,\n\nTe escribo de nuevo.")
    expect(String(data.cuerpoHtml)).toContain("<p>Hola Ana,")
    expect(String(data.cuerpoHtml)).toContain("<p>Te escribo de nuevo.</p>")
    expect(String(data.cuerpoHtml)).not.toContain("{{")
    expect(data.hashContenido).toBe(
      hashContenidoEnvio({
        asunto: "Propuesta para vos",
        cuerpoTexto: "Hola Ana,\n\nTe escribo de nuevo.",
        cuerpoHtml: String(data.cuerpoHtml),
        destinatario: "ventas@alfa.com.ar",
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("un APROBADO crea version+1 en la misma secuencia y cancela la anterior", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioBd({ estado: "APROBADO", version: 2 }),
    )
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.envioPropuesta.create.mockResolvedValue({
      id: "env_2",
      version: 3,
    })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta actualizada",
        cuerpoTexto: "Hola Ana,\n\nCambié el texto.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ envioId: "env_2", version: 3 })

    const cancelado = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(cancelado.where).toEqual({ id: "env_1", estado: "APROBADO" })
    expect(cancelado.data).toEqual({
      estado: "CANCELADO",
      motivoCancelacion: "EDITADO",
    })

    const nueva = datosDe(mocks.tx.envioPropuesta.create)
    expect(nueva).toMatchObject({
      prospectoId: "pros_1",
      campanaId: "camp_1",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      secuencia: 1,
      version: 3,
      destinatario: "ventas@alfa.com.ar",
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
      asunto: "Propuesta actualizada",
      estado: "BORRADOR",
    })
    expect(nueva).not.toHaveProperty("aprobadoHash")
    expect(nueva).not.toHaveProperty("tokenBaja")
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it.each([
    "ENVIANDO",
    "ENVIADO",
    "FALLIDO",
    "REBOTADO",
    "QUEJA",
    "RESPONDIDO",
    "CANCELADO",
  ])("en %s responde 409 ESTADO y no escribe", async (estado) => {
    mocks.envioFindUnique.mockResolvedValue(envioBd({ estado }))

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("responde 404 si el envio no existe", async () => {
    mocks.envioFindUnique.mockResolvedValue(null)

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/no-existe`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["asunto vacio", { asunto: "   " }],
    ["cuerpo vacio", { cuerpoTexto: "   " }],
    ["variable pendiente", { cuerpoTexto: "Hola {{nombreNegocio}}" }],
    ["placeholder mal formado", { cuerpoTexto: "Hola {{nombre" }],
    ["asunto largo", { asunto: "a".repeat(121) }],
  ])("no guarda una edicion invalida: %s", async (_caso, override) => {
    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
        ...override,
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("escapa HTML del cuerpo editado", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioBd())

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: '<img src=x onerror="alert(1)">',
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    const data = (argumento(mocks.envioUpdateMany).data ?? {}) as Record<
      string,
      unknown
    >
    expect(String(data.cuerpoHtml)).not.toContain("<img")
    expect(String(data.cuerpoHtml)).toContain("&lt;img")
  })

  it("exige admin, origen y rate limit", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const cross = await editarEnvio(
      pedido(
        `${URL_ENVIOS}/env_1`,
        "PATCH",
        { asunto: "Propuesta", cuerpoTexto: "Hola." },
        { origin: "https://evil.test" },
      ),
      contexto("env_1"),
    )
    expect(cross.status).toBe(403)
    expect((await jsonDe(cross)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(limitado.status).toBe(429)
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
  })

  it("un P2002 al crear la version responde 409 sin duplicar", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioBd({ estado: "APROBADO", version: 2 }),
    )
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.envioPropuesta.create.mockRejectedValue({ code: "P2002" })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.envioPropuesta.create).toHaveBeenCalledTimes(1)
  })
})
