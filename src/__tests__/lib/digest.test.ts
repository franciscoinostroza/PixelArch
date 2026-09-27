import { describe, expect, it } from "vitest"
import { armarDigest, type DigestData } from "@/lib/digest"

const base: DigestData = {
  hitosVencidos: [],
  hitosPorVencer: [],
  hitosSinFecha: [],
  soportesVencidos: [],
  soportesPorVencer: [],
  pagos24h: [],
}

describe("armarDigest", () => {
  it("sin pendientes: subject de todo al dia", () => {
    const { subject, text } = armarDigest(base)
    expect(subject).toContain("sin pendientes")
    expect(text).toContain("Sin cobros pendientes")
  })

  it("con hitos vencidos: conteo, monto y linea", () => {
    const { subject, text } = armarDigest({
      ...base,
      hitosVencidos: [
        {
          cliente: "ACME",
          proyecto: "Landing",
          titulo: "Anticipo",
          monto: 10000,
          vencimiento: new Date("2026-09-20T12:00:00Z"),
        },
      ],
    })
    expect(subject).toContain("1 vencido")
    expect(subject).toContain("US$100.00")
    expect(text).toContain("🔴 VENCIDOS (1)")
    expect(text).toContain("ACME · Landing · Anticipo: US$100.00")
  })

  it("pluraliza vencidos", () => {
    const { subject } = armarDigest({
      ...base,
      hitosVencidos: [
        { cliente: "A", proyecto: "P", titulo: "H1", monto: 100, vencimiento: new Date("2026-09-01T12:00:00Z") },
        { cliente: "B", proyecto: "P", titulo: "H2", monto: 200, vencimiento: new Date("2026-09-02T12:00:00Z") },
      ],
    })
    expect(subject).toContain("2 vencidos")
  })

  it("por vencer sin vencidos: subject de la semana", () => {
    const { subject, text } = armarDigest({
      ...base,
      hitosPorVencer: [
        { cliente: "ACME", proyecto: "App", titulo: "Hito 2", monto: 5000, vencimiento: new Date("2026-10-01T12:00:00Z") },
      ],
    })
    expect(subject).toContain("por vencer esta semana")
    expect(text).toContain("🟡 POR VENCER")
  })

  it("soportes: linea con precio mensual", () => {
    const { text } = armarDigest({
      ...base,
      soportesVencidos: [
        { cliente: "ACME", servicio: "Chatbot", monto: 2500, proximoPago: new Date("2026-09-15T12:00:00Z") },
      ],
    })
    expect(text).toContain("ACME · Soporte Chatbot: US$25.00/mes")
  })

  it("hitos sin fecha: seccion propia", () => {
    const { text } = armarDigest({
      ...base,
      hitosSinFecha: [{ cliente: "ACME", proyecto: "Web", titulo: "Entrega", monto: 30000, vencimiento: null }],
    })
    expect(text).toContain("⚪ HITOS SIN FECHA (1)")
    expect(text).toContain("(sin fecha)")
  })

  it("pagos 24h: detalle y totales separados por moneda", () => {
    const { text } = armarDigest({
      ...base,
      pagos24h: [
        { cliente: "ACME", monto: 10000, moneda: "usd", descripcion: "Anticipo" },
        { cliente: "Beta", monto: 5000000, moneda: "ars", descripcion: "Soporte Chatbot" },
      ],
    })
    expect(text).toContain("✅ COBRADO ÚLTIMAS 24H (2)")
    expect(text).toContain("ACME · Anticipo: US$100.00")
    expect(text).toContain("Beta · Soporte Chatbot: $50.000 ARS")
    expect(text).toContain("cobrado 24h US$100.00")
    expect(text).toContain("cobrado 24h $50.000 ARS")
  })

  it("incluye link al panel", () => {
    const { text } = armarDigest(base)
    expect(text).toContain("https://pixelarch.dev/admin/cobros")
  })
})
