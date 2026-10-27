import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-30 (AC-6, AC-7, AC-13, AC-15, AC-21): logica pura del webhook PayPal.
 *
 * No hay red ni base: se inyectan el cliente Prisma, las llamadas a PayPal y el
 * procesador. Se cubren parseo seguro (sin PII/payload), idempotencia por
 * `eventoId`, reintento de eventos `ERROR`, dispatch de ordenes/capturas,
 * intento rechazado, reembolsos/disputas y el registro tecnico de firma
 * invalida con id sintetico.
 */

type Fila = Record<string, unknown>

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ResultadoProcesamientoPaypal } from "@/lib/paypal/process"
import {
  registrarEventoPasarela,
  type EventoPasarelaClient,
} from "@/lib/paypal/events"
import {
  EVENTO_CAPTURE_COMPLETED,
  EVENTO_ORDER_APPROVED,
  parsearEventoPaypal,
  procesarEventoPaypal,
  registrarFirmaInvalida,
  type PaypalWebhookDeps,
} from "@/lib/paypal/webhook"

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const PII_EMAIL = "pagador@example.com"
const PII_NOMBRE = "Ana Perez"

function errorUnico(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

function enlaceBase(overrides: Fila = {}): Fila {
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

function capturaBase(overrides: Fila = {}): Fila {
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

function ordenBase(overrides: Fila = {}): Fila {
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
    id: "WH-CAPTURA-1",
    event_type: EVENTO_CAPTURE_COMPLETED,
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

function eventoOrden(overrides: Fila = {}): Fila {
  return {
    id: "WH-APROBADA-1",
    event_type: EVENTO_ORDER_APPROVED,
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

function resultadoProcesado(overrides: Fila = {}): ResultadoProcesamientoPaypal {
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
  } as ResultadoProcesamientoPaypal
}

function montarStore() {
  const eventos: Fila[] = []
  const updates: Fila[] = []
  let estadoEnlace = "ACTIVO"
  const pagos = new Map<string, string>()
  const creditos = new Map<string, number>()

  const eventoPasarela = {
    create: vi.fn(async (args: { data: Fila }) => {
      if (eventos.some((fila) => fila.eventoId === args.data.eventoId)) {
        throw errorUnico()
      }
      const fila = {
        id: `evento_${eventos.length + 1}`,
        creadoEn: AHORA,
        ...args.data,
      }
      eventos.push(fila)
      return fila
    }),
    findUnique: vi.fn(
      async (args: { where: { eventoId: string } }) =>
        eventos.find((fila) => fila.eventoId === args.where.eventoId) ?? null
    ),
  } as unknown as EventoPasarelaClient

  const enlacePago = {
    findUnique: vi.fn(
      async (args: { where: { externalId?: string; token?: string } }) => {
        if (args.where.externalId !== "ORDER-1" && args.where.token !== "token_1") {
          return null
        }
        return { ...enlaceBase(), estado: estadoEnlace }
      }
    ),
    update: vi.fn(async (args: Fila) => {
      updates.push(args)
      return {}
    }),
  }

  const pago = {
    findUnique: vi.fn(async (args: { where: { externalId?: string } }) => {
      if (args.where.externalId === "CAPTURE-1") {
        return { id: "pago_1", enlacePagoId: "enlace_1" }
      }
      return null
    }),
  }

  return {
    db: { eventoPasarela, enlacePago, pago },
    eventos,
    updates,
    pagos,
    creditos,
    getEstado: () => estadoEnlace,
    setEstado: (estado: string) => {
      estadoEnlace = estado
    },
  }
}

function procesadorQueRegistra(
  store: ReturnType<typeof montarStore>,
  opciones: { duplicado?: boolean } = {}
) {
  return async (
    captura: { captureId: string; orderId?: string | null; amountCents?: number | null; currency?: string | null },
    opcionesProc?: {
      ahora?: Date
      evento?: { eventoId: string; tipo?: string | null }
    }
  ): Promise<ResultadoProcesamientoPaypal> => {
    if (opciones.duplicado) {
      return {
        tipo: "DUPLICADO",
        duplicado: true,
        pagoId: "pago_1",
        enlaceId: "enlace_1",
        hitoId: "hito_1",
      }
    }

    const yaPagado = store.pagos.get(captura.captureId)
    if (yaPagado) {
      return {
        tipo: "DUPLICADO",
        duplicado: true,
        pagoId: yaPagado,
        enlaceId: "enlace_1",
        hitoId: "hito_1",
      }
    }

    store.pagos.set(captura.captureId, "pago_1")
    store.setEstado("PAGADO")
    store.creditos.set(
      "suscripcion_1",
      (store.creditos.get("suscripcion_1") ?? 0) + 1
    )

    const eventoId =
      opcionesProc?.evento?.eventoId ?? `PAYPAL:CAPTURA:${captura.captureId}`
    await registrarEventoPasarela(
      {
        eventoId,
        pasarela: "PAYPAL",
        tipo: opcionesProc?.evento?.tipo ?? EVENTO_CAPTURE_COMPLETED,
        externalId: captura.captureId,
        enlacePagoId: "enlace_1",
        pagoId: "pago_1",
        resultado: "PROCESADO",
        monto: captura.amountCents,
        moneda: captura.currency,
        procesadoEn: opcionesProc?.ahora,
      },
      {
        db: { eventoPasarela: store.db.eventoPasarela },
        ahora: opcionesProc?.ahora,
      }
    )

    return resultadoProcesado()
  }
}

function deps(
  store: ReturnType<typeof montarStore>,
  overrides: Partial<PaypalWebhookDeps> = {}
): PaypalWebhookDeps {
  return {
    db: store.db as unknown as PaypalWebhookDeps["db"],
    ahora: AHORA,
    getOrder: vi.fn(async () => ordenBase({ captures: [] }) as never),
    captureOrder: vi.fn(
      async () =>
        ordenBase({ status: "COMPLETED", captures: [capturaBase()] }) as never
    ),
    procesarCaptura: vi.fn(procesadorQueRegistra(store)) as never,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("parsearEventoPaypal", () => {
  it("extrae solo campos tecnicos y descarta PII/payload", () => {
    const parsed = parsearEventoPaypal(eventoCaptura())

    expect(parsed).toEqual({
      id: "WH-CAPTURA-1",
      tipo: "PAYMENT.CAPTURE.COMPLETED",
      resourceId: "CAPTURE-1",
      orderId: "ORDER-1",
      captureId: "CAPTURE-1",
      amountCents: 10656,
      currency: "USD",
      status: "COMPLETED",
      customId: "token_1",
      invoiceId: "token_1",
    })

    const serializado = JSON.stringify(parsed)
    expect(serializado).not.toContain(PII_EMAIL)
    expect(serializado).not.toContain(PII_NOMBRE)
    expect(Object.keys(parsed as object)).not.toContain("resource")
    expect(Object.keys(parsed as object)).not.toContain("payer")
  })

  it("parsea ordenes y disputas sin copiar el body", () => {
    const orden = parsearEventoPaypal(eventoOrden())
    expect(orden).toMatchObject({
      id: "WH-APROBADA-1",
      tipo: "CHECKOUT.ORDER.APPROVED",
      orderId: "ORDER-1",
      amountCents: 10656,
      currency: "USD",
      customId: "token_1",
      invoiceId: "token_1",
    })

    const disputa = parsearEventoPaypal({
      id: "WH-DISPUTA-1",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {
        id: "DISPUTE-1",
        status: "OPEN",
        disputed_transactions: [{ seller_transaction_id: "CAPTURE-1" }],
        disputed_transaction: {
          buyer: { email: PII_EMAIL, name: PII_NOMBRE },
        },
      },
    })
    expect(disputa).toMatchObject({
      resourceId: "DISPUTE-1",
      captureId: "CAPTURE-1",
      status: "OPEN",
    })
    expect(JSON.stringify(disputa)).not.toContain(PII_EMAIL)
    expect(JSON.stringify(disputa)).not.toContain(PII_NOMBRE)
  })

  it("devuelve null sin id, sin tipo o con tipo no seguro", () => {
    expect(parsearEventoPaypal(null)).toBeNull()
    expect(parsearEventoPaypal({})).toBeNull()
    expect(
      parsearEventoPaypal({ id: "WH-1", event_type: "TIPO CON ESPACIOS" })
    ).toBeNull()
    expect(
      parsearEventoPaypal({ id: "", event_type: "PAYMENT.CAPTURE.COMPLETED" })
    ).toBeNull()
  })
})

describe("procesarEventoPaypal", () => {
  it("procesa una captura una sola vez por evento repetido", async () => {
    const store = montarStore()
    const dependencias = deps(store)

    const primera = await procesarEventoPaypal(eventoCaptura(), dependencias)
    const segunda = await procesarEventoPaypal(eventoCaptura(), dependencias)

    expect(primera).toMatchObject({ estado: "PROCESADO", duplicate: false })
    expect(segunda).toMatchObject({ estado: "PROCESADO", duplicate: true })
    expect(store.pagos.size).toBe(1)
    expect(store.creditos.get("suscripcion_1")).toBe(1)
    expect(dependencias.procesarCaptura).toHaveBeenCalledTimes(1)
  })

  it("no duplica el pago si cambia el evento pero repite el capture id", async () => {
    const store = montarStore()
    const dependencias = deps(store)

    const primera = await procesarEventoPaypal(
      eventoCaptura({ id: "WH-1" }),
      dependencias
    )
    const segunda = await procesarEventoPaypal(
      eventoCaptura({ id: "WH-2" }),
      dependencias
    )

    expect(primera.estado).toBe("PROCESADO")
    expect(segunda).toMatchObject({ estado: "DUPLICADO", duplicate: true })
    expect(store.pagos.size).toBe(1)
    expect(store.creditos.get("suscripcion_1")).toBe(1)
    expect(dependencias.procesarCaptura).toHaveBeenCalledTimes(2)
  })

  it("reintenta un evento que quedo en ERROR en lugar de tomarlo como duplicado", async () => {
    const store = montarStore()
    store.eventos.push({
      id: "evento_error",
      eventoId: "WH-CAPTURA-1",
      resultado: "ERROR",
      tipo: "PAYMENT.CAPTURE.COMPLETED",
    })

    const res = await procesarEventoPaypal(
      eventoCaptura(),
      deps(store, { procesarCaptura: vi.fn(procesadorQueRegistra(store)) as never })
    )

    expect(res.estado).toBe("PROCESADO")
    expect(store.pagos.size).toBe(1)
  })

  it("un evento desconocido queda ignorado y no se reprocesa", async () => {
    const store = montarStore()
    const dependencias = deps(store)
    const evento = {
      id: "WH-RARO-1",
      event_type: "SOMETHING.NEW",
      resource: { id: "RESOURCE-1", payer: { email_address: PII_EMAIL } },
    }

    const primera = await procesarEventoPaypal(evento, dependencias)
    const segunda = await procesarEventoPaypal(evento, dependencias)

    expect(primera).toMatchObject({ estado: "IGNORADO", ignored: true })
    expect(segunda).toMatchObject({ duplicate: true })
    expect(store.eventos).toHaveLength(1)
    expect(JSON.stringify(store.eventos)).not.toContain(PII_EMAIL)
  })

  it("resuelve el link por token cuando falta el order id del capture", async () => {
    const store = montarStore()
    const dependencias = deps(store)
    const evento = eventoCaptura({
      resource: {
        id: "CAPTURE-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "106.56" },
        custom_id: "token_1",
        invoice_id: "token_1",
      },
    })

    const res = await procesarEventoPaypal(evento, dependencias)

    expect(res.estado).toBe("PROCESADO")
    const llamadas = (
      dependencias.procesarCaptura as unknown as {
        mock: { calls: Array<[Fila, Fila]> }
      }
    ).mock.calls
    expect(llamadas[0][0].orderId).toBe("ORDER-1")
  })

  it("una captura sin link se ignora sin llamar al procesador", async () => {
    const store = montarStore()
    const dependencias = deps(store, {
      getOrder: vi.fn(async () => ordenBase({ customId: null, invoiceId: null }) as never),
    })
    store.db.enlacePago.findUnique = vi.fn(async () => null)

    const res = await procesarEventoPaypal(
      eventoCaptura({ resource: { id: "CAPTURE-1", status: "COMPLETED" } }),
      dependencias
    )

    expect(res).toMatchObject({ estado: "IGNORADO", ignored: true })
    expect(dependencias.procesarCaptura).not.toHaveBeenCalled()
    expect(store.eventos[0]).toMatchObject({
      resultado: "IGNORADO",
      motivo: "ENLACE_NO_ENCONTRADO",
    })
  })

  it("captura una orden aprobada si aun no tiene captura", async () => {
    const store = montarStore()
    const getOrder = vi.fn(async () => ordenBase({ captures: [] }) as never)
    const captureOrder = vi.fn(
      async () =>
        ordenBase({ status: "COMPLETED", captures: [capturaBase()] }) as never
    )
    const dependencias = deps(store, { getOrder, captureOrder })

    const res = await procesarEventoPaypal(eventoOrden(), dependencias)

    expect(res.estado).toBe("PROCESADO")
    expect(getOrder).toHaveBeenCalledWith("ORDER-1", { timeoutMs: 4_000 })
    expect(captureOrder).toHaveBeenCalledWith("ORDER-1", { timeoutMs: 4_000 })
    expect(dependencias.procesarCaptura).not.toHaveBeenCalled()
    expect(store.eventos[0]).toMatchObject({
      resultado: "PROCESADO",
      motivo: "ORDEN_CAPTURADA",
    })
  })

  it("no captura una orden si el link ya fue pagado (fuera de orden)", async () => {
    const store = montarStore()
    const dependencias = deps(store)

    await procesarEventoPaypal(eventoCaptura(), dependencias)
    const res = await procesarEventoPaypal(eventoOrden(), dependencias)

    expect(res).toMatchObject({ estado: "IGNORADO", ignored: true })
    expect(dependencias.captureOrder).not.toHaveBeenCalled()
    expect(store.eventos[store.eventos.length - 1]).toMatchObject({
      motivo: "ENLACE_NO_ACTIVO:PAGADO",
    })
  })

  it("CAPTURE.DENIED expira la orden del link sin crear pago", async () => {
    const store = montarStore()
    const dependencias = deps(store)

    const res = await procesarEventoPaypal(
      eventoCaptura({
        id: "WH-DENEGADA-1",
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: {
          id: "CAPTURE-1",
          status: "DENIED",
          amount: { currency_code: "USD", value: "106.56" },
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        },
      }),
      dependencias
    )

    expect(res.estado).toBe("IGNORADO")
    expect(dependencias.procesarCaptura).not.toHaveBeenCalled()
    expect(store.updates[0]).toMatchObject({
      where: { id: "enlace_1" },
      data: { orderExpiraEn: AHORA, checkoutUrl: null },
    })
    expect(store.eventos[0]).toMatchObject({
      resultado: "IGNORADO",
      motivo: "CAPTURA_RECHAZADA",
    })
  })

  it("reembolso, reversion y disputa solo marcan requiereAccion", async () => {
    const store = montarStore()
    const dependencias = deps(store)

    const casos = [
      { tipo: "PAYMENT.CAPTURE.REFUNDED", motivo: "REEMBOLSO" },
      { tipo: "PAYMENT.CAPTURE.REVERSED", motivo: "CONTRACARGO" },
      { tipo: "CUSTOMER.DISPUTE.CREATED", motivo: "DISPUTA" },
    ]

    for (const [indice, caso] of casos.entries()) {
      store.eventos.length = 0
      const evento = {
        id: `WH-ACCION-${indice}`,
        event_type: caso.tipo,
        resource: {
          id: "CAPTURE-1",
          status: "OPEN",
          amount: { currency_code: "USD", value: "106.56" },
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
          disputed_transactions: [{ seller_transaction_id: "CAPTURE-1" }],
        },
      }

      const res = await procesarEventoPaypal(evento, dependencias)

      expect(res.estado, caso.tipo).toBe("REQUIERE_ACCION")
      expect(store.eventos[0], caso.tipo).toMatchObject({
        resultado: "REQUIERE_ACCION",
        motivo: caso.motivo,
        requiereAccion: true,
      })
    }

    expect(dependencias.procesarCaptura).not.toHaveBeenCalled()
    expect(store.updates).toHaveLength(0)
    expect(store.pagos.size).toBe(0)
  })
})

describe("registrarFirmaInvalida", () => {
  it("registra un evento tecnico con id sintetico, sin PII y sin consumir el evento real", async () => {
    const store = montarStore()

    await registrarFirmaInvalida({
      headers: {
        transmissionId: "trans-1",
        transmissionTime: "2026-10-20T12:00:00Z",
        transmissionSig: "firma",
        certUrl: "https://api-m.sandbox.paypal.com/cert.pem",
        authAlgo: "SHA256withRSA",
      },
      evento: eventoCaptura(),
      motivo: "FIRMA_INVALIDA",
      db: store.db as never,
      ahora: AHORA,
    })

    const registro = store.eventos[0]
    expect(registro).toMatchObject({
      resultado: "FIRMA_INVALIDA",
      motivo: "FIRMA_INVALIDA",
      requiereAccion: false,
    })
    expect(registro.eventoId).toMatch(/^PAYPAL:FIRMA_INVALIDA:[0-9a-f]{24}$/)
    expect(registro.eventoId).not.toBe("WH-CAPTURA-1")
    expect(JSON.stringify(registro)).not.toContain(PII_EMAIL)
    expect(JSON.stringify(registro)).not.toContain(PII_NOMBRE)
  })

  it("nunca rompe la respuesta si no puede persistir el evento tecnico", async () => {
    const db = {
      eventoPasarela: {
        create: vi.fn(async () => {
          throw new Error("db caida")
        }),
        findUnique: vi.fn(async () => null),
      },
      enlacePago: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
      },
      pago: {
        findUnique: vi.fn(async () => null),
      },
    }

    await expect(
      registrarFirmaInvalida({
        headers: null,
        evento: null,
        motivo: "HEADERS_INCOMPLETOS",
        db: db as never,
        ahora: AHORA,
      })
    ).resolves.toBeUndefined()
  })
})
