import { describe, expect, it } from "vitest"
import { estadoUI } from "@/lib/estados"

/**
 * T-03 (AC-11): los estados nuevos de Pago tienen etiqueta legible y no caen
 * en el fallback del mapa de estados.
 */
describe("estadoUI: REVISION y CONTRACARGO (T-03, AC-11)", () => {
  it("etiqueta REVISION como En revision", () => {
    expect(estadoUI("REVISION")).toMatchObject({ label: "En revision" })
    expect(estadoUI("REVISION").label).not.toBe("REVISION")
  })

  it("etiqueta CONTRACARGO como Contracargo", () => {
    expect(estadoUI("CONTRACARGO")).toMatchObject({ label: "Contracargo" })
    expect(estadoUI("CONTRACARGO").label).not.toBe("CONTRACARGO")
  })

  it("mantiene las etiquetas existentes de pagos", () => {
    expect(estadoUI("SUCCEEDED").label).toBe("Pagado")
    expect(estadoUI("FAILED").label).toBe("Fallido")
    expect(estadoUI("REFUNDED").label).toBe("Reembolsado")
    expect(estadoUI("PENDING").label).toBe("Pendiente")
  })
})
