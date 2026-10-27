import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-29 (AC-5, AC-7, AC-11, AC-13, AC-15, AC-19, AC-21; RNF-1, RNF-5, RNF-6):
 * `POST /api/webhooks/paypal`.
 *
 * PayPal, Prisma, el procesador de capturas y el logger estan mockeados: no
 * hay red ni base real. Se cubren:
 * - 503 sin `PAYPAL_WEBHOOK_ID`/credenciales y timeout de verificacion;
 * - 401 por headers ausentes, cuerpo invalido y firma invalida/alterada, con
 *   evento tecnico sin PII y sin bloquear el evento real por `eventoId`;
 * - dispatch de `CHECKOUT.ORDER.APPROVED` (captura si falta, no si ya existe),
 *   `CHECKOUT.ORDER.COMPLETED` (solo traza), `PAYMENT.CAPTURE.COMPLETED`
 *   (procesa e idempotencia), `PAYMENT.CAPTURE.DENIED` (expira la orden),
 *   reembolsos/reversiones/disputas (`requiereAccion`, sin cambios) y eventos
 *   desconocidos (200 `ignored`);
 * - 200 para procesado/duplicado/ignorado y 500 para reintento.
 */

type Fila = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  eventos: [] as Fila[],
  eventoCreate: vi.fn(),
  eventoFindUnique: vi.fn(),
  enlaceFindUnique: vi.fn(),
  enlaceUpdate: vi.fn(),
  pagoFindUnique: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  getOrder: vi.fn(),
  captureOrder: vi.fn(),
  procesarCapturaPaypal: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventoPasarela: {
      create: mocks.eventoCreate,
      findUnique: mocks.eventoFindUnique,
    },
    enlacePago: {
      findUnique: mocks.enlaceFindUnique,
      update: mocks.enlaceUpdate,
    },
    pago: {
      findUnique: mocks.pagoFindUnique,
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

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}))

vi.mock("@/lib/paypal/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/client")>()
  return {
    ...actual,
    verifyWebhookSignature: mocks.verifyWebhookSignature,
    getOrder: mocks.getOrder,
    captureOrder: mocks.captureOrder,
  }
})

vi.mock("@/lib/paypal/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/process")>()
  return {
    ...actual,
    procesarCapturaPaypal: mocks.procesarCapturaPaypal,
  }
})

import { POST } from "@/app/api/webhooks/paypal/route"
import { PaypalError } from "@/lib/paypal/client"
import { registrarEventoPasarela } from "@/lib/paypal/events"

const BASE_URL = "https://pixelarch.dev/api/webhooks/paypal"
const PII_EMAIL = "pagador@example.com"
const PII_NOMBRE = "Ana Perez"

const HEADERS = {
  "PAYPAL-TRANSMISSION-ID": "trans-1",
  "PAYPAL-TRANSMISSION-TIME": "2026-10-20T12:00:00Z",
  "PAYPAL-TRANSMISSION-SIG": "firma-valida",
  "PAYPAL-CERT-URL": "https://api-m.sandbox.paypal.com/cert.pem",
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
}

function configurarEnv() {
  vi.stubEnv("PAYPAL_ENV", "sandbox")
  vi.stubEnv("PAYPAL_CLIENT_ID", "client-id-de-prueba")
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "client-secret-de-prueba")
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "webhook-id-de-prueba")
  vi.stubEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
}

function errorUnico(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

function eventoRegistrado(overrides: Fila = {}): Fila {
  return {
    id: "evento_1",
    pasarela: "PAYPAL",
    eventoId: "WH-PREVIO",
    tipo: "PAYMENT.CAPTURE.COMPLETED",
    externalId: "CAPTURE-1",
    enlacePagoId: "enlace_1",
    pagoId: "pago_1",
    resultado: "PROCESADO",
    motivo: null,
    monto: 10656,
    moneda: "usd",
    requiereAccion: false,
    creadoEn: new Date(),
    procesadoEn: new Date(),
    ...overrides,
  }
}

function enlace(overrides: Fila = {}): Fila {
  return {
    id: "enlace_1",
    token: "token_1",
    pasarela: "PAYPAL",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    externalId: "ORDER-1",
    estado: "ACTIVO",
    ...overrides,
  }
}

function captura(overrides: Fila = {}): Fila {
  return {
    id: "CAPTURE-1",
    status: "COMPLETED",
    amountCents: 10656,
    currencyCode: "USD",
    orderId: "ORDER-1",
    customId: "token_1",
    invoiceId: "token_1",
    createTime: null,
    finalCapture: true,
    ...overrides,
  }
}

function orden(overrides: Fila = {}): Fila {
  return {
    id: "ORDER-1",
    status: "APPROVED",
    customId: "token_1",
    invoiceId: "token_1",
    amountCents: 10656,
    currencyCode: "USD",
    payerActionUrl: null,
    createTime: null,
    captures: [],
    ...overrides,
  }
}

function procesado(overrides: Fila = {}): Fila {
  return {
    tipo: "PROCESADO",
    duplicado: false,
    pagoId: "pago_1",
    enlaceId: "enlace_1",
    hitoId: "hito_1",
    reciboId: "REC-1",
    monto: 10656,
    montoAcordado: 10050,
    comision: 606,
    moneda: "usd",
    ...overrides,
  }
}

function eventoCaptura(overrides: Fila = {}): Fila {
  return {
    id: "WH-CAPTURA-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource: {
      id: "CAPTURE-1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "106.56" },
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
      custom_id: "token_1",
      invoice_id: "token_1",
      payer: {
        email_address: PII_EMAIL,
        name: { given_name: "Ana", surname: "Perez" },
      },
    },
    ...overrides,
  }
}

function eventoOrden(
  tipo: "CHECKOUT.ORDER.APPROVED" | "CHECKOUT.ORDER.COMPLETED",
  overrides: Fila = {}
): Fila {
  return {
    id: tipo === "CHECKOUT.ORDER.APPROVED" ? "WH-APROBADA-1" : "WH-COMPLETADA-1",
    event_type: tipo,
    resource_type: "checkout-order",
    resource: {
      id: "ORDER-1",
      status:
        tipo === "CHECKOUT.ORDER.APPROVED" ? "APPROVED" : "COMPLETED",
      purchase_units: [
        {
          custom_id: "token_1",
          invoice_id: "token_1",
          amount: { currency_code: "USD", value: "106.56" },
        },
      ],
      ...overrides,
    },
  }
}

function eventoDisputa(): Fila {
  return {
    id: "WH-DISPUTA-1",
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource_type: "dispute",
    resource: {
      id: "DISPUTE-1",
      status: "OPEN",
      disputed_transactions: [{ seller_transaction_id: "CAPTURE-1" }],
      disputed_transaction: {
        buyer: { email: PII_EMAIL, name: PII_NOMBRE },
      },
    },
  }
}

function request(
  evento: unknown,
  opciones: {
    headers?: Record<string, string | null>
    omitirHeader?: string
    body?: string
  } = {}
): Request {
  const headers = new Headers()
  const valores: Record<string, string | null> = {
    ...HEADERS,
    ...(opciones.headers ?? {}),
  }
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === null) continue
    if (clave === opciones.omitirHeader) continue
    headers.set(clave, valor)
  }
  if (opciones.omitirHeader) headers.delete(opciones.omitirHeader)

  return new Request(BASE_URL, {
    method: "POST",
    headers,
    body: opciones.body ?? JSON.stringify(evento),
  })
}

function crearEvento(data: Fila): Fila {
  if (mocks.eventos.some((fila) => fila.eventoId === data.eventoId)) {
    throw errorUnico()
  }
  const fila = {
    id: `evento_${mocks.eventos.length + 1}`,
    creadoEn: new Date(),
    ...data,
  }
  mocks.eventos.push(fila)
  return fila
}

function dataEvento(indice = 0): Fila {
  const llamada = mocks.eventoCreate.mock.calls[indice]
  if (!llamada) throw new Error("No se registro un EventoPasarela")
  return (llamada[0] as { data: Fila }).data
}

function logs(): string {
  return JSON.stringify([
    mocks.loggerDebug.mock.calls,
    mocks.loggerInfo.mock.calls,
    mocks.loggerWarn.mock.calls,
    mocks.loggerError.mock.calls,
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.eventos.length = 0
  configurarEnv()

  mocks.eventoCreate.mockImplementation(async (args: { data: Fila }) =>
    crearEvento(args.data)
  )
  mocks.eventoFindUnique.mockImplementation(
    async (args: { where: { eventoId: string } }) =>
      mocks.eventos.find((fila) => fila.eventoId === args.where.eventoId) ?? null
  )
  mocks.enlaceFindUnique.mockImplementation(
    async (args: { where: { externalId?: string; token?: string } }) => {
      if (args.where.externalId === "ORDER-1") return enlace()
      if (args.where.token === "token_1") return enlace()
      return null
    }
  )
  mocks.enlaceUpdate.mockResolvedValue({})
  mocks.pagoFindUnique.mockResolvedValue(null)
  mocks.verifyWebhookSignature.mockResolvedValue({
    verificado: true,
    estado: "SUCCESS",
    motivo: "OK",
  })
  mocks.getOrder.mockResolvedValue(
    orden({ status: "COMPLETED", captures: [captura()] })
  )
  mocks.captureOrder.mockResolvedValue(
    orden({ status: "COMPLETED", captures: [captura()] })
  )
  mocks.procesarCapturaPaypal.mockResolvedValue(procesado())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/webhooks/paypal - configuracion y firma", () => {
  it("responde 503 si PayPal no esta configurado y no procesa nada", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "")

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(503)
    expect(mocks.verifyWebhookSignature).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("responde 401 si falta un header de transmision y deja evento tecnico sin PII", async () => {
    const res = await POST(
      request(eventoCaptura(), { omitirHeader: "PAYPAL-TRANSMISSION-SIG" })
    )

    expect(res.status).toBe(401)
    expect(mocks.verifyWebhookSignature).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()

    const data = dataEvento()
    expect(data).toMatchObject({
      pasarela: "PAYPAL",
      resultado: "FIRMA_INVALIDA",
      motivo: "HEADERS_INCOMPLETOS",
      requiereAccion: false,
    })
    expect(data.eventoId).toMatch(/^PAYPAL:FIRMA_INVALIDA:/)
    expect(data.eventoId).not.toBe("WH-CAPTURA-1")
    expect(JSON.stringify(data)).not.toContain(PII_EMAIL)
    expect(JSON.stringify(data)).not.toContain(PII_NOMBRE)
  })

  it("responde 401 con firma invalida/alterada y no crea pago (AC-7)", async () => {
    mocks.verifyWebhookSignature.mockResolvedValue({
      verificado: false,
      estado: "FAILURE",
      motivo: "FIRMA_INVALIDA",
    })

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(401)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "FIRMA_INVALIDA",
      motivo: "FIRMA_INVALIDA",
    })
    expect(dataEvento().eventoId).not.toBe("WH-CAPTURA-1")
  })

  it("verifica la firma contra PayPal con timeout de webhook (4 s)", async () => {
    await POST(request(eventoCaptura()))

    expect(mocks.verifyWebhookSignature).toHaveBeenCalledTimes(1)
    const [input, opciones] = mocks.verifyWebhookSignature.mock.calls[0]
    expect(input.event).toMatchObject({ id: "WH-CAPTURA-1" })
    expect(input.headers["PAYPAL-TRANSMISSION-SIG"]).toBe("firma-valida")
    expect(opciones).toEqual({ timeoutMs: 4_000 })
  })

  it("responde 401 si el cuerpo no es JSON y registra el intento sin PII", async () => {
    const res = await POST(
      request(null, { body: "esto no es json", headers: { "x-otro": "1" } })
    )

    expect(res.status).toBe(401)
    expect(mocks.verifyWebhookSignature).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "FIRMA_INVALIDA",
      motivo: "CUERPO_INVALIDO",
    })
  })

  it("responde 503 si la verificacion no esta disponible (timeout) para que reintente", async () => {
    mocks.verifyWebhookSignature.mockRejectedValue(
      new PaypalError({
        code: "TIMEOUT",
        message: "PayPal no respondio a tiempo al verificar el webhook.",
      })
    )

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(503)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/webhooks/paypal - dispatch", () => {
  it("procesa PAYMENT.CAPTURE.COMPLETED de forma idempotente por evento", async () => {
    mocks.procesarCapturaPaypal.mockImplementation(
      async (capturaProcesable: Fila, opciones: Fila) => {
        await registrarEventoPasarela({
          eventoId: (opciones.evento as Fila).eventoId as string,
          pasarela: "PAYPAL",
          tipo: (opciones.evento as Fila).tipo as string,
          externalId: capturaProcesable.captureId as string,
          enlacePagoId: "enlace_1",
          pagoId: "pago_1",
          resultado: "PROCESADO",
          monto: capturaProcesable.amountCents as number,
          moneda: capturaProcesable.currency as string,
        })
        return procesado()
      }
    )

    const primera = await POST(request(eventoCaptura()))
    const segunda = await POST(request(eventoCaptura()))

    expect(primera.status).toBe(200)
    expect(await primera.json()).toEqual({ ok: true })
    expect(segunda.status).toBe(200)
    expect(await segunda.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)

    const [capturaProcesable, opciones] = mocks.procesarCapturaPaypal.mock.calls[0]
    expect(capturaProcesable).toEqual({
      captureId: "CAPTURE-1",
      orderId: "ORDER-1",
      amountCents: 10656,
      currency: "USD",
      status: "COMPLETED",
      customId: "token_1",
      invoiceId: "token_1",
    })
    expect(opciones).toMatchObject({
      ahora: expect.any(Date),
      evento: { eventoId: "WH-CAPTURA-1", tipo: "PAYMENT.CAPTURE.COMPLETED" },
    })
    // No se pasa el payload crudo ni PII al procesador.
    expect(JSON.stringify(capturaProcesable)).not.toContain(PII_EMAIL)
    expect(JSON.stringify(capturaProcesable)).not.toContain(PII_NOMBRE)
  })

  it("responde 200 duplicate si el evento ya fue procesado", async () => {
    mocks.eventos.push(eventoRegistrado({ eventoId: "WH-CAPTURA-1" }))

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.enlaceFindUnique).not.toHaveBeenCalled()
  })

  it("procesa un segundo evento aunque el procesador devuelva DUPLICADO", async () => {
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
    })

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)
  })

  it("un pago con diferencia de monto responde 200 y queda para accion (AC-5, AC-11)", async () => {
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "REVISION",
      duplicado: false,
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      monto: 5000,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      moneda: "usd",
      motivoRevision: "MONTO",
    })

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)
    // El webhook no crea un evento propio: el procesador ya lo registro como
    // REQUIERE_ACCION. Aca solo se valida la respuesta para PayPal (200).
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("un segundo pago perdido contra otra pasarela responde 200 (AC-13)", async () => {
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "PAGO_GANADOR",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      pagoId: "pago_previo",
    })

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("traza una captura que no corresponde a ningun link (200 ignored)", async () => {
    mocks.enlaceFindUnique.mockResolvedValue(null)
    mocks.getOrder.mockResolvedValue(
      orden({ customId: null, invoiceId: null, captures: [] })
    )

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ENLACE_NO_ENCONTRADO",
    })
  })

  it("CAPTURE.DENIED expira la orden del link y no crea pago", async () => {
    const evento = eventoCaptura({
      id: "WH-DENEGADA-1",
      event_type: "PAYMENT.CAPTURE.DENIED",
      resource: {
        id: "CAPTURE-1",
        status: "DENIED",
        amount: { currency_code: "USD", value: "106.56" },
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        custom_id: "token_1",
        invoice_id: "token_1",
      },
    })

    const res = await POST(request(evento))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: { orderExpiraEn: expect.any(Date), checkoutUrl: null },
    })
    const actualizacion = mocks.enlaceUpdate.mock.calls[0][0] as {
      data: { orderExpiraEn: Date }
    }
    expect(actualizacion.data.orderExpiraEn.getTime()).toBeLessThanOrEqual(
      Date.now()
    )
    expect(dataEvento()).toMatchObject({
      resultado: "IGNORADO",
      motivo: "CAPTURA_RECHAZADA",
    })
  })

  it("CHECKOUT.ORDER.APPROVED busca el link por order id y captura si falta", async () => {
    mocks.getOrder.mockResolvedValue(orden({ captures: [] }))
    mocks.captureOrder.mockResolvedValue(
      orden({ status: "COMPLETED", captures: [captura()] })
    )

    const res = await POST(
      request(eventoOrden("CHECKOUT.ORDER.APPROVED"))
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.enlaceFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: "ORDER-1" } })
    )
    expect(mocks.getOrder).toHaveBeenCalledWith("ORDER-1", { timeoutMs: 4_000 })
    expect(mocks.captureOrder).toHaveBeenCalledWith("ORDER-1", {
      timeoutMs: 4_000,
    })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      enlacePagoId: "enlace_1",
      resultado: "PROCESADO",
      motivo: "ORDEN_CAPTURADA",
    })
  })

  it("CHECKOUT.ORDER.APPROVED no captura dos veces una orden ya capturada", async () => {
    mocks.getOrder.mockResolvedValue(
      orden({ status: "COMPLETED", captures: [captura()] })
    )

    const res = await POST(
      request(eventoOrden("CHECKOUT.ORDER.APPROVED"))
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ORDEN_YA_CAPTURADA",
    })
  })

  it("CHECKOUT.ORDER.APPROVED no captura un link pagado o invalidado", async () => {
    for (const [indice, estado] of ["PAGADO", "INVALIDADO"].entries()) {
      mocks.eventos.length = 0
      mocks.eventoCreate.mockClear()
      mocks.enlaceFindUnique.mockResolvedValueOnce(enlace({ estado }))

      const evento = eventoOrden("CHECKOUT.ORDER.APPROVED")
      ;(evento as { id: string }).id = `WH-APROBADA-${indice}`

      const res = await POST(request(evento))

      expect(res.status, estado).toBe(200)
      expect(await res.json(), estado).toEqual({ ok: true, ignored: true })
      expect(mocks.captureOrder, estado).not.toHaveBeenCalled()
      expect(dataEvento(), estado).toMatchObject({
        resultado: "IGNORADO",
        motivo: `ENLACE_NO_ACTIVO:${estado}`,
      })
    }
  })

  it("CHECKOUT.ORDER.COMPLETED solo traza, sin capturar ni procesar", async () => {
    const res = await POST(
      request(eventoOrden("CHECKOUT.ORDER.COMPLETED"))
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ORDEN_COMPLETADA",
      enlacePagoId: "enlace_1",
    })
  })

  it("reembolso y reversion solo marcan requiereAccion sin modificar el pago", async () => {
    mocks.pagoFindUnique.mockResolvedValue({
      id: "pago_1",
      enlacePagoId: "enlace_1",
    })

    const casos = [
      { tipo: "PAYMENT.CAPTURE.REFUNDED", motivo: "REEMBOLSO" },
      { tipo: "PAYMENT.CAPTURE.REVERSED", motivo: "CONTRACARGO" },
    ]

    for (const [indice, caso] of casos.entries()) {
      mocks.eventos.length = 0
      mocks.eventoCreate.mockClear()
      const evento = eventoCaptura({
        id: `WH-ACCION-${indice}`,
        event_type: caso.tipo,
        resource: {
          id: "CAPTURE-1",
          status: caso.tipo.endsWith("REFUNDED") ? "REFUNDED" : "REVERSED",
          amount: { currency_code: "USD", value: "106.56" },
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        },
      })

      const res = await POST(request(evento))

      expect(res.status, caso.tipo).toBe(200)
      expect(await res.json(), caso.tipo).toEqual({ ok: true })
      expect(mocks.procesarCapturaPaypal, caso.tipo).not.toHaveBeenCalled()
      expect(mocks.enlaceUpdate, caso.tipo).not.toHaveBeenCalled()
      expect(dataEvento(), caso.tipo).toMatchObject({
        resultado: "REQUIERE_ACCION",
        motivo: caso.motivo,
        requiereAccion: true,
        pagoId: "pago_1",
        enlacePagoId: "enlace_1",
      })
    }
  })

  it("una disputa solo marca requiereAccion y vincula el pago si existe", async () => {
    mocks.pagoFindUnique.mockResolvedValue({
      id: "pago_1",
      enlacePagoId: "enlace_1",
    })

    const res = await POST(request(eventoDisputa()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "DISPUTA",
      requiereAccion: true,
      externalId: "CAPTURE-1",
      pagoId: "pago_1",
    })
  })

  it("un evento desconocido responde 200 ignored y solo traza tipo/id", async () => {
    const evento = {
      id: "WH-DESCONOCIDO-1",
      event_type: "SOMETHING.NEW.HAPPENED",
      resource: {
        id: "RESOURCE-1",
        payer: { email_address: PII_EMAIL, name: PII_NOMBRE },
      },
    }

    const res = await POST(request(evento))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(dataEvento()).toMatchObject({
      eventoId: "WH-DESCONOCIDO-1",
      tipo: "SOMETHING.NEW.HAPPENED",
      resultado: "IGNORADO",
      externalId: null,
    })
    expect(JSON.stringify(dataEvento())).not.toContain(PII_EMAIL)
    expect(JSON.stringify(dataEvento())).not.toContain(PII_NOMBRE)
  })

  it("un evento ya ignorado se responde como duplicado", async () => {
    mocks.eventos.push(
      eventoRegistrado({
        eventoId: "WH-DESCONOCIDO-1",
        resultado: "IGNORADO",
        externalId: null,
        pagoId: null,
      })
    )

    const res = await POST(
      request({
        id: "WH-DESCONOCIDO-1",
        event_type: "SOMETHING.NEW.HAPPENED",
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })

  it("responde 500 para reintento si el procesamiento falla", async () => {
    mocks.procesarCapturaPaypal.mockRejectedValue(new Error("db caida"))

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(500)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
    expect(logs()).not.toContain(PII_EMAIL)
    expect(logs()).not.toContain(PII_NOMBRE)
    expect(logs()).not.toContain("client-secret-de-prueba")
  })

  it("no guarda el payload crudo ni PII en eventos, logs ni resultados", async () => {
    await POST(request(eventoCaptura()))

    const persistido = JSON.stringify(mocks.eventoCreate.mock.calls)
    expect(persistido).not.toContain(PII_EMAIL)
    expect(persistido).not.toContain(PII_NOMBRE)
    expect(persistido).not.toContain("payer")
    expect(persistido).not.toContain("purchase_units")

    expect(logs()).not.toContain(PII_EMAIL)
    expect(logs()).not.toContain(PII_NOMBRE)
  })
})
