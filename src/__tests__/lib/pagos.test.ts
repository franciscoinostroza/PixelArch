import { describe, expect, it } from "vitest"
import type { MetodoPago } from "@prisma/client"
import {
  addMonths,
  siguienteVencimiento,
  convertirArsAUsd,
  convertirUsdAArs,
  equivalenteUsd,
  formatearMonto,
  precioDePlan,
  normalizeMoneda,
  METODOS_PAGO,
  METODO_LABEL,
  type MetodoPagoValue,
} from "@/lib/pagos"

// T-03: los tipos de la lib deben seguir siendo coherentes con el enum de Prisma.
type MetodoPagoValueValido = MetodoPagoValue extends MetodoPago ? true : never
type MetodoPagoCubierto = MetodoPago extends MetodoPagoValue ? true : never
const metodoPagoValueValido: MetodoPagoValueValido = true
const metodoPagoCubierto: MetodoPagoCubierto = true
void metodoPagoValueValido
void metodoPagoCubierto

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

describe("formatearMonto (T-04b, AC-18)", () => {
  it("usa es-AR por defecto en USD, con centavos y miles", () => {
    expect(formatearMonto(2500, "usd")).toBe("US$25,00")
    expect(formatearMonto(10050, "usd")).toBe("US$100,50")
    expect(formatearMonto(100050, "usd")).toBe("US$1.000,50")
    expect(formatearMonto(1, "usd")).toBe("US$0,01")
    expect(formatearMonto(123456789, "usd")).toBe("US$1.234.567,89")
  })

  it("formatea USD en es-AR explicito", () => {
    expect(formatearMonto(10050, "usd", "es-AR")).toBe("US$100,50")
    expect(formatearMonto(100050, "usd", "es-AR")).toBe("US$1.000,50")
  })

  it("formatea USD en en-US explicito solo para plantillas EN", () => {
    expect(formatearMonto(10050, "usd", "en-US")).toBe("US$100.50")
    expect(formatearMonto(100050, "usd", "en-US")).toBe("US$1,000.50")
  })

  it("mantiene el formato ARS", () => {
    expect(formatearMonto(3850000, "ars")).toBe("$38.500 ARS")
    expect(formatearMonto(3850000, "ars", "es-AR")).toBe("$38.500 ARS")
    expect(formatearMonto(3850000, "ars", "en-US")).toBe("$38,500 ARS")
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

describe("metodos de pago (T-03, AC-1, AC-11, AC-24)", () => {
  it("el selector generico no ofrece PAYPAL: solo el flujo dedicado", () => {
    expect(METODOS_PAGO).not.toContain("PAYPAL")
    expect(METODOS_PAGO).toEqual(["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO", "OTRO"])
  })

  it("METODO_LABEL etiqueta PayPal y todos los metodos del selector", () => {
    expect(METODO_LABEL.PAYPAL).toBe("PayPal")
    for (const metodo of METODOS_PAGO) {
      expect(METODO_LABEL[metodo]).toBeTruthy()
    }
  })
})