import { describe, expect, it } from "vitest"
import {
  esHostMercadoPago,
  esUrlMercadoPago,
  instalarGuardRedPasarelas,
  mensajeRedMercadoPago,
} from "../helpers/guard-paypal-red"

/**
 * T-06 (AC-22): la suite no hace llamadas reales a Mercado Pago.
 *
 * El guard vive en `src/__tests__/setup.ts` y bloquea cualquier host
 * `*.mercadopago.com` usado con `fetch`; la pagina del recibo, ademas, mockea
 * `@/lib/mercadopago`. No intercepta otros clientes HTTP, solo `fetch`.
 */
describe("guard sin red de Mercado Pago (T-06, AC-22)", () => {
  it("detecta mercadopago.com y sus subdominios", () => {
    for (const host of [
      "mercadopago.com",
      "api.mercadopago.com",
      "www.mercadopago.com",
      "API.MERCADOPAGO.COM",
      "api.mercadopago.com.",
    ]) {
      expect(esHostMercadoPago(host)).toBe(true)
    }

    expect(esUrlMercadoPago("https://api.mercadopago.com/v1/payments/123")).toBe(
      true
    )
    expect(
      esUrlMercadoPago(new URL("https://api.mercadopago.com/v1/payments/123"))
    ).toBe(true)
  })

  it("no bloquea dominios parecidos ni otros hosts", () => {
    for (const host of [
      "mercadopago.test",
      "mercadopago.com.evil.example",
      "notmercadopago.com",
      "paypal.com",
      "localhost",
      "pixelarch.dev",
    ]) {
      expect(esHostMercadoPago(host)).toBe(false)
    }

    expect(esUrlMercadoPago("no-es-una-url")).toBe(false)
    expect(esUrlMercadoPago(null)).toBe(false)
    expect(esUrlMercadoPago({})).toBe(false)
  })

  it("falla si un test intenta llamar a api.mercadopago.com por red", async () => {
    // El guard se instala en setup.ts; llamarlo de nuevo es idempotente.
    expect(() => instalarGuardRedPasarelas()).not.toThrow()

    await expect(
      fetch("https://api.mercadopago.com/v1/payments/123")
    ).rejects.toThrow(/api\.mercadopago\.com/)
  })

  it("el mensaje documenta ambas pasarelas y no filtra credenciales", () => {
    const mensaje = mensajeRedMercadoPago(
      "https://api.mercadopago.com/v1/payments/123?access_token=secreto"
    )

    expect(mensaje).toContain("api.mercadopago.com")
    expect(mensaje).toContain("*.paypal.com")
    expect(mensaje).toContain("*.mercadopago.com")
    expect(mensaje).toContain("vi.stubGlobal")
    expect(mensaje).toContain("solo envuelve fetch")
    expect(mensaje).toContain("§7.7")
    expect(mensaje).not.toContain("access_token=secreto")
  })
})
