import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-30 (AC-6, AC-7, AC-13, AC-15, AC-21; RNF-1, RNF-5): resiliencia del
 * webhook PayPal sin red ni base real.
 *
 * Se simula el procesador con stores en memoria (un Pago y un credito por
 * capture/order) y se ejercitan:
 * - firma invalida/ausente y timeout de verificacion;
 * - evento repetido y dos simultaneos con distinto event id;
 * - eventos fuera de orden (capture antes de order approved);
 * - evento desconocido;
 * - segundo pago de la misma orden: sin segundo Pago ni segundo credito.
 */

type Fila = Record<string, unknown>
type PagoEnMemoria = { pagoId: string; captureId: string }

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
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  captureException: vi.fn(),
  estado: { pagos: new Map<string, PagoEnMemoria>(), creditos: new Map<string, number>(), estadoEnlace: "ACTIVO" },
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
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }))

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
  return { ...actual, procesarCapturaPaypal: mocks.procesarCapturaPaypal }
})

import { POST } from "@/app/api/webhooks/paypal/route"
import { PaypalError } from "@/lib/paypal/client"
import { registrarEventoPasarela } from "@/lib/paypal/events"
import { reiniciarLimitadorWebhookPaypal } from "@/lib/paypal/webhook-limit"

const BASE_URL = "https://pixelarch.dev/api/webhooks/paypal"

const HEADERS = {
  "PAYPAL-TRANSMISSION-ID": "trans-1",
  "PAYPAL-TRANSMISSION-TIME": "2026-10-20T12:00:00Z",
  "PAYPAL-TRANSMISSION-SIG": "firma",
  "PAYPAL-CERT-URL": "https://api-m.sandbox.paypal.com/cert.pem",
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
}

function errorUnico(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
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
    estado: mocks.estado.estadoEnlace,
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

function eventoCaptura(overrides: Fila = {}): Fila {
  return {
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource: {
      id: "CAPTURE-1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "106.56" },
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
      custom_id: "token_1",
      invoice_id: "token_1",
    },
    ...overrides,
  }
}

function eventoOrden(overrides: Fila = {}): Fila {
  return {
    id: "WH-APROBADA-1",
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource_type: "checkout-order",
    resource: {
      id: "ORDER-1",
      status: "APPROVED",
      purchase_units: [
        {
          custom_id: "token_1",
          invoice_id: "token_1",
          amount: { currency_code: "USD", value: "106.56" },
        },
      ],
    },
    ...overrides,
  }
}

function request(
  evento: unknown,
  opciones: { omitirHeader?: string } = {}
): Request {
  const headers = new Headers()
  for (const [clave, valor] of Object.entries(HEADERS)) {
    if (clave === opciones.omitirHeader) continue
    headers.set(clave, valor)
  }
  return new Request(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(evento),
  })
}

function resultadoProcesado(overrides: Fila = {}) {
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

function procesadorResiliente(demoraMs = 0) {
  return mocks.procesarCapturaPaypal.mockImplementation(
    async (capturaProcesable: Fila, opciones: Fila) => {
      if (demoraMs > 0) await new Promise((resolve) => setTimeout(resolve, demoraMs))

      const captureId = capturaProcesable.captureId as string
      const orderId = (capturaProcesable.orderId as string | null) ?? ""

      const existente = mocks.estado.pagos.get(captureId)
      if (existente) {
        return {
          tipo: "DUPLICADO",
          duplicado: true,
          pagoId: existente.pagoId,
          enlaceId: "enlace_1",
          hitoId: "hito_1",
          requiereAccion: true,
        }
      }

      const pagoDeLaOrden = mocks.estado.pagos.get(`orden:${orderId}`)
      if (pagoDeLaOrden) {
        return {
          tipo: "DUPLICADO",
          duplicado: true,
          pagoId: pagoDeLaOrden.pagoId,
          enlaceId: "enlace_1",
          hitoId: "hito_1",
          requiereAccion: true,
        }
      }

      const pagoId = `pago_${mocks.estado.pagos.size + 1}`
      mocks.estado.pagos.set(captureId, { pagoId, captureId })
      if (orderId) {
        mocks.estado.pagos.set(`orden:${orderId}`, { pagoId, captureId })
      }
      mocks.estado.creditos.set(
        "suscripcion_1",
        (mocks.estado.creditos.get("suscripcion_1") ?? 0) + 1
      )
      mocks.estado.estadoEnlace = "PAGADO"

      const evento = (opciones.evento as Fila | undefined) ?? {}
      const eventoId = (evento.eventoId as string | undefined) ?? `CAPTURA:${captureId}`

      await registrarEventoPasarela({
        eventoId,
        pasarela: "PAYPAL",
        tipo: (evento.tipo as string | undefined) ?? "PAYMENT.CAPTURE.COMPLETED",
        externalId: captureId,
        enlacePagoId: "enlace_1",
        pagoId,
        resultado: "PROCESADO",
        monto: capturaProcesable.amountCents as number | null,
        moneda: capturaProcesable.currency as string | null,
        procesadoEn: opciones.ahora as Date | undefined,
      })

      return resultadoProcesado({ pagoId })
    }
  )
}

function crearEvento(data: Fila): Fila {
  if (mocks.eventos.some((fila) => fila.eventoId === data.eventoId)) {
    throw errorUnico()
  }
  const fila = { id: `evento_${mocks.eventos.length + 1}`, ...data }
  mocks.eventos.push(fila)
  return fila
}

function dataEvento(indice = 0): Fila {
  const llamada = mocks.eventoCreate.mock.calls[indice]
  if (!llamada) throw new Error("No se registro un EventoPasarela")
  return (llamada[0] as { data: Fila }).data
}

beforeEach(() => {
  vi.clearAllMocks()
  reiniciarLimitadorWebhookPaypal()
  mocks.eventos.length = 0
  mocks.estado.pagos.clear()
  mocks.estado.creditos.clear()
  mocks.estado.estadoEnlace = "ACTIVO"

  vi.stubEnv("PAYPAL_ENV", "sandbox")
  vi.stubEnv("PAYPAL_CLIENT_ID", "client-id-de-prueba")
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "client-secret-de-prueba")
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "webhook-id-de-prueba")
  vi.stubEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")

  mocks.eventoCreate.mockImplementation(async (args: { data: Fila }) =>
    crearEvento(args.data)
  )
  mocks.eventoFindUnique.mockImplementation(
    async (args: { where: { eventoId: string } }) =>
      mocks.eventos.find((fila) => fila.eventoId === args.where.eventoId) ?? null
  )
  mocks.enlaceFindUnique.mockImplementation(
    async (args: { where: { externalId?: string; token?: string } }) => {
      if (
        args.where.externalId === "ORDER-1" ||
        args.where.token === "token_1"
      ) {
        return enlace()
      }
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
  procesadorResiliente()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("resiliencia - firma y verificacion", () => {
  it("firma ausente: 401, sin procesador ni pago", async () => {
    const res = await POST(
      request(eventoCaptura(), { omitirHeader: "PAYPAL-TRANSMISSION-SIG" })
    )

    expect(res.status).toBe(401)
    expect(mocks.verifyWebhookSignature).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.estado.pagos.size).toBe(0)
  })

  it("firma invalida: 401, evento tecnico y sin pago", async () => {
    mocks.verifyWebhookSignature.mockResolvedValue({
      verificado: false,
      estado: "FAILURE",
      motivo: "FIRMA_INVALIDA",
    })

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(401)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.estado.pagos.size).toBe(0)
    expect(dataEvento()).toMatchObject({
      resultado: "FIRMA_INVALIDA",
      motivo: "FIRMA_INVALIDA",
    })
  })

  it("timeout de verificacion: 503 para reintento, sin pago", async () => {
    mocks.verifyWebhookSignature.mockRejectedValue(
      new PaypalError({
        code: "TIMEOUT",
        message: "PayPal no respondio a tiempo al verificar el webhook.",
      })
    )

    const res = await POST(request(eventoCaptura()))

    expect(res.status).toBe(503)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.estado.pagos.size).toBe(0)
    expect(mocks.eventoCreate).not.toHaveBeenCalled()
  })
})

describe("resiliencia - idempotencia y concurrencia", () => {
  it("evento repetido: un solo Pago y un solo credito, segundo 200 duplicate", async () => {
    const primera = await POST(request(eventoCaptura()))
    const segunda = await POST(request(eventoCaptura()))

    expect(primera.status).toBe(200)
    expect(await primera.json()).toEqual({ ok: true })
    expect(segunda.status).toBe(200)
    expect(await segunda.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)
    expect(mocks.estado.pagos.get("CAPTURE-1")?.pagoId).toBe("pago_1")
    expect(mocks.estado.creditos.get("suscripcion_1")).toBe(1)
  })

  it("dos webhooks simultaneos del mismo capture: un solo Pago y un solo credito", async () => {
    mocks.procesarCapturaPaypal.mockReset()
    procesadorResiliente(5)

    const [primera, segunda] = await Promise.all([
      POST(request(eventoCaptura({ id: "WH-SIM-1" }))),
      POST(request(eventoCaptura({ id: "WH-SIM-2" }))),
    ])

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(200)

    const estados = [
      (await primera.json()) as { duplicate?: boolean },
      (await segunda.json()) as { duplicate?: boolean },
    ]
    expect(estados.filter((estado) => estado.duplicate === true)).toHaveLength(1)
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(2)
    expect(mocks.estado.pagos.get("CAPTURE-1")?.pagoId).toBe("pago_1")
    expect(
      [...mocks.estado.pagos.keys()].filter((clave) => !clave.startsWith("orden:"))
    ).toHaveLength(1)
    expect(mocks.estado.creditos.get("suscripcion_1")).toBe(1)
  })

  it("capture antes de order approved: el approved no vuelve a capturar ni paga", async () => {
    const captureRes = await POST(request(eventoCaptura({ id: "WH-ORDEN-1" })))
    expect(captureRes.status).toBe(200)
    expect(mocks.estado.pagos.get("CAPTURE-1")?.pagoId).toBe("pago_1")
    expect(mocks.estado.pagos.get("orden:ORDER-1")?.pagoId).toBe("pago_1")

    const approvedRes = await POST(request(eventoOrden()))
    expect(approvedRes.status).toBe(200)
    expect(await approvedRes.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.estado.creditos.get("suscripcion_1")).toBe(1)
    expect(dataEvento(1)).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ENLACE_NO_ACTIVO:PAGADO",
    })
  })

  it("ORDER.APPROVED tolera un 422 de captura concurrente y no duplica (AC-6, AC-13)", async () => {
    mocks.getOrder
      .mockResolvedValueOnce(orden({ captures: [] }))
      .mockResolvedValueOnce(
        orden({ status: "COMPLETED", captures: [captura()] })
      )
    mocks.captureOrder.mockRejectedValue(
      Object.assign(new Error("order already captured"), { httpStatus: 422 })
    )

    const res = await POST(request(eventoOrden()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.getOrder).toHaveBeenCalledTimes(2)
    expect(mocks.captureOrder).toHaveBeenCalledTimes(1)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.estado.pagos.size).toBe(0)
    expect(dataEvento()).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ORDEN_YA_CAPTURADA",
    })
  })

  it("evento desconocido: 200 ignored sin procesador ni pago", async () => {
    const res = await POST(
      request({
        id: "WH-DESCONOCIDO-1",
        event_type: "UNKNOWN.EVENT",
        resource: { id: "X-1" },
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
    expect(mocks.estado.pagos.size).toBe(0)
  })

  it("segundo pago de la misma orden: sin segundo Pago ni segundo credito", async () => {
    const primera = await POST(request(eventoCaptura({ id: "WH-PAGO-1" })))
    expect(primera.status).toBe(200)

    const segunda = await POST(
      request(
        eventoCaptura({
          id: "WH-PAGO-2",
          resource: {
            id: "CAPTURE-2",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "106.56" },
            supplementary_data: { related_ids: { order_id: "ORDER-1" } },
            custom_id: "token_1",
            invoice_id: "token_1",
          },
        })
      )
    )

    expect(segunda.status).toBe(200)
    expect(await segunda.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(2)
    expect(
      [...mocks.estado.pagos.keys()].filter((clave) => !clave.startsWith("orden:"))
    ).toHaveLength(1)
    expect(mocks.estado.pagos.get("CAPTURE-1")?.pagoId).toBe("pago_1")
    expect(mocks.estado.pagos.has("CAPTURE-2")).toBe(false)
    expect(mocks.estado.creditos.get("suscripcion_1")).toBe(1)
  })
})
