import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import { hashEmail } from "@/lib/propuestas/supresion"

/**
 * T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56): supresiones
 * admin, revocacion excepcional y reutilizacion por rebote/queja.
 *
 * Rutas ejercitadas con Clerk, Prisma y logger mockeados:
 * - `POST /api/propuestas/supresiones`: EMAIL por HMAC (clave
 *   `EMAIL:<hash>`, email enmascarado, nunca en claro), DOMINIO de negocio,
 *   idempotencia/reactivacion, cancelacion de pendientes y marca SUPRIMIDO
 *   solo para el email actual coincidente. Sin secreto falla cerrado (503),
 *   publicos/multiinquilino se rechazan (400), auth/origen/rate/validacion y
 *   `no-store`.
 * - `POST /api/propuestas/supresiones/[id]/revocar`: excepcion con motivo,
 *   quien/cuando/historial, 404/409, sin reabrir prospectos ni envios.
 * - `POST /api/propuestas/envios/[id]/resultado`: REBOTE_DURO/QUEJA usan la
 *   misma creacion de supresion que el alta manual (misma clave/hash) y
 *   conservan el email nuevo del prospecto sin marcarlo SUPRIMIDO.
 *
 * Ningun test hace red real: `fetch` queda stubbeado y las rutas no lo usan.
 */

const mocks = vi.hoisted(() => {
  const supresionProspecto = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  }

  const prospecto = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  }

  const envioPropuesta = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  }

  const tx = { supresionProspecto, prospecto, envioPropuesta }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    supresionProspecto,
    prospecto,
    envioPropuesta,
    tx,
    transaction: vi.fn(),
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
    supresionProspecto: mocks.supresionProspecto,
    prospecto: mocks.prospecto,
    envioPropuesta: mocks.envioPropuesta,
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

import { POST as crearSupresionApi } from "@/app/api/propuestas/supresiones/route"
import { POST as revocarSupresionApi } from "@/app/api/propuestas/supresiones/[id]/revocar/route"
import { POST as purgarSupresionApi } from "@/app/api/propuestas/supresiones/[id]/purga/route"
import { POST as registrarResultado } from "@/app/api/propuestas/envios/[id]/resultado/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.77"
const SECRETO = "secreto-de-pruebas-supresiones-0123456789abcdef"
const EMAIL = "ventas@alfa.com.ar"
const HASH_EMAIL = hashEmail(EMAIL, SECRETO)
const CLAVE_EMAIL = `EMAIL:${HASH_EMAIL}`

const URL_SUPRESIONES = `${ORIGEN}/api/propuestas/supresiones`

function hashMotivo(motivo: string): string {
  return createHash("sha256").update(motivo, "utf8").digest("hex")
}

function urlRevocar(id = "sup_1"): string {
  return `${URL_SUPRESIONES}/${id}/revocar`
}

function urlPurga(id = "sup_revocada"): string {
  return `${URL_SUPRESIONES}/${id}/purga`
}

const URL_RESULTADO = `${ORIGEN}/api/propuestas/envios/env_1/resultado`

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function pedido(
  url: string,
  body: unknown,
  opciones: OpcionesPedido = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (opciones.origin !== null) headers.set("origin", opciones.origin ?? ORIGEN)
  if (opciones.ip !== null) headers.set("x-forwarded-for", opciones.ip ?? IP)

  return new Request(url, {
    method: "POST",
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

function logsDeMocks(): string {
  return JSON.stringify([
    ...mocks.loggerInfo.mock.calls,
    ...mocks.loggerWarn.mock.calls,
    ...mocks.loggerError.mock.calls,
  ])
}

function limpiarRateLimits(): void {
  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    `propuestas:ip:${IP}`,
    "propuestas:ip:198.51.100.99",
  ]) {
    resetRateLimit(clave)
  }
}

function cuerpoEmail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ambito: "EMAIL",
    email: "  Ventas@Alfa.com.AR ",
    motivo: "OPT_OUT",
    ...overrides,
  }
}

function cuerpoDominio(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ambito: "DOMINIO",
    dominioNegocio: "https://www.Alfa.com.ar/contacto",
    motivo: "MANUAL",
    ...overrides,
  }
}

function prospectoBd(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pros_1",
    email: EMAIL,
    historial: [{ accion: "ALTA", por: "user_1", en: "2026-11-01T10:00:00.000Z" }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubEnv("NEXT_PUBLIC_URL", ORIGEN)
  vi.stubEnv("PROPUESTAS_SECRETO", SECRETO)

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })

  mocks.supresionProspecto.findUnique.mockResolvedValue(null)
  mocks.supresionProspecto.findMany.mockResolvedValue([])
  mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_1" })
  mocks.supresionProspecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.supresionProspecto.deleteMany.mockResolvedValue({ count: 1 })

  mocks.prospecto.findUnique.mockResolvedValue(null)
  mocks.prospecto.findMany.mockResolvedValue([])
  mocks.prospecto.updateMany.mockResolvedValue({ count: 1 })

  mocks.envioPropuesta.findUnique.mockResolvedValue(null)
  mocks.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })

  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )

  vi.stubGlobal("fetch", vi.fn())
  limpiarRateLimits()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* T-20: POST /api/propuestas/supresiones                              */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/supresiones: alta EMAIL (T-20, AC-15, AC-17, AC-18)", () => {
  it("crea la clave EMAIL:<hash>, enmascara el email y nunca guarda ni devuelve el original", async () => {
    const res = await crearSupresionApi(
      pedido(
        URL_SUPRESIONES,
        cuerpoEmail({ notas: "  Baja solicitada por respuesta  " }),
      ),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)

    const cuerpo = await jsonDe(res)
    expect(cuerpo).toEqual({
      id: "sup_1",
      clave: CLAVE_EMAIL,
      creada: true,
      reactivada: false,
    })
    expect(cuerpo).not.toHaveProperty("email")
    expect(cuerpo).not.toHaveProperty("dominioNegocio")

    const upsert = argumento(mocks.supresionProspecto.upsert)
    expect(upsert.where).toEqual({ clave: CLAVE_EMAIL })
    // Alta nueva: el update del upsert no reescribe estado ni datos.
    expect(upsert.update).toEqual({ clave: CLAVE_EMAIL })
    const create = (upsert.create ?? {}) as Record<string, unknown>
    expect(create).toMatchObject({
      ambito: "EMAIL",
      clave: CLAVE_EMAIL,
      emailHash: HASH_EMAIL,
      emailEnmascarado: "v***@alfa.com.ar",
      dominioNegocio: null,
      motivo: "OPT_OUT",
      origen: "MANUAL",
      activa: true,
      notas: "Baja solicitada por respuesta",
      creadaPor: "user_1",
      creadaPorNombre: "Ana Pérez",
    })
    expect(create).not.toHaveProperty("email")

    // El email en claro no aparece en la respuesta, el modelo ni los logs.
    const serializado = JSON.stringify([
      cuerpo,
      upsert,
      logsDeMocks(),
    ]).toLowerCase()
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain(SECRETO.toLowerCase())
  })

  it("es idempotente por clave: 201 la primera vez y 200 sin reescribir si ya estaba activa", async () => {
    const primera = await crearSupresionApi(pedido(URL_SUPRESIONES, cuerpoEmail()))
    expect(primera.status).toBe(201)
    expect((await jsonDe(primera)).creada).toBe(true)

    // La fila ya existe y esta activa: el helper no vuelve a escribir.
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_1",
      activa: true,
      historial: [
        {
          accion: "CREADA",
          por: "user_1",
          en: "2026-11-01T10:00:00.000Z",
          motivo: "OPT_OUT",
          origen: "MANUAL",
        },
      ],
    })

    const segunda = await crearSupresionApi(pedido(URL_SUPRESIONES, cuerpoEmail()))
    expect(segunda.status).toBe(200)
    esperarNoStore(segunda)
    expect(await jsonDe(segunda)).toEqual({
      id: "sup_1",
      clave: CLAVE_EMAIL,
      creada: false,
      reactivada: false,
    })

    // Solo el alta original hizo upsert; la fila activa no se reescribe y no
    // se pisa el motivo/origen/creador/fecha originales.
    expect(mocks.supresionProspecto.upsert).toHaveBeenCalledTimes(1)
    const upsert = argumento(mocks.supresionProspecto.upsert)
    expect(upsert.where).toEqual({ clave: CLAVE_EMAIL })
    expect(upsert.update).toEqual({ clave: CLAVE_EMAIL })
    expect(upsert.update).not.toHaveProperty("motivo")
    expect(upsert.update).not.toHaveProperty("origen")
    expect(upsert.update).not.toHaveProperty("creadaPor")
    expect(upsert.update).not.toHaveProperty("creadaEn")
  })

  it("reactiva una supresion revocada conservando motivo/origen/creador/fecha y agrega REACTIVADA", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_revocada",
      activa: false,
      historial: [
        {
          accion: "CREADA",
          por: "user_9",
          en: "2026-11-01T10:00:00.000Z",
          motivo: "QUEJA",
          origen: "OPT_OUT",
        },
      ],
      motivo: "QUEJA",
      origen: "OPT_OUT",
      creadaPor: "user_9",
      creadaPorNombre: "Beto Gómez",
      creadaEn: new Date("2026-11-01T10:00:00.000Z"),
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_revocada" })

    const res = await crearSupresionApi(pedido(URL_SUPRESIONES, cuerpoEmail()))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      id: "sup_revocada",
      clave: CLAVE_EMAIL,
      creada: false,
      reactivada: true,
    })

    const upsert = argumento(mocks.supresionProspecto.upsert)
    expect(upsert.where).toEqual({ clave: CLAVE_EMAIL })
    const update = (upsert.update ?? {}) as Record<string, unknown>
    expect(update).toMatchObject({
      activa: true,
      revocadaPor: null,
      revocadaEn: null,
      motivoRevocacion: null,
    })
    // No se pisan los datos originales de la supresion.
    for (const campo of ["motivo", "origen", "creadaPor", "creadaPorNombre", "creadaEn"]) {
      expect(update).not.toHaveProperty(campo)
    }

    const historial = update.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[0]).toMatchObject({
      accion: "CREADA",
      por: "user_9",
      motivo: "QUEJA",
      origen: "OPT_OUT",
    })
    expect(historial[1]).toMatchObject({
      accion: "REACTIVADA",
      por: "user_1",
      motivo: "OPT_OUT",
    })
    expect(typeof historial[1].en).toBe("string")
  })

  it("cancela pendientes y marca SUPRIMIDO solo al prospecto cuyo email actual coincide", async () => {
    mocks.prospecto.findMany.mockResolvedValue([
      prospectoBd(),
      prospectoBd({
        id: "pros_2",
        email: "nueva@alfa.com.ar",
        historial: [],
      }),
    ])
    mocks.envioPropuesta.updateMany.mockResolvedValue({ count: 2 })

    const res = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoEmail({ motivo: "REBOTE_DURO" })),
    )

    expect(res.status).toBe(201)

    // La busqueda usa el email normalizado, nunca el valor crudo del body.
    expect(mocks.prospecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: EMAIL } }),
    )

    // Solo se cancelan los pendientes del prospecto coincidente.
    expect(mocks.envioPropuesta.updateMany).toHaveBeenCalledTimes(1)
    expect(argumento(mocks.envioPropuesta.updateMany)).toEqual({
      where: {
        prospectoId: { in: ["pros_1"] },
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      data: { estado: "CANCELADO", motivoCancelacion: "SUPRESION" },
    })

    // El prospecto con email nuevo conserva su ficha y su direccion: no se
    // actualiza ni se marca SUPRIMIDO.
    expect(mocks.prospecto.updateMany).toHaveBeenCalledTimes(1)
    const actualizado = argumento(mocks.prospecto.updateMany)
    expect(actualizado.where).toEqual({
      id: "pros_1",
      estado: { not: "SUPRIMIDO" },
    })
    const datos = (actualizado.data ?? {}) as Record<string, unknown>
    expect(datos).toMatchObject({
      estado: "SUPRIMIDO",
      actualizadoPor: "user_1",
    })
    expect(datos).not.toHaveProperty("email")
    expect(datos.ultimaInteraccionEn).toBeInstanceOf(Date)

    const historial = datos.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[0]).toMatchObject({ accion: "ALTA" })
    expect(historial[1]).toMatchObject({
      accion: "SUPRESION",
      motivo: "REBOTE_DURO",
      por: "user_1",
    })
    expect(typeof historial[1].en).toBe("string")

    const serializado = JSON.stringify(datos)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain("nueva@alfa.com.ar")
  })

  it("sin PROPUESTAS_SECRETO falla cerrado con 503 y no escribe", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", "")

    const res = await crearSupresionApi(pedido(URL_SUPRESIONES, cuerpoEmail()))

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/supresiones: alta DOMINIO (T-20, AC-15, AC-18)", () => {
  it("normaliza el dominio de negocio y suprime por DOMINIO:<dominio>", async () => {
    mocks.prospecto.findMany.mockResolvedValue([
      prospectoBd({ id: "pros_1", email: "uno@alfa.com.ar" }),
      prospectoBd({
        id: "pros_2",
        email: "dos@gmail.com",
        historial: [],
      }),
    ])
    mocks.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })

    const res = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoDominio()),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      id: "sup_1",
      clave: "DOMINIO:alfa.com.ar",
      creada: true,
      reactivada: false,
    })

    const upsert = argumento(mocks.supresionProspecto.upsert)
    expect(upsert.where).toEqual({ clave: "DOMINIO:alfa.com.ar" })
    expect((upsert.create ?? {}) as Record<string, unknown>).toMatchObject({
      ambito: "DOMINIO",
      clave: "DOMINIO:alfa.com.ar",
      emailHash: null,
      emailEnmascarado: null,
      dominioNegocio: "alfa.com.ar",
      motivo: "MANUAL",
      origen: "MANUAL",
      activa: true,
      creadaPor: "user_1",
    })

    // Afecta a todos los prospectos del dominio de negocio, incluso si el
    // contacto cargado usa un proveedor publico.
    expect(mocks.prospecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dominioNormalizado: "alfa.com.ar" } }),
    )
    expect(mocks.envioPropuesta.updateMany).toHaveBeenCalledWith({
      where: {
        prospectoId: { in: ["pros_1", "pros_2"] },
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      data: { estado: "CANCELADO", motivoCancelacion: "SUPRESION" },
    })
    expect(mocks.prospecto.updateMany).toHaveBeenCalledTimes(2)
    for (const [indice, id] of ["pros_1", "pros_2"].entries()) {
      const fila = argumento(mocks.prospecto.updateMany, indice)
      expect(fila.where).toEqual({ id, estado: { not: "SUPRIMIDO" } })
      expect((fila.data ?? {}) as Record<string, unknown>).toMatchObject({
        estado: "SUPRIMIDO",
      })
    }
  })

  it.each([
    ["gmail.com", "proveedor publico"],
    ["wixsite.com", "plataforma multiinquilino"],
    ["wordpress.com", "plataforma multiinquilino"],
  ])("rechaza %s (%s) con 400 sin crear la supresion", async (dominio) => {
    const res = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoDominio({ dominioNegocio: dominio })),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    const cuerpo = await jsonDe(res)
    expect(cuerpo).toMatchObject({ codigo: "VALIDACION" })
    expect(JSON.stringify(cuerpo)).not.toContain(dominio)
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.prospecto.findMany).not.toHaveBeenCalled()
  })

  it("es idempotente por clave: repetir el alta de un dominio activo responde 200 sin reescribir", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_dom",
      activa: true,
      historial: [],
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_dom" })

    const res = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoDominio()),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      id: "sup_dom",
      clave: "DOMINIO:alfa.com.ar",
      creada: false,
      reactivada: false,
    })
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
  })
})

describe("POST /api/propuestas/supresiones: seguridad y validacion (T-20, AC-18, AC-27)", () => {
  it("exige admin: 401 sin sesion y 403 para asistente, sin tocar datos", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoEmail()),
    )
    expect(anonimo.status).toBe(401)
    esperarNoStore(anonimo)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoEmail()),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403 antes de validar", async () => {
    simularAdmin()

    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await crearSupresionApi(
        pedido(URL_SUPRESIONES, cuerpoEmail(), opciones),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("aplica rate limit por admin y por IP con Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }

    const res = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoEmail()),
    )

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(mocks.transaction).not.toHaveBeenCalled()

    // La IP tambien tiene su propia ventana.
    resetRateLimit("propuestas:user_1")
    resetRateLimit(`propuestas:ip:${IP}`)
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await crearSupresionApi(
      pedido(URL_SUPRESIONES, cuerpoEmail()),
    )
    expect(porIp.status).toBe(429)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("valida el body estricto y no escribe ante errores 400", async () => {
    const invalidos: unknown[] = [
      {},
      { ambito: "EMAIL", email: "no-es-un-email", motivo: "MANUAL" },
      { ambito: "EMAIL", email: EMAIL },
      { ambito: "EMAIL", email: EMAIL, motivo: "OTRO" },
      { ambito: "EMAIL", email: EMAIL, motivo: "MANUAL", extra: true },
      { ambito: "DOMINIO", dominioNegocio: "", motivo: "MANUAL" },
      {
        ambito: "DOMINIO",
        dominioNegocio: "alfa.com.ar",
        motivo: "MANUAL",
        email: EMAIL,
      },
    ]

    for (const body of invalidos) {
      const res = await crearSupresionApi(pedido(URL_SUPRESIONES, body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    const jsonRoto = await crearSupresionApi(
      pedido(URL_SUPRESIONES, null, { rawBody: "{no-json" }),
    )
    expect(jsonRoto.status).toBe(400)
    expect((await jsonDe(jsonRoto)).codigo).toBe("VALIDACION")

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
  })

  it("mapea el esquema faltante a 503 y falla cerrado", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2021" })

    const res = await crearSupresionApi(pedido(URL_SUPRESIONES, cuerpoEmail()))

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
  })
})

/* ------------------------------------------------------------------ */
/* T-20: POST /api/propuestas/supresiones/[id]/revocar                 */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/supresiones/[id]/revocar (T-20, AC-18)", () => {
  it("revoca con motivo y registro de quien/cuando/historial sin reabrir prospectos", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_1",
      activa: true,
      historial: [
        {
          accion: "CREADA",
          por: "user_9",
          en: "2026-11-01T10:00:00.000Z",
          motivo: "QUEJA",
          origen: "MANUAL",
        },
      ],
    })

    const res = await revocarSupresionApi(
      pedido(urlRevocar(), {
        motivo: "  Autorización expresa del titular  ",
      }),
      contexto("sup_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ id: "sup_1", activa: false })

    const actualizado = argumento(mocks.supresionProspecto.updateMany)
    expect(actualizado.where).toEqual({ id: "sup_1", activa: true })
    const datos = (actualizado.data ?? {}) as Record<string, unknown>
    expect(datos).toMatchObject({
      activa: false,
      revocadaPor: "user_1",
      motivoRevocacion: "Autorización expresa del titular",
    })
    expect(datos.revocadaEn).toBeInstanceOf(Date)

    const historial = datos.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[0]).toMatchObject({ accion: "CREADA" })
    expect(historial[1]).toMatchObject({
      accion: "REVOCADA",
      por: "user_1",
      motivo: "Autorización expresa del titular",
    })
    expect(typeof historial[1].en).toBe("string")
    expect(JSON.stringify(datos)).not.toContain(EMAIL)

    // La revocacion no reabre prospectos ni reactiva envios.
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.envioPropuesta.updateMany).not.toHaveBeenCalled()
    expect(logsDeMocks()).not.toContain(EMAIL)
  })

  it("responde 404 si la supresion no existe y no escribe", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue(null)

    const res = await revocarSupresionApi(
      pedido(urlRevocar("sup_inexistente"), { motivo: "Excepcion" }),
      contexto("sup_inexistente"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
  })

  it("responde 409 si ya estaba revocada o si otra revocacion gano la carrera", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_1",
      activa: false,
      historial: [],
    })

    const yaRevocada = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion" }),
      contexto("sup_1"),
    )
    expect(yaRevocada.status).toBe(409)
    expect((await jsonDe(yaRevocada)).codigo).toBe("ESTADO")
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()

    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_1",
      activa: true,
      historial: [],
    })
    mocks.supresionProspecto.updateMany.mockResolvedValue({ count: 0 })

    const carrera = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion concurrente" }),
      contexto("sup_1"),
    )
    expect(carrera.status).toBe(409)
    expect((await jsonDe(carrera)).codigo).toBe("ESTADO")
  })

  it("exige un motivo no vacio y un body estricto", async () => {
    for (const body of [
      {},
      { motivo: "   " },
      { motivo: "x", extra: true },
    ]) {
      const res = await revocarSupresionApi(
        pedido(urlRevocar(), body),
        contexto("sup_1"),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
  })

  it("exige admin, origen same-origin y rate limit", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion" }),
      contexto("sup_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion" }),
      contexto("sup_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const cross = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion" }, { origin: null }),
      contexto("sup_1"),
    )
    expect(cross.status).toBe(403)
    expect((await jsonDe(cross)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await revocarSupresionApi(
      pedido(urlRevocar(), { motivo: "Excepcion" }),
      contexto("sup_1"),
    )
    expect(limitado.status).toBe(429)
    expect((await jsonDe(limitado)).codigo).toBe("RATE_LIMIT")
    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-20: POST /api/propuestas/supresiones/[id]/purga                   */
/* Purga manual: hard delete solo de una supresion ya revocada          */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/supresiones/[id]/purga (T-20, AC-15..AC-18, AC-27)", () => {
  function filaRevocada(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: "sup_revocada",
      activa: false,
      ambito: "EMAIL",
      ...overrides,
    }
  }

  it("purga una supresion revocada con deleteMany({ id, activa:false }) y responde { id, purgada:true }", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue(filaRevocada())
    const motivoPurgado = "Limpieza de un registro revocado por error"

    const res = await purgarSupresionApi(
      pedido(urlPurga(), {
        motivo: `  ${motivoPurgado}  `,
      }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      id: "sup_revocada",
      purgada: true,
    })

    // Hard delete acotado a la fila revocada: el where incluye activa:false.
    expect(mocks.supresionProspecto.deleteMany).toHaveBeenCalledTimes(1)
    expect(argumento(mocks.supresionProspecto.deleteMany)).toEqual({
      where: { id: "sup_revocada", activa: false },
    })

    // No toca prospectos, envios ni historial, ni reactiva/actualiza la fila.
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.prospecto.findMany).not.toHaveBeenCalled()
    expect(mocks.envioPropuesta.updateMany).not.toHaveBeenCalled()
    expect(mocks.envioPropuesta.findUnique).not.toHaveBeenCalled()

    // Trazabilidad sin PII: solo ids/ambito y metadatos del motivo. El texto
    // libre nunca se loguea; tampoco se persiste (la fila ya se borro).
    const llamada = mocks.loggerInfo.mock.calls[0] as unknown[]
    expect(llamada[0]).toBe("Supresion purgada")
    const log = llamada[1] as Record<string, unknown>
    expect(log).toEqual({
      supresionId: "sup_revocada",
      ambito: "EMAIL",
      adminId: "user_1",
      motivoLongitud: motivoPurgado.length,
      motivoHash: hashMotivo(motivoPurgado),
    })
    expect(log).not.toHaveProperty("motivo")
    const logs = logsDeMocks()
    expect(logs).not.toContain(motivoPurgado)
    expect(logs).not.toContain(EMAIL)
    expect(logs).not.toContain(HASH_EMAIL)
    expect(logs).not.toContain(CLAVE_EMAIL)
  })

  it("responde 409 ESTADO si sigue activa y no borra nada", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue(
      filaRevocada({ activa: true }),
    )

    const res = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Intento sobre una activa" }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ESTADO" })
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.loggerInfo).not.toHaveBeenCalled()
  })

  it("responde 404 si la supresion no existe o ya fue purgada", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue(null)

    const inexistente = await purgarSupresionApi(
      pedido(urlPurga("sup_inexistente"), { motivo: "Purga" }),
      contexto("sup_inexistente"),
    )

    expect(inexistente.status).toBe(404)
    esperarNoStore(inexistente)
    expect(await jsonDe(inexistente)).toMatchObject({ codigo: "NO_ENCONTRADO" })
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()

    // Carrera: la fila existia revocada al leer, pero otra operacion la purgo
    // o reactivo antes del delete. deleteMany no borra nada y se responde 404.
    mocks.supresionProspecto.findUnique.mockResolvedValue(filaRevocada())
    mocks.supresionProspecto.deleteMany.mockResolvedValue({ count: 0 })

    const carrera = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga concurrente" }),
      contexto("sup_revocada"),
    )

    expect(carrera.status).toBe(404)
    expect(await jsonDe(carrera)).toMatchObject({ codigo: "NO_ENCONTRADO" })
    expect(mocks.supresionProspecto.deleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.loggerInfo).not.toHaveBeenCalled()
  })

  it("valida un motivo de 1..500 caracteres y un body estricto sin borrar", async () => {
    const invalidos: unknown[] = [
      {},
      { motivo: "" },
      { motivo: "   " },
      { motivo: 123 },
      { motivo: "x".repeat(501) },
      { motivo: "purga", extra: true },
    ]

    for (const body of invalidos) {
      const res = await purgarSupresionApi(
        pedido(urlPurga(), body),
        contexto("sup_revocada"),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    const jsonRoto = await purgarSupresionApi(
      pedido(urlPurga(), null, { rawBody: "{no-json" }),
      contexto("sup_revocada"),
    )
    expect(jsonRoto.status).toBe(400)
    expect((await jsonDe(jsonRoto)).codigo).toBe("VALIDACION")

    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()

    // Borde aceptado: 500 caracteres (el maximo del contrato).
    mocks.supresionProspecto.findUnique.mockResolvedValue(filaRevocada())
    const motivoMaximo = "x".repeat(500)
    const borde = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: motivoMaximo }),
      contexto("sup_revocada"),
    )
    expect(borde.status).toBe(200)
    expect(await jsonDe(borde)).toEqual({
      id: "sup_revocada",
      purgada: true,
    })
    expect(argumento(mocks.supresionProspecto.deleteMany)).toEqual({
      where: { id: "sup_revocada", activa: false },
    })
  })

  it("exige admin: 401 sin sesion y 403 para asistente, sin borrar", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )
    expect(anonimo.status).toBe(401)
    esperarNoStore(anonimo)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
  })

  it("rechaza origen ausente o cross-site con 403 antes de borrar", async () => {
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await purgarSupresionApi(
        pedido(urlPurga(), { motivo: "Purga" }, opciones),
        contexto("sup_revocada"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
  })

  it("aplica rate limit por admin y por IP con Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }

    const res = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(429)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("RATE_LIMIT")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()

    resetRateLimit("propuestas:user_1")
    resetRateLimit(`propuestas:ip:${IP}`)
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )
    expect(porIp.status).toBe(429)
    expect((await jsonDe(porIp)).codigo).toBe("RATE_LIMIT")
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
  })

  it("no loguea el texto libre del motivo: solo longitud y hash SHA-256 sin PII", async () => {
    mocks.supresionProspecto.findUnique.mockResolvedValue(filaRevocada())

    const motivo =
      "purga juan@example.com https://interno.test/x?token=abc token=super-secreto"
    const res = await purgarSupresionApi(
      pedido(urlPurga(), { motivo }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(200)
    const llamada = mocks.loggerInfo.mock.calls[0] as unknown[]
    expect(llamada[0]).toBe("Supresion purgada")
    const log = llamada[1] as Record<string, unknown>
    expect(log).toEqual({
      supresionId: "sup_revocada",
      ambito: "EMAIL",
      adminId: "user_1",
      motivoLongitud: motivo.length,
      motivoHash: hashMotivo(motivo),
    })
    expect(log).not.toHaveProperty("motivo")
    expect(Object.keys(log).sort()).toEqual([
      "adminId",
      "ambito",
      "motivoHash",
      "motivoLongitud",
      "supresionId",
    ])

    const logs = logsDeMocks()
    expect(logs).not.toContain("[email]")
    expect(logs).not.toContain("[url]")
    expect(logs).not.toContain("[redactado]")
    expect(logs).not.toContain("juan@example.com")
    expect(logs).not.toContain("interno.test")
    expect(logs).not.toContain("token=abc")
    expect(logs).not.toContain("super-secreto")

    const cuerpo = await jsonDe(res)
    expect(JSON.stringify(cuerpo)).not.toContain("juan@example.com")
    expect(JSON.stringify(cuerpo)).not.toContain("super-secreto")
  })

  it("mapea el esquema faltante a 503 y falla cerrado sin borrar", async () => {
    mocks.supresionProspecto.findUnique.mockRejectedValue({ code: "P2021" })

    const res = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
  })

  it("un error inesperado responde 500 saneado y sin borrar", async () => {
    mocks.supresionProspecto.findUnique.mockRejectedValue(
      new Error("fallo juan@example.com"),
    )

    const res = await purgarSupresionApi(
      pedido(urlPurga(), { motivo: "Purga" }),
      contexto("sup_revocada"),
    )

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const cuerpo = await jsonDe(res)
    expect(cuerpo.codigo).toBe("DESCONOCIDO")
    expect(JSON.stringify(cuerpo)).not.toContain("juan@example.com")
    expect(JSON.stringify(logsDeMocks())).not.toContain("juan@example.com")
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-18/T-20: el rebote/queja reutiliza la misma creacion de supresion  */
/* ------------------------------------------------------------------ */

describe("resultado REBOTE_DURO/QUEJA reutiliza crearSupresion (T-18, T-20, AC-36)", () => {
  function envioRebotado(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: "env_1",
      prospectoId: "pros_1",
      destinatario: "  Ventas@Alfa.COM.AR  ",
      estado: "ENVIADO",
      ...overrides,
    }
  }

  it("usa la misma clave EMAIL:<hash> que el alta manual, sin email en claro", async () => {
    // Alta manual del mismo email (normalizado en el body).
    const manual = await crearSupresionApi(
      pedido(URL_SUPRESIONES, {
        ambito: "EMAIL",
        email: "  Ventas@Alfa.com.ar ",
        motivo: "MANUAL",
      }),
    )
    expect(manual.status).toBe(201)
    expect((await jsonDe(manual)).clave).toBe(CLAVE_EMAIL)

    // Rebote del destinatario enviado, con mayusculas y espacios.
    mocks.envioPropuesta.findUnique.mockResolvedValue(envioRebotado())
    mocks.prospecto.findUnique.mockResolvedValue({
      id: "pros_1",
      email: "nueva@alfa.com.ar",
      estado: "ENVIADO",
      historial: [],
    })

    const resultado = await registrarResultado(
      pedido(URL_RESULTADO, { tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )

    expect(resultado.status).toBe(200)
    esperarNoStore(resultado)
    expect(await jsonDe(resultado)).toEqual({
      estado: "REBOTADO",
      suprimido: true,
    })

    const claves = mocks.supresionProspecto.upsert.mock.calls.map(
      (llamada) => (llamada[0] as { where: { clave: string } }).where.clave,
    )
    expect(claves).toHaveLength(2)
    expect(new Set(claves)).toEqual(new Set([CLAVE_EMAIL]))

    const resultadoUpsert = argumento(mocks.supresionProspecto.upsert, 1)
    const create = (resultadoUpsert.create ?? {}) as Record<string, unknown>
    expect(create).toMatchObject({
      ambito: "EMAIL",
      clave: CLAVE_EMAIL,
      emailHash: HASH_EMAIL,
      emailEnmascarado: "v***@alfa.com.ar",
      motivo: "REBOTE_DURO",
      origen: "MANUAL",
      creadaPor: "user_1",
    })
    expect(create).not.toHaveProperty("email")
    expect(JSON.stringify(create).toLowerCase()).not.toContain(EMAIL)
    expect(logsDeMocks().toLowerCase()).not.toContain(EMAIL)
  })

  it("conserva el email nuevo y no marca SUPRIMIDO si el actual no coincide", async () => {
    mocks.envioPropuesta.findUnique.mockResolvedValue(envioRebotado())
    mocks.prospecto.findUnique.mockResolvedValue({
      id: "pros_1",
      email: "nueva@alfa.com.ar",
      estado: "ENVIADO",
      historial: [],
    })

    const res = await registrarResultado(
      pedido(URL_RESULTADO, { tipo: "QUEJA" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      estado: "QUEJA",
      suprimido: true,
    })

    const actualizado = argumento(mocks.prospecto.updateMany)
    expect(actualizado.where).toEqual({ id: "pros_1" })
    const datos = (actualizado.data ?? {}) as Record<string, unknown>
    expect(datos).not.toHaveProperty("estado")
    expect(datos).not.toHaveProperty("email")
    expect(datos.actualizadoPor).toBe("user_1")
    expect(datos.ultimaInteraccionEn).toBeInstanceOf(Date)
    const historial = datos.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(1)
    expect(historial[0]).toMatchObject({
      accion: "RESULTADO_ENVIO",
      motivo: "QUEJA",
      por: "user_1",
    })
    expect(JSON.stringify(datos)).not.toContain("nueva@alfa.com.ar")

    // Los pendientes igual se cancelan (la direccion vieja quedo suprimida).
    expect(mocks.envioPropuesta.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          prospectoId: "pros_1",
          estado: { in: ["BORRADOR", "APROBADO"] },
        },
      }),
    )
  })

  it("sobre un envio ya final responde 200 sin escribir, sin reactivar la supresion revocada y sin cancelar un borrador nuevo", async () => {
    mocks.envioPropuesta.findUnique.mockResolvedValue(
      envioRebotado({ estado: "REBOTADO" }),
    )
    mocks.prospecto.findUnique.mockResolvedValue({
      id: "pros_1",
      email: "nueva@alfa.com.ar",
      estado: "ENVIADO",
      historial: [],
    })
    // Si la ruta llamara a crearSupresion, esta fila revocada se reactivaria.
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_revocada",
      activa: false,
      historial: [
        {
          accion: "CREADA",
          por: "user_9",
          en: "2026-11-01T10:00:00.000Z",
          motivo: "QUEJA",
          origen: "MANUAL",
        },
      ],
      motivo: "QUEJA",
      origen: "MANUAL",
      creadaPor: "user_9",
      creadaEn: new Date("2026-11-01T10:00:00.000Z"),
    })

    const res = await registrarResultado(
      pedido(URL_RESULTADO, { tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      estado: "REBOTADO",
      suprimido: true,
    })

    // Repeticion idempotente: no abre transaccion, no crea/reactiva la
    // supresion, no cancela el borrador nuevo y no agrega historial.
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.envioPropuesta.updateMany).not.toHaveBeenCalled()
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
    expect(logsDeMocks()).not.toContain(EMAIL)
    expect(logsDeMocks()).not.toContain("nueva@alfa.com.ar")
  })
})
