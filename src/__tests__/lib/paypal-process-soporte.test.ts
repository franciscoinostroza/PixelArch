import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-11 (AC-5, AC-9, AC-10, AC-24, AC-27): procesador de capturas PayPal para
 * soporte mensual.
 *
 * Prisma esta mockeado con un store falso y `db` se inyecta: no hay base ni
 * red. Se cubren 1/3/12 meses, fin de mes, `proximoPago` futuro vs vencido,
 * estado/pastDue/cancelado, `Pago.meses`, idempotencia por capture/order,
 * pagos sucesivos en meses distintos, REVISION sin acreditar meses, recibo
 * solo en exito, snapshot/Int32/USD, sin PII y sin ARS.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  procesarCapturaPaypal,
  type CapturaPaypalProcesable,
  type PaypalProcessDb,
  type ProcesarCapturaOpciones,
} from "@/lib/paypal/process"
import { construirReciboPaypal } from "@/lib/paypal/receipts"

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const CAPTURE = "CAPTURE-SOP-1"
const ORDER = "ORDER-SOP-1"
const CAPTURE_2 = "CAPTURE-SOP-2"
const ORDER_2 = "ORDER-SOP-2"
const RECIBO = "PAY-20261020-SOPORTE0001"
const RECIBO_2 = "PAY-20261020-SOPORTE0002"
const PRISMA_INT_MAX = 2_147_483_647

type Fila = Record<string, unknown>

function enlaceSoporte(overrides: Fila = {}): Fila {
  return {
    id: "enlace_soporte_1",
    token: "token_soporte_1",
    clienteId: "cliente_1",
    hitoId: null,
    suscripcionId: "suscripcion_1",
    pasarela: "PAYPAL",
    concepto: "Soporte — 1 mes",
    montoAcordado: 5000,
    comision: 300,
    total: 5300,
    moneda: "usd",
    meses: 1,
    feeBps: 540,
    feeFixedCents: 30,
    externalId: ORDER,
    estado: "ACTIVO",
    hito: null,
    ...overrides,
  }
}

function capturaBase(
  overrides: Partial<CapturaPaypalProcesable> = {}
): CapturaPaypalProcesable {
  return {
    captureId: CAPTURE,
    orderId: ORDER,
    amountCents: 5300,
    currency: "USD",
    status: "COMPLETED",
    ...overrides,
  }
}

function suscripcionBase(overrides: Fila = {}): Fila {
  return {
    id: "suscripcion_1",
    proximoPago: new Date("2026-09-15T12:00:00.000Z"),
    estado: "PAST_DUE",
    pastDueEn: new Date("2026-09-15T00:00:00.000Z"),
    canceladoEn: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  }
}

interface OpcionesDb {
  enlaces?: Fila[]
  suscripciones?: Fila[]
  pagos?: Fila[]
  /** Fuerza P2002 en `Pago.create` (carrera con otra notificacion). */
  p2002?: boolean
  /** Oculta el pago en las primeras N consultas para simular una carrera. */
  ocultarPagoHasta?: number
}

function montarDb(opciones: OpcionesDb = {}) {
  const enlaces = opciones.enlaces ?? [enlaceSoporte()]
  const suscripciones = (opciones.suscripciones ?? [suscripcionBase()]).map((fila) => ({
    ...fila,
  }))
  const pagos = [...(opciones.pagos ?? [])]
  let llamadasPago = 0
  let llamadasCreate = 0

  function coincidePago(pago: Fila, where: Fila & { OR?: Fila[] }): boolean {
    if (Array.isArray(where.OR)) {
      const coincide = where.OR.some((cond) => {
        if (cond.externalId !== undefined) {
          return pago.externalId === cond.externalId
        }
        if (cond.paypalOrderId !== undefined) {
          return pago.paypalOrderId === cond.paypalOrderId
        }
        return false
      })
      if (!coincide) return false
    }
    if (where.hitoId !== undefined && pago.hitoId !== where.hitoId) return false
    if (where.estadoPago !== undefined && pago.estadoPago !== where.estadoPago) {
      return false
    }
    return true
  }

  const enlacePago = {
    findFirst: vi.fn(
      async (args: { where: { pasarela?: string; OR?: Fila[] } }) => {
        const condiciones = args.where.OR ?? []
        const encontrado = enlaces.find((enlace) => {
          if (enlace.pasarela !== args.where.pasarela) return false
          return condiciones.some((cond) => {
            if (cond.externalId !== undefined) {
              return enlace.externalId === cond.externalId
            }
            if (cond.token !== undefined) return enlace.token === cond.token
            return false
          })
        })
        return encontrado ?? null
      }
    ),
    update: vi.fn(async (args: { where: { id: string }; data: Fila }) => {
      const encontrado = enlaces.find((enlace) => enlace.id === args.where.id)
      if (!encontrado) throw new Error("Enlace no encontrado")
      Object.assign(encontrado, args.data)
      return {}
    }),
  }

  const pago = {
    findFirst: vi.fn(async (args: { where: Fila & { OR?: Fila[] } }) => {
      llamadasPago += 1
      if (opciones.ocultarPagoHasta && llamadasPago <= opciones.ocultarPagoHasta) {
        return null
      }
      return pagos.find((fila) => coincidePago(fila, args.where)) ?? null
    }),
    create: vi.fn(async (args: { data: Fila }) => {
      llamadasCreate += 1

      if (opciones.p2002 && llamadasCreate === 1) {
        const error = new Error("Unique constraint failed") as Error & {
          code: string
        }
        error.code = "P2002"
        throw error
      }

      const data = args.data
      const duplicado = pagos.some(
        (fila) =>
          (data.externalId !== undefined && fila.externalId === data.externalId) ||
          (data.paypalOrderId !== undefined &&
            fila.paypalOrderId === data.paypalOrderId)
      )
      if (duplicado) {
        const error = new Error("Unique constraint failed") as Error & {
          code: string
        }
        error.code = "P2002"
        throw error
      }

      const nueva = { id: `pago_${pagos.length + 1}`, ...data }
      pagos.push(nueva)
      return { id: String(nueva.id) }
    }),
  }

  const hito = {
    updateMany: vi.fn(async () => ({ count: 1 })),
  }

  const suscripcion = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return suscripciones.find((fila) => fila.id === args.where.id) ?? null
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Fila }) => {
      const encontrada = suscripciones.find((fila) => fila.id === args.where.id)
      if (!encontrada) throw new Error("Suscripcion no encontrada")
      Object.assign(encontrada, args.data)
      return {}
    }),
  }

  const tx = { enlacePago, pago, hito, suscripcion }
  const db = {
    ...tx,
    // Store falso: al lanzar, se restauran los cambios para imitar el rollback
    // de la transaccion interactiva de Prisma.
    $transaction: vi.fn(
      async (fn: (cliente: typeof tx) => Promise<unknown>) => {
        const pagosSnapshot = pagos.map((fila) => ({ ...fila }))
        const estadosEnlaceSnapshot = enlaces.map((enlace) => enlace.estado)
        const suscripcionesSnapshot = suscripciones.map((fila) => ({ ...fila }))
        try {
          return await fn(tx)
        } catch (error) {
          pagos.length = 0
          pagos.push(...pagosSnapshot)
          enlaces.forEach((enlace, indice) => {
            enlace.estado = estadosEnlaceSnapshot[indice]
          })
          suscripciones.length = 0
          suscripciones.push(...suscripcionesSnapshot)
          throw error
        }
      }
    ),
  }

  return { db, enlaces, enlacePago, pago, hito, suscripcion, suscripciones, pagos }
}

function opciones(
  db: ReturnType<typeof montarDb>["db"],
  overrides: Partial<ProcesarCapturaOpciones> = {}
): ProcesarCapturaOpciones {
  return {
    db: db as unknown as PaypalProcessDb,
    ahora: AHORA,
    nuevoReciboId: () => RECIBO,
    ...overrides,
  }
}

function dataDelPago(
  pago: ReturnType<typeof montarDb>["pago"],
  indice = 0
): Fila {
  const llamada = pago.create.mock.calls[indice]
  if (!llamada) throw new Error("No se creo un Pago")
  return (llamada[0] as { data: Fila }).data
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("acreditacion de soporte (AC-5, AC-9, AC-24)", () => {
  it("1 mes con proximoPago vencido: Pago SUCCEEDED, ACTIVE y vencimiento desde ahora", async () => {
    const fake = montarDb()
    const generar = vi.fn(() => RECIBO)

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opciones(fake.db, { nuevoReciboId: generar })
    )

    expect(resultado).toEqual({
      tipo: "PROCESADO",
      duplicado: false,
      pagoId: "pago_1",
      enlaceId: "enlace_soporte_1",
      hitoId: null,
      suscripcionId: "suscripcion_1",
      meses: 1,
      reciboId: RECIBO,
      monto: 5300,
      montoAcordado: 5000,
      comision: 300,
      moneda: "usd",
    })

    const datos = dataDelPago(fake.pago)
    expect(datos).toMatchObject({
      clienteId: "cliente_1",
      suscripcionId: "suscripcion_1",
      hitoId: null,
      externalId: CAPTURE,
      paypalOrderId: ORDER,
      monto: 5300,
      montoAcordado: 5000,
      comision: 300,
      montoEsperado: 5300,
      meses: 1,
      feeBps: 540,
      feeFixedCents: 30,
      moneda: "usd",
      metodo: "PAYPAL",
      pasarela: "PAYPAL",
      origen: "AUTOMATICO",
      estadoPago: "SUCCEEDED",
      reciboId: RECIBO,
      reciboEmitidoEn: AHORA,
    })
    expect(datos.revisionEstado).toBeUndefined()
    expect(datos.revisionNota).toBeUndefined()

    // Desglose exacto en centavos, sin ARS ni floats.
    expect((datos.montoAcordado as number) + (datos.comision as number)).toBe(
      datos.monto
    )
    expect(datos.moneda).toBe("usd")

    // Una sola actualizacion, con la regla de Mercado Pago: como el proximo
    // pago ya vencio, la base es `ahora`.
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).toHaveBeenCalledWith({
      where: { id: "suscripcion_1" },
      data: {
        estado: "ACTIVE",
        proximoPago: new Date("2026-11-20T12:00:00.000Z"),
        pastDueEn: null,
        canceladoEn: null,
      },
    })
    expect(fake.suscripciones[0]).toMatchObject({
      estado: "ACTIVE",
      pastDueEn: null,
      canceladoEn: null,
    })

    expect(fake.enlacePago.update).toHaveBeenCalledWith({
      where: { id: "enlace_soporte_1" },
      data: { estado: "PAGADO" },
    })
    expect(fake.enlaces[0].estado).toBe("PAGADO")
    // No aplica la logica de hito.
    expect(fake.hito.updateMany).not.toHaveBeenCalled()

    // Recibo solo en exito, construido con el snapshot del Pago.
    expect(generar).toHaveBeenCalledTimes(1)
    const recibo = construirReciboPaypal({
      reciboId: datos.reciboId as string,
      concepto: fake.enlaces[0].concepto as string,
      montoAcordado: datos.montoAcordado as number,
      comision: datos.comision as number,
      total: datos.monto as number,
      moneda: datos.moneda as string,
      fecha: datos.reciboEmitidoEn as Date,
      referenciaExterna: datos.externalId as string,
    })
    expect(recibo).toMatchObject({
      reciboId: RECIBO,
      concepto: "Soporte — 1 mes",
      montoAcordado: 5000,
      comision: 300,
      total: 5300,
      moneda: "usd",
      pasarela: "PAYPAL",
      referenciaExterna: CAPTURE,
    })
  })

  it("3 meses con proximoPago futuro extienden desde esa fecha", async () => {
    const fake = montarDb({
      enlaces: [enlaceSoporte({ meses: 3 })],
      suscripciones: [
        suscripcionBase({
          proximoPago: new Date("2026-12-31T12:00:00.000Z"),
          estado: "ACTIVE",
          pastDueEn: null,
          canceladoEn: null,
        }),
      ],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({ tipo: "PROCESADO", meses: 3 })
    expect(dataDelPago(fake.pago)).toMatchObject({ meses: 3 })
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).toHaveBeenCalledWith({
      where: { id: "suscripcion_1" },
      data: {
        estado: "ACTIVE",
        proximoPago: new Date("2027-03-31T12:00:00.000Z"),
        pastDueEn: null,
        canceladoEn: null,
      },
    })
  })

  it("12 meses acreditan el maximo y quedan en Pago.meses (AC-9)", async () => {
    const fake = montarDb({
      enlaces: [enlaceSoporte({ meses: 12 })],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({ tipo: "PROCESADO", meses: 12 })
    const datos = dataDelPago(fake.pago)
    expect(datos.meses).toBe(12)
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update.mock.calls[0][0].data.proximoPago).toEqual(
      new Date("2027-10-20T12:00:00.000Z")
    )
  })

  it.each([
    [
      "no bisiesto",
      new Date("2026-01-01T12:00:00.000Z"),
      new Date("2026-01-31T12:00:00.000Z"),
      new Date("2026-02-28T12:00:00.000Z"),
    ],
    [
      "bisiesto",
      new Date("2024-01-01T12:00:00.000Z"),
      new Date("2024-01-31T12:00:00.000Z"),
      new Date("2024-02-29T12:00:00.000Z"),
    ],
  ])(
    "fin de mes (%s): 31 de enero -> ultimo dia de febrero",
    async (_caso, ahora, proximoPago, esperado) => {
      const fake = montarDb({
        suscripciones: [
          suscripcionBase({
            proximoPago,
            estado: "ACTIVE",
            pastDueEn: null,
            canceladoEn: null,
          }),
        ],
      })

      const resultado = await procesarCapturaPaypal(
        capturaBase(),
        opciones(fake.db, { ahora })
      )

      expect(resultado).toMatchObject({ tipo: "PROCESADO", meses: 1 })
      expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
      expect(fake.suscripcion.update.mock.calls[0][0].data.proximoPago).toEqual(
        esperado
      )
    }
  )
})

describe("meses invalidos (AC-9)", () => {
  it.each([
    ["falta", null],
    ["cero", 0],
    ["negativo", -1],
    ["trece", 13],
    ["decimal", 1.5],
    ["NaN", Number.NaN],
  ])(
    "rechaza meses %s con error tipado sin escribir",
    async (_caso, meses) => {
      const fake = montarDb({
        enlaces: [enlaceSoporte({ meses: meses as number | null })],
      })
      const generar = vi.fn(() => RECIBO)

      await expect(
        procesarCapturaPaypal(
          capturaBase(),
          opciones(fake.db, { nuevoReciboId: generar })
        )
      ).rejects.toMatchObject({
        codigo: "MESES_INVALIDOS",
        httpStatus: 409,
      })

      expect(generar).not.toHaveBeenCalled()
      expect(fake.pago.create).not.toHaveBeenCalled()
      expect(fake.enlacePago.update).not.toHaveBeenCalled()
      expect(fake.suscripcion.update).not.toHaveBeenCalled()
      expect(fake.hito.updateMany).not.toHaveBeenCalled()
      expect(fake.enlaces[0].estado).toBe("ACTIVO")
    }
  )
})

describe("idempotencia y pagos sucesivos (AC-6, AC-9)", () => {
  it("el mismo capture no acredita dos veces el soporte", async () => {
    const fake = montarDb()

    const primera = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    const segunda = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(primera).toMatchObject({ tipo: "PROCESADO" })
    expect(segunda).toEqual({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_1",
      enlaceId: "enlace_soporte_1",
      hitoId: null,
      suscripcionId: "suscripcion_1",
    })

    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
    expect(fake.pagos).toHaveLength(1)
  })

  it("el mismo order id con otro capture tampoco acredita dos veces", async () => {
    const fake = montarDb()

    await procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    const segunda = await procesarCapturaPaypal(
      capturaBase({ captureId: "CAPTURE-SOP-OTRO" }),
      opciones(fake.db)
    )

    expect(segunda).toMatchObject({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_1",
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(1)
  })

  it("un P2002 de capture/order no acredita dos veces el soporte", async () => {
    // Carrera: el chequeo previo no ve el pago (por eso P2002), pero la
    // relectura posterior a la constraint unica si lo encuentra.
    const fake = montarDb({
      pagos: [
        {
          id: "pago_previo",
          externalId: CAPTURE,
          paypalOrderId: ORDER,
          enlacePagoId: "enlace_previo",
          hitoId: null,
          suscripcionId: "suscripcion_1",
          estadoPago: "SUCCEEDED",
        },
      ],
      p2002: true,
      // Solo el chequeo previo de idempotencia (1 llamada) no ve el pago; la
      // relectura posterior al P2002 si debe encontrarlo.
      ocultarPagoHasta: 1,
    })
    const generar = vi.fn(() => RECIBO)

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opciones(fake.db, { nuevoReciboId: generar })
    )

    expect(resultado).toEqual({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_previo",
      enlaceId: "enlace_previo",
      hitoId: null,
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    // El intento alcanzo a pedir un id de recibo antes del P2002, pero ningun
    // Pago persistido quedo con recibo: la transaccion se revierte.
    expect(fake.pagos).toHaveLength(1)
    expect(fake.pagos.every((pago) => pago.reciboId === undefined)).toBe(true)
  })

  it("permite pagos sucesivos en meses distintos y acumula el vencimiento", async () => {
    const fake = montarDb({
      enlaces: [
        enlaceSoporte(),
        enlaceSoporte({
          id: "enlace_soporte_2",
          token: "token_soporte_2",
          concepto: "Soporte — 2 meses",
          montoAcordado: 10000,
          comision: 600,
          total: 10600,
          meses: 2,
          externalId: ORDER_2,
        }),
      ],
    })
    const ids = [RECIBO, RECIBO_2]
    const generar = vi.fn(() => ids.shift() ?? RECIBO_2)

    const primera = await procesarCapturaPaypal(
      capturaBase(),
      opciones(fake.db, { nuevoReciboId: generar })
    )
    const segunda = await procesarCapturaPaypal(
      capturaBase({
        captureId: CAPTURE_2,
        orderId: ORDER_2,
        amountCents: 10600,
      }),
      opciones(fake.db, { nuevoReciboId: generar })
    )

    expect(primera).toMatchObject({ tipo: "PROCESADO", meses: 1 })
    expect(segunda).toMatchObject({
      tipo: "PROCESADO",
      meses: 2,
      enlaceId: "enlace_soporte_2",
      reciboId: RECIBO_2,
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(2)
    expect(dataDelPago(fake.pago, 1)).toMatchObject({
      meses: 2,
      suscripcionId: "suscripcion_1",
      hitoId: null,
    })

    // Cada capture acredita una sola vez; el segundo toma el vencimiento ya
    // actualizado (2026-11-20) y suma 2 meses.
    expect(fake.suscripcion.update).toHaveBeenCalledTimes(2)
    expect(fake.suscripcion.update.mock.calls[1][0].data.proximoPago).toEqual(
      new Date("2027-01-20T12:00:00.000Z")
    )
    expect(fake.pagos).toHaveLength(2)
    expect(fake.enlaces.map((enlace) => enlace.estado)).toEqual([
      "PAGADO",
      "PAGADO",
    ])
  })
})

describe("diferencias (AC-27, AC-10)", () => {
  it("un monto distinto queda en REVISION sin acreditar meses ni emitir recibo", async () => {
    const fake = montarDb()
    const generar = vi.fn(() => RECIBO)

    const resultado = await procesarCapturaPaypal(
      capturaBase({ amountCents: 5000 }),
      opciones(fake.db, { nuevoReciboId: generar })
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      hitoId: null,
      suscripcionId: "suscripcion_1",
      meses: 1,
      monto: 5000,
      montoAcordado: 5000,
      comision: 300,
      montoEsperado: 5300,
      moneda: "usd",
      motivoRevision: "MONTO",
    })
    expect("reciboId" in resultado).toBe(false)
    expect(generar).not.toHaveBeenCalled()

    const datos = dataDelPago(fake.pago)
    expect(datos).toMatchObject({
      estadoPago: "REVISION",
      revisionEstado: "PENDIENTE",
      revisionNota: null,
      suscripcionId: "suscripcion_1",
      hitoId: null,
      meses: 1,
      moneda: "usd",
    })
    expect(datos.reciboId).toBeUndefined()
    expect(datos.reciboEmitidoEn).toBeUndefined()

    // No acredita meses ni toca estado/vencimiento del soporte.
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()

    // El capture ya ocurrio: el link se consume (misma decision que T-10).
    expect(fake.enlacePago.update).toHaveBeenCalledWith({
      where: { id: "enlace_soporte_1" },
      data: { estado: "PAGADO" },
    })
  })

  it("ARS u otra moneda queda en REVISION sin acreditar ni persistir ARS", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ currency: "ars" }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONEDA",
      moneda: "usd",
    })
    expect("reciboId" in resultado).toBe(false)

    const datos = dataDelPago(fake.pago)
    expect(datos.moneda).toBe("usd")
    expect(datos.moneda).not.toBe("ars")
    expect(String(datos.revisionNota)).toContain("Moneda capturada ARS")
    expect(String(datos.revisionNota)).toContain("moneda del link USD")
    expect(String(datos.revisionNota)).toContain("esperado USD")
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })

  it("un monto mayor tambien queda en REVISION", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ amountCents: 6000 }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONTO",
      monto: 6000,
      montoEsperado: 5300,
    })
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
  })

  it("consume el link tras REVISION y bloquea un segundo cobro (T-10)", async () => {
    const fake = montarDb()

    const primera = await procesarCapturaPaypal(
      capturaBase({ amountCents: 5000 }),
      opciones(fake.db)
    )
    expect(primera).toMatchObject({ tipo: "REVISION" })
    // El capture ya ocurrio: el link queda PAGADO aunque el soporte no se
    // acredite hasta resolver la revision.
    expect(fake.enlaces[0].estado).toBe("PAGADO")
    expect(fake.suscripcion.update).not.toHaveBeenCalled()

    // Otro capture (otra orden, mismo token) no puede volver a cobrar el link.
    const segunda = await procesarCapturaPaypal(
      capturaBase({
        captureId: CAPTURE_2,
        orderId: ORDER_2,
        customId: "token_soporte_1",
      }),
      opciones(fake.db)
    )

    expect(segunda).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_PAGADO",
      enlaceId: "enlace_soporte_1",
      hitoId: null,
      pagoId: null,
      suscripcionId: "suscripcion_1",
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(fake.pagos).toHaveLength(1)
    expect(fake.enlaces[0].estado).toBe("PAGADO")
  })
})

describe("validaciones y privacidad (AC-5, AC-18, AC-19, AC-24)", () => {
  it.each([
    ["monto acordado 0", { montoAcordado: 0, comision: 300, total: 300 }],
    ["comision negativa", { montoAcordado: 5000, comision: -1, total: 4999 }],
    [
      "desglose que no reconcilia",
      { montoAcordado: 5000, comision: 300, total: 5299 },
    ],
    [
      "monto fuera de Int32",
      {
        montoAcordado: PRISMA_INT_MAX + 1,
        comision: 0,
        total: PRISMA_INT_MAX + 1,
      },
    ],
  ])(
    "rechaza un snapshot de soporte invalido (%s) sin escribir",
    async (_caso, overrides) => {
      const fake = montarDb({
        enlaces: [enlaceSoporte(overrides as Fila)],
      })

      await expect(
        procesarCapturaPaypal(capturaBase(), opciones(fake.db))
      ).rejects.toMatchObject({
        codigo: "ENLACE_INVALIDO",
        httpStatus: 409,
      })

      expect(fake.pago.create).not.toHaveBeenCalled()
      expect(fake.enlacePago.update).not.toHaveBeenCalled()
      expect(fake.suscripcion.update).not.toHaveBeenCalled()
      expect(fake.enlaces[0].estado).toBe("ACTIVO")
    }
  )

  it("si la suscripcion no existe no escribe y devuelve error tipado", async () => {
    const fake = montarDb({ suscripciones: [] })

    await expect(
      procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    ).rejects.toMatchObject({
      codigo: "ENLACE_INVALIDO",
      httpStatus: 409,
    })

    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
  })

  it("no persiste ni devuelve datos del pagador", async () => {
    const fake = montarDb()
    const capturaConPii = {
      ...capturaBase(),
      payer: {
        email_address: "pagador@example.com",
        name: { given_name: "Pagador" },
      },
      payerEmail: "pagador@example.com",
      payerName: "Pagador",
    } as CapturaPaypalProcesable

    const resultado = await procesarCapturaPaypal(capturaConPii, opciones(fake.db))

    const datos = dataDelPago(fake.pago)
    const serializado = JSON.stringify({ datos, resultado })

    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Pagador")
    expect(serializado).not.toContain("payer")
    expect(Object.keys(datos)).not.toContain("email")
    expect(Object.keys(datos)).not.toContain("nombre")
    expect(Object.keys(datos)).not.toContain("pagador")
  })

  it("no usa ARS en el Pago ni en el resultado exitoso", async () => {
    const fake = montarDb()
    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    const datos = dataDelPago(fake.pago)

    if (resultado.tipo !== "PROCESADO") {
      throw new Error("Se esperaba un pago procesado")
    }
    expect(resultado.moneda).toBe("usd")
    expect(datos.moneda).toBe("usd")
    expect(JSON.stringify(datos)).not.toContain('"moneda":"ars"')
    expect(JSON.stringify(resultado)).not.toContain('"moneda":"ars"')
  })
})
