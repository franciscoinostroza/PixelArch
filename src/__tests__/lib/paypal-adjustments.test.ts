import { describe, expect, it, vi } from "vitest"

/**
 * T-16 (AC-17, AC-19, AC-22): logica pura del ajuste manual de PayPal.
 *
 * Este archivo cubre el servicio `registrarAjustePaypal` sin HTTP ni Prisma
 * real: validacion de entrada (Zod ya valida el body, el servicio vuelve a
 * validar para que ningun caller interno lo omita), limites Int32, PII,
 * decisiones NINGUNA / REVERTIR_HITO / DESCONTAR_MESES, conservacion del pago
 * original, redondeo de vencimientos y saneamiento de errores.
 *
 * El contrato HTTP (403 de asistente, rate limit, Zod estricto, 404 de pagos no
 * PayPal) se cubre en `src/__tests__/api/admin/paypal-ajustes.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  sentryCaptureException: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/logger", () => ({ logger: mocks.logger }))
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.sentryCaptureException,
}))
// El servicio importa el singleton, pero todos los tests le pasan un `db`
// inyectado; el mock evita tocar pool/env de PostgreSQL al importar el modulo.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { addMonths } from "@/lib/pagos"
import {
  PaypalAdjustmentError,
  registrarAjustePaypal,
  type PagoAjustable,
  type PaypalAdjustmentDb,
  type PaypalAdjustmentTx,
  type RegistrarAjustePaypalInput,
  type ResultadoAjustePaypal,
  type SuscripcionAjustable,
} from "@/lib/paypal/adjustments"

const AHORA = new Date("2026-10-26T12:00:00.000Z")

const PAGO_HITO: PagoAjustable = {
  id: "pago_1",
  pasarela: "PAYPAL",
  hitoId: "hito_1",
  suscripcionId: null,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  monto: 10_656,
}

const PAGO_SOPORTE: PagoAjustable = {
  id: "pago_soporte",
  pasarela: "PAYPAL",
  hitoId: null,
  suscripcionId: "susc_1",
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  monto: 20_000,
}

const SUSC_FUTURA: SuscripcionAjustable = {
  id: "susc_1",
  proximoPago: new Date("2030-01-15T12:00:00.000Z"),
  estado: "ACTIVE",
  pastDueEn: null,
}

interface OpcionesTx {
  pago: PagoAjustable | null
  otrosPagosMismoHito?: PagoAjustable[]
  montosAjustesPrevios?: number[]
  suscripcion?: SuscripcionAjustable | null
  errorCreate?: unknown
  pagoUpdateCount?: number
  hitoUpdateCount?: number
  suscripcionUpdateCount?: number
}

function crearTx(opciones: OpcionesTx) {
  return {
    pago: {
      findUnique: vi.fn(
        async (_args: { where: { id: string }; select?: unknown }) => {
          void _args
          return opciones.pago
        }
      ),
      findFirst: vi.fn(
        async (_args: {
          where: {
            hitoId?: string
            estadoPago?: string
            id?: { not?: string }
          }
          select?: unknown
        }) => {
          void _args
          const candidatos = opciones.otrosPagosMismoHito ?? []
          const encontrado = candidatos.find((pago) => {
            if (
              _args.where.hitoId !== undefined &&
              pago.hitoId !== _args.where.hitoId
            ) {
              return false
            }
            if (
              _args.where.estadoPago !== undefined &&
              pago.estadoPago !== _args.where.estadoPago
            ) {
              return false
            }
            if (
              _args.where.id?.not !== undefined &&
              pago.id === _args.where.id.not
            ) {
              return false
            }
            return true
          })
          return encontrado ? { id: encontrado.id } : null
        }
      ),
      updateMany: vi.fn(
        async (_args: {
          where: {
            id: string
            pasarela?: string
            estadoPago?: string
            revisionEstado?: string | null
          }
          data: Record<string, unknown>
        }) => {
          void _args
          return { count: opciones.pagoUpdateCount ?? 1 }
        }
      ),
    },
    hito: {
      updateMany: vi.fn(
        async (_args: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          void _args
          return { count: opciones.hitoUpdateCount ?? 1 }
        }
      ),
    },
    suscripcion: {
      findUnique: vi.fn(
        async (_args: { where: { id: string }; select?: unknown }) => {
          void _args
          return opciones.suscripcion ?? null
        }
      ),
      updateMany: vi.fn(
        async (_args: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          void _args
          return { count: opciones.suscripcionUpdateCount ?? 1 }
        }
      ),
    },
    ajustePago: {
      findMany: vi.fn(
        async (_args: {
          where: { pagoId: string }
          select?: unknown
        }) => {
          void _args
          return (opciones.montosAjustesPrevios ?? []).map((monto) => ({
            monto,
          }))
        }
      ),
      create: vi.fn(
        async (_args: { data: Record<string, unknown>; select?: unknown }) => {
          void _args
          if (opciones.errorCreate !== undefined) throw opciones.errorCreate
          return { id: "ajuste_1" }
        }
      ),
    },
  }
}

type TxFalso = ReturnType<typeof crearTx>

function crearDb(tx: TxFalso): PaypalAdjustmentDb {
  return {
    ...tx,
    $transaction: async <T>(
      callback: (tx: PaypalAdjustmentTx) => Promise<T>
    ): Promise<T> => callback(tx as unknown as PaypalAdjustmentTx),
  } as unknown as PaypalAdjustmentDb
}

function input(
  overrides: Partial<RegistrarAjustePaypalInput> = {}
): RegistrarAjustePaypalInput {
  return {
    pagoId: PAGO_HITO.id,
    tipo: "REEMBOLSO",
    montoCents: 10_656,
    motivo: "Cliente solicito reembolso",
    evidencia: "ID de reembolso de PayPal",
    decision: "NINGUNA",
    ...overrides,
  }
}

async function ejecutar(
  entrada: RegistrarAjustePaypalInput,
  tx: TxFalso,
  ahora: Date = AHORA
): Promise<ResultadoAjustePaypal> {
  return registrarAjustePaypal(entrada, { ahora, db: crearDb(tx) })
}

async function capturarError(promesa: Promise<unknown>): Promise<PaypalAdjustmentError> {
  try {
    await promesa
  } catch (error) {
    expect(error).toBeInstanceOf(PaypalAdjustmentError)
    return error as PaypalAdjustmentError
  }
  throw new Error("Se esperaba un PaypalAdjustmentError")
}

function metadatosDeLog(): Record<string, unknown> {
  const llamada = mocks.logger.error.mock.calls.at(-1)
  expect(llamada).toBeDefined()
  return llamada?.[1] as Record<string, unknown>
}

describe("registrarAjustePaypal: validacion y limites (AC-22)", () => {
  it("rechaza una entrada nula o que no es objeto", async () => {
    for (const entrada of [null, undefined, "texto", 42]) {
      const tx = crearTx({ pago: PAGO_HITO })
      const error = await capturarError(
        registrarAjustePaypal(entrada as unknown as RegistrarAjustePaypalInput, {
          ahora: AHORA,
          db: crearDb(tx),
        })
      )
      expect(error.codigo).toBe("ARGUMENTOS_INVALIDOS")
      expect(error.httpStatus).toBe(400)
      expect(tx.ajustePago.create).not.toHaveBeenCalled()
      expect(tx.pago.updateMany).not.toHaveBeenCalled()
    }
  })

  it.each([
    ["pagoId vacio", input({ pagoId: "   " })],
    ["pagoId no textual", input({ pagoId: 123 as unknown as string })],
    ["pagoId demasiado largo", input({ pagoId: "x".repeat(101) })],
    ["tipo desconocido", input({ tipo: "OTRO" as never })],
    ["decision desconocida", input({ decision: "REVERTIR_TODO" as never })],
    ["monto cero", input({ montoCents: 0 })],
    ["monto negativo", input({ montoCents: -1 })],
    ["monto decimal", input({ montoCents: 10.5 })],
    ["monto NaN", input({ montoCents: Number.NaN })],
    ["monto infinito", input({ montoCents: Number.POSITIVE_INFINITY })],
    ["monto fuera de Int32", input({ montoCents: 2_147_483_648 })],
    ["monto no numerico", input({ montoCents: "100" as unknown as number })],
    [
      "DESCONTAR_MESES sin meses",
      input({ decision: "DESCONTAR_MESES", pagoId: PAGO_SOPORTE.id }),
    ],
    [
      "DESCONTAR_MESES con meses 0",
      input({
        decision: "DESCONTAR_MESES",
        mesesDescontados: 0,
        pagoId: PAGO_SOPORTE.id,
      }),
    ],
    [
      "DESCONTAR_MESES con meses 13",
      input({
        decision: "DESCONTAR_MESES",
        mesesDescontados: 13,
        pagoId: PAGO_SOPORTE.id,
      }),
    ],
    [
      "DESCONTAR_MESES con meses decimal",
      input({
        decision: "DESCONTAR_MESES",
        mesesDescontados: 1.5,
        pagoId: PAGO_SOPORTE.id,
      }),
    ],
    [
      "NINGUNA con meses",
      input({ decision: "NINGUNA", mesesDescontados: 1 }),
    ],
    [
      "REVERTIR_HITO con meses",
      input({ decision: "REVERTIR_HITO", mesesDescontados: 1 }),
    ],
    ["motivo no textual", input({ motivo: 123 as unknown as string })],
    ["evidencia no textual", input({ evidencia: 123 as unknown as string })],
    ["motivo demasiado largo", input({ motivo: "x".repeat(2_001) })],
    ["evidencia demasiado larga", input({ evidencia: "x".repeat(2_001) })],
    ["sin motivo ni evidencia", input({ motivo: null, evidencia: null })],
    [
      "con motivo y evidencia vacios",
      input({ motivo: "   ", evidencia: "" }),
    ],
  ])("rechaza %s antes de abrir la transaccion", async (_caso, entrada) => {
    const tx = crearTx({
      pago: entrada.pagoId === PAGO_SOPORTE.id ? PAGO_SOPORTE : PAGO_HITO,
      suscripcion: SUSC_FUTURA,
    })

    const error = await capturarError(ejecutar(entrada, tx))

    expect(error.codigo).toBe("ARGUMENTOS_INVALIDOS")
    expect(error.httpStatus).toBe(400)
    expect(tx.pago.findUnique).not.toHaveBeenCalled()
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
  })

  it("acepta el monto exacto del pago, incluso en el limite Int32", async () => {
    for (const monto of [1, 2_147_483_647]) {
      const pago = { ...PAGO_HITO, monto }
      const tx = crearTx({ pago })
      const resultado = await ejecutar(input({ montoCents: monto }), tx)

      expect(resultado.estadoPago).toBe("REFUNDED")
      expect(tx.ajustePago.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ monto }),
        select: { id: true },
      })
    }
  })

  it("rechaza un monto mayor al pago antes de crear el ajuste", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const error = await capturarError(
      ejecutar(input({ montoCents: PAGO_HITO.monto + 1 }), tx)
    )

    expect(error.codigo).toBe("MONTO_EXCEDE_PAGO")
    expect(error.httpStatus).toBe(400)
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
  })

  it("descuenta los ajustes previos del monto disponible del pago", async () => {
    const excedido = crearTx({
      pago: PAGO_HITO,
      montosAjustesPrevios: [6_000],
    })
    const error = await capturarError(
      ejecutar(input({ montoCents: 4_657 }), excedido)
    )

    expect(error.codigo).toBe("MONTO_EXCEDE_PAGO")
    expect(excedido.ajustePago.create).not.toHaveBeenCalled()

    const exacto = crearTx({
      pago: PAGO_HITO,
      montosAjustesPrevios: [6_000],
    })
    const resultado = await ejecutar(input({ montoCents: 4_656 }), exacto)

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(exacto.ajustePago.findMany).toHaveBeenCalledWith({
      where: { pagoId: PAGO_HITO.id },
      select: { monto: true },
    })
    expect(exacto.ajustePago.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ monto: 4_656 }),
      select: { id: true },
    })
  })

  it("acepta 1 y 12 meses para DESCONTAR_MESES", async () => {
    for (const meses of [1, 12]) {
      const tx = crearTx({
        pago: PAGO_SOPORTE,
        suscripcion: SUSC_FUTURA,
      })
      const resultado = await ejecutar(
        input({
          pagoId: PAGO_SOPORTE.id,
          decision: "DESCONTAR_MESES",
          mesesDescontados: meses,
        }),
        tx
      )

      expect(resultado.mesesDescontados).toBe(meses)
      expect(tx.ajustePago.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mesesDescontados: meses }),
        select: { id: true },
      })
    }
  })

  it("acepta un email en motivo o evidencia y no lo loguea (AC-19)", async () => {
    for (const campo of ["motivo", "evidencia"] as const) {
      const tx = crearTx({ pago: PAGO_HITO })
      const resultado = await ejecutar(
        input({ [campo]: "Reembolsado a pagador@example.com" }),
        tx
      )

      expect(resultado.estadoPago).toBe("REFUNDED")
      expect(tx.ajustePago.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          [campo]: "Reembolsado a pagador@example.com",
        }),
        select: { id: true },
      })
      expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
        "pagador@example.com"
      )
    }
  })

  it("AC-19: un nombre suelto en evidencia no se bloquea ni se loguea", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const resultado = await ejecutar(
      input({ evidencia: "Juan Perez" }),
      tx
    )

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(tx.ajustePago.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ evidencia: "Juan Perez" }),
      select: { id: true },
    })
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
      "Juan Perez"
    )
  })

  it("rechaza caracteres de control en motivo o evidencia", async () => {
    for (const campo of ["motivo", "evidencia"] as const) {
      const tx = crearTx({ pago: PAGO_HITO })
      const error = await capturarError(
        ejecutar(input({ [campo]: "reembolso\u0000ok" }), tx)
      )

      expect(error.codigo).toBe("ARGUMENTOS_INVALIDOS")
      expect(tx.ajustePago.create).not.toHaveBeenCalled()
    }
  })

  it("normaliza ids y textos y aplica el default de registradoPor", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    await ejecutar(
      input({
        pagoId: "  pago_1  ",
        motivo: "  Reembolso parcial  ",
        evidencia: "  REF-123  ",
        registradoPor: "  Ana Admin  ",
      }),
      tx
    )

    expect(tx.pago.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pago_1" } })
    )
    expect(tx.ajustePago.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivo: "Reembolso parcial",
        evidencia: "REF-123",
        registradoPor: "Ana Admin",
      }),
      select: { id: true },
    })
  })

  it("convierte motivo vacio en null y usa Admin por defecto si hay evidencia", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    await ejecutar(
      input({ motivo: "   ", evidencia: "REF-123", registradoPor: "" }),
      tx
    )

    expect(tx.ajustePago.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivo: null,
        evidencia: "REF-123",
        registradoPor: "Admin",
      }),
      select: { id: true },
    })
  })

  it("trunca registradoPor a 120 caracteres", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    await ejecutar(input({ registradoPor: "x".repeat(200) }), tx)

    const data = tx.ajustePago.create.mock.calls[0][0].data as {
      registradoPor: string
    }
    expect(data.registradoPor).toHaveLength(120)
  })

  it("rechaza una fecha de referencia invalida", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const error = await capturarError(
      registrarAjustePaypal(input(), {
        ahora: new Date("fecha-invalida"),
        db: crearDb(tx),
      })
    )

    expect(error.codigo).toBe("ARGUMENTOS_INVALIDOS")
    expect(tx.pago.findUnique).not.toHaveBeenCalled()
  })
})

describe("registrarAjustePaypal: pago y pasarela (AC-17, AC-22)", () => {
  it("responde PAGO_NO_ENCONTRADO si el pago no existe", async () => {
    const tx = crearTx({ pago: null })
    const error = await capturarError(ejecutar(input(), tx))

    expect(error.codigo).toBe("PAGO_NO_ENCONTRADO")
    expect(error.httpStatus).toBe(404)
    expect(error.message).toBe("Pago PayPal no encontrado.")
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
  })

  it("trata un pago de Mercado Pago como no encontrado y no lo toca", async () => {
    const pagoMp: PagoAjustable = {
      ...PAGO_HITO,
      id: "pago_mp",
      pasarela: "MERCADOPAGO",
    }
    const tx = crearTx({ pago: pagoMp })
    const error = await capturarError(ejecutar(input({ pagoId: pagoMp.id }), tx))

    expect(error.codigo).toBe("PAGO_NO_ENCONTRADO")
    expect(error.httpStatus).toBe(404)
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
  })

  it("permite ajustar un pago en REVISION rechazado (plan §4.3)", async () => {
    const pagoRevision: PagoAjustable = {
      ...PAGO_HITO,
      estadoPago: "REVISION",
      revisionEstado: "RECHAZADO",
    }
    const tx = crearTx({ pago: pagoRevision })
    const resultado = await ejecutar(input(), tx)

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(tx.pago.updateMany).toHaveBeenCalledWith({
      where: {
        id: PAGO_HITO.id,
        pasarela: "PAYPAL",
        estadoPago: "REVISION",
        revisionEstado: "RECHAZADO",
      },
      data: { estadoPago: "REFUNDED" },
    })
  })

  it.each([null, "PENDIENTE", "ACEPTADO"] as const)(
    "rechaza un pago en REVISION con revisionEstado %s",
    async (revisionEstado) => {
      const tx = crearTx({
        pago: {
          ...PAGO_HITO,
          estadoPago: "REVISION",
          revisionEstado,
        },
      })
      const error = await capturarError(ejecutar(input(), tx))

      expect(error.codigo).toBe("ESTADO_NO_AJUSTABLE")
      expect(error.httpStatus).toBe(409)
      expect(tx.ajustePago.create).not.toHaveBeenCalled()
      expect(tx.pago.updateMany).not.toHaveBeenCalled()
    }
  )

  it.each(["FAILED", "PENDING", "REFUNDED", "CONTRACARGO"] as const)(
    "rechaza ajustar un pago en estado %s",
    async (estadoPago) => {
      const tx = crearTx({
        pago: { ...PAGO_HITO, estadoPago },
      })
      const error = await capturarError(ejecutar(input(), tx))

      expect(error.codigo).toBe("ESTADO_NO_AJUSTABLE")
      expect(error.httpStatus).toBe(409)
      expect(tx.ajustePago.create).not.toHaveBeenCalled()
      expect(tx.pago.updateMany).not.toHaveBeenCalled()
    }
  )

  it("actualiza solo estadoPago y conserva el resto del pago original", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    await ejecutar(input({ tipo: "CONTRACARGO" }), tx)

    expect(tx.pago.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.pago.updateMany).toHaveBeenCalledWith({
      where: {
        id: PAGO_HITO.id,
        pasarela: "PAYPAL",
        estadoPago: "SUCCEEDED",
      },
      data: { estadoPago: "CONTRACARGO" },
    })
    // El servicio no reescribe montos, comision, recibo ni referencias.
    expect(tx.pago.updateMany.mock.calls[0][0].data).toEqual({
      estadoPago: "CONTRACARGO",
    })
  })
})

describe("registrarAjustePaypal: decision NINGUNA (AC-22)", () => {
  it("crea el AjustePago sin tocar el hito ni el soporte", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const resultado = await ejecutar(input(), tx)

    expect(resultado).toEqual({
      ajusteId: "ajuste_1",
      pagoId: PAGO_HITO.id,
      tipo: "REEMBOLSO",
      decision: "NINGUNA",
      estadoPago: "REFUNDED",
      mesesDescontados: null,
      hitoRevertido: false,
      vencimientoDescontado: false,
      soporteEnMora: false,
    })
    expect(tx.ajustePago.create).toHaveBeenCalledWith({
      data: {
        pagoId: PAGO_HITO.id,
        tipo: "REEMBOLSO",
        monto: 10_656,
        motivo: "Cliente solicito reembolso",
        evidencia: "ID de reembolso de PayPal",
        decision: "NINGUNA",
        mesesDescontados: null,
        registradoPor: "Admin",
        creadoEn: AHORA,
      },
      select: { id: true },
    })
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
    expect(tx.suscripcion.updateMany).not.toHaveBeenCalled()
  })

  it("no toca el soporte cuando el pago es de soporte y la decision es NINGUNA", async () => {
    const tx = crearTx({ pago: PAGO_SOPORTE, suscripcion: SUSC_FUTURA })
    const resultado = await ejecutar(
      input({ pagoId: PAGO_SOPORTE.id, decision: "NINGUNA" }),
      tx
    )

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(tx.suscripcion.updateMany).not.toHaveBeenCalled()
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
  })
})

describe("registrarAjustePaypal: decision REVERTIR_HITO (AC-22)", () => {
  it("revierte solo el hito vinculado al pago", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const resultado = await ejecutar(
      input({ decision: "REVERTIR_HITO" }),
      tx
    )

    expect(resultado.hitoRevertido).toBe(true)
    expect(resultado.decision).toBe("REVERTIR_HITO")
    expect(tx.hito.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.hito.updateMany).toHaveBeenCalledWith({
      where: { id: "hito_1" },
      data: { estado: "PENDIENTE", pagadoEn: null },
    })
    expect(tx.suscripcion.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza REVERTIR_HITO si el pago no tiene hito", async () => {
    const tx = crearTx({ pago: PAGO_SOPORTE, suscripcion: SUSC_FUTURA })
    const error = await capturarError(
      ejecutar(
        input({ pagoId: PAGO_SOPORTE.id, decision: "REVERTIR_HITO" }),
        tx
      )
    )

    expect(error.codigo).toBe("DECISION_INCOMPATIBLE")
    expect(error.httpStatus).toBe(400)
    expect(error.message).toContain("hito")
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
  })

  it("informa ERROR_INTERNO si el hito no se puede actualizar", async () => {
    const tx = crearTx({ pago: PAGO_HITO, hitoUpdateCount: 0 })
    const error = await capturarError(
      ejecutar(input({ decision: "REVERTIR_HITO" }), tx)
    )

    expect(error.codigo).toBe("ERROR_INTERNO")
    expect(error.httpStatus).toBe(500)
    expect(error.message).not.toContain("hito_1")
  })

  it("rechaza REVERTIR_HITO si otro Pago SUCCEEDED apunta al mismo hito", async () => {
    const tx = crearTx({
      pago: PAGO_HITO,
      otrosPagosMismoHito: [{ ...PAGO_HITO, id: "pago_2" }],
    })
    const error = await capturarError(
      ejecutar(input({ decision: "REVERTIR_HITO" }), tx)
    )

    expect(error.codigo).toBe("HITO_CON_OTRO_PAGO")
    expect(error.httpStatus).toBe(409)
    expect(tx.pago.findFirst).toHaveBeenCalledWith({
      where: {
        hitoId: "hito_1",
        estadoPago: "SUCCEEDED",
        id: { not: PAGO_HITO.id },
      },
      select: { id: true },
    })
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.pago.updateMany).not.toHaveBeenCalled()
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
  })
})

describe("registrarAjustePaypal: decision DESCONTAR_MESES (AC-22)", () => {
  it("resta meses y mantiene el estado si el nuevo vencimiento sigue futuro", async () => {
    const tx = crearTx({ pago: PAGO_SOPORTE, suscripcion: SUSC_FUTURA })
    const resultado = await ejecutar(
      input({
        pagoId: PAGO_SOPORTE.id,
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
      }),
      tx
    )

    expect(resultado).toEqual(
      expect.objectContaining({
        estadoPago: "REFUNDED",
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
        vencimientoDescontado: true,
        soporteEnMora: false,
      })
    )
    expect(tx.suscripcion.updateMany).toHaveBeenCalledWith({
      where: { id: "susc_1" },
      data: { proximoPago: addMonths(SUSC_FUTURA.proximoPago as Date, -2) },
    })
    expect(tx.hito.updateMany).not.toHaveBeenCalled()
  })

  it("restaura ACTIVE y limpia pastDueEn si estaba en mora y queda futuro", async () => {
    const tx = crearTx({
      pago: PAGO_SOPORTE,
      suscripcion: {
        ...SUSC_FUTURA,
        estado: "PAST_DUE",
        pastDueEn: new Date("2026-08-01T12:00:00.000Z"),
      },
    })
    await ejecutar(
      input({
        pagoId: PAGO_SOPORTE.id,
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
      }),
      tx
    )

    expect(tx.suscripcion.updateMany).toHaveBeenCalledWith({
      where: { id: "susc_1" },
      data: {
        proximoPago: addMonths(SUSC_FUTURA.proximoPago as Date, -2),
        estado: "ACTIVE",
        pastDueEn: null,
      },
    })
  })

  it("marca PAST_DUE y conserva el pastDueEn existente si queda vencido", async () => {
    const proximoPago = new Date("2026-09-15T12:00:00.000Z")
    const pastDueEn = new Date("2026-08-01T12:00:00.000Z")
    const tx = crearTx({
      pago: PAGO_SOPORTE,
      suscripcion: { ...SUSC_FUTURA, proximoPago, pastDueEn },
    })

    const resultado = await ejecutar(
      input({
        pagoId: PAGO_SOPORTE.id,
        decision: "DESCONTAR_MESES",
        mesesDescontados: 3,
      }),
      tx
    )

    expect(resultado.soporteEnMora).toBe(true)
    expect(tx.suscripcion.updateMany).toHaveBeenCalledWith({
      where: { id: "susc_1" },
      data: {
        proximoPago: addMonths(proximoPago, -3),
        estado: "PAST_DUE",
        pastDueEn,
      },
    })
  })

  it("usa la fecha del ajuste como pastDueEn si no habia uno", async () => {
    const proximoPago = new Date("2026-09-15T12:00:00.000Z")
    const tx = crearTx({
      pago: PAGO_SOPORTE,
      suscripcion: { ...SUSC_FUTURA, proximoPago, pastDueEn: null },
    })

    await ejecutar(
      input({
        pagoId: PAGO_SOPORTE.id,
        decision: "DESCONTAR_MESES",
        mesesDescontados: 2,
      }),
      tx
    )

    expect(tx.suscripcion.updateMany).toHaveBeenCalledWith({
      where: { id: "susc_1" },
      data: {
        proximoPago: addMonths(proximoPago, -2),
        estado: "PAST_DUE",
        pastDueEn: AHORA,
      },
    })
  })

  it("responde SIN_VENCIMIENTO si el soporte no tiene proximoPago", async () => {
    const tx = crearTx({
      pago: PAGO_SOPORTE,
      suscripcion: { ...SUSC_FUTURA, proximoPago: null },
    })
    const error = await capturarError(
      ejecutar(
        input({
          pagoId: PAGO_SOPORTE.id,
          decision: "DESCONTAR_MESES",
          mesesDescontados: 1,
        }),
        tx
      )
    )

    expect(error.codigo).toBe("SIN_VENCIMIENTO")
    expect(error.httpStatus).toBe(409)
    expect(tx.suscripcion.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza DESCONTAR_MESES si el pago no tiene soporte", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const error = await capturarError(
      ejecutar(
        input({ decision: "DESCONTAR_MESES", mesesDescontados: 1 }),
        tx
      )
    )

    expect(error.codigo).toBe("DECISION_INCOMPATIBLE")
    expect(tx.ajustePago.create).not.toHaveBeenCalled()
    expect(tx.suscripcion.updateMany).not.toHaveBeenCalled()
  })

  it("informa ERROR_INTERNO si el soporte no se puede actualizar", async () => {
    const tx = crearTx({
      pago: PAGO_SOPORTE,
      suscripcion: SUSC_FUTURA,
      suscripcionUpdateCount: 0,
    })
    const error = await capturarError(
      ejecutar(
        input({
          pagoId: PAGO_SOPORTE.id,
          decision: "DESCONTAR_MESES",
          mesesDescontados: 1,
        }),
        tx
      )
    )

    expect(error.codigo).toBe("ERROR_INTERNO")
  })
})

describe("registrarAjustePaypal: errores y trazabilidad (AC-19, AC-22)", () => {
  it("sanea un error inesperado y no loguea motivo, evidencia ni PII", async () => {
    const tx = crearTx({
      pago: PAGO_HITO,
      errorCreate: new Error("fallo con pagador@example.com"),
    })
    const error = await capturarError(
      ejecutar(
        input({
          motivo: "Juan Perez pidio el reembolso",
          evidencia: "comprobante privado",
        }),
        tx
      )
    )

    expect(error.codigo).toBe("ERROR_INTERNO")
    expect(error.httpStatus).toBe(500)
    expect(error.message).not.toContain("pagador@example.com")
    expect(error.message).not.toContain("Juan Perez")
    expect(tx.pago.updateMany).not.toHaveBeenCalled()

    const meta = metadatosDeLog()
    expect(meta).not.toHaveProperty("motivo")
    expect(meta).not.toHaveProperty("evidencia")
    expect(JSON.stringify(meta)).not.toContain("pagador@example.com")
    expect(JSON.stringify(meta)).not.toContain("Juan Perez")
    expect(JSON.stringify(meta)).not.toContain("comprobante")
  })

  it("informa ERROR_INTERNO si no se puede actualizar el pago", async () => {
    const tx = crearTx({ pago: PAGO_HITO, pagoUpdateCount: 0 })
    const error = await capturarError(ejecutar(input(), tx))

    expect(error.codigo).toBe("ERROR_INTERNO")
    expect(error.httpStatus).toBe(500)
  })

  it("funciona con un db sin $transaction (fallback de dobles)", async () => {
    const tx = crearTx({ pago: PAGO_HITO })
    const db = { ...tx } as unknown as PaypalAdjustmentDb

    const resultado = await registrarAjustePaypal(input(), {
      ahora: AHORA,
      db,
    })

    expect(resultado.estadoPago).toBe("REFUNDED")
    expect(tx.pago.updateMany).toHaveBeenCalledTimes(1)
  })
})
