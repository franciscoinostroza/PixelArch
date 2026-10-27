import { describe, expect, it } from "vitest"
import {
  esHostPaypal,
  esUrlPaypal,
  instalarGuardRedPaypal,
  mensajeRedPaypal,
} from "../helpers/guard-paypal-red"

/**
 * T-33 (AC-21): guard sin red.
 *
 * La suite completa se ejecuta sin llamadas reales a PayPal. El guard vive en
 * `src/__tests__/setup.ts` y bloquea cualquier host `*.paypal.com` usado con
 * `fetch`; los tests mockean `fetch`. No intercepta otros clientes HTTP, asi
 * que la documentacion aclara que solo envuelve `fetch`. La validacion sandbox
 * de AC-29 se corre fuera de CI, en Railway staging con Postgres separado
 * (plan.md §7.7); local/ngrok es solo desarrollo.
 */
describe("guard sin red de PayPal (AC-21)", () => {
  it("detecta todos los hosts de PayPal, incluidos api, api-m y subdominios", () => {
    for (const host of [
      "api-m.sandbox.paypal.com",
      "api-m.paypal.com",
      "api.paypal.com",
      "api.sandbox.paypal.com",
      "www.paypal.com",
      "sandbox.paypal.com",
      "paypal.com",
      "notapi-m.paypal.com",
      "API-M.SANDBOX.PAYPAL.COM",
    ]) {
      expect(esHostPaypal(host)).toBe(true)
    }

    expect(esUrlPaypal("https://api-m.sandbox.paypal.com/v1/oauth2/token")).toBe(
      true
    )
    expect(esUrlPaypal("https://api.paypal.com/v2/checkout/orders")).toBe(true)
    expect(esUrlPaypal("https://api.sandbox.paypal.com/v2/checkout/orders")).toBe(
      true
    )
    expect(esUrlPaypal("https://api-m.paypal.com/v2/checkout/orders")).toBe(true)
    expect(esUrlPaypal(new URL("https://api-m.sandbox.paypal.com/v2/checkout/orders"))).toBe(
      true
    )
  })

  it("no bloquea dominios parecidos que no terminan en paypal.com", () => {
    for (const host of [
      "paypal.test",
      "localhost",
      "127.0.0.1",
      "pixelarch.dev",
      "api-m.paypal.com.evil.example",
      "paypal.com.evil.example",
      "notpaypal.com",
    ]) {
      expect(esHostPaypal(host)).toBe(false)
    }

    expect(esUrlPaypal("https://paypal.test/v1/oauth2/token")).toBe(false)
    expect(esUrlPaypal("no-es-una-url")).toBe(false)
    expect(esUrlPaypal(null)).toBe(false)
    expect(esUrlPaypal({})).toBe(false)
  })

  it("falla si un test intenta llamar a api-m.sandbox.paypal.com por red (AC-21)", async () => {
    // El guard se instala en setup.ts; llamarlo de nuevo es idempotente.
    expect(() => instalarGuardRedPaypal()).not.toThrow()

    await expect(
      fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
        method: "POST",
        body: "grant_type=client_credentials",
      })
    ).rejects.toThrow(/api-m\.sandbox\.paypal\.com/)
  })

  it("falla contra api, api-m y cualquier subdominio de PayPal usado con fetch", async () => {
    await expect(fetch("https://api-m.paypal.com/v2/checkout/orders")).rejects.toThrow(
      /api-m\.paypal\.com/
    )
    await expect(fetch("https://api.paypal.com/v2/checkout/orders")).rejects.toThrow(
      /api\.paypal\.com/
    )
    await expect(
      fetch("https://api.sandbox.paypal.com/v2/checkout/orders")
    ).rejects.toThrow(/api\.sandbox\.paypal\.com/)
    await expect(fetch("https://www.paypal.com/checkoutnow")).rejects.toThrow(
      /www\.paypal\.com/
    )

    const request = new Request("https://api-m.sandbox.paypal.com/v2/checkout/orders")
    await expect(fetch(request)).rejects.toThrow(/api-m\.sandbox\.paypal\.com/)
  })

  it("el mensaje documenta que el guard solo envuelve fetch y la validacion externa", () => {
    const mensaje = mensajeRedPaypal(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token?token=secreto"
    )

    expect(mensaje).toContain("api-m.sandbox.paypal.com")
    expect(mensaje).toContain("vi.stubGlobal")
    expect(mensaje).toContain("solo envuelve fetch")
    expect(mensaje).toContain("Railway staging")
    expect(mensaje).toContain("§7.7")
    // No filtra query strings ni credenciales del intento.
    expect(mensaje).not.toContain("token=secreto")
  })
})
