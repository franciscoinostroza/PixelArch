import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-07 (AC-1, AC-2, AC-12, AC-13, AC-18, AC-24, AC-26): servicio de links.
 *
 * Prisma y `createOrder` estan mockeados: no hay base ni llamadas reales a
 * PayPal. Se valida creacion, reutilizacion, regeneracion, vencimiento
 * perezoso, adopcion del link MP legacy (sin contaminarla con el request
 * PayPal), grupo estable, snapshot de tarifa y la secuencia crear->invalidar.
 */

const mocks = vi.hoisted(() => ({
  hitoFindUnique: vi.fn(),
  suscripcionFindUnique: vi.fn(),
  enlaceFindMany: vi.fn(),
  enlaceFindFirst: vi.fn(),
  enlaceCreate: vi.fn(),
  enlaceUpdate: vi.fn(),
  hitoUpdate: vi.fn(),
  suscripcionUpdate: vi.fn(),
  pagoCreate: vi.fn(),
  createOrder: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hito: { findUnique: mocks.hitoFindUnique, update: mocks.hitoUpdate },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      update: mocks.suscripcionUpdate,
    },
    pago: { create: mocks.pagoCreate },
    enlacePago: {
      findMany: mocks.enlaceFindMany,
      findFirst: mocks.enlaceFindFirst,
      create: mocks.enlaceCreate,
      update: mocks.enlaceUpdate,
    },
  },
}))

vi.mock("@/lib/paypal/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/client")>()
  return { ...actual, createOrder: mocks.createOrder }
})

import { PaypalError } from "@/lib/paypal/client"
import {
  MOTIVO_INVALIDACION_REGENERACION,
  PAYPAL_ORDER_TTL_MS,
  PaypalLinkError,
  crearEnlacePaypal,
  grupoCobroDeHito,
  grupoCobroDeSuscripcion,
} from "@/lib/paypal/links"

const PAYPAL_KEYS = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_BASE_URL",
  "PAYPAL_FEE_BPS",
  "PAYPAL_FEE_FIXED_CENTS",
] as const

type PaypalKey = (typeof PAYPAL_KEYS)[number]

const originalEnv = new Map<PaypalKey, string | undefined>()

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const DIA_MS = 24 * 60 * 60 * 1000
const BASE_URL = "https://pixelarch.dev"

function limpiarEnv() {
  for (const key of PAYPAL_KEYS) delete process.env[key]
}

function configurar(overrides: Partial<Record<PaypalKey, string>> = {}) {
  limpiarEnv()
  const base: Record<string, string> = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "client-id-de-prueba",
    PAYPAL_CLIENT_SECRET: "client-secret-de-prueba",
    PAYPAL_WEBHOOK_ID: "webhook-id-de-prueba",
    PAYPAL_BASE_URL: "https://paypal.test",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) process.env[key] = value
  }
}

function hitoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "hito_1",
    proyectoId: "proyecto_1",
    orden: 1,
    titulo: "Anticipo",
    monto: 10050,
    estado: "PENDIENTE",
    vencimiento: null,
    pagadoEn: null,
    mpLink: null,
    mpPreferenceId: null,
    mpLinkExpira: null,
    creadoEn: AHORA,
    proyecto: { titulo: "Sitio ACME", clienteId: "cliente_1" },
    ...overrides,
  }
}

function suscripcionBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "suscripcion_1",
    clienteId: "cliente_1",
    servicioId: "servicio_1",
    plan: "SOPORTE",
    estado: "ACTIVE",
    deploymentId: null,
    deploymentPlatform: null,
    platformServiceId: null,
    proximoPago: null,
    entregadoEn: null,
    cancelAtPeriodEnd: false,
    canceladoEn: null,
    pastDueEn: null,
    precioCustom: 5000,
    ultimoRecordatorioEn: null,
    mpLink: null,
    mpPreferenceId: null,
    mpLinkExpira: null,
    mpLinkMeses: null,
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    servicio: { nombre: "Soporte mensual", precioMantenimiento: 20000 },
    ...overrides,
  }
}

function enlaceActivo(overrides: Record<string, unknown> = {}) {
  return {
    id: "enlace_activo",
    token: "token-activo",
    clienteId: "cliente_1",
    hitoId: "hito_1",
    suscripcionId: null,
    pasarela: "PAYPAL",
    concepto: "Sitio ACME — Anticipo",
    descripcion: null,
    notaInterna: null,
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    meses: null,
    feeBps: 540,
    feeFixedCents: 30,
    url: "https://viejo.example/pago/paypal/token-activo",
    checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-EXISTENTE",
    externalId: "ORDER-EXISTENTE",
    estado: "ACTIVO",
    grupoCobroId: "hito:hito_1",
    expiraEn: new Date(AHORA.getTime() + 5 * DIA_MS),
    orderExpiraEn: new Date(AHORA.getTime() + 3 * 60 * 60 * 1000),
    generadoPor: null,
    generadoPorNombre: null,
    enviadoPor: null,
    enviadoEn: null,
    canalEnvio: null,
    idioma: null,
    invalidadoEn: null,
    motivoInvalido: null,
    ultimoError: null,
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    ...overrides,
  }
}

function ordenPaypal(overrides: Record<string, unknown> = {}) {
  return {
    id: "ORDER-1",
    status: "CREATED",
    customId: "token",
    invoiceId: "token",
    amountCents: 10656,
    currencyCode: "USD",
    payerActionUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    createTime: AHORA.toISOString(),
    captures: [],
    ...overrides,
  }
}

function dataCreada(pasarela: string): Record<string, unknown> {
  const llamadas = mocks.enlaceCreate.mock.calls.map(
    (llamada) => (llamada[0] as { data: Record<string, unknown> }).data
  )
  const encontrada = llamadas.find((data) => data.pasarela === pasarela)
  if (!encontrada) throw new Error(`No se creo un EnlacePago ${pasarela}`)
  return encontrada
}

function actualizacionConEstado(estado: string): Record<string, unknown> {
  const llamadas = mocks.enlaceUpdate.mock.calls.map(
    (llamada) => (llamada[0] as { data: Record<string, unknown> }).data
  )
  const encontrada = llamadas.find((data) => data.estado === estado)
  if (!encontrada) throw new Error(`No se actualizo a ${estado}`)
  return encontrada
}

let secuencia: number
let almacen: Map<string, Record<string, unknown>>

beforeEach(() => {
  for (const key of PAYPAL_KEYS) originalEnv.set(key, process.env[key])
  vi.clearAllMocks()
  configurar()

  secuencia = 0
  almacen = new Map()

  mocks.hitoFindUnique.mockResolvedValue(hitoBase())
  mocks.suscripcionFindUnique.mockResolvedValue(null)
  mocks.enlaceFindMany.mockResolvedValue([])
  mocks.enlaceFindFirst.mockResolvedValue(null)

  mocks.enlaceCreate.mockImplementation((args: { data: Record<string, unknown> }) => {
    secuencia += 1
    const fila = {
      id: `enlace_${secuencia}`,
      creadoEn: AHORA,
      actualizadoEn: AHORA,
      ...args.data,
    }
    almacen.set(String(fila.id), fila)
    return Promise.resolve(fila)
  })

  mocks.enlaceUpdate.mockImplementation(
    (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = {
        ...(almacen.get(args.where.id) ?? { id: args.where.id }),
        ...args.data,
        actualizadoEn: AHORA,
      }
      almacen.set(args.where.id, fila)
      return Promise.resolve(fila)
    }
  )

  mocks.createOrder.mockResolvedValue(ordenPaypal())
})

afterEach(() => {
  for (const key of PAYPAL_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  originalEnv.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("crearEnlacePaypal: alta (AC-1, AC-18, AC-24, AC-26)", () => {
  it("crea el enlace PayPal con token opaco, grupo estable, gross-up y snapshot de tarifa", async () => {
    const resultado = await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
      generadoPor: "user_admin",
      generadoPorNombre: "Ana Admin",
      idioma: "es",
    })

    // AC-1/AC-18: montos enteros en centavos USD, sin tocar el concepto.
    expect(mocks.hitoFindUnique).toHaveBeenCalledWith({
      where: { id: "hito_1" },
      include: { proyecto: { select: { titulo: true, clienteId: true } } },
    })
    expect(mocks.enlaceFindMany).toHaveBeenCalledWith({
      where: {
        grupoCobroId: "hito:hito_1",
        pasarela: "PAYPAL",
        estado: "ACTIVO",
      },
      orderBy: { creadoEn: "desc" },
    })

    const creado = dataCreada("PAYPAL")
    expect(creado).toMatchObject({
      clienteId: "cliente_1",
      hitoId: "hito_1",
      suscripcionId: null,
      pasarela: "PAYPAL",
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      moneda: "usd",
      meses: null,
      feeBps: 540,
      feeFixedCents: 30,
      estado: "CREANDO",
      grupoCobroId: "hito:hito_1",
      generadoPor: "user_admin",
      generadoPorNombre: "Ana Admin",
      idioma: "es",
    })
    expect(String(creado.token)).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(creado.expiraEn).toEqual(new Date(AHORA.getTime() + 30 * DIA_MS))
    expect(creado.url).toBe(`${BASE_URL}/pago/paypal/${String(creado.token)}`)

    // Primera orden PayPal: se guarda order id, approve URL y vigencia de 3 h.
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        montoCents: 10656,
        referencia: creado.token,
        descripcion: "Sitio ACME — Anticipo",
        locale: "es-AR",
        returnUrl: `${BASE_URL}/pago/paypal/retorno?enlace=${String(creado.token)}`,
        cancelUrl: `${BASE_URL}/pago/paypal/cancelado?enlace=${String(creado.token)}`,
      }),
      expect.objectContaining({ requestId: `paypal-link-${String(creado.token)}` })
    )

    const activo = actualizacionConEstado("ACTIVO")
    expect(activo).toMatchObject({
      estado: "ACTIVO",
      externalId: "ORDER-1",
      checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
      orderExpiraEn: new Date(AHORA.getTime() + PAYPAL_ORDER_TTL_MS),
      ultimoError: null,
    })

    expect(resultado.reutilizado).toBe(false)
    expect(resultado.url).toBe(`${BASE_URL}/pago/paypal/${String(creado.token)}`)
    expect(resultado.enlace.id).toBe("enlace_1")

    // AC-1: generar el link no marca pagado el hito ni crea un Pago.
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("usa la tarifa vigente de paypalConfig (override por env) sin recalcular historicos", async () => {
    configurar({ PAYPAL_FEE_BPS: "600", PAYPAL_FEE_FIXED_CENTS: "50" })

    await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    // ceil((10050 + 50) * 10000 / 9400) = 10745; comision = 695.
    const creado = dataCreada("PAYPAL")
    expect(creado).toMatchObject({
      montoAcordado: 10050,
      comision: 695,
      total: 10745,
      feeBps: 600,
      feeFixedCents: 50,
    })
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ montoCents: 10745 }),
      expect.anything()
    )
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("crea un enlace de soporte con los meses indicados", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcionBase())

    const resultado = await crearEnlacePaypal({
      suscripcionId: "suscripcion_1",
      meses: 3,
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    const creado = dataCreada("PAYPAL")
    expect(creado).toMatchObject({
      clienteId: "cliente_1",
      hitoId: null,
      suscripcionId: "suscripcion_1",
      concepto: "Soporte mensual — 3 meses",
      montoAcordado: 15000,
      meses: 3,
      grupoCobroId: "soporte:suscripcion_1",
    })
    expect(resultado.reutilizado).toBe(false)
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it.each([0, null])(
    "usa el catalogo cuando precioCustom es %s (igual que precioDePlan)",
    async (precioCustom) => {
      mocks.hitoFindUnique.mockResolvedValue(null)
      mocks.suscripcionFindUnique.mockResolvedValue(suscripcionBase({ precioCustom }))

      await crearEnlacePaypal({
        suscripcionId: "suscripcion_1",
        meses: 2,
        baseUrl: BASE_URL,
        ahora: AHORA,
      })

      // precioCustom 0/null no es override: 20000 del servicio x 2 meses.
      expect(dataCreada("PAYPAL")).toMatchObject({
        montoAcordado: 40000,
        meses: 2,
      })
    }
  )

  it("usa precioCustom > 0 en lugar del catalogo", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcionBase({ precioCustom: 7500 }))

    await crearEnlacePaypal({
      suscripcionId: "suscripcion_1",
      meses: 2,
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    // 7500 custom x 2 meses; el catalogo (20000) no participa.
    expect(dataCreada("PAYPAL")).toMatchObject({
      montoAcordado: 15000,
      meses: 2,
    })
  })
})

describe("elegibilidad del soporte (AC-1, AC-14)", () => {
  it.each([
    ["PAUSED", "SOPORTE"],
    ["CANCELED", "SOPORTE"],
    ["READY", "SOPORTE"],
    ["PENDING", "SOPORTE"],
    ["ACTIVE", "BASICO"],
    ["ACTIVE", "MANTENIMIENTO"],
  ])(
    "rechaza un soporte no elegible (estado=%s, plan=%s) sin crear ni llamar a PayPal",
    async (estado, plan) => {
      mocks.hitoFindUnique.mockResolvedValue(null)
      mocks.suscripcionFindUnique.mockResolvedValue(
        suscripcionBase({ estado, plan })
      )

      await expect(
        crearEnlacePaypal({
          suscripcionId: "suscripcion_1",
          meses: 1,
          baseUrl: BASE_URL,
          ahora: AHORA,
        })
      ).rejects.toMatchObject({
        codigo: "CONCEPTO_NO_ELEGIBLE",
        httpStatus: 409,
      })

      expect(mocks.enlaceFindFirst).not.toHaveBeenCalled()
      expect(mocks.enlaceFindMany).not.toHaveBeenCalled()
      expect(mocks.enlaceCreate).not.toHaveBeenCalled()
      expect(mocks.createOrder).not.toHaveBeenCalled()
      expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
      expect(mocks.pagoCreate).not.toHaveBeenCalled()
    }
  )

  it.each(["ACTIVE", "PAST_DUE"])(
    "acepta un soporte SOPORTE en estado %s",
    async (estado) => {
      mocks.hitoFindUnique.mockResolvedValue(null)
      mocks.suscripcionFindUnique.mockResolvedValue(
        suscripcionBase({ estado, plan: "SOPORTE" })
      )

      const resultado = await crearEnlacePaypal({
        suscripcionId: "suscripcion_1",
        meses: 2,
        baseUrl: BASE_URL,
        ahora: AHORA,
      })

      expect(resultado.reutilizado).toBe(false)
      expect(dataCreada("PAYPAL")).toMatchObject({
        suscripcionId: "suscripcion_1",
        meses: 2,
        montoAcordado: 10000,
      })
    }
  )
})

describe("reutilizacion y regeneracion (AC-2, AC-26)", () => {
  it("reutiliza un enlace ACTIVO no vencido del mismo grupo sin llamar a PayPal (AC-2)", async () => {
    mocks.enlaceFindMany.mockResolvedValue([enlaceActivo()])

    const resultado = await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    expect(resultado.reutilizado).toBe(true)
    expect(resultado.enlace.id).toBe("enlace_activo")
    expect(resultado.url).toBe(`${BASE_URL}/pago/paypal/token-activo`)
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  })

  it("regenerar invalida el link anterior y crea uno nuevo con el mismo grupo", async () => {
    mocks.enlaceFindMany.mockResolvedValue([enlaceActivo()])

    const resultado = await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
      regenerar: true,
    })

    const invalidado = actualizacionConEstado("INVALIDADO")
    expect(invalidado).toMatchObject({
      estado: "INVALIDADO",
      invalidadoEn: AHORA,
      motivoInvalido: MOTIVO_INVALIDACION_REGENERACION,
    })

    // Secuencia crear->confirmar->invalidar: el link anterior recien se
    // invalida despues de que el nuevo checkout quedo ACTIVO.
    const indiceActivo = mocks.enlaceUpdate.mock.calls.findIndex(
      (llamada) => (llamada[0] as { data: Record<string, unknown> }).data.estado === "ACTIVO"
    )
    const indiceInvalidado = mocks.enlaceUpdate.mock.calls.findIndex(
      (llamada) =>
        (llamada[0] as { data: Record<string, unknown> }).data.estado === "INVALIDADO"
    )
    const ordenCreate = mocks.enlaceCreate.mock.invocationCallOrder[0]
    const ordenActivo = mocks.enlaceUpdate.mock.invocationCallOrder[indiceActivo]
    const ordenInvalidado = mocks.enlaceUpdate.mock.invocationCallOrder[indiceInvalidado]
    expect(ordenCreate).toBeLessThan(ordenActivo)
    expect(ordenActivo).toBeLessThan(ordenInvalidado)

    const creado = dataCreada("PAYPAL")
    expect(creado.grupoCobroId).toBe("hito:hito_1")
    expect(creado.token).not.toBe("token-activo")
    expect(resultado.reutilizado).toBe(false)
    expect(resultado.enlace.id).toBe("enlace_1")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("no reutiliza en silencio un link con otro monto: exige regenerar", async () => {
    mocks.enlaceFindMany.mockResolvedValue([enlaceActivo({ montoAcordado: 20000 })])

    await expect(
      crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({
      codigo: "REQUIERE_REGENERAR",
      httpStatus: 409,
      enlaceId: "enlace_activo",
    })

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
  })

  it("no reutiliza en silencio un link de soporte con otros meses", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcionBase())
    mocks.enlaceFindMany.mockResolvedValue([
      enlaceActivo({
        hitoId: null,
        suscripcionId: "suscripcion_1",
        montoAcordado: 15000,
        meses: 1,
      }),
    ])

    await expect(
      crearEnlacePaypal({
        suscripcionId: "suscripcion_1",
        meses: 3,
        baseUrl: BASE_URL,
        ahora: AHORA,
      })
    ).rejects.toMatchObject({ codigo: "REQUIERE_REGENERAR", httpStatus: 409 })

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
  })

  it("si falla createOrder al regenerar, el link anterior sigue vigente", async () => {
    mocks.enlaceFindMany.mockResolvedValue([enlaceActivo()])
    mocks.createOrder.mockRejectedValue(
      new PaypalError({ code: "TIMEOUT", message: "PayPal no respondio a tiempo." })
    )

    await expect(
      crearEnlacePaypal({
        hitoId: "hito_1",
        baseUrl: BASE_URL,
        ahora: AHORA,
        regenerar: true,
      })
    ).rejects.toMatchObject({ codigo: "PAYPAL_ERROR", httpStatus: 502 })

    const actualizacionesDelAnterior = mocks.enlaceUpdate.mock.calls.filter(
      (llamada) => (llamada[0] as { where: { id: string } }).where.id === "enlace_activo"
    )
    expect(actualizacionesDelAnterior).toHaveLength(0)

    // El unico update de esta secuencia es el FALLIDO del enlace nuevo.
    const llamadaFallida = mocks.enlaceUpdate.mock.calls.find(
      (llamada) =>
        (llamada[0] as { data: Record<string, unknown> }).data.estado === "FALLIDO"
    )
    expect(llamadaFallida?.[0]).toMatchObject({
      where: { id: "enlace_1" },
      data: {
        estado: "FALLIDO",
        ultimoError: expect.stringContaining("no respondio a tiempo"),
      },
    })

    const estados = mocks.enlaceUpdate.mock.calls.map(
      (llamada) => (llamada[0] as { data: Record<string, unknown> }).data.estado
    )
    expect(estados).not.toContain("INVALIDADO")
    expect(estados).not.toContain("ACTIVO")
  })

  it("marca VENCIDO un link activo vencido y no lo reutiliza", async () => {
    mocks.enlaceFindMany.mockResolvedValue([
      enlaceActivo({ expiraEn: new Date(AHORA.getTime() - 1000) }),
    ])

    const resultado = await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    expect(mocks.enlaceUpdate).toHaveBeenCalledWith({
      where: { id: "enlace_activo" },
      data: { estado: "VENCIDO" },
    })
    expect(resultado.reutilizado).toBe(false)
    expect(resultado.enlace.id).toBe("enlace_1")
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  })

  it("mantiene un grupo estable entre regeneraciones y entre pasarelas", () => {
    expect(grupoCobroDeHito("hito_1")).toBe("hito:hito_1")
    expect(grupoCobroDeSuscripcion("suscripcion_1")).toBe("soporte:suscripcion_1")
  })
})

describe("adopcion de links MP legacy (AC-13)", () => {
  it("adopta el link MP como EnlacePago MERCADOPAGO con el mismo grupo, sin tocarlo", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/checkout",
        mpPreferenceId: "PREF-1",
        mpLinkExpira: new Date(AHORA.getTime() + 5 * DIA_MS),
      })
    )

    await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    expect(mocks.enlaceFindFirst).toHaveBeenCalledWith({
      where: {
        pasarela: "MERCADOPAGO",
        OR: [
          { externalId: "PREF-1" },
          { checkoutUrl: "https://mp.example/checkout" },
        ],
      },
      select: { id: true, estado: true, expiraEn: true },
    })

    const adoptado = dataCreada("MERCADOPAGO")
    expect(adoptado).toMatchObject({
      clienteId: "cliente_1",
      hitoId: "hito_1",
      suscripcionId: null,
      pasarela: "MERCADOPAGO",
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 10050,
      comision: 0,
      total: 10050,
      moneda: "usd",
      meses: null,
      feeBps: 0,
      feeFixedCents: 0,
      url: "https://mp.example/checkout",
      checkoutUrl: "https://mp.example/checkout",
      externalId: "PREF-1",
      estado: "ACTIVO",
      grupoCobroId: "hito:hito_1",
    })
    expect(String(adoptado.token)).toMatch(/^[A-Za-z0-9_-]{32}$/)

    const paypal = dataCreada("PAYPAL")
    expect(paypal.grupoCobroId).toBe(adoptado.grupoCobroId)
    expect(paypal.token).not.toBe(adoptado.token)

    // No se migra ni se modifica el hito ni su link MP.
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("no duplica la adopcion si el link MP ya fue adoptado", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/checkout",
        mpPreferenceId: "PREF-1",
        mpLinkExpira: new Date(AHORA.getTime() + 5 * DIA_MS),
      })
    )
    mocks.enlaceFindFirst.mockResolvedValue({
      id: "enlace_mp_existente",
      estado: "ACTIVO",
      expiraEn: new Date(AHORA.getTime() + 5 * DIA_MS),
    })

    await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    const adopciones = mocks.enlaceCreate.mock.calls
      .map((llamada) => (llamada[0] as { data: Record<string, unknown> }).data)
      .filter((data) => data.pasarela === "MERCADOPAGO")
    expect(adopciones).toHaveLength(0)
    expect(mocks.enlaceCreate).toHaveBeenCalledTimes(1)
    expect(dataCreada("PAYPAL").grupoCobroId).toBe("hito:hito_1")
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  })

  it("adopta un link MP legacy vencido como VENCIDO", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/checkout-viejo",
        mpPreferenceId: "PREF-VIEJO",
        mpLinkExpira: new Date(AHORA.getTime() - DIA_MS),
      })
    )

    await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      estado: "VENCIDO",
      externalId: "PREF-VIEJO",
    })
  })

  it("conserva mpLinkMeses y el concepto MP aunque el request pida otros meses", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(
      suscripcionBase({
        mpLink: "https://mp.example/soporte",
        mpPreferenceId: "PREF-SOPORTE",
        mpLinkExpira: new Date(AHORA.getTime() + 5 * DIA_MS),
        mpLinkMeses: 1,
      })
    )

    await crearEnlacePaypal({
      suscripcionId: "suscripcion_1",
      meses: 3,
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    // El snapshot MP conserva los datos legacy, independientes del request.
    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      pasarela: "MERCADOPAGO",
      concepto: "Soporte mensual — 1 mes",
      montoAcordado: 5000,
      total: 5000,
      meses: 1,
    })

    expect(dataCreada("PAYPAL")).toMatchObject({
      concepto: "Soporte mensual — 3 meses",
      montoAcordado: 15000,
      meses: 3,
    })
  })

  it("no contamina la adopcion MP de soporte con meses ni monto del request", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(
      suscripcionBase({
        mpLink: "https://mp.example/soporte",
        mpPreferenceId: "PREF-SOPORTE",
        mpLinkExpira: new Date(AHORA.getTime() + 5 * DIA_MS),
        mpLinkMeses: 1,
      })
    )

    await crearEnlacePaypal({
      suscripcionId: "suscripcion_1",
      meses: 3,
      montoAcordadoCents: 12345,
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    // Ambos overrides del request (meses=3, monto=12345) aplican solo al link
    // PayPal; la adopcion MP conserva mpLinkMeses=1 y el monto de referencia
    // legacy (precioCustom 5000 x 1 mes).
    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      pasarela: "MERCADOPAGO",
      concepto: "Soporte mensual — 1 mes",
      montoAcordado: 5000,
      total: 5000,
      meses: 1,
    })

    expect(dataCreada("PAYPAL")).toMatchObject({
      concepto: "Soporte mensual — 3 meses",
      montoAcordado: 12345,
      meses: 3,
    })
  })

  it("no contamina el monto MP con montoAcordadoCents del request PayPal", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/checkout",
        mpPreferenceId: "PREF-1",
        mpLinkExpira: new Date(AHORA.getTime() + 5 * DIA_MS),
      })
    )

    await crearEnlacePaypal({
      hitoId: "hito_1",
      montoAcordadoCents: 20000,
      baseUrl: BASE_URL,
      ahora: AHORA,
    })

    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      montoAcordado: 10050,
      total: 10050,
    })
    expect(dataCreada("PAYPAL")).toMatchObject({
      montoAcordado: 20000,
      concepto: "Sitio ACME — Anticipo",
    })
  })

  it("usa 30 dias desde ahora si el link MP no tiene vencimiento", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/sin-vencimiento",
        mpLinkExpira: null,
      })
    )

    await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })

    const adoptado = dataCreada("MERCADOPAGO")
    expect(adoptado.estado).toBe("ACTIVO")
    expect(adoptado.expiraEn).toEqual(new Date(AHORA.getTime() + 30 * DIA_MS))
  })

  it("marca VENCIDO el link MP adoptado que ya vencio sin duplicarlo", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({
        mpLink: "https://mp.example/vencido",
        mpPreferenceId: "PREF-VENCIDO",
      })
    )
    mocks.enlaceFindFirst.mockResolvedValue({
      id: "enlace_mp_vencido",
      estado: "ACTIVO",
      expiraEn: new Date(AHORA.getTime() - DIA_MS),
    })

    await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })

    expect(mocks.enlaceUpdate).toHaveBeenCalledWith({
      where: { id: "enlace_mp_vencido" },
      data: { estado: "VENCIDO" },
    })
    const adopciones = mocks.enlaceCreate.mock.calls
      .map((llamada) => (llamada[0] as { data: Record<string, unknown> }).data)
      .filter((data) => data.pasarela === "MERCADOPAGO")
    expect(adopciones).toHaveLength(0)
  })

  it("adopta el link MP cuando solo existe mpLink", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({ mpLink: "https://mp.example/solo-link", mpPreferenceId: null })
    )

    await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })

    expect(mocks.enlaceFindFirst).toHaveBeenCalledWith({
      where: {
        pasarela: "MERCADOPAGO",
        OR: [{ checkoutUrl: "https://mp.example/solo-link" }],
      },
      select: { id: true, estado: true, expiraEn: true },
    })
    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      externalId: null,
      url: "https://mp.example/solo-link",
      checkoutUrl: "https://mp.example/solo-link",
    })
  })

  it("adopta el link MP cuando solo existe mpPreferenceId", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({ mpLink: null, mpPreferenceId: "PREF-SOLO" })
    )

    await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })

    expect(mocks.enlaceFindFirst).toHaveBeenCalledWith({
      where: {
        pasarela: "MERCADOPAGO",
        OR: [{ externalId: "PREF-SOLO" }],
      },
      select: { id: true, estado: true, expiraEn: true },
    })
    expect(dataCreada("MERCADOPAGO")).toMatchObject({
      externalId: "PREF-SOLO",
      url: null,
      checkoutUrl: null,
    })
  })
})

describe("errores (AC-14, AC-16)", () => {
  it("no consulta la base ni crea nada si PayPal no esta configurado", async () => {
    limpiarEnv()

    await expect(
      crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({ codigo: "NO_CONFIGURADO", httpStatus: 503 })

    await expect(
      crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toBeInstanceOf(PaypalLinkError)

    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.enlaceFindFirst).not.toHaveBeenCalled()
    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("si createOrder falla deja el enlace FALLIDO con error sanitizado y sin ACTIVO", async () => {
    mocks.createOrder.mockRejectedValue(
      new PaypalError({
        code: "HTTP",
        httpStatus: 500,
        issue: "INTERNAL_SERVER_ERROR",
        message: "PayPal rechazo crear la orden (HTTP 500, INTERNAL_SERVER_ERROR).",
      })
    )

    await expect(
      crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({
      codigo: "PAYPAL_ERROR",
      httpStatus: 502,
      enlaceId: "enlace_1",
    })

    const fallido = actualizacionConEstado("FALLIDO")
    expect(fallido.estado).toBe("FALLIDO")
    expect(String(fallido.ultimoError)).toContain("HTTP 500")
    expect(String(fallido.ultimoError)).not.toContain("client-secret")

    const estados = mocks.enlaceUpdate.mock.calls.map(
      (llamada) => (llamada[0] as { data: Record<string, unknown> }).data.estado
    )
    expect(estados).not.toContain("ACTIVO")
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("rechaza argumentos invalidos sin tocar la base", async () => {
    await expect(
      crearEnlacePaypal({
        hitoId: "hito_1",
        suscripcionId: "suscripcion_1",
        baseUrl: BASE_URL,
        ahora: AHORA,
      })
    ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS", httpStatus: 400 })

    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.suscripcionFindUnique).not.toHaveBeenCalled()
    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
  })

  it.each(["http://pixelarch.dev", "ftp://pixelarch.dev"])(
    "rechaza la base insegura %s antes de tocar la base",
    async (baseUrl) => {
      await expect(
        crearEnlacePaypal({ hitoId: "hito_1", baseUrl, ahora: AHORA })
      ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS", httpStatus: 400 })

      expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
      expect(mocks.enlaceCreate).not.toHaveBeenCalled()
      expect(mocks.createOrder).not.toHaveBeenCalled()
    }
  )

  it.each([
    "",
    "   ",
    "no-es-una-url",
    "pixelarch.dev",
    "https://user:pass@pixelarch.dev",
    "https://pixelarch.dev?foo=bar",
    "https://pixelarch.dev#seccion",
  ])(
    "rechaza la base invalida %j como ARGUMENTOS_INVALIDOS",
    async (baseUrl) => {
      await expect(
        crearEnlacePaypal({ hitoId: "hito_1", baseUrl, ahora: AHORA })
      ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS", httpStatus: 400 })

      expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
      expect(mocks.enlaceCreate).not.toHaveBeenCalled()
      expect(mocks.createOrder).not.toHaveBeenCalled()
    }
  )

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "acepta HTTP en loopback para desarrollo (%s)",
    async (baseUrl) => {
      const resultado = await crearEnlacePaypal({
        hitoId: "hito_1",
        baseUrl,
        ahora: AHORA,
      })

      expect(resultado.url).toContain("/pago/paypal/")
    }
  )

  it("acepta HTTP solo en localhost para desarrollo", async () => {
    const resultado = await crearEnlacePaypal({
      hitoId: "hito_1",
      baseUrl: "http://localhost:3000",
      ahora: AHORA,
    })

    expect(resultado.url).toMatch(/^http:\/\/localhost:3000\/pago\/paypal\//)
  })

  it.each([0, 13])("rechaza meses fuera de 1..12 (%s)", async (meses) => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcionBase())

    await expect(
      crearEnlacePaypal({
        suscripcionId: "suscripcion_1",
        meses,
        baseUrl: BASE_URL,
        ahora: AHORA,
      })
    ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS", httpStatus: 400 })

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("devuelve CONCEPTO_NO_ENCONTRADO para hito y soporte inexistentes", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockResolvedValue(null)

    await expect(
      crearEnlacePaypal({ hitoId: "hito_x", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({ codigo: "CONCEPTO_NO_ENCONTRADO", httpStatus: 404 })

    await expect(
      crearEnlacePaypal({ suscripcionId: "suscripcion_x", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({ codigo: "CONCEPTO_NO_ENCONTRADO", httpStatus: 404 })

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("deja FALLIDO si createOrder no devuelve payerActionUrl", async () => {
    mocks.createOrder.mockResolvedValue(ordenPaypal({ payerActionUrl: null }))

    await expect(
      crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    ).rejects.toMatchObject({
      codigo: "PAYPAL_ERROR",
      httpStatus: 502,
      enlaceId: "enlace_1",
    })

    const fallido = actualizacionConEstado("FALLIDO")
    expect(String(fallido.ultimoError)).toContain("link de aprobacion")
    const estados = mocks.enlaceUpdate.mock.calls.map(
      (llamada) => (llamada[0] as { data: Record<string, unknown> }).data.estado
    )
    expect(estados).not.toContain("ACTIVO")
  })

  it("envuelve errores de Prisma sin filtrar el detalle crudo", async () => {
    mocks.hitoFindUnique.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    let capturado: unknown
    try {
      await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe("No se pudo consultar el hito.")
    expect((capturado as Error).message).not.toContain("postgres")
    expect((capturado as Error).message).not.toContain("secreto")
  })

  it("envuelve errores de Prisma al consultar el soporte", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)
    mocks.suscripcionFindUnique.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    let capturado: unknown
    try {
      await crearEnlacePaypal({
        suscripcionId: "suscripcion_1",
        baseUrl: BASE_URL,
        ahora: AHORA,
      })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe("No se pudo consultar el soporte.")
    expect((capturado as Error).message).not.toContain("postgres")
    expect((capturado as Error).message).not.toContain("secreto")
    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("envuelve errores de Prisma al buscar links activos", async () => {
    mocks.enlaceFindMany.mockRejectedValue(new Error("relation does not exist"))

    let capturado: unknown
    try {
      await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe("No se pudo consultar el link de pago.")
    expect((capturado as Error).message).not.toContain("relation")

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("envuelve errores de Prisma al crear el enlace", async () => {
    mocks.enlaceCreate.mockRejectedValueOnce(
      new Error("insert into EnlacePago failed: postgres://user:secreto@db:5432")
    )

    let capturado: unknown
    try {
      await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe("No se pudo guardar el enlace de pago.")
    expect((capturado as Error).message).not.toContain("postgres")
    expect((capturado as Error).message).not.toContain("secreto")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("envuelve errores de Prisma al verificar el link MP legacy", async () => {
    mocks.hitoFindUnique.mockResolvedValue(
      hitoBase({ mpLink: "https://mp.example/checkout" })
    )
    mocks.enlaceFindFirst.mockRejectedValue(new Error("db down"))

    let capturado: unknown
    try {
      await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe(
      "No se pudo verificar el link de Mercado Pago."
    )
    expect((capturado as Error).message).not.toContain("db down")

    expect(mocks.enlaceCreate).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("envuelve errores de Prisma al confirmar el link nuevo", async () => {
    mocks.enlaceUpdate.mockRejectedValueOnce(new Error("raw db detail"))

    let capturado: unknown
    try {
      await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalLinkError)
    expect(capturado).toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
      enlaceId: "enlace_1",
    })
    expect((capturado as Error).message).toBe("No se pudo confirmar el enlace de pago.")
    expect((capturado as Error).message).not.toContain("raw db detail")

    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  })
})

describe("contrato de datos (AC-12, AC-26)", () => {
  it("el enlace guarda la vigencia de 30 dias y el concepto para el historial", async () => {
    await crearEnlacePaypal({ hitoId: "hito_1", baseUrl: BASE_URL, ahora: AHORA })

    const creado = dataCreada("PAYPAL")
    const expiraEn = creado.expiraEn as Date
    expect(expiraEn.getTime() - AHORA.getTime()).toBe(30 * DIA_MS)
    expect(creado.concepto).toBe("Sitio ACME — Anticipo")
    expect(creado.generadoPor).toBeNull()
    expect(creado.generadoPorNombre).toBeNull()
  })
})
