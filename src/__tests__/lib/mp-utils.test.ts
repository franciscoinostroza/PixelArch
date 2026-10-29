import { describe, expect, it } from "vitest"
import {
  ESTADOS_RECIBO_MERCADOPAGO,
  RECIBO_MP_CONCEPTO_MAX,
  RECIBO_MP_REFERENCIA_MAX,
  ReciboMpValidationError,
  esEstadoReciboMercadoPago,
  mapearEstadoPagoMp,
  monedaReciboMp,
  normalizarMeses,
  resolverFechaReciboMp,
  tituloLink,
  validarMontosReciboMp,
  vencimientoConMeses,
  type MontosReciboMp,
} from "@/lib/mp-utils"

/** Captura el error de validacion y comprueba el campo culpable. */
function capturarErrorReciboMp(fn: () => unknown): ReciboMpValidationError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ReciboMpValidationError)
    return error as ReciboMpValidationError
  }
  throw new Error("Se esperaba un ReciboMpValidationError")
}

describe("normalizarMeses", () => {
  it("normaliza numeros validos", () => {
    expect(normalizarMeses(1)).toBe(1)
    expect(normalizarMeses("3")).toBe(3)
    expect(normalizarMeses(12)).toBe(12)
  })

  it("clampea a 12 y a 0", () => {
    expect(normalizarMeses(20)).toBe(12)
    expect(normalizarMeses(-4)).toBe(0)
    expect(normalizarMeses(0)).toBe(0)
  })

  it("devuelve 0 para valores invalidos", () => {
    expect(normalizarMeses(undefined)).toBe(0)
    expect(normalizarMeses(null)).toBe(0)
    expect(normalizarMeses("abc")).toBe(0)
    expect(normalizarMeses(NaN)).toBe(0)
  })
})

describe("mapearEstadoPagoMp", () => {
  it("approved -> SUCCEEDED", () => {
    expect(mapearEstadoPagoMp("approved")).toBe("SUCCEEDED")
  })

  it("rejected y cancelled -> FAILED", () => {
    expect(mapearEstadoPagoMp("rejected")).toBe("FAILED")
    expect(mapearEstadoPagoMp("cancelled")).toBe("FAILED")
  })

  it("estados intermedios se ignoran", () => {
    expect(mapearEstadoPagoMp("pending")).toBeNull()
    expect(mapearEstadoPagoMp("in_process")).toBeNull()
    expect(mapearEstadoPagoMp("refunded")).toBeNull()
    expect(mapearEstadoPagoMp(undefined)).toBeNull()
  })
})

describe("vencimientoConMeses", () => {
  const ahora = new Date("2026-09-10T12:00:00")

  it("0 meses no mueve el vencimiento", () => {
    const actual = new Date("2026-09-20T12:00:00")
    expect(vencimientoConMeses(actual, 0, ahora)?.toISOString().slice(0, 10)).toBe("2026-09-20")
    expect(vencimientoConMeses(null, 0, ahora)).toBeNull()
  })

  it("acredita N meses desde el vencimiento futuro", () => {
    const r = vencimientoConMeses(new Date("2026-09-20T12:00:00"), 3, ahora)
    expect(r?.toISOString().slice(0, 10)).toBe("2026-12-20")
  })

  it("si esta vencido, cuenta desde hoy", () => {
    const r = vencimientoConMeses(new Date("2026-07-01T12:00:00"), 2, ahora)
    expect(r?.toISOString().slice(0, 10)).toBe("2026-11-10")
  })

  it("sin vencimiento previo, cuenta desde hoy", () => {
    const r = vencimientoConMeses(null, 1, ahora)
    expect(r?.toISOString().slice(0, 10)).toBe("2026-10-10")
  })

  it("clampea fin de mes", () => {
    const r = vencimientoConMeses(new Date("2027-01-31T12:00:00"), 1, new Date("2026-12-01T12:00:00"))
    expect(r?.toISOString().slice(0, 10)).toBe("2027-02-28")
  })

  it("no muta la fecha original", () => {
    const original = new Date("2026-09-20T12:00:00")
    vencimientoConMeses(original, 3, ahora)
    expect(original.toISOString().slice(0, 10)).toBe("2026-09-20")
  })
})

describe("tituloLink", () => {
  it("genera titulos legibles", () => {
    expect(tituloLink("Chatbot", 0)).toBe("Chatbot — pago")
    expect(tituloLink("Chatbot", 1)).toBe("Chatbot — 1 mes")
    expect(tituloLink("Chatbot", 4)).toBe("Chatbot — 4 meses")
  })
})

/* -------------------------------------------------------------------------- */
/* Recibo interno de Mercado Pago (spec 002, T-01)                            */
/* -------------------------------------------------------------------------- */

describe("estados con recibo de Mercado Pago", () => {
  it("solo SUCCEEDED, REVISION, REFUNDED y CONTRACARGO llevan recibo (D-3)", () => {
    expect(ESTADOS_RECIBO_MERCADOPAGO).toEqual([
      "SUCCEEDED",
      "REVISION",
      "REFUNDED",
      "CONTRACARGO",
    ])
    for (const estado of ESTADOS_RECIBO_MERCADOPAGO) {
      expect(esEstadoReciboMercadoPago(estado)).toBe(true)
    }
  })

  it("FAILED, PENDING, null y estados desconocidos no llevan recibo", () => {
    expect(esEstadoReciboMercadoPago("FAILED")).toBe(false)
    expect(esEstadoReciboMercadoPago("PENDING")).toBe(false)
    expect(esEstadoReciboMercadoPago("OTRO")).toBe(false)
    expect(esEstadoReciboMercadoPago("")).toBe(false)
    expect(esEstadoReciboMercadoPago(null)).toBe(false)
    expect(esEstadoReciboMercadoPago(undefined)).toBe(false)
  })

  it("tolera minusculas y espacios de datos historicos", () => {
    expect(esEstadoReciboMercadoPago(" succeeded ")).toBe(true)
    expect(esEstadoReciboMercadoPago("refunded")).toBe(true)
    expect(esEstadoReciboMercadoPago("Contracargo")).toBe(true)
  })

  it("expone los maximos de referencia y concepto", () => {
    expect(RECIBO_MP_REFERENCIA_MAX).toBe(128)
    expect(RECIBO_MP_CONCEPTO_MAX).toBe(200)
  })
})

describe("validarMontosReciboMp", () => {
  it("usa el monto cobrado como acordado y comision 0 si no se informan", () => {
    const esperado: MontosReciboMp = {
      montoAcordado: 100000,
      comision: 0,
      total: 100000,
    }
    expect(validarMontosReciboMp({ monto: 100000 })).toEqual(esperado)
    expect(
      validarMontosReciboMp({ monto: 100000, montoAcordado: null, comision: null })
    ).toEqual(esperado)
    expect(
      validarMontosReciboMp({ monto: 100000, montoAcordado: undefined, comision: 0 })
    ).toEqual(esperado)
  })

  it("acepta un desglose con comision mayor que 0 que reconcilia", () => {
    expect(
      validarMontosReciboMp({ monto: 10606, montoAcordado: 10000, comision: 606 })
    ).toEqual({ montoAcordado: 10000, comision: 606, total: 10606 })
  })

  it("acepta montos en cero: la regla es entero no negativo", () => {
    expect(validarMontosReciboMp({ monto: 0 })).toEqual({
      montoAcordado: 0,
      comision: 0,
      total: 0,
    })
  })

  it("rechaza un total que no reconcilia", () => {
    expect(() =>
      validarMontosReciboMp({ monto: 10605, montoAcordado: 10000, comision: 606 })
    ).toThrow(ReciboMpValidationError)
    expect(() =>
      validarMontosReciboMp({ monto: 10000, montoAcordado: 9000, comision: 0 })
    ).toThrow(ReciboMpValidationError)
    expect(() =>
      validarMontosReciboMp({ monto: 10000, comision: 606 })
    ).toThrow(ReciboMpValidationError)
  })

  it("rechaza comision registrada sin monto acordado (AC-25)", () => {
    const error = capturarErrorReciboMp(() =>
      validarMontosReciboMp({ monto: 10606, comision: 606 })
    )
    expect(error.campo).toBe("total")
  })

  it("rechaza montos negativos, decimales o no finitos", () => {
    expect(() => validarMontosReciboMp({ monto: -1 })).toThrow(
      ReciboMpValidationError
    )
    expect(() => validarMontosReciboMp({ monto: 100.5 })).toThrow(
      ReciboMpValidationError
    )
    expect(() => validarMontosReciboMp({ monto: Number.NaN })).toThrow(
      ReciboMpValidationError
    )
    expect(() =>
      validarMontosReciboMp({ monto: Number.POSITIVE_INFINITY })
    ).toThrow(ReciboMpValidationError)
    expect(() =>
      validarMontosReciboMp({ monto: 100, montoAcordado: -1 })
    ).toThrow(ReciboMpValidationError)
    expect(() =>
      validarMontosReciboMp({ monto: 100, comision: -1 })
    ).toThrow(ReciboMpValidationError)
    expect(() =>
      validarMontosReciboMp({ monto: 100, comision: 1.5 })
    ).toThrow(ReciboMpValidationError)
  })

  it("informa el campo culpable", () => {
    expect(capturarErrorReciboMp(() => validarMontosReciboMp({ monto: -1 })).campo).toBe(
      "total"
    )
    expect(
      capturarErrorReciboMp(() =>
        validarMontosReciboMp({ monto: 100, montoAcordado: -1 })
      ).campo
    ).toBe("montoAcordado")
    expect(
      capturarErrorReciboMp(() =>
        validarMontosReciboMp({ monto: 100, comision: -1 })
      ).campo
    ).toBe("comision")
  })
})

describe("monedaReciboMp", () => {
  it("normaliza ARS y USD (case-insensitive)", () => {
    expect(monedaReciboMp("ars")).toBe("ars")
    expect(monedaReciboMp("ARS")).toBe("ars")
    expect(monedaReciboMp(" ars ")).toBe("ars")
    expect(monedaReciboMp("usd")).toBe("usd")
    expect(monedaReciboMp("USD")).toBe("usd")
  })

  it("devuelve null para monedas no soportadas", () => {
    expect(monedaReciboMp("eur")).toBeNull()
    expect(monedaReciboMp("ARS/USD")).toBeNull()
    expect(monedaReciboMp("")).toBeNull()
    expect(monedaReciboMp("   ")).toBeNull()
    expect(monedaReciboMp(null)).toBeNull()
    expect(monedaReciboMp(undefined)).toBeNull()
  })
})

describe("resolverFechaReciboMp", () => {
  const pago = new Date("2026-10-01T12:00:00.000Z")
  const emision = new Date("2026-10-05T12:00:00.000Z")

  it("prioriza la fecha de emision", () => {
    expect(resolverFechaReciboMp(emision, pago)?.toISOString()).toBe(
      emision.toISOString()
    )
  })

  it("usa la fecha del pago cuando no hay emision", () => {
    expect(resolverFechaReciboMp(null, pago)?.toISOString()).toBe(
      pago.toISOString()
    )
    expect(
      resolverFechaReciboMp(undefined, "2026-10-01T12:00:00.000Z")?.toISOString()
    ).toBe(pago.toISOString())
  })

  it("devuelve null si no hay fecha valida", () => {
    expect(resolverFechaReciboMp(null, null)).toBeNull()
    expect(resolverFechaReciboMp(undefined, undefined)).toBeNull()
    expect(resolverFechaReciboMp(null, "no-es-fecha")).toBeNull()
    expect(resolverFechaReciboMp("", pago)).toBeNull()
    expect(resolverFechaReciboMp(new Date(Number.NaN), pago)).toBeNull()
  })

  it("no muta la fecha original", () => {
    const original = new Date(emision.getTime())
    const resuelta = resolverFechaReciboMp(original, pago)
    resuelta?.setUTCFullYear(2030)
    expect(original.toISOString()).toBe(emision.toISOString())
  })
})