import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-09 (AC-3, AC-4, AC-12, AC-17): envio/registro del link PayPal.
 *
 * `requireStaff`, Prisma, Resend y `armarMensajePaypal` estan mockeados: no hay
 * base ni llamadas reales. Se cubren permisos, body Zod, enlace inexistente o
 * no utilizable, cliente sin email, Resend no configurado, envio EMAIL con
 * tracking, WHATSAPP/COPIA sin envio, idioma ES/EN y que la ruta no escriba en
 * hito, suscripcion, Pago, eventos ni Mercado Pago.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  armarMensajePaypal: vi.fn(),
  resend: vi.fn(),
  send: vi.fn(),
  enlaceFindUnique: vi.fn(),
  enlaceUpdate: vi.fn(),
  hitoUpdate: vi.fn(),
  suscripcionUpdate: vi.fn(),
  pagoCreate: vi.fn(),
  pagoUpdate: vi.fn(),
  eventoCreate: vi.fn(),
  crearLinkDePagoMp: vi.fn(),
  obtenerPagoMp: vi.fn(),
  mpClient: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enlacePago: {
      findUnique: mocks.enlaceFindUnique,
      update: mocks.enlaceUpdate,
    },
    hito: { update: mocks.hitoUpdate },
    suscripcion: { update: mocks.suscripcionUpdate },
    pago: { create: mocks.pagoCreate, update: mocks.pagoUpdate },
    eventoPasarela: { create: mocks.eventoCreate },
  },
}))

vi.mock("@/lib/resend", () => ({ resend: mocks.resend }))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

// AC-20: este flujo no debe tocar Mercado Pago.
vi.mock("@/lib/mercadopago", () => ({
  crearLinkDePago: mocks.crearLinkDePagoMp,
  obtenerPagoMp: mocks.obtenerPagoMp,
  mpClient: mocks.mpClient,
}))

vi.mock("@/lib/paypal/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/messages")>()
  return { ...actual, armarMensajePaypal: mocks.armarMensajePaypal }
})

import { POST } from "@/app/api/admin/paypal/enviar/route"

const BASE_URL = "http://localhost:3000"
const RUTA = `${BASE_URL}/api/admin/paypal/enviar`
const ENLACE_ID = "enlace_1"
const CLIENTE_EMAIL = "ana@example.com"
const CLIENTE_NOMBRE = "Ana Perez"
const LINK = "https://pixelarch.dev/pago/paypal/token_1"
// Reloj congelado: la ruta compara `expiraEn` contra `new Date()`. Sin esto, la
// suite empezaria a fallar cuando la fecha real supere VENCIMIENTO.
const AHORA = new Date("2026-10-20T12:00:00.000Z")
const VENCIMIENTO = new Date("2026-11-18T12:00:00.000Z")
const FROM = "PixelArch <noreply@pixelarch.dev>"

const MENSAJE_EMAIL = {
  asunto: "Cobro por PayPal — Anticipo del proyecto",
  cuerpo: "Hola Ana Perez,\n\nTe enviamos el detalle del cobro por PayPal.",
}

const MENSAJE_WHATSAPP = {
  texto: "Hola Ana Perez, te paso el detalle del cobro por PayPal.",
}

const STAFF = {
  userId: "user_staff",
  nombre: "Ana Admin",
  rol: "admin",
  esAdmin: true,
  cliente: null,
}

function enlace(overrides: Record<string, unknown> = {}) {
  return {
    id: ENLACE_ID,
    token: "token_1",
    clienteId: "cliente_1",
    hitoId: "hito_1",
    suscripcionId: null,
    pasarela: "PAYPAL",
    concepto: "Anticipo del proyecto",
    descripcion: null,
    notaInterna: null,
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    meses: null,
    feeBps: 540,
    feeFixedCents: 30,
    url: LINK,
    checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    externalId: "ORDER-1",
    estado: "ACTIVO",
    grupoCobroId: "hito:hito_1",
    expiraEn: VENCIMIENTO,
    orderExpiraEn: null,
    generadoPor: "user_staff",
    generadoPorNombre: "Ana Admin",
    enviadoPor: null,
    enviadoEn: null,
    canalEnvio: null,
    idioma: null,
    invalidadoEn: null,
    motivoInvalido: null,
    ultimoError: null,
    creadoEn: new Date("2026-10-19T12:00:00.000Z"),
    actualizadoEn: new Date("2026-10-19T12:00:00.000Z"),
    cliente: { nombre: CLIENTE_NOMBRE, email: CLIENTE_EMAIL },
    hito: { id: "hito_1" },
    suscripcion: null,
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
  return `198.18.${Math.floor(ipSequence / 250)}.${(ipSequence % 250) + 1}`
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
  expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
  expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  expect(mocks.pagoCreate).not.toHaveBeenCalled()
  expect(mocks.pagoUpdate).not.toHaveBeenCalled()
  expect(mocks.eventoCreate).not.toHaveBeenCalled()
  expect(mocks.crearLinkDePagoMp).not.toHaveBeenCalled()
  expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
  expect(mocks.mpClient).not.toHaveBeenCalled()
}

function expectTracking(
  canal: "EMAIL" | "WHATSAPP" | "COPIA",
  idioma: "es" | "en",
  staffId = STAFF.userId
) {
  expect(mocks.enlaceUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.enlaceUpdate).toHaveBeenCalledWith({
    where: { id: ENLACE_ID },
    data: {
      enviadoPor: staffId,
      enviadoEn: expect.any(Date),
      canalEnvio: canal,
      idioma,
    },
  })
  expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  expect(mocks.pagoCreate).not.toHaveBeenCalled()
  expect(mocks.pagoUpdate).not.toHaveBeenCalled()
  expect(mocks.eventoCreate).not.toHaveBeenCalled()
  expect(mocks.crearLinkDePagoMp).not.toHaveBeenCalled()
  expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
  expect(mocks.mpClient).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AHORA)

  mocks.requireStaff.mockResolvedValue(STAFF)
  mocks.enlaceFindUnique.mockResolvedValue(enlace())
  mocks.enlaceUpdate.mockResolvedValue(enlace())
  mocks.resend.mockReturnValue({ emails: { send: mocks.send } })
  mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null, headers: null })
  mocks.armarMensajePaypal.mockImplementation(
    (input: { canal: "EMAIL" | "WHATSAPP" }) =>
      input.canal === "EMAIL" ? MENSAJE_EMAIL : MENSAJE_WHATSAPP
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/admin/paypal/enviar: autorizacion (AC-17)", () => {
  it("responde 403 sin staff y no consulta ni envia nada", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: "No autorizado" })
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("aplica 20/min por IP antes de requireStaff y responde 429", async () => {
    const ip = "203.0.113.21"

    for (let intento = 0; intento < 20; intento += 1) {
      const permitida = await POST(
        request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }, RUTA, ip)
      )
      expect(permitida.status).toBe(200)
    }

    vi.clearAllMocks()

    const res = await POST(
      request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }, RUTA, ip)
    )

    expect(res.status).toBe(429)
    expect(await json(res)).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.requireStaff).not.toHaveBeenCalled()
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("permite enviar a la asistente y registra su userId", async () => {
    mocks.requireStaff.mockResolvedValue({
      ...STAFF,
      userId: "user_asistente",
      nombre: "Bea Asistente",
      rol: "asistente",
      esAdmin: false,
    })

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))

    expect(res.status).toBe(200)
    expectTracking("WHATSAPP", "es", "user_asistente")
  })
})

describe("POST /api/admin/paypal/enviar: body Zod (AC-3)", () => {
  it("responde 400 con JSON invalido sin consultar la base", async () => {
    const res = await POST(request("{"))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "JSON invalido" })
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it.each([
    ["sin body", {}],
    ["sin enlaceId", { canal: "EMAIL" }],
    ["enlaceId vacio", { enlaceId: "  ", canal: "EMAIL" }],
    ["sin canal", { enlaceId: ENLACE_ID }],
    ["canal invalido", { enlaceId: ENLACE_ID, canal: "SMS" }],
    ["idioma invalido", { enlaceId: ENLACE_ID, canal: "EMAIL", idioma: "fr" }],
    ["enlaceId no string", { enlaceId: 123, canal: "EMAIL" }],
  ])("responde 400 %s", async (_caso, body) => {
    const res = await POST(request(body))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "Datos invalidos" })
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })
})

describe("POST /api/admin/paypal/enviar: enlace (AC-3, AC-4, AC-12)", () => {
  it("responde 404 si el enlace no existe", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(null)

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: "Enlace no encontrado." })
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it.each(["MERCADOPAGO", "MANUAL"])(
    "responde 404 si el enlace es de pasarela %s",
    async (pasarela) => {
      mocks.enlaceFindUnique.mockResolvedValue(enlace({ pasarela }))

      const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: "Enlace no encontrado." })
      expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
      expectSinEscrituras()
    }
  )

  it.each([
    ["VENCIDO", "El enlace esta vencido."],
    ["INVALIDADO", "El enlace fue invalidado."],
    ["PAGADO", "El enlace ya fue pagado."],
    ["CREANDO", "El enlace no esta activo."],
    ["FALLIDO", "El enlace no esta activo."],
  ])("responde 409 si el enlace esta %s", async (estado, mensaje) => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ estado }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: mensaje })
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el enlace esta ACTIVO pero vencio", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(
      enlace({ estado: "ACTIVO", expiraEn: new Date("2020-01-01T00:00:00.000Z") })
    )

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: "El enlace esta vencido." })
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el enlace no tiene url", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ url: null }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({
      error: "El enlace no tiene un link de pago disponible.",
    })
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 409 si el enlace no esta en USD", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ moneda: "ars" }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: "El enlace no esta expresado en USD." })
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })
})

describe("POST /api/admin/paypal/enviar: cliente sin email (AC-3)", () => {
  it.each(["", "   "])(
    "responde 409 con mensaje claro para EMAIL si el email es %j",
    async (email) => {
      mocks.enlaceFindUnique.mockResolvedValue(
        enlace({ cliente: { nombre: CLIENTE_NOMBRE, email } })
      )

      const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({
        error: "El cliente no tiene un email cargado para enviar el cobro.",
      })
      expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
      expect(mocks.resend).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
      expectSinEscrituras()
    }
  )

  it("permite WHATSAPP aunque el cliente no tenga email", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(
      enlace({ cliente: { nombre: CLIENTE_NOMBRE, email: "" } })
    )

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))

    expect(res.status).toBe(200)
    expect(mocks.resend).not.toHaveBeenCalled()
    expectTracking("WHATSAPP", "es")
  })
})

describe("POST /api/admin/paypal/enviar: EMAIL (AC-3, AC-12)", () => {
  it("envia con Resend, devuelve el mensaje y registra el tracking (AC-3, AC-4)", async () => {
    const res = await POST(
      request({ enlaceId: ENLACE_ID, canal: "EMAIL", idioma: "en" })
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      ok: true,
      canal: "EMAIL",
      enviado: true,
      mensaje: MENSAJE_EMAIL,
    })
    expect(res.headers.get("cache-control")).toBe("no-store")

    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith({
      idioma: "en",
      canal: "EMAIL",
      concepto: "Anticipo del proyecto",
      montoAcordadoCents: 10050,
      comisionCents: 606,
      totalCents: 10656,
      moneda: "usd",
      link: LINK,
      vencimiento: VENCIMIENTO,
      clienteNombre: CLIENTE_NOMBRE,
    })

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith({
      from: FROM,
      to: CLIENTE_EMAIL,
      subject: MENSAJE_EMAIL.asunto,
      text: MENSAJE_EMAIL.cuerpo,
    })

    expectTracking("EMAIL", "en")
  })

  it("usa el idioma del enlace si el request no lo indica", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ idioma: "en" }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(200)
    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: "en" })
    )
    expectTracking("EMAIL", "en")
  })

  it("el idioma del request tiene prioridad sobre el del enlace", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ idioma: "en" }))

    const res = await POST(
      request({ enlaceId: ENLACE_ID, canal: "EMAIL", idioma: "es" })
    )

    expect(res.status).toBe(200)
    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: "es" })
    )
    expectTracking("EMAIL", "es")
  })

  it("default es si el enlace no tiene idioma o tiene uno invalido", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ idioma: "fr" }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(200)
    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: "es" })
    )
    expectTracking("EMAIL", "es")
  })

  it("no loguea el email, el nombre ni el token del cliente", async () => {
    await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    const llamadas = JSON.stringify([
      mocks.loggerInfo.mock.calls,
      mocks.loggerWarn.mock.calls,
      mocks.loggerError.mock.calls,
    ])
    expect(llamadas).not.toContain(CLIENTE_EMAIL)
    expect(llamadas).not.toContain(CLIENTE_NOMBRE)
    expect(llamadas).not.toContain("token_1")
  })
})

describe("POST /api/admin/paypal/enviar: Resend no disponible o falla (AC-3)", () => {
  it("responde 503 si Resend no esta configurado y no registra tracking", async () => {
    mocks.resend.mockReturnValue(null)

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))

    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({
      error: "El envio por email no esta disponible.",
    })
    expect(mocks.armarMensajePaypal).toHaveBeenCalledTimes(1)
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 502 si Resend devuelve error y no registra tracking", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: "application_error", message: "boom", statusCode: 500 },
      headers: null,
    })

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))
    const payload = await json(res)

    expect(res.status).toBe(502)
    expect(payload).toEqual({ error: "No se pudo enviar el email del cobro." })
    expect(JSON.stringify(payload)).not.toContain(CLIENTE_EMAIL)
    expect(JSON.stringify(payload)).not.toContain("boom")
    expectSinEscrituras()
  })

  it("responde 502 si Resend lanza una excepcion y no registra tracking", async () => {
    mocks.send.mockRejectedValue(new Error("connect ECONNREFUSED resend"))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))
    const payload = await json(res)

    expect(res.status).toBe(502)
    expect(payload).toEqual({ error: "No se pudo enviar el email del cobro." })
    expect(JSON.stringify(payload)).not.toContain("ECONNREFUSED")
    expectSinEscrituras()
  })

  it("responde 500 si falla el tracking despues del envio, sin filtrar el detalle", async () => {
    mocks.enlaceUpdate.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload).toEqual({ error: "No se pudo registrar el envio del cobro." })
    expect(JSON.stringify(payload)).not.toContain("postgres")
    expect(JSON.stringify(payload)).not.toContain("secreto")
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/admin/paypal/enviar: WHATSAPP y COPIA (AC-3, AC-4)", () => {
  it("WHATSAPP no envia nada, devuelve texto y registra canal/fecha", async () => {
    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      ok: true,
      canal: "WHATSAPP",
      enviado: false,
      mensaje: MENSAJE_WHATSAPP,
    })
    expect(res.headers.get("cache-control")).toBe("no-store")

    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith(
      expect.objectContaining({
        idioma: "es",
        canal: "WHATSAPP",
        link: LINK,
        vencimiento: VENCIMIENTO,
      })
    )
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectTracking("WHATSAPP", "es")
  })

  it("COPIA no envia nada, usa la plantilla de texto y registra el canal", async () => {
    const res = await POST(
      request({ enlaceId: ENLACE_ID, canal: "COPIA", idioma: "en" })
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      ok: true,
      canal: "COPIA",
      enviado: false,
      mensaje: MENSAJE_WHATSAPP,
    })
    expect(mocks.armarMensajePaypal).toHaveBeenCalledWith(
      expect.objectContaining({ canal: "WHATSAPP", idioma: "en" })
    )
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expectTracking("COPIA", "en")
  })

  it("registra el idioma del enlace en WHATSAPP cuando el request no lo indica", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(enlace({ idioma: "en" }))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))

    expect(res.status).toBe(200)
    expectTracking("WHATSAPP", "en")
  })
})

describe("POST /api/admin/paypal/enviar: errores internos (AC-12)", () => {
  it("responde 500 si falla la consulta del enlace sin filtrar el detalle", async () => {
    mocks.enlaceFindUnique.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload).toEqual({ error: "Error al consultar el enlace de pago." })
    expect(JSON.stringify(payload)).not.toContain("postgres")
    expect(JSON.stringify(payload)).not.toContain("secreto")
    expect(mocks.armarMensajePaypal).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 500 si no se puede armar el mensaje y no registra tracking", async () => {
    mocks.armarMensajePaypal.mockImplementation(() => {
      throw new Error("datos incompletos")
    })

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "EMAIL" }))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload).toEqual({ error: "No se pudo armar el mensaje del cobro." })
    expect(JSON.stringify(payload)).not.toContain("datos incompletos")
    expect(mocks.send).not.toHaveBeenCalled()
    expectSinEscrituras()
  })

  it("responde 500 si falla el tracking de WHATSAPP sin filtrar el detalle", async () => {
    mocks.enlaceUpdate.mockRejectedValue(new Error("raw db detail: secreto"))

    const res = await POST(request({ enlaceId: ENLACE_ID, canal: "WHATSAPP" }))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload).toEqual({ error: "No se pudo registrar el envio del cobro." })
    expect(JSON.stringify(payload)).not.toContain("secreto")
  })
})
