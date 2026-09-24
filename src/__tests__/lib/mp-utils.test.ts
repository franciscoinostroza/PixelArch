import { describe, expect, it } from "vitest"
import { normalizarMeses, mapearEstadoPagoMp, vencimientoConMeses, tituloLink } from "@/lib/mp-utils"

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