import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  METODO_LABEL,
  METODOS_PAGO,
  formatearMonto,
} from "@/lib/pagos"
import {
  mapearEstadoPagoMp,
  normalizarMeses,
  tituloLink,
  vencimientoConMeses,
} from "@/lib/mp-utils"

/**
 * T-32 (AC-20, AC-21): regresion de Mercado Pago.
 *
 * La regresion real de los flujos MP (link, pago, hito, soporte y
 * coexistencia con PayPal) vive en `api/mercadopago-coexistencia.test.ts`.
 * Este archivo cubre las piezas estables que no dependen de Prisma: selector
 * de metodos, formatos, reglas de meses/estados y campos legacy del schema.
 *
 * No toca red ni base: solo funciones puras y el schema.
 */

const ROOT = process.cwd()

function leer(relativo: string): string {
  return readFileSync(path.join(ROOT, relativo), "utf8")
}

describe("Mercado Pago intacto (AC-20)", () => {
  it("el selector generico no ofrece PayPal (solo el flujo dedicado)", () => {
    expect(METODOS_PAGO).toEqual([
      "TRANSFERENCIA",
      "MERCADOPAGO",
      "EFECTIVO",
      "OTRO",
    ])
    expect(METODOS_PAGO).not.toContain("PAYPAL")
    expect(METODO_LABEL.PAYPAL).toBe("PayPal")
    expect(METODO_LABEL.MERCADOPAGO).toBe("Mercado Pago")
  })

  it("mantiene el formato ARS original y el formato USD es-AR", () => {
    expect(formatearMonto(500000, "ars")).toBe("$5.000 ARS")
    expect(formatearMonto(100050, "ars")).toBe("$1.001 ARS")
    expect(formatearMonto(10050, "usd")).toBe("US$100,50")
  })

  it("mantiene las reglas de meses y estados del webhook MP", () => {
    expect(normalizarMeses(1)).toBe(1)
    expect(normalizarMeses("12")).toBe(12)
    expect(normalizarMeses(20)).toBe(12)
    expect(normalizarMeses(-1)).toBe(0)
    expect(normalizarMeses("abc")).toBe(0)

    expect(mapearEstadoPagoMp("approved")).toBe("SUCCEEDED")
    expect(mapearEstadoPagoMp("rejected")).toBe("FAILED")
    expect(mapearEstadoPagoMp("cancelled")).toBe("FAILED")
    expect(mapearEstadoPagoMp("pending")).toBeNull()
    expect(mapearEstadoPagoMp("refunded")).toBeNull()

    const ahora = new Date("2026-09-10T12:00:00.000Z")
    expect(
      vencimientoConMeses(new Date("2026-09-20T12:00:00.000Z"), 3, ahora)
        ?.toISOString()
        .slice(0, 10)
    ).toBe("2026-12-20")
    expect(
      vencimientoConMeses(new Date("2027-01-31T12:00:00.000Z"), 1, new Date("2026-12-01T12:00:00.000Z"))
        ?.toISOString()
        .slice(0, 10)
    ).toBe("2027-02-28")

    expect(tituloLink("Chatbot", 0)).toBe("Chatbot — pago")
    expect(tituloLink("Chatbot", 3)).toBe("Chatbot — 3 meses")
  })

  it("conserva los campos legacy de MP en el schema Prisma", () => {
    const schema = leer("prisma/schema.prisma")

    const modelo = (nombre: string): string => {
      const bloque = schema.match(new RegExp(`model ${nombre} \\{([\\s\\S]*?)\\n\\}`))
      if (!bloque) throw new Error(`No se encontro el modelo ${nombre} en el schema`)
      return bloque[1]
    }

    const hito = modelo("Hito")
    expect(hito).toContain("mpLink")
    expect(hito).toContain("mpPreferenceId")
    expect(hito).toContain("mpLinkExpira")

    const suscripcion = modelo("Suscripcion")
    expect(suscripcion).toContain("mpLink")
    expect(suscripcion).toContain("mpPreferenceId")
    expect(suscripcion).toContain("mpLinkExpira")
    expect(suscripcion).toContain("mpLinkMeses")

    // Los links MP y PayPal conviven en la misma tabla de historial.
    expect(schema).toContain("model EnlacePago")
  })
})
