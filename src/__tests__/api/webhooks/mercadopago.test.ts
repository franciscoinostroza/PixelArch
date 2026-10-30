import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Hardening del webhook de Mercado Pago:
 * - 429 por limite de solicitudes sin validar firma, consultar MP ni escribir;
 * - topics que no son `payment` (o sin `data.id`) se ignoran antes de la firma;
 * - presupuesto de firmas invalidas por IP y log acotado sin PII;
 * - un pago valido sigue su curso.
 *
 * Prisma, Mercado Pago, rate limit, logger y Sentry estan mockeados: no hay
 * base ni red.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  rateLimitDetalle: vi.fn(),
  rateLimitEstado: vi.fn(),
  resetRateLimit: vi.fn(),
  validarFirma: vi.fn(),
  obtenerPagoMp: vi.fn(),
  pagoFindUnique: vi.fn(),
  enlaceFindUnique: vi.fn(),
  enlaceFindFirst: vi.fn(),
  eventoCreate: vi.fn(),
  eventoFindUnique: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  captureException: vi.fn(),
  contadores: new Map<string, { count: number; resetAt: number }>(),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  rateLimitDetalle: mocks.rateLimitDetalle,
  rateLimitEstado: mocks.rateLimitEstado,
  resetRateLimit: mocks.resetRateLimit,
}))

vi.mock("mercadopago", () => {
  class InvalidWebhookSignatureError extends Error {}
  return {
    WebhookSignatureValidator: { validate: mocks.validarFirma },
    InvalidWebhookSignatureError,
    SignatureFailureReason: { SignatureMismatch: "SignatureMismatch" },
  }
})

vi.mock("@/lib/mercadopago", () => ({
  obtenerPagoMp: mocks.obtenerPagoMp,
  crearLinkDePago: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pago: {
      findUnique: mocks.pagoFindUnique,
    },
    enlacePago: {
      findUnique: mocks.enlaceFindUnique,
      findFirst: mocks.enlaceFindFirst,
    },
    eventoPasarela: {
      create: mocks.eventoCreate,
      findUnique: mocks.eventoFindUnique,
    },
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: vi.fn(),
}))

vi.mock("@/lib/notifications", () => ({
  sendPaymentReceipt: vi.fn(),
}))

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }))

import { POST } from "@/app/api/webhooks/mercadopago/route"

const BASE_URL = "https://pixelarch.dev/api/webhooks/mercadopago"
const IP = "203.0.113.20"
const PAYMENT_ID = "mp_payment_1"
const PII_EMAIL = "pagador@example.com"

function request(
  body: unknown,
  opciones: {
    ip?: string
    query?: string
    headers?: Record<string, string>
  } = {}
): Request {
  return new Request(`${BASE_URL}${opciones.query ?? ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": opciones.ip ?? IP,
      "x-signature": "ts=1,v1=firma-secreta",
      "x-request-id": "req_1",
      ...opciones.headers,
    },
    body: JSON.stringify(body),
  })
}

function logs(): string {
  return JSON.stringify([
    mocks.loggerDebug.mock.calls,
    mocks.loggerInfo.mock.calls,
    mocks.loggerWarn.mock.calls,
    mocks.loggerError.mock.calls,
  ])
}

function configurarRateLimitRealista(): void {
  mocks.rateLimitDetalle.mockImplementation(
    (key: string, limit: number, windowMs: number) => {
      const ahora = Date.now()
      const entrada = mocks.contadores.get(key)
      if (!entrada || ahora > entrada.resetAt) {
        mocks.contadores.set(key, { count: 1, resetAt: ahora + windowMs })
        return { permitido: true, restantes: limit - 1, retryAfterSegundos: 0 }
      }
      if (entrada.count >= limit) {
        return {
          permitido: false,
          restantes: 0,
          retryAfterSegundos: Math.ceil((entrada.resetAt - ahora) / 1000),
        }
      }
      entrada.count++
      return {
        permitido: true,
        restantes: limit - entrada.count,
        retryAfterSegundos: 0,
      }
    }
  )

  mocks.rateLimitEstado.mockImplementation(
    (key: string, limit: number) => {
      const ahora = Date.now()
      const entrada = mocks.contadores.get(key)
      if (!entrada || ahora > entrada.resetAt) {
        return { excedido: false, retryAfterSegundos: 0 }
      }
      return {
        excedido: entrada.count >= limit,
        retryAfterSegundos:
          entrada.count >= limit
            ? Math.ceil((entrada.resetAt - ahora) / 1000)
            : 0,
      }
    }
  )

  mocks.rateLimit.mockImplementation(
    (key: string, limit: number, windowMs: number) => {
      const ahora = Date.now()
      const entrada = mocks.contadores.get(key)
      if (!entrada || ahora > entrada.resetAt) {
        mocks.contadores.set(key, { count: 1, resetAt: ahora + windowMs })
        return true
      }
      if (entrada.count >= limit) return false
      entrada.count++
      return true
    }
  )

  mocks.resetRateLimit.mockImplementation((key: string) => {
    mocks.contadores.delete(key)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.contadores.clear()
  vi.stubEnv("MP_WEBHOOK_SECRET", "secret-de-prueba")
  configurarRateLimitRealista()
  mocks.validarFirma.mockReturnValue(undefined)
  mocks.obtenerPagoMp.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/webhooks/mercadopago - hardening", () => {
  it("ignora un topic distinto de payment antes de validar la firma", async () => {
    const res = await POST(
      request({ type: "plan", action: "updated", data: { id: "plan_1" } })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.validarFirma).not.toHaveBeenCalled()
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.pagoFindUnique).not.toHaveBeenCalled()
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
    // Un topic ajeno tampoco consume el presupuesto de firmas invalidas.
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.rateLimitEstado).not.toHaveBeenCalled()
    expect(mocks.resetRateLimit).not.toHaveBeenCalled()
  })

  it("ignora un payment sin data.id antes de validar la firma", async () => {
    const res = await POST(request({ type: "payment", data: {} }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.validarFirma).not.toHaveBeenCalled()
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.rateLimitEstado).not.toHaveBeenCalled()
    expect(mocks.resetRateLimit).not.toHaveBeenCalled()
  })

  it("responde 429 por limite de solicitudes sin validar firma ni consultar MP", async () => {
    mocks.rateLimitDetalle.mockReturnValueOnce({
      permitido: false,
      restantes: 0,
      retryAfterSegundos: 42,
    })

    const res = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(await res.json()).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.validarFirma).not.toHaveBeenCalled()
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.pagoFindUnique).not.toHaveBeenCalled()
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
  })

  it("responde 401 por firma invalida dentro del presupuesto y loguea en debug sin PII", async () => {
    const { InvalidWebhookSignatureError, SignatureFailureReason } = await import(
      "mercadopago"
    )
    mocks.validarFirma.mockImplementation(() => {
      throw new InvalidWebhookSignatureError(
        SignatureFailureReason.SignatureMismatch
      )
    })

    const res = await POST(
      request(
        {
          type: "payment",
          data: {
            id: PAYMENT_ID,
            payer: { email: PII_EMAIL },
          },
        },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Firma invalida" })
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
    expect(mocks.loggerDebug).toHaveBeenCalledWith("Webhook MP con firma invalida")
    expect(logs()).not.toContain(PAYMENT_ID)
    expect(logs()).not.toContain("firma-secreta")
    // El log en debug no incluye la IP ni PII del pagador.
    expect(logs()).not.toContain(IP)
    expect(logs()).not.toContain(PII_EMAIL)
  })

  it("responde 429 al agotar el presupuesto de firmas invalidas, sin validar la siguiente", async () => {
    const { InvalidWebhookSignatureError, SignatureFailureReason } = await import(
      "mercadopago"
    )
    mocks.validarFirma.mockImplementation(() => {
      throw new InvalidWebhookSignatureError(
        SignatureFailureReason.SignatureMismatch
      )
    })

    for (let i = 0; i < 20; i++) {
      const res = await POST(
        request(
          { type: "payment", data: { id: `mp_${i}` } },
          { query: `?data.id=mp_${i}` }
        )
      )
      expect(res.status, String(i)).toBe(401)
    }

    expect(mocks.validarFirma).toHaveBeenCalledTimes(20)

    const bloqueada = await POST(
      request(
        { type: "payment", data: { id: "mp_21" } },
        { query: "?data.id=mp_21" }
      )
    )

    expect(bloqueada.status).toBe(429)
    expect(await bloqueada.json()).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.validarFirma).toHaveBeenCalledTimes(20)
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.pagoFindUnique).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("un origen limitado no afecta a otro origen", async () => {
    mocks.rateLimitDetalle.mockImplementation((key: string) =>
      key === `webhook-mp:ip:${IP}`
        ? { permitido: false, restantes: 0, retryAfterSegundos: 42 }
        : { permitido: true, restantes: 1, retryAfterSegundos: 0 }
    )

    const bloqueada = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )
    expect(bloqueada.status).toBe(429)

    const permitida = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { ip: "203.0.113.21", query: `?data.id=${PAYMENT_ID}` }
      )
    )

    expect(permitida.status).toBe(200)
    expect(await permitida.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.validarFirma).toHaveBeenCalledTimes(1)
  })

  it("tras 20 firmas invalidas de un origen, otro origen con firma valida procesa 200", async () => {
    const { InvalidWebhookSignatureError, SignatureFailureReason } = await import(
      "mercadopago"
    )
    mocks.validarFirma.mockImplementation(() => {
      throw new InvalidWebhookSignatureError(
        SignatureFailureReason.SignatureMismatch
      )
    })

    for (let i = 0; i < 20; i++) {
      const res = await POST(
        request(
          { type: "payment", data: { id: `mp_${i}` } },
          { query: `?data.id=mp_${i}` }
        )
      )
      expect(res.status, String(i)).toBe(401)
    }

    const bloqueada = await POST(
      request(
        { type: "payment", data: { id: "mp_21" } },
        { query: "?data.id=mp_21" }
      )
    )
    expect(bloqueada.status).toBe(429)

    // Firma valida desde otro origen: no la afecta el bloqueo del primero.
    mocks.validarFirma.mockReturnValue(undefined)
    const permitida = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { ip: "203.0.113.21", query: `?data.id=${PAYMENT_ID}` }
      )
    )

    expect(permitida.status).toBe(200)
    expect(await permitida.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.validarFirma).toHaveBeenCalledTimes(21)
    expect(mocks.obtenerPagoMp).toHaveBeenCalledWith(PAYMENT_ID)
  })

  it("una firma valida limpia el presupuesto de firmas invalidas del origen", async () => {
    const { InvalidWebhookSignatureError, SignatureFailureReason } = await import(
      "mercadopago"
    )
    mocks.validarFirma.mockImplementationOnce(() => {
      throw new InvalidWebhookSignatureError(
        SignatureFailureReason.SignatureMismatch
      )
    })

    const invalida = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )
    expect(invalida.status).toBe(401)

    const valida = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )
    expect(valida.status).toBe(200)
    expect(mocks.resetRateLimit).toHaveBeenCalledWith(`webhook-mp:firma:${IP}`)

    // Tras limpiar, el origen vuelve a tener sus 20 intentos (no 429).
    mocks.validarFirma.mockImplementation(() => {
      throw new InvalidWebhookSignatureError(
        SignatureFailureReason.SignatureMismatch
      )
    })
    for (let i = 0; i < 20; i++) {
      const res = await POST(
        request(
          { type: "payment", data: { id: `mp_reset_${i}` } },
          { query: `?data.id=mp_reset_${i}` }
        )
      )
      expect(res.status, String(i)).toBe(401)
    }
  })

  it("responde 429 antes de parsear un cuerpo invalido", async () => {
    mocks.rateLimitDetalle.mockReturnValueOnce({
      permitido: false,
      restantes: 0,
      retryAfterSegundos: 7,
    })

    const res = await POST(
      new Request(BASE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": IP,
          "x-signature": "ts=1,v1=firma-secreta",
          "x-request-id": "req_1",
        },
        body: "esto no es json",
      })
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("7")
    expect(await res.json()).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.validarFirma).not.toHaveBeenCalled()
    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("un pago con firma valida sigue consultando MP y limpia los fallos", async () => {
    const res = await POST(
      request(
        { type: "payment", data: { id: PAYMENT_ID } },
        { query: `?data.id=${PAYMENT_ID}` }
      )
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.validarFirma).toHaveBeenCalledWith(
      expect.objectContaining({
        dataId: PAYMENT_ID,
        secret: "secret-de-prueba",
      })
    )
    expect(mocks.obtenerPagoMp).toHaveBeenCalledWith(PAYMENT_ID)
    expect(mocks.resetRateLimit).toHaveBeenCalledWith(`webhook-mp:firma:${IP}`)
  })
})
