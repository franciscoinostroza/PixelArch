import { describe, expect, it } from "vitest"
import { PAYPAL_DEFAULT_FEE } from "@/lib/paypal/config"
import {
  calcularGrossUp,
  snapshotTarifa,
  validarTarifa,
} from "@/lib/paypal/fees"
import { PaypalValidationError } from "@/lib/paypal/utils"

/**
 * T-04 (AC-18, AC-24): gross-up entero, snapshot de tarifa y validacion de
 * montos/tarifas. El ejemplo obligatorio del plan es US$100,50 + 5,40% +
 * US$0,30 -> total US$106,56 y comision US$6,06.
 */
describe("calcularGrossUp (T-04, AC-24)", () => {
  it("aplica el ejemplo obligatorio: US$100,50 -> total US$106,56 / comision US$6,06", () => {
    const resultado = calcularGrossUp(10050, { bps: 540, fixedCents: 30 })

    expect(resultado).toEqual({
      montoAcordadoCents: 10050,
      comisionCents: 606,
      totalCents: 10656,
      feeBps: 540,
      feeFixedCents: 30,
    })
    expect(resultado.totalCents - resultado.montoAcordadoCents).toBe(resultado.comisionCents)
  })

  it("usa la tarifa default 540 bps + 30 centavos", () => {
    expect(calcularGrossUp(10050)).toEqual(calcularGrossUp(10050, PAYPAL_DEFAULT_FEE))
    expect(PAYPAL_DEFAULT_FEE).toEqual({ bps: 540, fixedCents: 30 })
  })

  it("redondea hacia arriba para no cobrar de menos", () => {
    // 100 * 10000 / 9460 = 105,708... -> 106 centavos.
    const resultado = calcularGrossUp(100, { bps: 540, fixedCents: 0 })
    expect(resultado.totalCents).toBe(106)
    expect(resultado.comisionCents).toBe(6)
  })

  it("con bps 0 y fijo 0 no agrega comision", () => {
    const resultado = calcularGrossUp(10050, { bps: 0, fixedCents: 0 })
    expect(resultado.totalCents).toBe(10050)
    expect(resultado.comisionCents).toBe(0)
  })

  it("con bps 0 solo suma el fijo", () => {
    const resultado = calcularGrossUp(10050, { bps: 0, fixedCents: 30 })
    expect(resultado.totalCents).toBe(10080)
    expect(resultado.comisionCents).toBe(30)
  })

  it("admite el maximo de bps (9999) sin dividir por cero", () => {
    const resultado = calcularGrossUp(1, { bps: 9999, fixedCents: 0 })
    expect(resultado.totalCents).toBe(10000)
    expect(resultado.comisionCents).toBe(9999)
  })

  it("rechaza montos invalidos", () => {
    for (const monto of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => calcularGrossUp(monto, { bps: 540, fixedCents: 30 })).toThrow(
        PaypalValidationError
      )
    }
  })

  it("rechaza montos cuyo calculo excede el rango seguro", () => {
    const monto = Math.floor(Number.MAX_SAFE_INTEGER / 10_000) + 1
    expect(() => calcularGrossUp(monto, { bps: 0, fixedCents: 0 })).toThrow(
      PaypalValidationError
    )
    expect(() =>
      calcularGrossUp(Math.floor(Number.MAX_SAFE_INTEGER / 10_000), {
        bps: 0,
        fixedCents: 1,
      })
    ).toThrow(PaypalValidationError)
  })

  it("calcula el monto valido mas grande sin perder precision (referencia BigInt)", () => {
    const bps = 540
    const fixedCents = 30
    const maxBaseSegura = Math.floor(Number.MAX_SAFE_INTEGER / 10_000)
    const monto = maxBaseSegura - fixedCents

    const resultado = calcularGrossUp(monto, { bps, fixedCents })

    // Misma formula con aritmetica exacta: ceil((monto + fijo) * 10000 / (10000 - bps)).
    const base = BigInt(monto) + BigInt(fixedCents)
    const denominador = BigInt(10_000 - bps)
    const numerador = base * BigInt(10_000)
    const totalEsperado = (numerador + denominador - BigInt(1)) / denominador

    expect(Number.isSafeInteger(resultado.totalCents)).toBe(true)
    expect(resultado.totalCents).toBe(Number(totalEsperado))
    expect(resultado.comisionCents).toBe(Number(totalEsperado) - monto)
    expect(resultado.totalCents - resultado.montoAcordadoCents).toBe(
      resultado.comisionCents
    )
  })

  it("rechaza bps fuera de 0..9999 o no enteros", () => {
    for (const bps of [-1, 10_000, 1.5, NaN]) {
      expect(() => calcularGrossUp(10050, { bps, fixedCents: 30 })).toThrow(
        PaypalValidationError
      )
    }
  })

  it("rechaza fijo negativo o no entero", () => {
    for (const fixedCents of [-1, 0.5, NaN]) {
      expect(() => calcularGrossUp(10050, { bps: 540, fixedCents })).toThrow(
        PaypalValidationError
      )
    }
  })
})

describe("validarTarifa / snapshotTarifa (T-04, AC-24)", () => {
  it("devuelve el snapshot con los nombres de campos de la base", () => {
    expect(snapshotTarifa({ bps: 540, fixedCents: 30 })).toEqual({
      feeBps: 540,
      feeFixedCents: 30,
    })
  })

  it("acepta los limites 0 y 9999", () => {
    expect(validarTarifa({ bps: 0, fixedCents: 0 })).toEqual({ bps: 0, fixedCents: 0 })
    expect(validarTarifa({ bps: 9999, fixedCents: 0 })).toEqual({ bps: 9999, fixedCents: 0 })
  })

  it("rechaza tarifas invalidas", () => {
    expect(() => snapshotTarifa({ bps: 10_000, fixedCents: 30 })).toThrow(PaypalValidationError)
    expect(() => snapshotTarifa({ bps: 540, fixedCents: -1 })).toThrow(PaypalValidationError)
  })
})
