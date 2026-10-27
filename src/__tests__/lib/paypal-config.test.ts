import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PAYPAL_API_BASE_URLS,
  PAYPAL_DEFAULT_FEE_BPS,
  PAYPAL_DEFAULT_FEE_FIXED_CENTS,
  paypalConfig,
  type PaypalConfig,
} from "@/lib/paypal/config"
import {
  createOrder,
  esPaypalError,
  resetPaypalTokenCache,
} from "@/lib/paypal/client"

/**
 * El SDK de Mercado Pago se mockea: este archivo verifica que PayPal sea
 * opcional sin llamar a la red ni depender de credenciales reales de MP.
 */
const mpMocks = vi.hoisted(() => {
  const create = vi.fn()
  const MercadoPagoConfig = vi.fn(function (this: unknown) {
    return {}
  })
  const Preference = vi.fn(function (this: unknown) {
    return { create }
  })
  const Payment = vi.fn(function (this: unknown) {
    return {}
  })

  return { create, MercadoPagoConfig, Preference, Payment }
})

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: mpMocks.MercadoPagoConfig,
  Preference: mpMocks.Preference,
  Payment: mpMocks.Payment,
}))

const PAYPAL_KEYS = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_BASE_URL",
  "PAYPAL_FEE_BPS",
  "PAYPAL_FEE_FIXED_CENTS",
] as const

type PaypalKey = (typeof PAYPAL_KEYS)[number]

const originalEnv = new Map<PaypalKey, string | undefined>()

function limpiarEnv() {
  for (const key of PAYPAL_KEYS) delete process.env[key]
}

function configurar(overrides: Partial<Record<PaypalKey, string>> = {}) {
  limpiarEnv()
  const base: Record<string, string> = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "client-id-de-prueba",
    PAYPAL_CLIENT_SECRET: "client-secret-de-prueba",
    PAYPAL_WEBHOOK_ID: "webhook-id-de-prueba",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) process.env[key] = value
  }
}

function esperarDeshabilitado(config: PaypalConfig) {
  if (config.disponible) {
    throw new Error("Se esperaba una configuracion PayPal deshabilitada")
  }
  return config
}

function esperarHabilitado(config: PaypalConfig) {
  if (!config.disponible) {
    throw new Error(`Se esperaba PayPal habilitado: ${config.motivo}`)
  }
  return config
}

beforeEach(() => {
  for (const key of PAYPAL_KEYS) originalEnv.set(key, process.env[key])
  limpiarEnv()
})

afterEach(() => {
  for (const key of PAYPAL_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  originalEnv.clear()
  resetPaypalTokenCache()
  vi.unstubAllGlobals()
})

// AC-16: sin credenciales validas PayPal queda no disponible sin lanzar; el
// resto del CRM (Mercado Pago incluido) no depende de esta configuracion.
// RNF-2: los secretos no se filtran en motivos, errores ni configuracion
// deshabilitada.
describe("paypalConfig (AC-16, RNF-2)", () => {
  it("no lanza y queda deshabilitado si falta toda la configuracion", () => {
    expect(() => paypalConfig()).not.toThrow()

    const config = esperarDeshabilitado(paypalConfig())
    expect(config.motivo).toContain("PayPal no disponible")
    expect(config.motivo).toContain("configuracion incompleta")
    expect(config.motivo).toContain("PAYPAL_ENV")
    expect(config.motivo).toContain("PAYPAL_CLIENT_ID")
    expect(config.motivo).toContain("PAYPAL_CLIENT_SECRET")
    expect(config.motivo).toContain("PAYPAL_WEBHOOK_ID")
    expect(config.env).toBeNull()
    expect(config.baseUrl).toBeNull()
    expect(config.clientId).toBeNull()
    expect(config.clientSecret).toBeNull()
    expect(config.webhookId).toBeNull()
    expect(config.fee).toEqual({
      bps: PAYPAL_DEFAULT_FEE_BPS,
      fixedCents: PAYPAL_DEFAULT_FEE_FIXED_CENTS,
    })
  })

  it("queda deshabilitado si falta una credencial e indica cual", () => {
    configurar({ PAYPAL_WEBHOOK_ID: undefined })

    const config = esperarDeshabilitado(paypalConfig())
    expect(config.motivo).toContain("PAYPAL_WEBHOOK_ID")
    expect(config.motivo).not.toContain("PAYPAL_CLIENT_ID")
    expect(config.webhookId).toBeNull()
  })

  it("trata los valores vacios o con espacios como faltantes", () => {
    configurar({ PAYPAL_CLIENT_SECRET: "   " })

    const config = esperarDeshabilitado(paypalConfig())
    expect(config.motivo).toContain("PAYPAL_CLIENT_SECRET")
    expect(config.clientSecret).toBeNull()
  })

  it("usa la base URL de sandbox", () => {
    configurar()

    const config = esperarHabilitado(paypalConfig())
    expect(config.env).toBe("sandbox")
    expect(config.baseUrl).toBe(PAYPAL_API_BASE_URLS.sandbox)
    expect(config.clientId).toBe("client-id-de-prueba")
    expect(config.clientSecret).toBe("client-secret-de-prueba")
    expect(config.webhookId).toBe("webhook-id-de-prueba")
    expect(config.motivo).toBeNull()
  })

  it("usa la base URL de production", () => {
    configurar({ PAYPAL_ENV: "production" })

    const config = esperarHabilitado(paypalConfig())
    expect(config.env).toBe("production")
    expect(config.baseUrl).toBe(PAYPAL_API_BASE_URLS.production)
  })

  it("rechaza PAYPAL_ENV fuera de sandbox/production", () => {
    configurar({ PAYPAL_ENV: "live" })

    const config = esperarDeshabilitado(paypalConfig())
    expect(config.motivo).toContain("PAYPAL_ENV")
    expect(config.motivo).toContain("sandbox")
    expect(config.motivo).toContain("production")
  })

  it("PAYPAL_BASE_URL prevalece y normaliza la barra final", () => {
    configurar({ PAYPAL_BASE_URL: "https://paypal-proxy.example.com/api/" })

    const config = esperarHabilitado(paypalConfig())
    expect(config.baseUrl).toBe("https://paypal-proxy.example.com/api")
  })

  it("PAYPAL_BASE_URL vacia usa la base URL derivada de PAYPAL_ENV", () => {
    configurar({ PAYPAL_BASE_URL: "   " })

    const config = esperarHabilitado(paypalConfig())
    expect(config.baseUrl).toBe(PAYPAL_API_BASE_URLS.sandbox)
  })

  it("rechaza overrides no HTTPS, relativos o con credenciales/query/hash", () => {
    const invalidas = [
      "http://paypal-proxy.example.com",
      "paypal-proxy.example.com",
      "ftp://paypal-proxy.example.com",
      "https://usuario:clave@paypal-proxy.example.com",
      "https://paypal-proxy.example.com?destino=otro",
      "https://paypal-proxy.example.com#fragmento",
    ]

    for (const valor of invalidas) {
      configurar({ PAYPAL_BASE_URL: valor })

      expect(() => paypalConfig()).not.toThrow()
      const config = esperarDeshabilitado(paypalConfig())
      expect(config.motivo).toContain("PAYPAL_BASE_URL")
      expect(config.baseUrl).toBeNull()
    }
  })

  it("usa la tarifa por defecto 540 bps + 30 centavos", () => {
    configurar()

    const config = esperarHabilitado(paypalConfig())
    expect(config.fee).toEqual({ bps: 540, fixedCents: 30 })
  })

  it("permite override de la tarifa por env", () => {
    configurar({ PAYPAL_FEE_BPS: "600", PAYPAL_FEE_FIXED_CENTS: "49" })

    const config = esperarHabilitado(paypalConfig())
    expect(config.fee).toEqual({ bps: 600, fixedCents: 49 })
  })

  it("acepta tarifa cero (sin comision) como valor explicito", () => {
    configurar({ PAYPAL_FEE_BPS: "0", PAYPAL_FEE_FIXED_CENTS: "0" })

    const config = esperarHabilitado(paypalConfig())
    expect(config.fee).toEqual({ bps: 0, fixedCents: 0 })
  })

  it("deshabilita PayPal con tarifas invalidas", () => {
    for (const valor of ["-1", "540.5", "abc", "10000", "99999999999999999999"]) {
      configurar({ PAYPAL_FEE_BPS: valor })

      const config = esperarDeshabilitado(paypalConfig())
      expect(config.motivo).toContain("PAYPAL_FEE_BPS")
    }

    for (const valor of ["-30", "30.5", "abc", "99999999999999999999"]) {
      configurar({ PAYPAL_FEE_FIXED_CENTS: valor })
      const config = esperarDeshabilitado(paypalConfig())
      expect(config.motivo).toContain("PAYPAL_FEE_FIXED_CENTS")
    }
  })

  it("no expone secretos en el motivo ni en la configuracion deshabilitada", () => {
    const clientId = "client-id-que-no-debe-filtrarse"
    const clientSecret = "secreto-que-no-debe-filtrarse"
    const casos: Partial<Record<PaypalKey, string>>[] = [
      { PAYPAL_ENV: "invalido" },
      { PAYPAL_FEE_BPS: "abc" },
      { PAYPAL_FEE_FIXED_CENTS: "-1" },
      { PAYPAL_BASE_URL: "http://paypal-proxy.example.com" },
    ]

    for (const caso of casos) {
      configurar({ PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret, ...caso })

      const config = esperarDeshabilitado(paypalConfig())
      const serializada = JSON.stringify(config)
      expect(config.motivo).not.toContain(clientId)
      expect(config.motivo).not.toContain(clientSecret)
      expect(serializada).not.toContain(clientId)
      expect(serializada).not.toContain(clientSecret)
      expect(config.clientId).toBeNull()
      expect(config.clientSecret).toBeNull()
    }
  })
})

// T-33 (AC-16, AC-20, AC-21): sin PAYPAL_* la pasarela queda deshabilitada sin
// tocar la red y Mercado Pago sigue operativo. La suite no depende de PayPal.
describe("PayPal opcional sin romper Mercado Pago (AC-16, AC-20, AC-21)", () => {
  it("sin PAYPAL_* createOrder falla con NO_CONFIGURADO y no llama a fetch", async () => {
    limpiarEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const error = await createOrder({
      montoCents: 10656,
      referencia: "enlace-abc",
      returnUrl: "https://pixelarch.dev/pago/paypal/retorno?enlace=abc",
      cancelUrl: "https://pixelarch.dev/pago/paypal/cancelado",
    }).catch((capturado: unknown) => capturado)

    expect(esPaypalError(error)).toBe(true)
    if (!esPaypalError(error)) throw new Error("Se esperaba PaypalError")
    expect(error.code).toBe("NO_CONFIGURADO")
    expect(error.message).toContain("PayPal no disponible")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("Mercado Pago sigue operativo aunque no haya ninguna variable PAYPAL_*", async () => {
    limpiarEnv()
    const mpTokenOriginal = process.env.MP_ACCESS_TOKEN
    const initPoint =
      "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=MP-PREF-1"
    process.env.MP_ACCESS_TOKEN = "mp-token-de-prueba"
    mpMocks.create.mockResolvedValue({ id: "MP-PREF-1", init_point: initPoint })

    try {
      const { crearLinkDePago } = await import("@/lib/mercadopago")
      const resultado = await crearLinkDePago({
        externalReference: "hito_1",
        titulo: "Anticipo",
        montoArsCents: 500000,
        metadata: { tipo: "hito" },
      })

      // Con MP configurado el link se genera igual aunque PayPal no exista.
      expect(resultado).toEqual({ url: initPoint, preferenceId: "MP-PREF-1" })
      expect(mpMocks.create).toHaveBeenCalledTimes(1)

      const preferencia = mpMocks.create.mock.calls[0][0] as {
        body: {
          items: Array<Record<string, unknown>>
          external_reference: string
        }
      }
      expect(preferencia.body.items[0].currency_id).toBe("ARS")
      expect(preferencia.body.external_reference).toBe("hito_1")

      // PayPal, en cambio, queda no disponible sin afectar el link de MP.
      expect(paypalConfig().disponible).toBe(false)
    } finally {
      mpMocks.create.mockReset()
      if (mpTokenOriginal === undefined) delete process.env.MP_ACCESS_TOKEN
      else process.env.MP_ACCESS_TOKEN = mpTokenOriginal
    }
  })
})
