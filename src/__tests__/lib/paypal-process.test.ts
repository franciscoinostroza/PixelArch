import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-10 (AC-5, AC-8, AC-10, AC-18, AC-24, AC-27): procesador de capturas PayPal
 * para hitos.
 *
 * Prisma esta mockeado con un store falso y `db` se inyecta: no hay base ni
 * red. Se cubren el camino exitoso, la idempotencia por capture/order y P2002,
 * la revision por monto y por moneda, el link inexistente, los conflictos de
 * hito/link, el recibo, la ausencia de PII y la ausencia de ARS.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  PaypalProcessError,
  procesarCapturaPaypal,
  type CapturaPaypalProcesable,
  type PaypalProcessDb,
  type ProcesarCapturaOpciones,
} from "@/lib/paypal/process"
import { construirReciboPaypal } from "@/lib/paypal/receipts"

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const CAPTURE = "CAPTURE-ABC-1"
const ORDER = "ORDER-ABC-1"
const RECIBO = "PAY-20261020-ABC123DEF456"
const RECIBO_RETRY = "PAY-20261020-ABC123DEF457"
const PRISMA_INT_MAX = 2_147_483_647

type Fila = Record<string, unknown>

function enlaceBase(overrides: Fila = {}): Fila {
  return {
    id: "enlace_1",
    token: "token_1",
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
    externalId: ORDER,
    estado: "ACTIVO",
    hito: { id: "hito_1", estado: "PENDIENTE" },
    ...overrides,
  }
}

function capturaBase(
  overrides: Partial<CapturaPaypalProcesable> = {}
): CapturaPaypalProcesable {
  return {
    captureId: CAPTURE,
    orderId: ORDER,
    amountCents: 10656,
    currency: "USD",
    status: "COMPLETED",
    ...overrides,
  }
}

function pagoPrevio(overrides: Fila = {}): Fila {
  return {
    id: "pago_previo",
    externalId: "CAPTURE-OTRA",
    paypalOrderId: "ORDER-OTRA",
    enlacePagoId: "enlace_previo",
    hitoId: "hito_1",
    estadoPago: "SUCCEEDED",
    ...overrides,
  }
}

interface OpcionesDb {
  enlaces?: Fila[]
  pagos?: Fila[]
  p2002?: boolean
  /** Falla el primer `create` con P2002 en `reciboId` (colision del recibo). */
  p2002ReciboPrimeraVez?: boolean
  /** Oculta el pago en las primeras N consultas para simular una carrera. */
  ocultarPagoHasta?: number
}

function montarDb(opciones: OpcionesDb = {}) {
  const enlaces = opciones.enlaces ?? [enlaceBase()]
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

      if (opciones.p2002ReciboPrimeraVez && llamadasCreate === 1) {
        const error = new Error("Unique constraint failed") as Error & {
          code: string
          meta: { target: string[] }
        }
        error.code = "P2002"
        error.meta = { target: ["reciboId"] }
        throw error
      }

      if (opciones.p2002) {
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

  const tx = { enlacePago, pago, hito }
  const db = {
    ...tx,
    // Los tests corren contra un store falso: al lanzar, se restauran los
    // cambios para imitar el rollback de la transaccion interactiva de Prisma.
    $transaction: vi.fn(
      async (fn: (cliente: typeof tx) => Promise<unknown>) => {
        const pagosSnapshot = pagos.map((fila) => ({ ...fila }))
        const estadosEnlaceSnapshot = enlaces.map((enlace) => enlace.estado)
        try {
          return await fn(tx)
        } catch (error) {
          pagos.length = 0
          pagos.push(...pagosSnapshot)
          enlaces.forEach((enlace, indice) => {
            enlace.estado = estadosEnlaceSnapshot[indice]
          })
          throw error
        }
      }
    ),
  }

  return { db, enlaces, enlacePago, pago, hito, pagos }
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

describe("camino exitoso (AC-5, AC-8, AC-10, AC-18, AC-24)", () => {
  it("crea un Pago SUCCEEDED con desglose y recibo, y marca hito y link PAGADOS", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(fake.db.$transaction).toHaveBeenCalledTimes(1)
    expect(fake.enlacePago.findFirst).toHaveBeenCalledWith({
      where: { pasarela: "PAYPAL", OR: [{ externalId: ORDER }] },
      include: { hito: { select: { id: true, estado: true } } },
    })

    const datos = dataDelPago(fake.pago)
    expect(datos).toMatchObject({
      clienteId: "cliente_1",
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
      externalId: CAPTURE,
      paypalOrderId: ORDER,
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      meses: null,
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

    // AC-18/AC-24: centavos enteros y desglose exacto, sin floats ni ARS.
    for (const campo of [
      "monto",
      "montoAcordado",
      "comision",
      "montoEsperado",
      "feeBps",
      "feeFixedCents",
    ]) {
      expect(Number.isInteger(datos[campo] as number)).toBe(true)
    }
    expect((datos.montoAcordado as number) + (datos.comision as number)).toBe(
      datos.monto
    )
    expect(datos.moneda).toBe("usd")

    // El recibo se construye con el snapshot real del Pago SUCCEEDED.
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
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      moneda: "usd",
      pasarela: "PAYPAL",
      referenciaExterna: CAPTURE,
    })

    expect(fake.hito.updateMany).toHaveBeenCalledWith({
      where: { id: "hito_1", estado: "PENDIENTE" },
      data: { estado: "PAGADO", pagadoEn: AHORA },
    })
    expect(fake.enlacePago.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: { estado: "PAGADO" },
    })

    expect(resultado).toEqual({
      tipo: "PROCESADO",
      duplicado: false,
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      reciboId: RECIBO,
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
      moneda: "usd",
    })
  })

  it("resuelve el link por el token si falta el order id", async () => {
    const fake = montarDb({
      enlaces: [enlaceBase({ externalId: "ORDER-VIEJO" })],
    })

    const resultado = await procesarCapturaPaypal(
      capturaBase({ orderId: null, customId: "token_1" }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({ tipo: "PROCESADO" })
    expect(dataDelPago(fake.pago)).toMatchObject({
      paypalOrderId: "ORDER-VIEJO",
      externalId: CAPTURE,
    })
    expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)
  })
})

describe("idempotencia (AC-6, AC-8, AC-13)", () => {
  it("devuelve DUPLICADO si ya existe un Pago con el mismo capture id", async () => {
    const fake = montarDb({
      pagos: [pagoPrevio({ externalId: CAPTURE })],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toEqual({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_previo",
      enlaceId: "enlace_previo",
      hitoId: "hito_1",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
  })

  it("devuelve DUPLICADO si ya existe un Pago con el mismo order id", async () => {
    const fake = montarDb({
      pagos: [pagoPrevio({ paypalOrderId: ORDER, hitoId: "hito_1" })],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_previo",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })

  it("captura P2002 como duplicado sin actualizar hito ni link", async () => {
    // Carrera: el chequeo previo no ve el pago (por eso P2002), pero la
    // relectura posterior a la constraint unica si lo encuentra.
    const fake = montarDb({
      pagos: [pagoPrevio({ externalId: CAPTURE })],
      p2002: true,
      ocultarPagoHasta: 2,
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toEqual({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_previo",
      enlaceId: "enlace_previo",
      hitoId: "hito_1",
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
  })

  it("si la actualizacion condicional del hito falla, revierte y devuelve conflicto", async () => {
    const fake = montarDb()
    fake.hito.updateMany.mockResolvedValue({ count: 0 })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({
      tipo: "CONFLICTO",
      motivo: "PAGO_GANADOR",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
    })
    // La transaccion se revierte: no queda el Pago insertado ni el link tocado.
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.pagos).toHaveLength(0)
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
  })
})

describe("diferencias de monto y moneda (AC-27)", () => {
  it.each([
    [5000, "parcial"],
    [12000, "mayor"],
    [0, "cero"],
  ])(
    "un monto %s (%s) queda en REVISION sin marcar el hito",
    async (monto) => {
      const fake = montarDb()

      const resultado = await procesarCapturaPaypal(
        capturaBase({ amountCents: monto }),
        opciones(fake.db)
      )

      expect(resultado).toEqual({
        tipo: "REVISION",
        duplicado: false,
        pagoId: "pago_1",
        enlaceId: "enlace_1",
        hitoId: "hito_1",
        monto,
        montoAcordado: 10050,
        comision: 606,
        montoEsperado: 10656,
        moneda: "usd",
        motivoRevision: "MONTO",
      })
      expect("reciboId" in resultado).toBe(false)

      const datos = dataDelPago(fake.pago)
      expect(datos).toMatchObject({
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        revisionNota: null,
        monto,
        montoEsperado: 10656,
        montoAcordado: 10050,
        comision: 606,
        feeBps: 540,
        feeFixedCents: 30,
        externalId: CAPTURE,
        paypalOrderId: ORDER,
        moneda: "usd",
      })
      // REVISION no emite recibo: T-17 lo emite al aceptar la revision.
      expect(datos.reciboId).toBeUndefined()
      expect(datos.reciboEmitidoEn).toBeUndefined()
      expect(fake.hito.updateMany).not.toHaveBeenCalled()
      // El capture ya ocurrio: el link se consume para impedir otro cobro.
      expect(fake.enlacePago.update).toHaveBeenCalledWith({
        where: { id: "enlace_1" },
        data: { estado: "PAGADO" },
      })
    }
  )

  it("una moneda distinta de USD queda en REVISION, sin marcar el hito", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ currency: "EUR" }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONEDA",
      monto: 10656,
      montoEsperado: 10656,
      moneda: "usd",
    })

    const datos = dataDelPago(fake.pago)
    expect(datos).toMatchObject({
      estadoPago: "REVISION",
      revisionEstado: "PENDIENTE",
      moneda: "usd",
    })
    expect(String(datos.revisionNota)).toContain("Moneda capturada EUR")
    expect(String(datos.revisionNota)).toContain("moneda del link USD")
    expect(String(datos.revisionNota)).toContain("esperado USD")
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: { estado: "PAGADO" },
    })
  })

  it("consume el link en REVISION y bloquea un segundo cobro", async () => {
    const fake = montarDb()

    const primera = await procesarCapturaPaypal(
      capturaBase({ amountCents: 5000 }),
      opciones(fake.db)
    )
    expect(primera).toMatchObject({ tipo: "REVISION" })
    // El capture ya ocurrio: el link queda PAGADO aunque el hito no se marque.
    expect(fake.enlaces[0].estado).toBe("PAGADO")
    expect(fake.pago.create).toHaveBeenCalledTimes(1)

    // Otro capture (otra orden, mismo token) no puede volver a cobrar el link.
    const segunda = await procesarCapturaPaypal(
      capturaBase({
        captureId: "CAPTURE-ABC-2",
        orderId: "ORDER-ABC-2",
        customId: "token_1",
      }),
      opciones(fake.db)
    )

    expect(segunda).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_PAGADO",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      pagoId: null,
    })
    expect(fake.pago.create).toHaveBeenCalledTimes(1)
    expect(fake.pagos).toHaveLength(1)
  })

  it("detecta ARS sin importar mayusculas y nunca persiste ARS como moneda (AC-18)", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ currency: "ars" }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONEDA",
    })

    const datos = dataDelPago(fake.pago)
    expect(datos.moneda).toBe("usd")
    expect(datos.moneda).not.toBe("ars")
    expect(String(datos.revisionNota)).toContain("Moneda capturada ARS")
    expect(String(datos.revisionNota)).toContain("moneda del link USD")
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })

  it("distingue la moneda del link de la capturada cuando el link no es USD", async () => {
    const fake = montarDb({ enlaces: [enlaceBase({ moneda: "ars" })] })

    const resultado = await procesarCapturaPaypal(
      capturaBase({ currency: "USD" }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONEDA",
    })

    const datos = dataDelPago(fake.pago)
    expect(datos.moneda).toBe("usd")
    expect(String(datos.revisionNota)).toContain("Moneda capturada USD")
    expect(String(datos.revisionNota)).toContain("moneda del link ARS")
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })
})

describe("validacion de captura y snapshot (AC-5, AC-18, AC-27)", () => {
  it("un COMPLETED sin monto no registra un pago de 0 ni consume el link", async () => {
    const fake = montarDb()

    await expect(
      procesarCapturaPaypal(
        capturaBase({ amountCents: null }),
        opciones(fake.db)
      )
    ).rejects.toMatchObject({
      codigo: "CAPTURA_INVALIDA",
      httpStatus: 400,
    })

    expect(fake.db.$transaction).not.toHaveBeenCalled()
    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(fake.enlaces[0].estado).toBe("ACTIVO")

    // La misma orden, ahora con el monto correcto, si se procesa.
    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opciones(fake.db)
    )
    expect(resultado).toMatchObject({ tipo: "PROCESADO", monto: 10656 })
    expect(fake.enlaces[0].estado).toBe("PAGADO")
    expect(fake.pagos).toHaveLength(1)
  })

  it.each([
    ["nulo", null],
    ["negativo", -1],
    ["decimal", 10656.5],
    ["NaN", Number.NaN],
    ["fuera del rango Int32", PRISMA_INT_MAX + 1],
  ])(
    "rechaza amountCents %s antes de abrir la transaccion",
    async (_caso, amountCents) => {
      const fake = montarDb()

      await expect(
        procesarCapturaPaypal(
          capturaBase({ amountCents: amountCents as number | null }),
          opciones(fake.db)
        )
      ).rejects.toMatchObject({
        codigo: "CAPTURA_INVALIDA",
        httpStatus: 400,
      })

      expect(fake.db.$transaction).not.toHaveBeenCalled()
      expect(fake.pago.create).not.toHaveBeenCalled()
      expect(fake.enlaces[0].estado).toBe("ACTIVO")
    }
  )

  it("acepta el limite Int32 como monto capturado (y lo manda a revision)", async () => {
    const fake = montarDb()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ amountCents: PRISMA_INT_MAX }),
      opciones(fake.db)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      monto: PRISMA_INT_MAX,
      motivoRevision: "MONTO",
    })
  })

  it.each([null, "", "   "])(
    "rechaza una captura COMPLETED sin moneda (%j) sin abrir la transaccion",
    async (currency) => {
      const fake = montarDb()

      await expect(
        procesarCapturaPaypal(
          capturaBase({ currency: currency as string | null }),
          opciones(fake.db)
        )
      ).rejects.toMatchObject({
        codigo: "CAPTURA_INVALIDA",
        httpStatus: 400,
      })

      expect(fake.db.$transaction).not.toHaveBeenCalled()
      expect(fake.pago.create).not.toHaveBeenCalled()
      expect(fake.enlaces[0].estado).toBe("ACTIVO")
    }
  )

  it.each([
    ["monto acordado 0", { montoAcordado: 0, comision: 606, total: 606 }],
    ["comision negativa", { montoAcordado: 10050, comision: -1, total: 10049 }],
    ["total 0", { montoAcordado: 0, comision: 0, total: 0 }],
    [
      "desglose que no reconcilia",
      { montoAcordado: 10050, comision: 606, total: 10655 },
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
    "rechaza un snapshot de link invalido (%s) sin crear Pago",
    async (_caso, overrides) => {
      const fake = montarDb({ enlaces: [enlaceBase(overrides as Fila)] })

      await expect(
        procesarCapturaPaypal(capturaBase(), opciones(fake.db))
      ).rejects.toMatchObject({
        codigo: "ENLACE_INVALIDO",
        httpStatus: 409,
      })

      expect(fake.pago.create).not.toHaveBeenCalled()
      expect(fake.enlacePago.update).not.toHaveBeenCalled()
      expect(fake.hito.updateMany).not.toHaveBeenCalled()
      expect(fake.enlaces[0].estado).toBe("ACTIVO")
    }
  )

  it("no genera recibo en REVISION ni en duplicados/conflictos", async () => {
    const fakeRevision = montarDb()
    const generarRevision = vi.fn(() => RECIBO)
    await procesarCapturaPaypal(
      capturaBase({ amountCents: 5000 }),
      opciones(fakeRevision.db, { nuevoReciboId: generarRevision })
    )
    expect(generarRevision).not.toHaveBeenCalled()

    const fakeDuplicado = montarDb({
      pagos: [pagoPrevio({ externalId: CAPTURE })],
    })
    const generarDuplicado = vi.fn(() => RECIBO)
    await procesarCapturaPaypal(
      capturaBase(),
      opciones(fakeDuplicado.db, { nuevoReciboId: generarDuplicado })
    )
    expect(generarDuplicado).not.toHaveBeenCalled()

    const fakeConflicto = montarDb({
      enlaces: [enlaceBase({ hito: { id: "hito_1", estado: "PAGADO" } })],
    })
    const generarConflicto = vi.fn(() => RECIBO)
    await procesarCapturaPaypal(
      capturaBase(),
      opciones(fakeConflicto.db, { nuevoReciboId: generarConflicto })
    )
    expect(generarConflicto).not.toHaveBeenCalled()
  })

  it("revierte todo si el generador de recibo falla", async () => {
    const fake = montarDb()

    await expect(
      procesarCapturaPaypal(
        capturaBase(),
        opciones(fake.db, {
          nuevoReciboId: () => {
            throw new Error("fallo del generador")
          },
        })
      )
    ).rejects.toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
    })

    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(fake.pagos).toHaveLength(0)
  })

  it("reintenta una vez con un recibo nuevo si P2002 es por reciboId", async () => {
    const fake = montarDb({ p2002ReciboPrimeraVez: true })
    const ids = [RECIBO, RECIBO_RETRY]
    const generar = vi.fn(() => ids.shift() ?? RECIBO_RETRY)

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opciones(fake.db, { nuevoReciboId: generar })
    )

    expect(resultado).toEqual({
      tipo: "PROCESADO",
      duplicado: false,
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      reciboId: RECIBO_RETRY,
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
      moneda: "usd",
    })
    expect(generar).toHaveBeenCalledTimes(2)
    expect(fake.pago.create).toHaveBeenCalledTimes(2)
    expect(dataDelPago(fake.pago, 1)).toMatchObject({ reciboId: RECIBO_RETRY })
    expect(fake.pagos).toHaveLength(1)
    expect(fake.enlaces[0].estado).toBe("PAGADO")
  })
})

describe("conflictos y errores (AC-8, AC-14, AC-27)", () => {
  it("lanza un error tipado si no existe el link de pago", async () => {
    const fake = montarDb({ enlaces: [] })

    await expect(
      procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    ).rejects.toMatchObject({
      codigo: "ENLACE_NO_ENCONTRADO",
      httpStatus: 404,
    })

    await expect(
      procesarCapturaPaypal(capturaBase(), opciones(montarDb({ enlaces: [] }).db))
    ).rejects.toBeInstanceOf(PaypalProcessError)

    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })

  it("lanza ENLACE_INVALIDO si el link no tiene hito ni soporte, sin escribir", async () => {
    const fake = montarDb({
      enlaces: [
        enlaceBase({ hitoId: null, suscripcionId: null, hito: null }),
      ],
    })

    await expect(
      procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    ).rejects.toMatchObject({
      codigo: "ENLACE_INVALIDO",
      httpStatus: 409,
    })

    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(fake.enlacePago.update).not.toHaveBeenCalled()
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza una captura sin capture id antes de abrir la transaccion", async () => {
    const fake = montarDb()

    await expect(
      procesarCapturaPaypal(
        capturaBase({ captureId: "   " }),
        opciones(fake.db)
      )
    ).rejects.toMatchObject({
      codigo: "CAPTURA_INVALIDA",
      httpStatus: 400,
    })

    expect(fake.db.$transaction).not.toHaveBeenCalled()
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("no procesa una captura que no esta COMPLETED", async () => {
    const fake = montarDb()

    await expect(
      procesarCapturaPaypal(capturaBase({ status: "PENDING" }), opciones(fake.db))
    ).rejects.toMatchObject({
      codigo: "CAPTURA_NO_COMPLETADA",
      httpStatus: 409,
    })

    expect(fake.db.$transaction).not.toHaveBeenCalled()
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("devuelve conflicto si el hito ya esta PAGADO", async () => {
    const fake = montarDb({
      enlaces: [enlaceBase({ hito: { id: "hito_1", estado: "PAGADO" } })],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "HITO_PAGADO",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      pagoId: null,
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("devuelve conflicto si otro pago ya gano el hito", async () => {
    const fake = montarDb({ pagos: [pagoPrevio()] })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "PAGO_GANADOR",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      pagoId: "pago_previo",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("devuelve conflicto si el link fue invalidado por la otra pasarela", async () => {
    const fake = montarDb({
      enlaces: [enlaceBase({ estado: "INVALIDADO" })],
    })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({
      tipo: "CONFLICTO",
      motivo: "ENLACE_INVALIDADO",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("no registra un pago nuevo sobre un link ya PAGADO", async () => {
    const fake = montarDb({ enlaces: [enlaceBase({ estado: "PAGADO" })] })

    const resultado = await procesarCapturaPaypal(capturaBase(), opciones(fake.db))

    expect(resultado).toMatchObject({
      tipo: "CONFLICTO",
      motivo: "ENLACE_PAGADO",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("envuelve errores de Prisma sin filtrar el detalle crudo", async () => {
    const fake = montarDb()
    fake.enlacePago.findFirst.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secreto@db:5432")
    )

    let capturado: unknown
    try {
      await procesarCapturaPaypal(capturaBase(), opciones(fake.db))
    } catch (error) {
      capturado = error
    }

    expect(capturado).toBeInstanceOf(PaypalProcessError)
    expect(capturado).toMatchObject({ codigo: "ERROR_INTERNO", httpStatus: 500 })
    expect((capturado as Error).message).toBe(
      "No se pudo procesar el pago de PayPal."
    )
    expect((capturado as Error).message).not.toContain("postgres")
    expect((capturado as Error).message).not.toContain("secreto")
  })

  it("no consulta la base si no hay order id ni token de link", async () => {
    const fake = montarDb()

    await expect(
      procesarCapturaPaypal(
        capturaBase({ orderId: null, customId: null, invoiceId: null }),
        opciones(fake.db)
      )
    ).rejects.toMatchObject({ codigo: "ENLACE_NO_ENCONTRADO" })

    expect(fake.db.$transaction).not.toHaveBeenCalled()
  })
})

describe("privacidad (AC-19)", () => {
  it("no persiste ni devuelve datos del pagador", async () => {
    const fake = montarDb()
    const capturaConPii = {
      ...capturaBase(),
      payer: {
        email_address: "pagador@example.com",
        name: { given_name: "Pagador" },
      },
      payerEmail: "pagador@example.com",
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
})
