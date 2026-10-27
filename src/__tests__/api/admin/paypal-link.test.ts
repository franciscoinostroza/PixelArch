import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-08 (AC-1, AC-2, AC-3, AC-14, AC-16, AC-17, AC-24): API de generacion de
 * link PayPal.
 *
 * `requireStaff`, Prisma, la configuracion y el servicio de links estan
 * mockeados: no hay base ni llamadas reales a PayPal. Se cubren permisos,
 * validacion del body, concepto inexistente/pagado/en revision, 503/502/500,
 * el contrato 200, la reutilizacion y que la ruta no escriba en hito,
 * suscripcion, Pago ni EnlacePago, ni toque Mercado Pago.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  paypalConfig: vi.fn(),
  crearEnlacePaypal: vi.fn(),
  createOrder: vi.fn(),
  hitoFindUnique: vi.fn(),
  suscripcionFindUnique: vi.fn(),
  pagoFindFirst: vi.fn(),
  hitoUpdate: vi.fn(),
  suscripcionUpdate: vi.fn(),
  pagoCreate: vi.fn(),
  enlaceCreate: vi.fn(),
  enlaceUpdate: vi.fn(),
  crearLinkDePagoMp: vi.fn(),
  obtenerPagoMp: vi.fn(),
  mpClient: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hito: { findUnique: mocks.hitoFindUnique, update: mocks.hitoUpdate },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      update: mocks.suscripcionUpdate,
    },
    pago: { findFirst: mocks.pagoFindFirst, create: mocks.pagoCreate },
    enlacePago: { create: mocks.enlaceCreate, update: mocks.enlaceUpdate },
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// AC-1/AC-20: generar un link PayPal no debe tocar Mercado Pago.
vi.mock("@/lib/mercadopago", () => ({
  crearLinkDePago: mocks.crearLinkDePagoMp,
  obtenerPagoMp: mocks.obtenerPagoMp,
  mpClient: mocks.mpClient,
}))

vi.mock("@/lib/paypal/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/config")>()
  return { ...actual, paypalConfig: mocks.paypalConfig }
})

vi.mock("@/lib/paypal/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/client")>()
  return { ...actual, createOrder: mocks.createOrder }
})

vi.mock("@/lib/paypal/links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/links")>()
  return { ...actual, crearEnlacePaypal: mocks.crearEnlacePaypal }
})

import { POST } from "@/app/api/admin/paypal/link/route"
import {
  MENSAJE_SOPORTE_NO_ELEGIBLE,
  PaypalLinkError,
} from "@/lib/paypal/links"

const BASE_URL = "http://localhost:3000"
const RUTA = `${BASE_URL}/api/admin/paypal/link`

const STAFF = {
  userId: "user_staff",
  nombre: "Ana Admin",
  rol: "admin",
  esAdmin: true,
  cliente: null,
}

function configDisponible() {
  return {
    disponible: true,
    motivo: null,
    env: "sandbox",
    baseUrl: "https://api-m.sandbox.paypal.com",
    clientId: "client-id-de-prueba",
    clientSecret: "client-secret-de-prueba",
    webhookId: "webhook-id-de-prueba",
    fee: { bps: 540, fixedCents: 30 },
  }
}

function configDeshabilitada(motivo: string) {
  return {
    disponible: false,
    motivo,
    env: null,
    baseUrl: null,
    clientId: null,
    clientSecret: null,
    webhookId: null,
    fee: { bps: 540, fixedCents: 30 },
  }
}

function hito(overrides: Record<string, unknown> = {}) {
  return {
    id: "hito_1",
    estado: "PENDIENTE",
    proyecto: { clienteId: "cliente_1" },
    ...overrides,
  }
}

function suscripcion(overrides: Record<string, unknown> = {}) {
  return {
    id: "suscripcion_1",
    clienteId: "cliente_1",
    estado: "ACTIVE",
    plan: "SOPORTE",
    ...overrides,
  }
}

function enlace(overrides: Record<string, unknown> = {}) {
  return {
    id: "enlace_1",
    token: "token_1",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    expiraEn: new Date("2026-11-18T12:00:00.000Z"),
    ...overrides,
  }
}

function resultado(overrides: Record<string, unknown> = {}) {
  return {
    enlace: enlace(),
    url: "https://pixelarch.dev/pago/paypal/token_1",
    reutilizado: false,
    ...overrides,
  }
}

let ipSequence = 0

/**
 * Cada request usa una IP distinta por defecto para no agotar el rate limit
 * (20/min) entre tests. Los casos de 429 pasan una IP fija explicita.
 */
function proximaIp(): string {
  ipSequence += 1
  return `198.51.${Math.floor(ipSequence / 250)}.${(ipSequence % 250) + 1}`
}

function request(body: unknown, url = RUTA, ip = proximaIp()): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function expectSinEscrituras() {
  expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  expect(mocks.pagoCreate).not.toHaveBeenCalled()
  expect(mocks.enlaceCreate).not.toHaveBeenCalled()
  expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
  // AC-20: el flujo PayPal no debe tocar Mercado Pago.
  expect(mocks.crearLinkDePagoMp).not.toHaveBeenCalled()
  expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
  expect(mocks.mpClient).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requireStaff.mockResolvedValue(STAFF)
  mocks.paypalConfig.mockReturnValue(configDisponible())
  mocks.hitoFindUnique.mockResolvedValue(hito())
  mocks.suscripcionFindUnique.mockResolvedValue(null)
  mocks.pagoFindFirst.mockResolvedValue(null)
  mocks.crearEnlacePaypal.mockResolvedValue(resultado())
  mocks.createOrder.mockResolvedValue({
    id: "ORDER-1",
    status: "CREATED",
    payerActionUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    captures: [],
  })
})

describe("POST /api/admin/paypal/link: autorizacion (AC-17)", () => {
  it("responde 403 sin staff y no consulta la base ni crea nada", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: "No autorizado" })
    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.suscripcionFindUnique).not.toHaveBeenCalled()
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("aplica 20/min por IP antes de requireStaff y responde 429", async () => {
    const ip = "203.0.113.20"

    for (let intento = 0; intento < 20; intento += 1) {
      const permitida = await POST(
        request({ hitoId: "hito_1" }, RUTA, ip)
      )
      expect(permitida.status).toBe(200)
    }

    vi.clearAllMocks()

    const res = await POST(request({ hitoId: "hito_1" }, RUTA, ip))

    expect(res.status).toBe(429)
    expect(await json(res)).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.requireStaff).not.toHaveBeenCalled()
    expect(mocks.paypalConfig).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("permite generar el link a la asistente y registra sus datos", async () => {
    mocks.requireStaff.mockResolvedValue({
      ...STAFF,
      userId: "user_asistente",
      nombre: "Bea Asistente",
      rol: "asistente",
      esAdmin: false,
    })

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(200)
    expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith(
      expect.objectContaining({
        generadoPor: "user_asistente",
        generadoPorNombre: "Bea Asistente",
      })
    )
  })
})

describe("POST /api/admin/paypal/link: body (AC-1)", () => {
  it("responde 400 con JSON invalido sin llamar al servicio", async () => {
    const res = await POST(request("{"))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "JSON invalido" })
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
  })

  it.each([
    ["sin ids", {}],
    ["con ambos ids", { hitoId: "hito_1", suscripcionId: "suscripcion_1" }],
    ["con id vacio", { hitoId: "  " }],
    ["con meses en un hito", { hitoId: "hito_1", meses: 2 }],
    ["con meses 0", { suscripcionId: "suscripcion_1", meses: 0 }],
    ["con meses 13", { suscripcionId: "suscripcion_1", meses: 13 }],
    ["con meses decimales", { suscripcionId: "suscripcion_1", meses: 1.5 }],
    ["con monto 0", { hitoId: "hito_1", montoAcordadoCents: 0 }],
    ["con monto negativo", { hitoId: "hito_1", montoAcordadoCents: -1 }],
    ["con monto decimal", { hitoId: "hito_1", montoAcordadoCents: 10.5 }],
    ["con idioma invalido", { hitoId: "hito_1", idioma: "fr" }],
    ["con regenerar invalido", { hitoId: "hito_1", regenerar: "si" }],
  ])("responde 400 %s", async (_caso, body) => {
    const res = await POST(request(body))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "Datos invalidos" })
    expect(mocks.paypalConfig).not.toHaveBeenCalled()
    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.suscripcionFindUnique).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })
})

describe("POST /api/admin/paypal/link: concepto (AC-1, AC-14)", () => {
  it("responde 404 si el hito no existe", async () => {
    mocks.hitoFindUnique.mockResolvedValue(null)

    const res = await POST(request({ hitoId: "hito_x" }))

    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: "Concepto no encontrado." })
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 404 si el soporte no existe", async () => {
    mocks.suscripcionFindUnique.mockResolvedValue(null)

    const res = await POST(request({ suscripcionId: "suscripcion_x", meses: 1 }))

    expect(res.status).toBe(404)
    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 404 si el hito no esta vinculado a un cliente", async () => {
    mocks.hitoFindUnique.mockResolvedValue(hito({ proyecto: { clienteId: "" } }))

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(404)
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 404 si el soporte no esta vinculado a un cliente", async () => {
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcion({ clienteId: "" }))

    const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 1 }))

    expect(res.status).toBe(404)
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el hito ya esta PAGADO sin consultar pagos", async () => {
    mocks.hitoFindUnique.mockResolvedValue(hito({ estado: "PAGADO" }))

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: "El hito ya esta pagado." })
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el hito tiene un pago en REVISION PENDIENTE", async () => {
    mocks.pagoFindFirst.mockResolvedValue({ id: "pago_revision" })

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(409)
    expect(mocks.pagoFindFirst).toHaveBeenCalledWith({
      where: {
        hitoId: "hito_1",
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
      },
      select: { id: true },
    })
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el soporte tiene un pago en REVISION PENDIENTE", async () => {
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcion())
    mocks.pagoFindFirst.mockResolvedValue({ id: "pago_revision" })

    const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 3 }))

    expect(res.status).toBe(409)
    expect(mocks.pagoFindFirst).toHaveBeenCalledWith({
      where: {
        suscripcionId: "suscripcion_1",
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
      },
      select: { id: true },
    })
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("no bloquea si el pago en REVISION ya fue RECHAZADO", async () => {
    // Store falso: el pago rechazado existe, pero solo una consulta sin el
    // filtro revisionEstado=PENDIENTE lo devolveria. El filtro debe ignorarlo.
    const pagos = [
      { id: "pago_rechazado", estadoPago: "REVISION", revisionEstado: "RECHAZADO" },
    ]
    mocks.pagoFindFirst.mockImplementation(
      (args: { where: { revisionEstado?: string } }) =>
        Promise.resolve(
          args.where.revisionEstado === "PENDIENTE"
            ? pagos.find((pago) => pago.revisionEstado === "PENDIENTE") ?? null
            : pagos[0] ?? null
        )
    )

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(200)
    expect(mocks.pagoFindFirst).toHaveBeenCalledWith({
      where: {
        hitoId: "hito_1",
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
      },
      select: { id: true },
    })
    expect(mocks.crearEnlacePaypal).toHaveBeenCalledTimes(1)
    expectSinEscrituras()
  })
})

describe("POST /api/admin/paypal/link: elegibilidad del soporte (AC-1, AC-17)", () => {
  it.each([
    ["PAUSED", "SOPORTE"],
    ["CANCELED", "SOPORTE"],
    ["READY", "SOPORTE"],
    ["PENDING", "SOPORTE"],
    ["ACTIVE", "BASICO"],
    ["ACTIVE", "MANTENIMIENTO"],
  ])(
    "responde 409 si el soporte no es elegible (estado=%s, plan=%s)",
    async (estado, plan) => {
      mocks.suscripcionFindUnique.mockResolvedValue(suscripcion({ estado, plan }))

      const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 1 }))

      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({
        error:
          "El soporte no esta habilitado para cobrar por PayPal (debe estar ACTIVE o PAST_DUE y ser plan SOPORTE).",
      })
      // La elegibilidad se valida antes de consultar pagos o crear el link.
      expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
      expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
      expectSinEscrituras()
    }
  )

  it.each(["ACTIVE", "PAST_DUE"])(
    "permite generar el link de un soporte SOPORTE en %s",
    async (estado) => {
      mocks.suscripcionFindUnique.mockResolvedValue(suscripcion({ estado }))

      const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 2 }))

      expect(res.status).toBe(200)
      expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith(
        expect.objectContaining({ suscripcionId: "suscripcion_1", meses: 2 })
      )
      expectSinEscrituras()
    }
  )
})

describe("POST /api/admin/paypal/link: errores de PayPal (AC-14, AC-16)", () => {
  it("responde 503 generico si PayPal no esta configurado, sin consultar la base", async () => {
    mocks.paypalConfig.mockReturnValue(
      configDeshabilitada(
        "PayPal no disponible: configuracion incompleta (faltan PAYPAL_ENV, PAYPAL_CLIENT_ID)."
      )
    )

    const res = await POST(request({ hitoId: "hito_1" }))
    const payload = await json(res)

    expect(res.status).toBe(503)
    expect(payload.error).toBe(
      "PayPal no disponible: configuracion incompleta o invalida."
    )
    expect(JSON.stringify(payload)).not.toContain("PAYPAL_")
    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.pagoFindFirst).not.toHaveBeenCalled()
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("mapea NO_CONFIGURADO del servicio a 503 sin exponer nombres de envs", async () => {
    mocks.crearEnlacePaypal.mockRejectedValue(
      new PaypalLinkError({
        codigo: "NO_CONFIGURADO",
        mensaje:
          "PayPal no disponible: configuracion incompleta (faltan PAYPAL_CLIENT_ID).",
      })
    )

    const res = await POST(request({ hitoId: "hito_1" }))
    const payload = await json(res)

    expect(res.status).toBe(503)
    expect(payload.error).toBe(
      "PayPal no disponible: configuracion incompleta o invalida."
    )
    expect(JSON.stringify(payload)).not.toContain("PAYPAL_")
    expectSinEscrituras()
  })

  it("mapea PAYPAL_ERROR a 502 sin crear Pago ni tocar el concepto", async () => {
    mocks.crearEnlacePaypal.mockRejectedValue(
      new PaypalLinkError({
        codigo: "PAYPAL_ERROR",
        mensaje: "PayPal no pudo crear el checkout.",
        enlaceId: "enlace_1",
      })
    )

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(502)
    expect(await json(res)).toEqual({ error: "PayPal no pudo crear el checkout." })
    expectSinEscrituras()
  })

  it("mapea un error inesperado a 500 sin filtrar el detalle crudo", async () => {
    mocks.crearEnlacePaypal.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await POST(request({ hitoId: "hito_1" }))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload.error).toBe("Error al generar el link de PayPal.")
    expect(JSON.stringify(payload)).not.toContain("postgres")
    expect(JSON.stringify(payload)).not.toContain("secreto")
    expectSinEscrituras()
  })

  it("mapea CONCEPTO_NO_ELEGIBLE del servicio a 409 con el mensaje canonico (defensa en profundidad)", async () => {
    // La ruta ya valida la elegibilidad, pero si `crearEnlacePaypal` la rechaza
    // (por ejemplo, por una carrera entre la lectura y la creacion) el 409 debe
    // conservar el mensaje canonico y no dejar escrituras.
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcion())
    mocks.crearEnlacePaypal.mockRejectedValue(
      new PaypalLinkError({
        codigo: "CONCEPTO_NO_ELEGIBLE",
        mensaje: MENSAJE_SOPORTE_NO_ELEGIBLE,
      })
    )

    const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 1 }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: MENSAJE_SOPORTE_NO_ELEGIBLE })
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it.each([
    ["ARGUMENTOS_INVALIDOS", 400],
    ["CONCEPTO_NO_ENCONTRADO", 404],
    ["REQUIERE_REGENERAR", 409],
    ["ERROR_INTERNO", 500],
  ] as const)("mapea %s a %i", async (codigo, status) => {
    mocks.crearEnlacePaypal.mockRejectedValue(
      new PaypalLinkError({ codigo, mensaje: `Error ${codigo}` })
    )

    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(status)
    expectSinEscrituras()
  })
})

describe("POST /api/admin/paypal/link: contrato 200 (AC-1, AC-3, AC-24)", () => {
  it("devuelve el link y el desglose, y pasa los datos del staff y del request", async () => {
    const res = await POST(
      request({
        hitoId: "hito_1",
        montoAcordadoCents: 10050,
        descripcion: "Anticipo",
        notaInterna: "Acordado por email",
        idioma: "en",
        regenerar: true,
      })
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      ok: true,
      enlaceId: "enlace_1",
      url: "https://pixelarch.dev/pago/paypal/token_1",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      moneda: "usd",
      expiraEn: "2026-11-18T12:00:00.000Z",
      reutilizado: false,
    })

    expect(mocks.hitoFindUnique).toHaveBeenCalledWith({
      where: { id: "hito_1" },
      select: {
        id: true,
        estado: true,
        proyecto: { select: { clienteId: true } },
      },
    })
    expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith({
      hitoId: "hito_1",
      suscripcionId: null,
      montoAcordadoCents: 10050,
      meses: null,
      descripcion: "Anticipo",
      notaInterna: "Acordado por email",
      generadoPor: "user_staff",
      generadoPorNombre: "Ana Admin",
      idioma: "en",
      regenerar: true,
      baseUrl: BASE_URL,
    })

    // AC-1: generar el link no toca el concepto, no crea Pago ni orden aca.
    expectSinEscrituras()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("aplica idioma es y regenerar false por defecto", async () => {
    await POST(request({ hitoId: "hito_1" }))

    expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith(
      expect.objectContaining({
        idioma: "es",
        regenerar: false,
        montoAcordadoCents: null,
        meses: null,
        descripcion: null,
        notaInterna: null,
      })
    )
  })

  it("genera un link de soporte con meses y no actualiza la suscripcion", async () => {
    mocks.suscripcionFindUnique.mockResolvedValue(suscripcion())
    mocks.crearEnlacePaypal.mockResolvedValue(
      resultado({ enlace: enlace({ meses: 3 }) })
    )

    const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 3 }))

    expect(res.status).toBe(200)
    expect(mocks.suscripcionFindUnique).toHaveBeenCalledWith({
      where: { id: "suscripcion_1" },
      select: { id: true, clienteId: true, estado: true, plan: true },
    })
    expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith(
      expect.objectContaining({
        hitoId: null,
        suscripcionId: "suscripcion_1",
        meses: 3,
      })
    )
    expectSinEscrituras()
  })

  it("reutiliza el link vigente y propaga reutilizado=true", async () => {
    mocks.crearEnlacePaypal.mockResolvedValue(resultado({ reutilizado: true }))

    const res = await POST(request({ hitoId: "hito_1" }))
    const payload = await json(res)

    expect(res.status).toBe(200)
    expect(payload.reutilizado).toBe(true)
    expect(mocks.crearEnlacePaypal).toHaveBeenCalledTimes(1)
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("usa el origin de la request como baseUrl", async () => {
    await POST(request({ hitoId: "hito_1" }, "https://pixelarch.dev/api/admin/paypal/link"))

    expect(mocks.crearEnlacePaypal).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://pixelarch.dev" })
    )
  })

  it("responde 200 con Cache-Control: no-store porque el body incluye el token", async () => {
    const res = await POST(request({ hitoId: "hito_1" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})

describe("POST /api/admin/paypal/link: errores de base (500 generico)", () => {
  function expectErrorGenerico(
    res: Response,
    payload: Record<string, unknown>
  ) {
    expect(res.status).toBe(500)
    expect(payload.error).toBe("Error al generar el link de PayPal.")
    expect(JSON.stringify(payload)).not.toContain("postgres")
    expect(JSON.stringify(payload)).not.toContain("secreto")
    expect(JSON.stringify(payload)).not.toContain("raw db detail")
    expect(mocks.crearEnlacePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  }

  it("responde 500 si falla findUnique del hito sin filtrar el detalle", async () => {
    mocks.hitoFindUnique.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await POST(request({ hitoId: "hito_1" }))

    expectErrorGenerico(res, await json(res))
  })

  it("responde 500 si falla findUnique del soporte sin filtrar el detalle", async () => {
    mocks.suscripcionFindUnique.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await POST(request({ suscripcionId: "suscripcion_1", meses: 1 }))

    expectErrorGenerico(res, await json(res))
  })

  it("responde 500 si falla findFirst de pagos sin filtrar el detalle", async () => {
    mocks.pagoFindFirst.mockRejectedValue(new Error("raw db detail: secreto"))

    const res = await POST(request({ hitoId: "hito_1" }))

    expectErrorGenerico(res, await json(res))
  })
})
