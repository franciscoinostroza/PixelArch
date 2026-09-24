import { describe, expect, it } from "vitest"
import {
  addMonths,
  siguienteVencimiento,
  convertirArsAUsd,
  convertirUsdAArs,
  equivalenteUsd,
  formatearMonto,
  precioDePlan,
  normalizeMoneda,
} from "@/lib/pagos"

describe("normalizeMoneda", () => {
  it("normaliza a usd o ars", () => {
    expect(normalizeMoneda("ars")).toBe("ars")
    expect(normalizeMoneda("USD")).toBe("usd")
    expect(normalizeMoneda(undefined)).toBe("usd")
    expect(normalizeMoneda(null)).toBe("usd")
  })
})

describe("addMonths", () => {
  it("suma un mes simple", () => {
    const r = addMonths(new Date("2026-03-15T12:00:00"), 1)
    expect(r.getMonth()).toBe(3)
    expect(r.getDate()).toBe(15)
  })

  it("clampea fin de mes (31 ene -> 28/29 feb)", () => {
    const r = addMonths(new Date("2026-01-31T12:00:00"), 1)
    expect(r.getMonth()).toBe(1)
    expect(r.getDate()).toBe(28)
  })

  it("clampea 31 marzo -> 30 abril", () => {
    const r = addMonths(new Date("2026-03-31T12:00:00"), 1)
    expect(r.getMonth()).toBe(3)
    expect(r.getDate()).toBe(30)
  })

  it("cruza de año", () => {
    const r = addMonths(new Date("2026-12-15T12:00:00"), 1)
    expect(r.getFullYear()).toBe(2027)
    expect(r.getMonth()).toBe(0)
  })
})

describe("siguienteVencimiento", () => {
  const ahora = new Date("2026-09-10T12:00:00")

  it("si el vencimiento es futuro, avanza desde ese vencimiento", () => {
    const r = siguienteVencimiento(new Date("2026-09-20T12:00:00"), ahora)
    expect(r.toISOString().slice(0, 10)).toBe("2026-10-20")
  })

  it("si esta vencido, cuenta desde hoy", () => {
    const r = siguienteVencimiento(new Date("2026-07-01T12:00:00"), ahora)
    expect(r.toISOString().slice(0, 10)).toBe("2026-10-10")
  })

  it("sin vencimiento previo, cuenta desde hoy", () => {
    const r = siguienteVencimiento(null, ahora)
    expect(r.toISOString().slice(0, 10)).toBe("2026-10-10")
  })

  it("no muta la fecha original", () => {
    const original = new Date("2026-09-20T12:00:00")
    siguienteVencimiento(original, ahora)
    expect(original.toISOString().slice(0, 10)).toBe("2026-09-20")
  })
})

describe("conversiones", () => {
  it("ARS a USD con dolar", () => {
    expect(convertirArsAUsd(3850000, 1540)).toBe(2500)
  })

  it("USD a ARS con dolar", () => {
    expect(convertirUsdAArs(2500, 1540)).toBe(3850000)
  })

  it("rate invalido devuelve 0", () => {
    expect(convertirArsAUsd(100, 0)).toBe(0)
    expect(convertirUsdAArs(100, -5)).toBe(0)
  })

  it("equivalente USD usa cotizacion guardada si existe", () => {
    expect(equivalenteUsd(3850000, "ars", 1540, 2000)).toBe(2500)
  })

  it("equivalente USD usa dolar actual si no hay cotizacion", () => {
    expect(equivalenteUsd(3850000, "ars", null, 1540)).toBe(2500)
  })

  it("pago en USD es su propio equivalente", () => {
    expect(equivalenteUsd(2500, "usd", null, 1540)).toBe(2500)
  })

  it("sin ningun dolar devuelve null", () => {
    expect(equivalenteUsd(3850000, "ars", null, null)).toBeNull()
  })
})

describe("formatearMonto", () => {
  it("formatea USD en centavos", () => {
    expect(formatearMonto(2500, "usd")).toBe("US$25.00")
  })

  it("formatea ARS en centavos", () => {
    expect(formatearMonto(3850000, "ars")).toBe("$38.500 ARS")
  })
})

describe("precioDePlan", () => {
  const precios = { precioUnico: 25000, precioBasico: 2500, precioMantenimiento: 10000 }

  it("usa el precio de catalogo segun plan", () => {
    expect(precioDePlan("BASICO", precios)).toBe(2500)
    expect(precioDePlan("MANTENIMIENTO", precios)).toBe(10000)
    expect(precioDePlan("UNICO", precios)).toBe(25000)
  })

  it("soporte usa precio custom o referencia de mantenimiento", () => {
    expect(precioDePlan("SOPORTE", precios)).toBe(10000)
    expect(precioDePlan("SOPORTE", precios, 3000)).toBe(3000)
  })

  it("prioriza el precio custom", () => {
    expect(precioDePlan("BASICO", precios, 1800)).toBe(1800)
  })

  it("ignora precio custom invalido", () => {
    expect(precioDePlan("BASICO", precios, 0)).toBe(2500)
  })
})