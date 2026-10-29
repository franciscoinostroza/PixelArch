import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { validateEnv } from "@/lib/env"

/**
 * AC-16 / RNF-2: PayPal es opcional. La validacion de entorno no debe exigir
 * `PAYPAL_*`, y `.env.example` debe documentar las variables sin secretos.
 */

const BASE_ENV_KEYS = [
  "DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_URL",
  "CONTACT_EMAIL",
] as const

const PAYPAL_ENV_KEYS = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_BASE_URL",
  "PAYPAL_FEE_BPS",
  "PAYPAL_FEE_FIXED_CENTS",
] as const

const ENV_KEYS = [...BASE_ENV_KEYS, ...PAYPAL_ENV_KEYS]
const originalEnv = new Map<string, string | undefined>()

function guardarEnv() {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
}

function restaurarEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  originalEnv.clear()
}

function configurarSoloEnvBase() {
  process.env.DATABASE_URL = "postgres://localhost/pixelarch-test"
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy"
  process.env.CLERK_SECRET_KEY = "sk_test_dummy"
  process.env.RESEND_API_KEY = "re_test_dummy"
  process.env.NEXT_PUBLIC_URL = "https://pixelarch.test"
  process.env.CONTACT_EMAIL = "contacto@pixelarch.test"

  for (const key of PAYPAL_ENV_KEYS) delete process.env[key]
}

beforeEach(() => {
  guardarEnv()
  configurarSoloEnvBase()
})

afterEach(() => {
  restaurarEnv()
})

describe("validateEnv con PayPal opcional (AC-16, RNF-2)", () => {
  it("no exige ninguna variable PAYPAL_* ni las devuelve", () => {
    expect(() => validateEnv()).not.toThrow()

    const env = validateEnv()
    expect(env.DATABASE_URL).toBe(process.env.DATABASE_URL)
    expect(Object.keys(env).some((key) => key.startsWith("PAYPAL_"))).toBe(false)
  })

  it("sigue exigiendo las variables base: PayPal no relaja la validacion", () => {
    delete process.env.DATABASE_URL

    expect(() => validateEnv()).toThrow(/DATABASE_URL/)
  })
})

describe(".env.example documenta PayPal sin secretos (RNF-2)", () => {
  function leerEjemplo(): string {
    return readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8")
  }

  function valorDe(contenido: string, key: string): string | undefined {
    const linea = contenido
      .split(/\r?\n/)
      .find((candidata) => candidata.startsWith(`${key}=`))
    return linea?.slice(key.length + 1)
  }

  it("incluye todas las variables de configuracion PayPal", () => {
    const contenido = leerEjemplo()
    for (const key of PAYPAL_ENV_KEYS) {
      expect(valorDe(contenido, key), `${key} falta en .env.example`).toBeDefined()
    }
  })

  it("no versiona credenciales reales de PayPal", () => {
    const contenido = leerEjemplo()
    expect(valorDe(contenido, "PAYPAL_CLIENT_ID")).toBe("")
    expect(valorDe(contenido, "PAYPAL_CLIENT_SECRET")).toBe("")
    expect(valorDe(contenido, "PAYPAL_WEBHOOK_ID")).toBe("")
  })

  it("usa PAYPAL_ENV sandbox|production y la tarifa default documentada", () => {
    const contenido = leerEjemplo()
    expect(["sandbox", "production"]).toContain(valorDe(contenido, "PAYPAL_ENV"))
    expect(valorDe(contenido, "PAYPAL_FEE_BPS")).toBe("540")
    expect(valorDe(contenido, "PAYPAL_FEE_FIXED_CENTS")).toBe("30")
  })

  it("no expone variables PayPal al cliente (sin NEXT_PUBLIC_PAYPAL_*)", () => {
    expect(leerEjemplo()).not.toMatch(/^\s*NEXT_PUBLIC_PAYPAL\w*\s*=/m)
  })
})
