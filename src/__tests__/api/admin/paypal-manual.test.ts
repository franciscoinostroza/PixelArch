import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-15 (AC-17, AC-19, AC-24, AC-25): registro manual de un pago PayPal.
 *
 * Se cubren permisos (solo admin), rate limit, validacion del body y del
 * desglose, lookup de la orden, idempotencia por capture/order (incluido un
 * webhook posterior), aplicacion de hito y soporte con sus flags, meses 1..12,
 * recibo interno, ausencia de PII y el rechazo de `metodo=PAYPAL` en el
 * endpoint generico. Prisma, PayPal, auth y rate limit estan mockeados: no hay
 * base ni red.
 */

type Fila = Record<string, unknown>

const mocks = vi.hoisted(() => {
  const store = {
    hitos: new Map<string, Fila>(),
    suscripciones: new Map<string, Fila>(),
    pagos: [] as Fila[],
  }

  function snapshotStore() {
    return {
      hitos: new Map(
        [...store.hitos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      suscripciones: new Map(
        [...store.suscripciones].map(
          ([id, fila]) => [id, structuredClone(fila)] as const
        )
      ),
      pagos: store.pagos.map((fila) => structuredClone(fila)),
    }
  }

  function restoreStore(snapshot: ReturnType<typeof snapshotStore>) {
    store.hitos = snapshot.hitos
    store.suscripciones = snapshot.suscripciones
    store.pagos = snapshot.pagos
  }

  function coincidePago(pago: Fila, where: Fila & { OR?: Fila[] }): boolean {
    if (Array.isArray(where.OR)) {
      return where.OR.some((condicion) => {
        if (condicion.externalId !== undefined) {
          return pago.externalId === condicion.externalId
        }
        if (condicion.paypalOrderId !== undefined) {
          return pago.paypalOrderId === condicion.paypalOrderId
        }
        return false
      })
    }

    if (where.hitoId !== undefined && pago.hitoId !== where.hitoId) return false
    if (where.suscripcionId !== undefined && pago.suscripcionId !== where.suscripcionId) {
      return false
    }
    if (where.estadoPago !== undefined && pago.estadoPago !== where.estadoPago) {
      return false
    }
    return true
  }

  const pagoFindFirst = vi.fn(
    async (args: { where: Fila & { OR?: Fila[] } }) =>
      store.pagos.find((pago) => coincidePago(pago, args.where)) ?? null
  )

  const pagoCreate = vi.fn(async (args: { data: Fila }) => {
    const data = args.data
    const duplicado = store.pagos.some(
      (pago) =>
        (data.externalId !== undefined &&
          data.externalId !== null &&
          pago.externalId === data.externalId) ||
        (data.paypalOrderId !== undefined &&
          data.paypalOrderId !== null &&
          pago.paypalOrderId === data.paypalOrderId)
    )

    if (duplicado) {
      const error = new Error("Unique constraint failed") as Error & {
        code: string
      }
      error.code = "P2002"
      throw error
    }

    const pago = { id: `pago_${store.pagos.length + 1}`, ...data }
    store.pagos.push(pago)
    return { id: pago.id }
  })

  const hitoFindUnique = vi.fn(
    async (args: { where: { id: string } }) => store.hitos.get(args.where.id) ?? null
  )

  const suscripcionFindUnique = vi.fn(
    async (args: { where: { id: string } }) =>
      store.suscripciones.get(args.where.id) ?? null
  )

  const hitoUpdateMany = vi.fn(
    async (args: { where: { id: string; estado?: string }; data: Fila }) => {
      const hito = store.hitos.get(args.where.id)
      if (!hito) return { count: 0 }
      if (args.where.estado !== undefined && hito.estado !== args.where.estado) {
        return { count: 0 }
      }
      Object.assign(hito, args.data)
      return { count: 1 }
    }
  )

  const hitoUpdate = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const hito = store.hitos.get(args.where.id)
      if (!hito) throw new Error("Hito no encontrado")
      Object.assign(hito, args.data)
      return hito
    }
  )

  const suscripcionUpdate = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      if (!suscripcion) throw new Error("Suscripcion no encontrada")
      Object.assign(suscripcion, args.data)
      return suscripcion
    }
  )

  type TxFalso = {
    pago: { findFirst: typeof pagoFindFirst; create: typeof pagoCreate }
    hito: {
      findUnique: typeof hitoFindUnique
      updateMany: typeof hitoUpdateMany
      update: typeof hitoUpdate
    }
    suscripcion: {
      findUnique: typeof suscripcionFindUnique
      update: typeof suscripcionUpdate
    }
  }

  const tx: TxFalso = {
    pago: { findFirst: pagoFindFirst, create: pagoCreate },
    hito: {
      findUnique: hitoFindUnique,
      updateMany: hitoUpdateMany,
      update: hitoUpdate,
    },
    suscripcion: {
      findUnique: suscripcionFindUnique,
      update: suscripcionUpdate,
    },
  }

  const $transaction = vi.fn(async (fn: (tx: TxFalso) => Promise<unknown>) => {
    const snapshot = snapshotStore()
    try {
      return await fn(tx)
    } catch (error) {
      restoreStore(snapshot)
      throw error
    }
  })

  return {
    store,
    $transaction,
    pagoFindFirst,
    pagoCreate,
    hitoFindUnique,
    suscripcionFindUnique,
    hitoUpdateMany,
    hitoUpdate,
    suscripcionUpdate,
    requireAdmin: vi.fn(),
    rateLimit: vi.fn(),
    paypalConfig: vi.fn(),
    getOrder: vi.fn(),
    sendPaymentReceipt: vi.fn(),
    loggerDebug: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  }
})

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  requireStaff: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    pago: { findFirst: mocks.pagoFindFirst, create: mocks.pagoCreate },
    hito: {
      findUnique: mocks.hitoFindUnique,
      updateMany: mocks.hitoUpdateMany,
      update: mocks.hitoUpdate,
    },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      update: mocks.suscripcionUpdate,
    },
  },
}))

vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: vi.fn(async () => null),
}))

vi.mock("@/lib/notifications", () => ({
  sendPaymentReceipt: mocks.sendPaymentReceipt,
}))

vi.mock("@/lib/paypal/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/config")>()
  return { ...actual, paypalConfig: mocks.paypalConfig }
})

vi.mock("@/lib/paypal/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/client")>()
  return { ...actual, getOrder: mocks.getOrder }
})

import { POST as manualPOST } from "@/app/api/admin/paypal/manual/route"
import { POST as pagosPOST } from "@/app/api/admin/pagos/route"
import { vencimientoConMeses } from "@/lib/mp-utils"
import { PaypalError } from "@/lib/paypal/client"
import {
  EVIDENCIA_PAYPAL_MAX,
  registrarPagoManualPaypal,
} from "@/lib/paypal/manual"
import { procesarCapturaPaypal } from "@/lib/paypal/process"
import { construirReciboPaypal } from "@/lib/paypal/receipts"

const AHORA = new Date("2026-10-26T12:00:00.000Z")
const PROXIMO_PAGO = new Date("2030-01-15T12:00:00.000Z")
const CAPTURE = "3C679366HH908993F"
const ORDER = "5O190127TN364715T"
const RECIBO = "PAY-20261026-ABCDEF123456"

const ADMIN = {
  id: "admin_1",
  clerkUserId: "admin_1",
  nombre: "Ana Admin",
  email: "admin@example.com",
  activo: true,
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

function orden(overrides: Fila = {}) {
  return {
    id: ORDER,
    status: "COMPLETED",
    customId: "token_1",
    invoiceId: "token_1",
    amountCents: 10656,
    currencyCode: "USD",
    payerActionUrl: null,
    createTime: null,
    captures: [
      {
        id: CAPTURE,
        status: "COMPLETED",
        amountCents: 10656,
        currencyCode: "USD",
        orderId: ORDER,
        customId: null,
        invoiceId: null,
        createTime: null,
        finalCapture: true,
      },
    ],
    ...overrides,
  }
}

function body(overrides: Fila = {}) {
  return {
    hitoId: "hito_1",
    montoAcordadoCents: 10050,
    comisionCents: 606,
    totalCents: 10656,
    externalId: CAPTURE,
    paypalOrderId: ORDER,
    evidencia: `Capture ${CAPTURE} / order ${ORDER} / comprobante recibido`,
    ...overrides,
  }
}

function request(payload: unknown): Request {
  return new Request("https://pixelarch.dev/api/admin/paypal/manual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function resetStore() {
  mocks.store.hitos.clear()
  mocks.store.suscripciones.clear()
  mocks.store.pagos.length = 0

  mocks.store.hitos.set("hito_1", {
    id: "hito_1",
    estado: "PENDIENTE",
    monto: 10050,
    titulo: "Anticipo",
    pagadoEn: null,
    proyecto: {
      clienteId: "cliente_1",
      cliente: {
        id: "cliente_1",
        nombre: "Cliente ACME",
        email: "cliente@example.com",
      },
    },
  })

  mocks.store.suscripciones.set("suscripcion_1", {
    id: "suscripcion_1",
    clienteId: "cliente_1",
    plan: "SOPORTE",
    estado: "ACTIVE",
    proximoPago: PROXIMO_PAGO,
    pastDueEn: new Date("2026-09-01T12:00:00.000Z"),
    canceladoEn: null,
    servicio: { nombre: "Soporte mensual" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()

  mocks.requireAdmin.mockResolvedValue(ADMIN)
  mocks.rateLimit.mockReturnValue(true)
  mocks.paypalConfig.mockReturnValue(configDisponible())
  mocks.getOrder.mockResolvedValue(orden())
  mocks.sendPaymentReceipt.mockResolvedValue(undefined)
})

describe("POST /api/admin/paypal/manual: permisos y rate limit (AC-17, AC-25)", () => {
  it("responde 403 a la asistente o a un usuario sin rol admin sin tocar la base", async () => {
    mocks.requireAdmin.mockResolvedValue(null)

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: "No autorizado" })
    expect(mocks.hitoFindUnique).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.getOrder).not.toHaveBeenCalled()
  })

  it("aplica rate limit de 20/min antes de autenticar", async () => {
    mocks.rateLimit.mockReturnValue(false)

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(429)
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      expect.stringContaining("admin-paypal-manual:"),
      20,
      60_000
    )
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
  })

  it("permite registrar al admin y devuelve ok + pagoId", async () => {
    const res = await manualPOST(request(body()))

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, pagoId: "pago_1" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/admin/paypal/manual: validacion (AC-24, AC-25)", () => {
  it("responde 400 con JSON invalido", async () => {
    const res = await manualPOST(request("{"))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "JSON invalido" })
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it.each([
    ["sin concepto", body({ hitoId: null })],
    ["con ambos conceptos", body({ suscripcionId: "suscripcion_1" })],
    ["con desglose incorrecto", body({ totalCents: 1 })],
    ["con comision negativa", body({ comisionCents: -1 })],
    ["con monto decimal", body({ montoAcordadoCents: 10.5 })],
    ["sin referencias", body({ externalId: null, paypalOrderId: null })],
    ["con evidencia vacia", body({ evidencia: "   " })],
    ["con evidencia demasiado larga", body({ evidencia: "x".repeat(EVIDENCIA_PAYPAL_MAX + 1) })],
    ["con hito y meses", body({ meses: 2 })],
    ["con soporte sin meses", body({ hitoId: null, suscripcionId: "suscripcion_1" })],
    [
      "con soporte y meses 0",
      body({ hitoId: null, suscripcionId: "suscripcion_1", meses: 0 }),
    ],
    [
      "con soporte y meses 13",
      body({ hitoId: null, suscripcionId: "suscripcion_1", meses: 13 }),
    ],
    ["con moneda ARS", body({ moneda: "ars" })],
    ["con moneda distinta de USD", body({ moneda: "eur" })],
    ["con monto acordado en cero", body({ montoAcordadoCents: 0, totalCents: 606 })],
    ["con total en cero", body({ totalCents: 0 })],
    [
      "con monto acordado fuera de Int32",
      body({
        montoAcordadoCents: 2_147_483_648,
        comisionCents: 0,
        totalCents: 2_147_483_648,
      }),
    ],
    [
      "con comision fuera de Int32",
      body({
        comisionCents: 2_147_483_648,
        totalCents: 2_147_483_648,
      }),
    ],
    ["con referencia invalida", body({ externalId: "capture con espacios" })],
    ["con PII del pagador", body({ pagadorEmail: "pagador@example.com" })],
  ])("responde 400 %s sin crear un pago", async (_caso, payload) => {
    const res = await manualPOST(request(payload))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "Datos invalidos" })
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.getOrder).not.toHaveBeenCalled()
  })

  it("rechaza una evidencia que contiene un email (sin PII del pagador)", async () => {
    const res = await manualPOST(
      request(body({ evidencia: "Pagado por pagador@example.com" }))
    )

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("datos personales")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("rechaza una evidencia con caracteres de control", async () => {
    const res = await manualPOST(
      request(body({ evidencia: "pago\u0000ok" }))
    )

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("evidencia")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("acepta comision cero y normaliza moneda USD (AC-24)", async () => {
    const res = await manualPOST(
      request(
        body({
          comisionCents: 0,
          totalCents: 10050,
          paypalOrderId: null,
          moneda: "USD",
        })
      )
    )

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toEqual(
      expect.objectContaining({
        montoAcordado: 10050,
        comision: 0,
        monto: 10050,
        montoEsperado: 10050,
        moneda: "usd",
      })
    )
  })

  it("acepta una URL como evidencia textual (AC-25)", async () => {
    const evidencia = `https://www.paypal.com/activity/payment/${CAPTURE}`

    const res = await manualPOST(request(body({ evidencia })))

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toEqual(
      expect.objectContaining({ evidencia })
    )
  })

  it("responde 404 si el concepto no existe", async () => {
    const res = await manualPOST(
      request(body({ hitoId: "hito_x", paypalOrderId: null }))
    )

    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: "Concepto no encontrado." })
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si el soporte no es plan SOPORTE", async () => {
    mocks.store.suscripciones.set("suscripcion_1", {
      ...mocks.store.suscripciones.get("suscripcion_1"),
      plan: "BASICO",
    })

    const res = await manualPOST(
      request(
        body({
          hitoId: null,
          suscripcionId: "suscripcion_1",
          meses: 1,
          paypalOrderId: null,
        })
      )
    )

    expect(res.status).toBe(409)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/manual: lookup de la orden (AC-25)", () => {
  it("resuelve el capture id desde la orden cuando solo se informa paypalOrderId", async () => {
    const res = await manualPOST(
      request(body({ externalId: null, paypalOrderId: ORDER }))
    )

    expect(res.status).toBe(200)
    expect(mocks.getOrder).toHaveBeenCalledWith(ORDER)
    expect(mocks.store.pagos[0]).toEqual(
      expect.objectContaining({
        externalId: CAPTURE,
        paypalOrderId: ORDER,
      })
    )
  })

  it("responde 409 si el capture informado no coincide con la orden", async () => {
    const res = await manualPOST(
      request(body({ externalId: "OTRO-CAPTURE-123" }))
    )

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("capture id")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si el monto de la captura no coincide con el total", async () => {
    mocks.getOrder.mockResolvedValue(
      orden({
        amountCents: 9999,
        captures: [{ ...orden().captures[0], amountCents: 9999 }],
      })
    )

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("monto")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si la orden no tiene una captura completada", async () => {
    mocks.getOrder.mockResolvedValue(orden({ captures: [] }))

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(409)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("no consulta la orden si PayPal no esta configurado y registra con paypalOrderId", async () => {
    mocks.paypalConfig.mockReturnValue(
      configDeshabilitada("PayPal no disponible: configuracion incompleta.")
    )

    const res = await manualPOST(
      request(body({ externalId: null, paypalOrderId: ORDER }))
    )

    expect(res.status).toBe(200)
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(mocks.store.pagos[0]).toEqual(
      expect.objectContaining({
        externalId: null,
        paypalOrderId: ORDER,
        moneda: "usd",
      })
    )
  })

  it("sin configuracion permite registrar solo con capture id manual", async () => {
    mocks.paypalConfig.mockReturnValue(
      configDeshabilitada("PayPal no disponible: configuracion incompleta.")
    )

    const res = await manualPOST(
      request(body({ externalId: CAPTURE, paypalOrderId: null }))
    )

    expect(res.status).toBe(200)
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(mocks.store.pagos[0]).toEqual(
      expect.objectContaining({
        externalId: CAPTURE,
        paypalOrderId: null,
        moneda: "usd",
      })
    )
  })

  it("responde 409 si la orden devuelta no coincide con el id informado", async () => {
    mocks.getOrder.mockResolvedValue(orden({ id: "OTRA-ORDER" }))

    const res = await manualPOST(request(body({ externalId: null })))

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("no coincide")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si la captura no esta en USD", async () => {
    mocks.getOrder.mockResolvedValue(
      orden({
        currencyCode: "EUR",
        captures: [{ ...orden().captures[0], currencyCode: "EUR" }],
      })
    )

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("USD")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si la captura no esta COMPLETED", async () => {
    mocks.getOrder.mockResolvedValue(
      orden({
        captures: [{ ...orden().captures[0], status: "DECLINED" }],
      })
    )

    const res = await manualPOST(request(body()))

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("completada")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("mapea un fallo de PayPal a 502 y un NO_CONFIGURADO a 503 sin escribir", async () => {
    mocks.getOrder.mockRejectedValueOnce(
      new PaypalError({ code: "HTTP", message: "PayPal rechazo la consulta." })
    )

    const res502 = await manualPOST(request(body()))
    expect(res502.status).toBe(502)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()

    mocks.getOrder.mockRejectedValueOnce(
      new PaypalError({
        code: "NO_CONFIGURADO",
        message: "PayPal no disponible.",
      })
    )

    const res503 = await manualPOST(request(body()))
    expect(res503.status).toBe(503)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/manual: hito (AC-24, AC-25)", () => {
  it("crea el pago con desglose, recibo y trazabilidad y marca el hito PAGADO", async () => {
    const payload = body()

    const res = await manualPOST(request(payload))

    expect(res.status).toBe(200)

    const pago = mocks.store.pagos[0] as Fila
    expect(pago).toEqual(
      expect.objectContaining({
        clienteId: "cliente_1",
        hitoId: "hito_1",
        suscripcionId: null,
        externalId: CAPTURE,
        paypalOrderId: ORDER,
        monto: 10656,
        montoAcordado: 10050,
        comision: 606,
        montoEsperado: 10656,
        moneda: "usd",
        metodo: "PAYPAL",
        pasarela: "PAYPAL",
        origen: "MANUAL",
        estadoPago: "SUCCEEDED",
        evidencia: payload.evidencia,
        registradoPor: "Ana Admin",
        meses: null,
      })
    )
    expect(String(pago.reciboId)).toMatch(/^PAY-\d{8}-[0-9A-F]{12}$/)
    expect(pago.reciboEmitidoEn).toBeInstanceOf(Date)

    const hito = mocks.store.hitos.get("hito_1") as Fila
    expect(hito.estado).toBe("PAGADO")
    expect(hito.pagadoEn).toBeInstanceOf(Date)
  })

  it("marca el hito PAGADO sin tocar los campos de Mercado Pago", async () => {
    await manualPOST(request(body()))

    expect(mocks.hitoUpdateMany).toHaveBeenCalledWith({
      where: { id: "hito_1", estado: "PENDIENTE" },
      data: { estado: "PAGADO", pagadoEn: expect.any(Date) },
    })
    const data = mocks.hitoUpdateMany.mock.calls[0][0].data
    expect(data).not.toHaveProperty("mpLink")
    expect(data).not.toHaveProperty("mpLinkExpira")
    expect(data).not.toHaveProperty("mpPreferenceId")
  })

  it("respeta marcarHitoPagado=false y deja el hito pendiente", async () => {
    const res = await manualPOST(request(body({ marcarHitoPagado: false })))

    expect(res.status).toBe(200)
    expect(mocks.store.pagos).toHaveLength(1)
    expect((mocks.store.hitos.get("hito_1") as Fila).estado).toBe("PENDIENTE")
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
  })

  it("responde 409 si el hito ya esta PAGADO", async () => {
    mocks.store.hitos.set("hito_1", {
      ...mocks.store.hitos.get("hito_1"),
      estado: "PAGADO",
    })

    const res = await manualPOST(
      request(body({ paypalOrderId: null, externalId: CAPTURE }))
    )

    expect(res.status).toBe(409)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 si el hito ya tiene otro pago exitoso", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      hitoId: "hito_1",
      estadoPago: "SUCCEEDED",
      externalId: "CAPTURE-PREVIO",
      paypalOrderId: null,
    })

    const res = await manualPOST(
      request(body({ paypalOrderId: null, externalId: CAPTURE }))
    )

    expect(res.status).toBe(409)
    expect(mocks.store.pagos).toHaveLength(1)
  })
})

describe("registrarPagoManualPaypal: soporte (AC-24, AC-25)", () => {
  const inputSoporte = {
    suscripcionId: "suscripcion_1",
    montoAcordadoCents: 30_000,
    comisionCents: 1_650,
    totalCents: 31_650,
    externalId: CAPTURE,
    evidencia: "Comprobante de PayPal",
    meses: 3,
    registradoPor: "Ana Admin",
  }

  it("acredita los meses y actualiza el vencimiento una sola vez", async () => {
    const resultado = await registrarPagoManualPaypal(inputSoporte, {
      ahora: AHORA,
      nuevoReciboId: () => RECIBO,
    })

    expect(resultado).toEqual(
      expect.objectContaining({
        pagoId: "pago_1",
        reciboId: RECIBO,
        suscripcionId: "suscripcion_1",
        meses: 3,
        monto: 31_650,
        montoAcordado: 30_000,
        comision: 1_650,
        montoEsperado: 31_650,
        moneda: "usd",
        aplicado: true,
      })
    )

    const pago = mocks.store.pagos[0] as Fila
    expect(pago).toEqual(
      expect.objectContaining({
        hitoId: null,
        suscripcionId: "suscripcion_1",
        meses: 3,
        monto: 31_650,
        reciboId: RECIBO,
        reciboEmitidoEn: AHORA,
      })
    )

    const suscripcion = mocks.store.suscripciones.get("suscripcion_1") as Fila
    expect(suscripcion.estado).toBe("ACTIVE")
    expect(suscripcion.proximoPago).toEqual(
      vencimientoConMeses(PROXIMO_PAGO, 3, AHORA)
    )
    expect(suscripcion.pastDueEn).toBeNull()
    expect(suscripcion.canceladoEn).toBeNull()
  })

  it.each([1, 12])(
    "acredita el limite de %s mes(es) de soporte (AC-24)",
    async (meses) => {
      const resultado = await registrarPagoManualPaypal(
        { ...inputSoporte, meses },
        { ahora: AHORA, nuevoReciboId: () => RECIBO }
      )

      expect(resultado).toEqual(
        expect.objectContaining({ meses, aplicado: true })
      )
      expect((mocks.store.pagos[0] as Fila).meses).toBe(meses)
      expect(
        (mocks.store.suscripciones.get("suscripcion_1") as Fila).proximoPago
      ).toEqual(vencimientoConMeses(PROXIMO_PAGO, meses, AHORA))
    }
  )

  it("respeta acreditarMeses=false y no toca la suscripcion", async () => {
    const antes = structuredClone(
      mocks.store.suscripciones.get("suscripcion_1") as Fila
    )

    const resultado = await registrarPagoManualPaypal(
      { ...inputSoporte, acreditarMeses: false },
      { ahora: AHORA, nuevoReciboId: () => RECIBO }
    )

    expect(resultado.aplicado).toBe(false)
    expect(mocks.store.pagos).toHaveLength(1)
    expect((mocks.store.pagos[0] as Fila).meses).toBe(3)
    expect(mocks.store.suscripciones.get("suscripcion_1")).toEqual(antes)
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  })

  it.each([0, 13, 1.5])(
    "rechaza meses fuera de 1..12 (%s) sin crear pago",
    async (meses) => {
      await expect(
        registrarPagoManualPaypal(
          { ...inputSoporte, meses },
          { ahora: AHORA }
        )
      ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS" })

      expect(mocks.pagoCreate).not.toHaveBeenCalled()
      expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
    }
  )
})

describe("POST /api/admin/paypal/manual: idempotencia (AC-25)", () => {
  it("responde 409 duplicado por externalId sin crear otro pago", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: CAPTURE,
      paypalOrderId: null,
      estadoPago: "SUCCEEDED",
    })

    const res = await manualPOST(
      request(body({ paypalOrderId: null, externalId: CAPTURE }))
    )

    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({
      ok: false,
      error: "Ya existe un pago PayPal con la misma referencia.",
      pagoId: "pago_previo",
      duplicado: true,
    })
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
  })

  it("responde 409 duplicado por paypalOrderId", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: null,
      paypalOrderId: ORDER,
      estadoPago: "SUCCEEDED",
    })

    const res = await manualPOST(
      request(body({ externalId: null, paypalOrderId: ORDER }))
    )

    expect(res.status).toBe(409)
    expect((await json(res)).duplicado).toBe(true)
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.getOrder).not.toHaveBeenCalled()
  })

  it("detecta el duplicado dentro de la transaccion si otro registro gano tras el pre-chequeo", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: CAPTURE,
      paypalOrderId: null,
      estadoPago: "SUCCEEDED",
    })
    // El pre-chequeo ve la base limpia; la transaccion ya encuentra la fila.
    mocks.pagoFindFirst.mockResolvedValueOnce(null)

    const res = await manualPOST(
      request(body({ paypalOrderId: null, externalId: CAPTURE }))
    )

    expect(res.status).toBe(409)
    expect((await json(res)).pagoId).toBe("pago_previo")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.store.pagos).toHaveLength(1)
  })

  it("traduce el P2002 de la constraint unica a duplicado sin 500", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: CAPTURE,
      paypalOrderId: null,
      estadoPago: "SUCCEEDED",
    })
    // Pre-chequeo y chequeo transaccional no ven la fila; el insert choca.
    mocks.pagoFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const res = await manualPOST(
      request(body({ paypalOrderId: null, externalId: CAPTURE }))
    )

    expect(res.status).toBe(409)
    expect((await json(res)).pagoId).toBe("pago_previo")
    expect(mocks.pagoCreate).toHaveBeenCalledTimes(1)
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  it("detecta el duplicado por capture resuelto desde la orden", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: CAPTURE,
      paypalOrderId: null,
      estadoPago: "SUCCEEDED",
    })

    const res = await manualPOST(
      request(body({ externalId: null, paypalOrderId: ORDER }))
    )

    expect(res.status).toBe(409)
    expect(mocks.getOrder).toHaveBeenCalledWith(ORDER)
    expect((await json(res)).pagoId).toBe("pago_previo")
    expect(mocks.store.pagos).toHaveLength(1)
  })

  it("un webhook posterior encuentra el pago manual y no lo duplica", async () => {
    const res = await manualPOST(request(body()))
    expect(res.status).toBe(200)

    const pagoManual = mocks.store.pagos[0] as Fila
    const enlace = {
      id: "enlace_1",
      token: "token_1",
      clienteId: "cliente_1",
      hitoId: "hito_1",
      suscripcionId: null,
      pasarela: "PAYPAL",
      concepto: "Anticipo",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      moneda: "usd",
      meses: null,
      feeBps: 540,
      feeFixedCents: 30,
      externalId: ORDER,
      estado: "ACTIVO",
      grupoCobroId: "hito:hito_1",
      hito: { id: "hito_1", estado: "PENDIENTE" },
    }

    const webhookPagoCreate = vi.fn()
    const webhookHitoUpdate = vi.fn()
    const db = {
      enlacePago: {
        findFirst: vi.fn(async () => enlace),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      pago: {
        findFirst: vi.fn(async () => ({
          id: pagoManual.id,
          estadoPago: pagoManual.estadoPago,
          enlacePagoId: null,
          hitoId: pagoManual.hitoId,
          externalId: pagoManual.externalId,
          paypalOrderId: pagoManual.paypalOrderId,
        })),
        create: webhookPagoCreate,
      },
      hito: { updateMany: webhookHitoUpdate },
      suscripcion: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    }

    const resultado = await procesarCapturaPaypal(
      {
        captureId: CAPTURE,
        orderId: ORDER,
        amountCents: 10656,
        currency: "USD",
        status: "COMPLETED",
      },
      { db: db as never, ahora: AHORA }
    )

    expect(resultado.tipo).toBe("DUPLICADO")
    expect(webhookPagoCreate).not.toHaveBeenCalled()
    expect(webhookHitoUpdate).not.toHaveBeenCalled()
    expect(mocks.store.pagos).toHaveLength(1)
  })
})

describe("POST /api/admin/paypal/manual: recibo, PII y errores genericos", () => {
  it("el recibo interno reconcilia el desglose y no incluye datos del pagador (AC-10, AC-24)", async () => {
    await manualPOST(request(body()))

    const pago = mocks.store.pagos[0] as Fila
    const recibo = construirReciboPaypal({
      reciboId: String(pago.reciboId),
      concepto: "Anticipo",
      montoAcordado: Number(pago.montoAcordado),
      comision: Number(pago.comision),
      total: Number(pago.monto),
      moneda: String(pago.moneda),
      fecha: pago.reciboEmitidoEn as Date,
      referenciaExterna: String(pago.externalId),
    })

    expect(recibo.montoAcordado + recibo.comision).toBe(recibo.total)
    expect(recibo.total).toBe(10656)
    expect(recibo.pasarela).toBe("PAYPAL")
    expect(JSON.stringify(recibo)).not.toContain("pagador")
  })

  it("no persiste ni loguea PII del pagador ni la evidencia (AC-19, AC-24)", async () => {
    const res = await manualPOST(request(body()))
    expect(res.status).toBe(200)

    const serializado = JSON.stringify(mocks.store.pagos[0])
    expect(serializado).not.toContain("pagador")
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("4111111111111111")

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("comprobante recibido")
    expect(logs).not.toContain("pagador@example.com")
  })

  it("no loguea la evidencia ni PII al rechazar un duplicado (AC-19, AC-25)", async () => {
    mocks.store.pagos.push({
      id: "pago_previo",
      externalId: CAPTURE,
      paypalOrderId: null,
      estadoPago: "SUCCEEDED",
    })
    const evidencia = "Comprobante confidencial de Ana Pagadora"

    const res = await manualPOST(
      request(
        body({ externalId: CAPTURE, paypalOrderId: null, evidencia })
      )
    )

    expect(res.status).toBe(409)
    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain(evidencia)
    expect(logs).not.toContain("Ana Pagadora")
  })

  it("responde 500 generico si la base falla sin filtrar el detalle", async () => {
    mocks.pagoCreate.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    const res = await manualPOST(request(body()))
    const payload = await json(res)

    expect(res.status).toBe(500)
    expect(payload.error).toBe("Error al registrar el pago manual de PayPal.")
    expect(JSON.stringify(payload)).not.toContain("postgres")
    expect(JSON.stringify(payload)).not.toContain("secreto")
  })
})

describe("POST /api/admin/pagos: rechazo de PayPal (AC-24, AC-25)", () => {
  it("rechaza metodo=PAYPAL con 400 y deriva al endpoint manual", async () => {
    const res = await pagosPOST(
      request({
        hitoId: "hito_1",
        monto: 10656,
        moneda: "usd",
        metodo: "PAYPAL",
      })
    )

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("/api/admin/paypal/manual")
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
  })

  it.each([["paypal en minusculas", "paypal"], ["paypal con espacios", " PayPaL "]])(
    "rechaza %s con 400 y deriva al endpoint manual",
    async (_caso, metodo) => {
      const res = await pagosPOST(
        request({ hitoId: "hito_1", monto: 10656, moneda: "usd", metodo })
      )

      expect(res.status).toBe(400)
      expect((await json(res)).error).toContain("/api/admin/paypal/manual")
      expect(mocks.pagoCreate).not.toHaveBeenCalled()
      expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    }
  )

  it.each([["sin metodo", undefined], ["con metodo null", null], ["con metodo vacio", ""]])(
    "rechaza %s (no permite metodo=null)",
    async (_caso, metodo) => {
      const res = await pagosPOST(
        request({ hitoId: "hito_1", monto: 10656, moneda: "usd", metodo })
      )

      expect(res.status).toBe(400)
      expect((await json(res)).error).toBe("Metodo de pago invalido")
      expect(mocks.pagoCreate).not.toHaveBeenCalled()
    }
  )

  it.each(["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO", "OTRO"])(
    "sigue permitiendo el metodo valido %s",
    async (metodo) => {
      const res = await pagosPOST(
        request({
          hitoId: "hito_1",
          monto: 10656,
          moneda: "usd",
          metodo,
          enviarRecibo: false,
        })
      )

      expect(res.status).toBe(200)
      expect(mocks.store.pagos[0]).toEqual(
        expect.objectContaining({
          metodo,
          monto: 10656,
          moneda: "usd",
        })
      )
    }
  )
})
