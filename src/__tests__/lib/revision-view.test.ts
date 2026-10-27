import { describe, expect, it } from "vitest"

/**
 * T-27 (AC-17, AC-27): reglas puras de elegibilidad de la revision de un pago
 * PayPal por diferencia de monto.
 *
 * `revision-view.ts` es un modulo client-safe que comparten `/admin/pagos` y el
 * modal. Se cubren:
 * - solo PayPal en `REVISION` con `revisionEstado = PENDIENTE`;
 * - aceptar solo en USD y con referencia externa (capture id u order id);
 * - bloqueo cuando la revision fue originada por una captura en otra moneda
 *   aunque `Pago.moneda` se haya persistido como `usd` (T-10/T-11);
 * - diferencia entera en centavos, sin floats.
 *
 * Sin React, sin Prisma y sin red.
 */

import {
  diferenciaRevisionPaypal,
  esPagoRevisablePaypal,
  esRevisionPorMoneda,
  motivoNoAceptaRevision,
  puedeAceptarRevisionPaypal,
  type PagoRevisableView,
} from "@/lib/paypal/revision-view"

const PAGO: PagoRevisableView = {
  pasarela: "PAYPAL",
  estadoPago: "REVISION",
  revisionEstado: "PENDIENTE",
  moneda: "usd",
  revisionNota: "El total capturado no coincide con el total esperado del link.",
  externalId: "CAPTURE-1",
  paypalOrderId: "ORDER-1",
  monto: 10000,
  montoEsperado: 10656,
}

function pago(overrides: Partial<PagoRevisableView> = {}): PagoRevisableView {
  return { ...PAGO, ...overrides }
}

describe("esPagoRevisablePaypal (AC-17, AC-27)", () => {
  it("acepta un pago PayPal en REVISION pendiente", () => {
    expect(esPagoRevisablePaypal(PAGO)).toBe(true)
  })

  it("normaliza mayusculas y espacios de los estados", () => {
    expect(
      esPagoRevisablePaypal({
        ...PAGO,
        pasarela: " paypal ",
        estadoPago: " revision ",
        revisionEstado: " pendiente ",
      })
    ).toBe(true)
  })

  it.each([
    ["otra pasarela", { pasarela: "MERCADOPAGO" }],
    ["pago ya resuelto", { estadoPago: "SUCCEEDED" }],
    ["revision aceptada", { revisionEstado: "ACEPTADO" }],
    ["revision rechazada", { revisionEstado: "RECHAZADO" }],
    ["revision sin estado", { revisionEstado: null }],
    ["pasarela ausente", { pasarela: null }],
    ["estado ausente", { estadoPago: null }],
  ])("no ofrece resolver %s", (_caso, overrides) => {
    expect(esPagoRevisablePaypal(pago(overrides))).toBe(false)
  })
})

describe("esRevisionPorMoneda (AC-27)", () => {
  it("detecta el prefijo estructural que escriben T-10/T-11", () => {
    expect(
      esRevisionPorMoneda(
        "Moneda capturada EUR; moneda del link USD; esperado USD."
      )
    ).toBe(true)
    expect(esRevisionPorMoneda("Moneda capturada desconocida")).toBe(true)
    expect(esRevisionPorMoneda("MONEDA: EUR")).toBe(true)
    expect(esRevisionPorMoneda("moneda:eur")).toBe(true)
    expect(esRevisionPorMoneda("  Moneda capturada ARS")).toBe(true)
  })

  it("no marca notas que solo mencionan la moneda", () => {
    expect(esRevisionPorMoneda(null)).toBe(false)
    expect(esRevisionPorMoneda(undefined)).toBe(false)
    expect(esRevisionPorMoneda("Diferencia de monto")).toBe(false)
    expect(esRevisionPorMoneda("Diferencia de moneda")).toBe(false)
    expect(esRevisionPorMoneda("Nota: moneda capturada ARS")).toBe(false)
    expect(esRevisionPorMoneda("Moneda")).toBe(false)
    expect(esRevisionPorMoneda("Moneda capturadamente")).toBe(false)
  })
})

describe("motivoNoAceptaRevision (AC-27)", () => {
  it("permite aceptar un pago USD con capture id", () => {
    expect(motivoNoAceptaRevision(PAGO)).toBeNull()
    expect(puedeAceptarRevisionPaypal(PAGO)).toBe(true)
  })

  it("permite aceptar un pago USD con solo order id", () => {
    const soloOrder = pago({ externalId: null, paypalOrderId: "ORDER-1" })

    expect(motivoNoAceptaRevision(soloOrder)).toBeNull()
    expect(puedeAceptarRevisionPaypal(soloOrder)).toBe(true)
  })

  it("bloquea con MONEDA cuando Pago.moneda no es USD", () => {
    const pagoArs = pago({ moneda: "ars" })

    expect(motivoNoAceptaRevision(pagoArs)).toBe("MONEDA")
    expect(puedeAceptarRevisionPaypal(pagoArs)).toBe(false)
  })

  it("bloquea con MONEDA cuando la nota marca otra moneda aunque Pago.moneda sea usd", () => {
    // Caso real de T-10/T-11: el pago PayPal se persiste siempre en USD y la
    // moneda extranjera queda documentada en `revisionNota`.
    const pagoEur = pago({
      moneda: "usd",
      revisionNota:
        "Moneda capturada EUR; moneda del link USD; esperado USD.",
    })

    expect(motivoNoAceptaRevision(pagoEur)).toBe("MONEDA")
    expect(puedeAceptarRevisionPaypal(pagoEur)).toBe(false)
  })

  it("bloquea con SIN_REFERENCIA cuando faltan capture id y order id", () => {
    const sinReferencia = pago({
      externalId: null,
      paypalOrderId: null,
    })

    expect(motivoNoAceptaRevision(sinReferencia)).toBe("SIN_REFERENCIA")
    expect(puedeAceptarRevisionPaypal(sinReferencia)).toBe(false)
  })

  it("trata ids vacios o con espacios como ausentes", () => {
    expect(
      motivoNoAceptaRevision(
        pago({ externalId: "   ", paypalOrderId: "" })
      )
    ).toBe("SIN_REFERENCIA")
  })

  it("responde NO_REVISABLE antes que cualquier otra condicion", () => {
    const noRevisable = pago({
      pasarela: "PAYPAL",
      estadoPago: "SUCCEEDED",
      revisionEstado: null,
      moneda: "ars",
      externalId: null,
      paypalOrderId: null,
    })

    expect(motivoNoAceptaRevision(noRevisable)).toBe("NO_REVISABLE")
    expect(puedeAceptarRevisionPaypal(noRevisable)).toBe(false)
  })
})

describe("diferenciaRevisionPaypal (AC-27)", () => {
  it("calcula la diferencia negativa en centavos", () => {
    expect(diferenciaRevisionPaypal({ monto: 10000, montoEsperado: 10656 })).toBe(
      -656
    )
  })

  it("calcula la diferencia positiva y el caso sin diferencia", () => {
    expect(diferenciaRevisionPaypal({ monto: 11000, montoEsperado: 10656 })).toBe(
      344
    )
    expect(diferenciaRevisionPaypal({ monto: 10656, montoEsperado: 10656 })).toBe(
      0
    )
  })

  it("devuelve null si falta algun monto", () => {
    expect(diferenciaRevisionPaypal({ monto: null, montoEsperado: 10656 })).toBeNull()
    expect(diferenciaRevisionPaypal({ monto: 10000, montoEsperado: null })).toBeNull()
    expect(diferenciaRevisionPaypal({})).toBeNull()
  })

  it.each([
    ["monto negativo", { monto: -1, montoEsperado: 10656 }],
    ["esperado negativo", { monto: 10000, montoEsperado: -1 }],
    ["monto decimal", { monto: 100.5, montoEsperado: 10656 }],
    ["monto no finito", { monto: Number.POSITIVE_INFINITY, montoEsperado: 10656 }],
    ["monto NaN", { monto: Number.NaN, montoEsperado: 10656 }],
  ])("devuelve null con %s", (_caso, montos) => {
    expect(diferenciaRevisionPaypal(montos)).toBeNull()
  })
})
