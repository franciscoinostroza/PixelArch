import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-16 (AC-17, AC-19, AC-22): reembolsos y contracargos manuales de PayPal.
 *
 * Se cubren permisos (solo admin), rate limit, validacion del body y de la
 * coherencia decision/meses, pago inexistente o de otra pasarela, las tres
 * decisiones, la conservacion del pago original (montos, comision, monto
 * esperado, recibo y referencias), el estado REFUNDED/CONTRACARGO, la ausencia
 * de automatismo y la ausencia de PII. Prisma, auth, rate limit y logger estan
 * mockeados: no hay base ni red.
 */

type Fila = Record<string, unknown>

const mocks = vi.hoisted(() => {
  const store = {
    pagos: new Map<string, Fila>(),
    hitos: new Map<string, Fila>(),
    suscripciones: new Map<string, Fila>(),
    ajustes: [] as Fila[],
  }

  function snapshotStore() {
    return {
      pagos: new Map(
        [...store.pagos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      hitos: new Map(
        [...store.hitos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      suscripciones: new Map(
        [...store.suscripciones].map(
          ([id, fila]) => [id, structuredClone(fila)] as const
        )
      ),
      ajustes: store.ajustes.map((fila) => structuredClone(fila)),
    }
  }

  function restoreStore(snapshot: ReturnType<typeof snapshotStore>) {
    store.pagos = snapshot.pagos
    store.hitos = snapshot.hitos
    store.suscripciones = snapshot.suscripciones
    store.ajustes = snapshot.ajustes
  }

  const pagoFindUnique = vi.fn(
    async (args: { where: { id: string } }) => {
      const pago = store.pagos.get(args.where.id)
      return pago ? structuredClone(pago) : null
    }
  )

  const pagoUpdateMany = vi.fn(
    async (args: {
      where: {
        id: string
        pasarela?: string
        estadoPago?: string
        revisionEstado?: string | null
      }
      data: Fila
    }) => {
      const pago = store.pagos.get(args.where.id)
      if (!pago) return { count: 0 }
      if (
        args.where.pasarela !== undefined &&
        pago.pasarela !== args.where.pasarela
      ) {
        return { count: 0 }
      }
      if (
        args.where.estadoPago !== undefined &&
        pago.estadoPago !== args.where.estadoPago
      ) {
        return { count: 0 }
      }
      if (
        args.where.revisionEstado !== undefined &&
        pago.revisionEstado !== args.where.revisionEstado
      ) {
        return { count: 0 }
      }
      Object.assign(pago, args.data)
      return { count: 1 }
    }
  )

  const pagoFindFirst = vi.fn(
    async (args: {
      where: {
        hitoId?: string
        estadoPago?: string
        id?: { not?: string }
      }
      select?: Fila
    }) => {
      for (const pago of store.pagos.values()) {
        if (
          args.where.hitoId !== undefined &&
          pago.hitoId !== args.where.hitoId
        ) {
          continue
        }
        if (
          args.where.estadoPago !== undefined &&
          pago.estadoPago !== args.where.estadoPago
        ) {
          continue
        }
        if (
          args.where.id?.not !== undefined &&
          pago.id === args.where.id.not
        ) {
          continue
        }
        return { id: pago.id }
      }
      return null
    }
  )

  const hitoUpdateMany = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const hito = store.hitos.get(args.where.id)
      if (!hito) return { count: 0 }
      Object.assign(hito, args.data)
      return { count: 1 }
    }
  )

  const suscripcionFindUnique = vi.fn(
    async (args: { where: { id: string } }) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      return suscripcion ? structuredClone(suscripcion) : null
    }
  )

  const suscripcionUpdateMany = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      if (!suscripcion) return { count: 0 }
      Object.assign(suscripcion, args.data)
      return { count: 1 }
    }
  )

  const ajustePagoFindMany = vi.fn(
    async (args: { where: { pagoId: string }; select?: Fila }) => {
      return store.ajustes
        .filter((ajuste) => ajuste.pagoId === args.where.pagoId)
        .map((ajuste) => ({ monto: ajuste.monto as number }))
    }
  )

  const ajustePagoCreate = vi.fn(
    async (args: { data: Fila; select?: Fila }) => {
      const ajuste = {
        id: `ajuste_${store.ajustes.length + 1}`,
        ...structuredClone(args.data),
      }
      store.ajustes.push(ajuste)
      return { id: ajuste.id }
    }
  )

  type TxFalso = {
    pago: {
      findUnique: typeof pagoFindUnique
      findFirst: typeof pagoFindFirst
      updateMany: typeof pagoUpdateMany
    }
    hito: { updateMany: typeof hitoUpdateMany }
    suscripcion: {
      findUnique: typeof suscripcionFindUnique
      updateMany: typeof suscripcionUpdateMany
    }
    ajustePago: {
      findMany: typeof ajustePagoFindMany
      create: typeof ajustePagoCreate
    }
  }

  const tx: TxFalso = {
    pago: {
      findUnique: pagoFindUnique,
      findFirst: pagoFindFirst,
      updateMany: pagoUpdateMany,
    },
    hito: { updateMany: hitoUpdateMany },
    suscripcion: {
      findUnique: suscripcionFindUnique,
      updateMany: suscripcionUpdateMany,
    },
    ajustePago: {
      findMany: ajustePagoFindMany,
      create: ajustePagoCreate,
    },
  }

  const $transaction = vi.fn(
    async (fn: (tx: TxFalso) => Promise<unknown>) => {
      const snapshot = snapshotStore()
      try {
        return await fn(tx)
      } catch (error) {
        restoreStore(snapshot)
        throw error
      }
    }
  )

  return {
    store,
    $transaction,
    pagoFindUnique,
    pagoFindFirst,
    pagoUpdateMany,
    hitoUpdateMany,
    suscripcionFindUnique,
    suscripcionUpdateMany,
    ajustePagoFindMany,
    ajustePagoCreate,
    requireAdmin: vi.fn(),
    rateLimit: vi.fn(),
    sentryCaptureException: vi.fn(),
    loggerDebug: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  }
})

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.sentryCaptureException,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    pago: {
      findUnique: mocks.pagoFindUnique,
      findFirst: mocks.pagoFindFirst,
      updateMany: mocks.pagoUpdateMany,
    },
    hito: { updateMany: mocks.hitoUpdateMany },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      updateMany: mocks.suscripcionUpdateMany,
    },
    ajustePago: {
      findMany: mocks.ajustePagoFindMany,
      create: mocks.ajustePagoCreate,
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

import { POST } from "@/app/api/admin/paypal/ajustes/route"
import { addMonths } from "@/lib/pagos"
import {
  registrarAjustePaypal,
  type RegistrarAjustePaypalInput,
} from "@/lib/paypal/adjustments"

const PAGO_HITO = "pago_1"
const PAGO_SOPORTE = "pago_soporte"
const PAGO_MP = "pago_mp"
const HITO_1 = "hito_1"
const HITO_2 = "hito_2"
const SUSC_1 = "suscripcion_1"

const PAGADO_EN = new Date("2026-10-01T12:00:00.000Z")
const PROXIMO_PAGO = new Date("2030-01-15T12:00:00.000Z")
const RECIBO_HITO = "PAY-20261001-ABCDEF123456"
const RECIBO_SOPORTE = "PAY-20261002-ABCDEF123456"
const CAPTURE = "3C679366HH908993F"
const ORDER = "5O190127TN364715T"

const ADMIN = {
  id: "admin_1",
  clerkUserId: "admin_1",
  nombre: "Ana Admin",
  email: "admin@example.com",
  activo: true,
}

function body(overrides: Fila = {}): Fila {
  return {
    pagoId: PAGO_HITO,
    tipo: "REEMBOLSO",
    montoCents: 10656,
    motivo: "Cliente solicito reembolso",
    evidencia: "ID de reembolso de PayPal",
    decision: "NINGUNA",
    mesesDescontados: null,
    ...overrides,
  }
}

function request(payload: unknown): Request {
  return new Request("https://pixelarch.dev/api/admin/paypal/ajustes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function pago(id: string): Fila {
  return mocks.store.pagos.get(id) as Fila
}

function hito(id: string): Fila {
  return mocks.store.hitos.get(id) as Fila
}

function suscripcion(): Fila {
  return mocks.store.suscripciones.get(SUSC_1) as Fila
}

function expectPagoHitoIntacto() {
  expect(pago(PAGO_HITO)).toEqual(
    expect.objectContaining({
      hitoId: HITO_1,
      suscripcionId: null,
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      moneda: "usd",
      reciboId: RECIBO_HITO,
      reciboEmitidoEn: PAGADO_EN,
      externalId: CAPTURE,
      paypalOrderId: ORDER,
      metodo: "PAYPAL",
      origen: "AUTOMATICO",
      feeBps: 540,
      feeFixedCents: 30,
      revisionEstado: null,
      revisionNota: null,
      registradoPor: "Webhook PayPal",
    })
  )
}

function expectPagoSoporteIntacto() {
  expect(pago(PAGO_SOPORTE)).toEqual(
    expect.objectContaining({
      hitoId: null,
      suscripcionId: SUSC_1,
      monto: 20000,
      montoAcordado: 18868,
      comision: 1132,
      montoEsperado: 20000,
      moneda: "usd",
      reciboId: RECIBO_SOPORTE,
      reciboEmitidoEn: PAGADO_EN,
      externalId: "CAPTURE-SOPORTE",
      paypalOrderId: "ORDER-SOPORTE",
      meses: 2,
      metodo: "PAYPAL",
      origen: "AUTOMATICO",
      feeBps: 540,
      feeFixedCents: 30,
      revisionEstado: null,
      revisionNota: null,
      registradoPor: "Webhook PayPal",
    })
  )
}

function resetStore() {
  mocks.store.pagos.clear()
  mocks.store.hitos.clear()
  mocks.store.suscripciones.clear()
  mocks.store.ajustes.length = 0

  mocks.store.pagos.set(PAGO_HITO, {
    id: PAGO_HITO,
    clienteId: "cliente_1",
    hitoId: HITO_1,
    suscripcionId: null,
    pasarela: "PAYPAL",
    estadoPago: "SUCCEEDED",
    monto: 10656,
    montoAcordado: 10050,
    comision: 606,
    montoEsperado: 10656,
    moneda: "usd",
    reciboId: RECIBO_HITO,
    reciboEmitidoEn: PAGADO_EN,
    externalId: CAPTURE,
    paypalOrderId: ORDER,
    meses: null,
    metodo: "PAYPAL",
    origen: "AUTOMATICO",
    feeBps: 540,
    feeFixedCents: 30,
    revisionEstado: null,
    revisionNota: null,
    registradoPor: "Webhook PayPal",
  })

  mocks.store.pagos.set(PAGO_SOPORTE, {
    id: PAGO_SOPORTE,
    clienteId: "cliente_1",
    hitoId: null,
    suscripcionId: SUSC_1,
    pasarela: "PAYPAL",
    estadoPago: "SUCCEEDED",
    monto: 20000,
    montoAcordado: 18868,
    comision: 1132,
    montoEsperado: 20000,
    moneda: "usd",
    reciboId: RECIBO_SOPORTE,
    reciboEmitidoEn: PAGADO_EN,
    externalId: "CAPTURE-SOPORTE",
    paypalOrderId: "ORDER-SOPORTE",
    meses: 2,
    metodo: "PAYPAL",
    origen: "AUTOMATICO",
    feeBps: 540,
    feeFixedCents: 30,
    revisionEstado: null,
    revisionNota: null,
    registradoPor: "Webhook PayPal",
  })

  mocks.store.pagos.set(PAGO_MP, {
    id: PAGO_MP,
    clienteId: "cliente_1",
    hitoId: HITO_2,
    suscripcionId: null,
    pasarela: "MERCADOPAGO",
    estadoPago: "SUCCEEDED",
    monto: 5000,
    montoAcordado: 5000,
    comision: 0,
    montoEsperado: 5000,
    moneda: "ars",
    reciboId: null,
    externalId: "mp-123",
    paypalOrderId: null,
    meses: null,
  })

  mocks.store.hitos.set(HITO_1, {
    id: HITO_1,
    estado: "PAGADO",
    pagadoEn: PAGADO_EN,
    monto: 10656,
    mpLink: "https://mp.example/hito-1",
  })

  mocks.store.hitos.set(HITO_2, {
    id: HITO_2,
    estado: "PAGADO",
    pagadoEn: PAGADO_EN,
    monto: 5000,
    mpLink: "https://mp.example/hito-2",
  })

  mocks.store.suscripciones.set(SUSC_1, {
    id: SUSC_1,
    estado: "ACTIVE",
    proximoPago: PROXIMO_PAGO,
    pastDueEn: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()

  mocks.requireAdmin.mockResolvedValue(ADMIN)
  mocks.rateLimit.mockReturnValue(true)
})

describe("POST /api/admin/paypal/ajustes: permisos y rate limit (AC-17)", () => {
  it("responde 403 a la asistente o a un usuario sin rol admin sin tocar la base", async () => {
    mocks.requireAdmin.mockResolvedValue(null)

    const res = await POST(request(body()))

    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: "No autorizado" })
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1)
    expect(mocks.$transaction).not.toHaveBeenCalled()
    expect(mocks.pagoFindUnique).not.toHaveBeenCalled()
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
  })

  it("aplica rate limit de 20/min antes de autenticar", async () => {
    mocks.rateLimit.mockReturnValue(false)

    const res = await POST(request(body()))

    expect(res.status).toBe(429)
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      expect.stringContaining("admin-paypal-ajustes:"),
      20,
      60_000
    )
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/ajustes: validacion (AC-22)", () => {
  it("responde 400 con JSON invalido", async () => {
    const res = await POST(request("{"))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "JSON invalido" })
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
  })

  it.each([
    ["sin pagoId", body({ pagoId: "" })],
    ["con pagoId demasiado largo", body({ pagoId: "x".repeat(101) })],
    ["con tipo invalido", body({ tipo: "OTRO" })],
    ["con monto en cero", body({ montoCents: 0 })],
    ["con monto negativo", body({ montoCents: -1 })],
    ["con monto decimal", body({ montoCents: 10.5 })],
    ["con monto no numerico", body({ montoCents: "100" })],
    ["con monto fuera de Int32", body({ montoCents: 2_147_483_648 })],
    ["sin decision", body({ decision: null })],
    ["con decision invalida", body({ decision: "REVERTIR_TODO" })],
    [
      "con DESCONTAR_MESES sin meses",
      body({ decision: "DESCONTAR_MESES" }),
    ],
    [
      "con DESCONTAR_MESES y meses 0",
      body({ decision: "DESCONTAR_MESES", mesesDescontados: 0 }),
    ],
    [
      "con DESCONTAR_MESES y meses 13",
      body({ decision: "DESCONTAR_MESES", mesesDescontados: 13 }),
    ],
    [
      "con DESCONTAR_MESES y meses decimal",
      body({ decision: "DESCONTAR_MESES", mesesDescontados: 1.5 }),
    ],
    ["con NINGUNA y meses", body({ mesesDescontados: 2 })],
    [
      "con REVERTIR_HITO y meses",
      body({ decision: "REVERTIR_HITO", mesesDescontados: 1 }),
    ],
    ["sin motivo ni evidencia", body({ motivo: null, evidencia: null })],
    ["con motivo no textual", body({ motivo: 123 })],
    [
      "con evidencia demasiado larga",
      body({ evidencia: "x".repeat(2_001) }),
    ],
    [
      "con PII del pagador en un campo extra",
      body({ pagadorEmail: "pagador@example.com" }),
    ],
    ["con un campo desconocido", body({ campoExtra: true })],
  ])("responde 400 %s sin crear el ajuste", async (_caso, payload) => {
    const res = await POST(request(payload))

    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ error: "Datos invalidos" })
    expect(mocks.$transaction).not.toHaveBeenCalled()
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
  })

  it("acepta un email en la evidencia pero no lo loguea (AC-19)", async () => {
    const res = await POST(
      request(body({ evidencia: "Reembolsado a pagador@example.com" }))
    )

    expect(res.status).toBe(200)
    expect(mocks.ajustePagoCreate).toHaveBeenCalledTimes(1)
    expect(mocks.store.ajustes[0].evidencia).toContain("pagador@example.com")
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "pagador@example.com"
    )
  })

  it("acepta un motivo con email y rechaza caracteres de control (AC-19)", async () => {
    const conEmail = await POST(
      request(body({ motivo: "Contacto: pagador@example.com" }))
    )
    expect(conEmail.status).toBe(200)
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain(
      "pagador@example.com"
    )

    const conControl = await POST(
      request(body({ evidencia: "reembolso\u0000ok" }))
    )
    expect(conControl.status).toBe(400)

    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "pagador@example.com"
    )
  })
})

describe("POST /api/admin/paypal/ajustes: pago y coherencia (AC-17, AC-22)", () => {
  it("responde 404 si el pago no existe", async () => {
    const res = await POST(request(body({ pagoId: "no_existe" })))

    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: "Pago PayPal no encontrado." })
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
  })

  it("responde 404 y no toca un pago de Mercado Pago", async () => {
    const res = await POST(request(body({ pagoId: PAGO_MP })))

    expect(res.status).toBe(404)
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_MP).estadoPago).toBe("SUCCEEDED")
    expect(hito(HITO_2).estado).toBe("PAGADO")
  })

  it("rechaza REVERTIR_HITO sobre un pago de soporte", async () => {
    const res = await POST(
      request(
        body({ pagoId: PAGO_SOPORTE, decision: "REVERTIR_HITO" })
      )
    )

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("no es compatible")
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_SOPORTE).estadoPago).toBe("SUCCEEDED")
  })

  it("rechaza DESCONTAR_MESES sobre un pago de hito", async () => {
    const res = await POST(
      request(
        body({ decision: "DESCONTAR_MESES", mesesDescontados: 2 })
      )
    )

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("no es compatible")
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
  })
})

describe("POST /api/admin/paypal/ajustes: estado del pago (AC-22)", () => {
  it.each(["FAILED", "PENDING", "REFUNDED", "CONTRACARGO"] as const)(
    "rechaza con 409 un pago en estado %s",
    async (estadoPago) => {
      mocks.store.pagos.set(PAGO_HITO, {
        ...pago(PAGO_HITO),
        estadoPago,
        revisionEstado: null,
      })

      const res = await POST(request(body()))

      expect(res.status).toBe(409)
      expect((await json(res)).error).toContain("estado ajustable")
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
      expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
      expect(pago(PAGO_HITO).estadoPago).toBe(estadoPago)
    }
  )

  it.each([null, "PENDIENTE", "ACEPTADO"] as const)(
    "rechaza un pago en REVISION con revisionEstado %s",
    async (revisionEstado) => {
      mocks.store.pagos.set(PAGO_HITO, {
        ...pago(PAGO_HITO),
        estadoPago: "REVISION",
        revisionEstado,
      })

      const res = await POST(request(body()))

      expect(res.status).toBe(409)
      expect((await json(res)).error).toContain("estado ajustable")
      expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
      expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
      expect(pago(PAGO_HITO).estadoPago).toBe("REVISION")
    }
  )

  it("acepta un pago en REVISION rechazado e incluye revisionEstado en el where", async () => {
    mocks.store.pagos.set(PAGO_HITO, {
      ...pago(PAGO_HITO),
      estadoPago: "REVISION",
      revisionEstado: "RECHAZADO",
    })

    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expect(pago(PAGO_HITO).estadoPago).toBe("REFUNDED")
    expect(mocks.pagoUpdateMany).toHaveBeenCalledWith({
      where: {
        id: PAGO_HITO,
        pasarela: "PAYPAL",
        estadoPago: "REVISION",
        revisionEstado: "RECHAZADO",
      },
      data: { estadoPago: "REFUNDED" },
    })
  })
})

describe("POST /api/admin/paypal/ajustes: tope del monto (AC-22)", () => {
  it("acepta un ajuste por el monto exacto del pago", async () => {
    const res = await POST(request(body({ montoCents: 10_656 })))

    expect(res.status).toBe(200)
    expect(mocks.store.ajustes[0].monto).toBe(10_656)
    expect(pago(PAGO_HITO).estadoPago).toBe("REFUNDED")
  })

  it("rechaza con 400 un monto mayor al pago", async () => {
    const res = await POST(request(body({ montoCents: 10_657 })))

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("supera")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
  })

  it("rechaza el monto Int32 maximo si supera el pago", async () => {
    const res = await POST(request(body({ montoCents: 2_147_483_647 })))

    expect(res.status).toBe(400)
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
  })

  it("limita la suma acumulada de dos ajustes del mismo pago", async () => {
    mocks.store.ajustes.push({
      id: "ajuste_previo",
      pagoId: PAGO_HITO,
      tipo: "REEMBOLSO",
      monto: 6_000,
      motivo: "Ajuste previo",
      evidencia: "REF-PREVIA",
      decision: "NINGUNA",
      mesesDescontados: null,
      registradoPor: "Admin",
      creadoEn: new Date("2026-10-01T12:00:00.000Z"),
    })

    const excedido = await POST(request(body({ montoCents: 4_657 })))
    expect(excedido.status).toBe(400)
    expect((await json(excedido)).error).toContain("supera")
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")

    const exacto = await POST(request(body({ montoCents: 4_656 })))
    expect(exacto.status).toBe(200)

    expect(mocks.store.ajustes).toHaveLength(2)
    const total = mocks.store.ajustes.reduce(
      (suma, ajuste) => suma + (ajuste.monto as number),
      0
    )
    expect(total).toBe(10_656)
  })
})

describe("POST /api/admin/paypal/ajustes: NINGUNA (AC-22)", () => {
  it("registra el reembolso, pasa el pago a REFUNDED y no toca el hito", async () => {
    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      ok: true,
      ajusteId: "ajuste_1",
      pagoId: PAGO_HITO,
      estadoPago: "REFUNDED",
      decision: "NINGUNA",
      mesesDescontados: null,
    })
    expect(res.headers.get("cache-control")).toBe("no-store")

    expect(pago(PAGO_HITO).estadoPago).toBe("REFUNDED")
    expectPagoHitoIntacto()

    // Solo cambia estadoPago: montos, desglose, recibo y referencias quedan
    // intactos, y no se tocan los links de Mercado Pago del hito.
    expect(mocks.pagoUpdateMany).toHaveBeenCalledWith({
      where: {
        id: PAGO_HITO,
        pasarela: "PAYPAL",
        estadoPago: "SUCCEEDED",
      },
      data: { estadoPago: "REFUNDED" },
    })
    expect(hito(HITO_1).mpLink).toBe("https://mp.example/hito-1")

    expect(hito(HITO_1).estado).toBe("PAGADO")
    expect(hito(HITO_1).pagadoEn).toEqual(PAGADO_EN)
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()

    expect(mocks.store.ajustes).toHaveLength(1)
    expect(mocks.store.ajustes[0]).toEqual({
      id: "ajuste_1",
      pagoId: PAGO_HITO,
      tipo: "REEMBOLSO",
      monto: 10656,
      motivo: "Cliente solicito reembolso",
      evidencia: "ID de reembolso de PayPal",
      decision: "NINGUNA",
      mesesDescontados: null,
      registradoPor: "Ana Admin",
      creadoEn: expect.any(Date),
    })
  })

  it("registra un contracargo y deja el pago en CONTRACARGO", async () => {
    const res = await POST(
      request(
        body({
          tipo: "CONTRACARGO",
          motivo: "Contracargo informado por PayPal",
          evidencia: "Disputa PP-D-123",
        })
      )
    )

    expect(res.status).toBe(200)
    expect((await json(res)).estadoPago).toBe("CONTRACARGO")
    expect(pago(PAGO_HITO).estadoPago).toBe("CONTRACARGO")
    expectPagoHitoIntacto()
    expect(mocks.store.ajustes[0]).toEqual(
      expect.objectContaining({
        tipo: "CONTRACARGO",
        decision: "NINGUNA",
        motivo: "Contracargo informado por PayPal",
        evidencia: "Disputa PP-D-123",
        mesesDescontados: null,
      })
    )
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/ajustes: REVERTIR_HITO (AC-22)", () => {
  it("vuelve el hito del pago a PENDIENTE sin tocar otros hitos ni montos", async () => {
    const res = await POST(
      request(body({ decision: "REVERTIR_HITO" }))
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual(
      expect.objectContaining({
        ok: true,
        pagoId: PAGO_HITO,
        estadoPago: "REFUNDED",
        decision: "REVERTIR_HITO",
        mesesDescontados: null,
      })
    )

    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(hito(HITO_1).pagadoEn).toBeNull()
    expect(mocks.hitoUpdateMany).toHaveBeenCalledWith({
      where: { id: HITO_1 },
      data: { estado: "PENDIENTE", pagadoEn: null },
    })

    // Solo el hito del pago: el otro hito y el pago de MP quedan intactos,
    // incluido el link MP del hito revertido.
    expect(hito(HITO_1).mpLink).toBe("https://mp.example/hito-1")
    expect(hito(HITO_2).estado).toBe("PAGADO")
    expect(hito(HITO_2).pagadoEn).toEqual(PAGADO_EN)
    expect(hito(HITO_2).mpLink).toBe("https://mp.example/hito-2")
    expect(pago(PAGO_MP).estadoPago).toBe("SUCCEEDED")

    expect(pago(PAGO_HITO).estadoPago).toBe("REFUNDED")
    expectPagoHitoIntacto()
    expect(suscripcion()).toEqual(
      expect.objectContaining({
        estado: "ACTIVE",
        proximoPago: PROXIMO_PAGO,
        pastDueEn: null,
      })
    )
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()

    expect(mocks.store.ajustes[0]).toEqual(
      expect.objectContaining({
        decision: "REVERTIR_HITO",
        mesesDescontados: null,
      })
    )
  })

  it("rechaza REVERTIR_HITO si otro Pago SUCCEEDED apunta al mismo hito", async () => {
    const PAGO_HITO_2 = "pago_hito_2"
    mocks.store.pagos.set(PAGO_HITO_2, {
      ...pago(PAGO_HITO),
      id: PAGO_HITO_2,
      monto: 5_000,
      montoAcordado: 4_700,
      comision: 300,
      montoEsperado: 5_000,
      externalId: "CAPTURE-HITO-2",
      paypalOrderId: "ORDER-HITO-2",
      reciboId: "PAY-20261001-HITO2",
    })

    const res = await POST(
      request(body({ decision: "REVERTIR_HITO" }))
    )

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("otro pago")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.pagoFindFirst).toHaveBeenCalledWith({
      where: {
        hitoId: HITO_1,
        estadoPago: "SUCCEEDED",
        id: { not: PAGO_HITO },
      },
      select: { id: true },
    })

    // No se escribe nada: ni ajuste, ni estado del pago, ni hito.
    expect(mocks.ajustePagoCreate).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.store.ajustes).toHaveLength(0)
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
    expect(hito(HITO_1).estado).toBe("PAGADO")
    expect(hito(HITO_1).pagadoEn).toEqual(PAGADO_EN)
  })
})

describe("POST /api/admin/paypal/ajustes: DESCONTAR_MESES (AC-22)", () => {
  it("resta los meses del proximoPago con addMonths y lo deja vigente si sigue futuro", async () => {
    const proximoPago = addMonths(new Date(), 8)
    mocks.store.suscripciones.set(SUSC_1, {
      id: SUSC_1,
      estado: "ACTIVE",
      proximoPago,
      pastDueEn: null,
    })

    const res = await POST(
      request(
        body({
          pagoId: PAGO_SOPORTE,
          decision: "DESCONTAR_MESES",
          mesesDescontados: 2,
        })
      )
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual(
      expect.objectContaining({
        pagoId: PAGO_SOPORTE,
        estadoPago: "REFUNDED",
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
      })
    )

    expect(suscripcion().proximoPago).toEqual(addMonths(proximoPago, -2))
    expect(suscripcion().estado).toBe("ACTIVE")
    expect(suscripcion().pastDueEn).toBeNull()

    expect(pago(PAGO_SOPORTE).estadoPago).toBe("REFUNDED")
    expectPagoSoporteIntacto()
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()

    expect(mocks.store.ajustes[0]).toEqual(
      expect.objectContaining({
        pagoId: PAGO_SOPORTE,
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
      })
    )
  })

  it("restaura ACTIVE y limpia pastDueEn si estaba en mora y queda futuro", async () => {
    const proximoPago = addMonths(new Date(), 8)
    const pastDueOriginal = new Date("2026-01-01T12:00:00.000Z")
    mocks.store.suscripciones.set(SUSC_1, {
      id: SUSC_1,
      estado: "PAST_DUE",
      proximoPago,
      pastDueEn: pastDueOriginal,
    })

    const res = await POST(
      request(
        body({
          pagoId: PAGO_SOPORTE,
          decision: "DESCONTAR_MESES",
          mesesDescontados: 2,
        })
      )
    )

    expect(res.status).toBe(200)
    expect(suscripcion().proximoPago).toEqual(addMonths(proximoPago, -2))
    expect(suscripcion().estado).toBe("ACTIVE")
    expect(suscripcion().pastDueEn).toBeNull()
    expect(mocks.suscripcionUpdateMany).toHaveBeenCalledWith({
      where: { id: SUSC_1 },
      data: {
        proximoPago: addMonths(proximoPago, -2),
        estado: "ACTIVE",
        pastDueEn: null,
      },
    })
  })

  it("conserva la fecha calculada y marca PAST_DUE si el descuento la deja vencida", async () => {    const proximoPago = addMonths(new Date(), 1)
    const pastDueOriginal = new Date("2026-01-01T12:00:00.000Z")
    mocks.store.suscripciones.set(SUSC_1, {
      id: SUSC_1,
      estado: "ACTIVE",
      proximoPago,
      pastDueEn: pastDueOriginal,
    })

    const res = await POST(
      request(
        body({
          pagoId: PAGO_SOPORTE,
          tipo: "CONTRACARGO",
          decision: "DESCONTAR_MESES",
          mesesDescontados: 3,
        })
      )
    )

    expect(res.status).toBe(200)
    expect(suscripcion().proximoPago).toEqual(addMonths(proximoPago, -3))
    expect(suscripcion().estado).toBe("PAST_DUE")
    // Se conserva el pastDueEn previo, no se inventa una fecha negativa.
    expect(suscripcion().pastDueEn).toEqual(pastDueOriginal)
    expect(pago(PAGO_SOPORTE).estadoPago).toBe("CONTRACARGO")
    expectPagoSoporteIntacto()
  })

  it("responde 409 y revierte todo si el soporte no tiene vencimiento", async () => {
    mocks.store.suscripciones.set(SUSC_1, {
      id: SUSC_1,
      estado: "ACTIVE",
      proximoPago: null,
      pastDueEn: null,
    })

    const res = await POST(
      request(
        body({
          pagoId: PAGO_SOPORTE,
          decision: "DESCONTAR_MESES",
          mesesDescontados: 1,
        })
      )
    )

    expect(res.status).toBe(409)
    expect((await json(res)).error).toContain("vencimiento")
    // El ajuste y el cambio de estado se intentaron dentro de la transaccion,
    // pero al fallar el vencimiento se revierte todo: nada queda persistido.
    expect(mocks.store.ajustes).toHaveLength(0)
    expect(pago(PAGO_SOPORTE).estadoPago).toBe("SUCCEEDED")
    expect(suscripcion().proximoPago).toBeNull()
  })
})

describe("POST /api/admin/paypal/ajustes: privacidad y sin automatismo (AC-19, AC-22)", () => {
  it("no loguea motivo, evidencia ni datos del pagador", async () => {
    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1)

    const meta = mocks.loggerInfo.mock.calls[0][1] as Fila
    expect(meta).not.toHaveProperty("motivo")
    expect(meta).not.toHaveProperty("evidencia")
    expect(meta).not.toHaveProperty("pagadorEmail")
    expect(JSON.stringify(meta)).not.toContain("@")
  })

  it("ignora campos extra del caller y no persiste PII en el ajuste", async () => {
    const entrada = {
      pagoId: PAGO_HITO,
      tipo: "REEMBOLSO",
      montoCents: 5000,
      motivo: "Reembolso parcial",
      evidencia: "REF-123",
      decision: "NINGUNA",
      registradoPor: "Ana Admin",
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador Ejemplo",
    } as RegistrarAjustePaypalInput & {
      pagadorEmail: string
      pagadorNombre: string
    }

    const resultado = await registrarAjustePaypal(entrada, {
      ahora: new Date("2026-10-26T12:00:00.000Z"),
    })

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(mocks.store.ajustes).toHaveLength(1)

    const ajuste = mocks.store.ajustes[0]
    expect(Object.keys(ajuste).sort()).toEqual(
      [
        "creadoEn",
        "decision",
        "evidencia",
        "id",
        "mesesDescontados",
        "monto",
        "motivo",
        "pagoId",
        "registradoPor",
        "tipo",
      ].sort()
    )
    expect(JSON.stringify(ajuste)).not.toContain("pagador")
    expect(JSON.stringify(ajuste)).not.toContain("@")
    expectPagoHitoIntacto()
  })

  it("con decision NINGUNA no aplica ningun cambio automatico al concepto", async () => {
    const res = await POST(
      request(body({ pagoId: PAGO_SOPORTE, decision: "NINGUNA" }))
    )

    expect(res.status).toBe(200)
    expect(suscripcion()).toEqual(
      expect.objectContaining({
        estado: "ACTIVE",
        proximoPago: PROXIMO_PAGO,
        pastDueEn: null,
      })
    )
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_SOPORTE).estadoPago).toBe("REFUNDED")
  })
})

describe("POST /api/admin/paypal/ajustes: bordes y errores (AC-19, AC-22)", () => {
  it("rechaza el monto Int32 maximo porque supera el pago", async () => {
    const res = await POST(request(body({ montoCents: 2_147_483_647 })))

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain("supera")
    expect(mocks.store.ajustes).toHaveLength(0)
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
    expectPagoHitoIntacto()
  })

  it("responde 500, reporta a Sentry y no loguea motivo, evidencia ni PII", async () => {
    mocks.ajustePagoCreate.mockRejectedValueOnce(
      new Error("fallo con pagador@example.com")
    )

    const res = await POST(
      request(
        body({
          motivo: "Juan Perez solicito el reembolso",
          evidencia: "comprobante privado",
        })
      )
    )

    expect(res.status).toBe(500)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await json(res)).toEqual({
      error: "Error al registrar el ajuste de PayPal.",
    })
    expect(mocks.sentryCaptureException).toHaveBeenCalledTimes(1)

    const logs = [
      ...mocks.loggerError.mock.calls,
      ...mocks.loggerWarn.mock.calls,
    ]
    expect(JSON.stringify(logs)).not.toContain("pagador@example.com")
    expect(JSON.stringify(logs)).not.toContain("Juan Perez")
    expect(JSON.stringify(logs)).not.toContain("comprobante")
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
    expect(mocks.store.ajustes).toHaveLength(0)
  })
})
