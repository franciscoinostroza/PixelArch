/**
 * Configuracion de PayPal.
 *
 * PayPal es opcional: si falta o es invalida la configuracion, `paypalConfig()`
 * devuelve `disponible: false` con un motivo legible, sin lanzar. Mercado Pago
 * y el resto del CRM siguen funcionando.
 *
 * Los secretos se leen de `process.env` en cada llamada y nunca se incluyen en
 * `motivo`, logs ni respuestas.
 */

import {
  PAYPAL_DEFAULT_FEE,
  PAYPAL_DEFAULT_FEE_BPS,
  PAYPAL_DEFAULT_FEE_FIXED_CENTS,
  type PaypalFee,
} from "./fees-core"

export {
  PAYPAL_DEFAULT_FEE,
  PAYPAL_DEFAULT_FEE_BPS,
  PAYPAL_DEFAULT_FEE_FIXED_CENTS,
  type PaypalFee,
} from "./fees-core"

export type PaypalEnv = "sandbox" | "production"

export interface PaypalConfigEnabled {
  disponible: true
  motivo: null
  env: PaypalEnv
  baseUrl: string
  clientId: string
  clientSecret: string
  webhookId: string
  fee: PaypalFee
}

export interface PaypalConfigDisabled {
  disponible: false
  motivo: string
  env: PaypalEnv | null
  baseUrl: string | null
  clientId: null
  clientSecret: null
  webhookId: null
  fee: PaypalFee
}

export type PaypalConfig = PaypalConfigEnabled | PaypalConfigDisabled

export const PAYPAL_API_BASE_URLS: Record<PaypalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
}

const REQUIRED_ENV_KEYS = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
] as const

function leerEnv(key: string): string | null {
  const raw = process.env[key]
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return value.length > 0 ? value : null
}

function leerEntero(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

function resolverBaseUrl(override: string | null, env: PaypalEnv): string | null {
  const candidato = override ?? PAYPAL_API_BASE_URLS[env]

  try {
    const url = new URL(candidato)
    // Las credenciales viajan a este host: solo HTTPS, sin userinfo, query ni hash.
    if (url.protocol !== "https:") return null
    if (url.username || url.password || url.search || url.hash) return null
    const pathname = url.pathname.replace(/\/+$/, "")
    return `${url.origin}${pathname}`
  } catch {
    return null
  }
}

function deshabilitado(params: {
  motivo: string
  env?: PaypalEnv | null
  baseUrl?: string | null
  fee?: PaypalFee
}): PaypalConfigDisabled {
  return {
    disponible: false,
    motivo: params.motivo,
    env: params.env ?? null,
    baseUrl: params.baseUrl ?? null,
    clientId: null,
    clientSecret: null,
    webhookId: null,
    fee: params.fee ?? { ...PAYPAL_DEFAULT_FEE },
  }
}

function parsearTarifa(): { fee: PaypalFee } | { error: string } {
  const feeBps = leerEntero(leerEnv("PAYPAL_FEE_BPS"), PAYPAL_DEFAULT_FEE_BPS)
  if (feeBps === null || feeBps >= 10_000) {
    return {
      error:
        "PayPal no disponible: PAYPAL_FEE_BPS invalido (debe ser un entero entre 0 y 9999).",
    }
  }

  const feeFixedCents = leerEntero(
    leerEnv("PAYPAL_FEE_FIXED_CENTS"),
    PAYPAL_DEFAULT_FEE_FIXED_CENTS
  )
  if (feeFixedCents === null) {
    return {
      error:
        "PayPal no disponible: PAYPAL_FEE_FIXED_CENTS invalido (debe ser un entero mayor o igual a 0).",
    }
  }

  return { fee: { bps: feeBps, fixedCents: feeFixedCents } }
}

export function paypalConfig(): PaypalConfig {
  const envRaw = leerEnv("PAYPAL_ENV")
  const clientId = leerEnv("PAYPAL_CLIENT_ID")
  const clientSecret = leerEnv("PAYPAL_CLIENT_SECRET")
  const webhookId = leerEnv("PAYPAL_WEBHOOK_ID")

  const faltantes = REQUIRED_ENV_KEYS.filter((key) => leerEnv(key) === null)
  if (faltantes.length > 0) {
    return deshabilitado({
      motivo: `PayPal no disponible: configuracion incompleta (faltan ${faltantes.join(", ")}).`,
    })
  }

  if (envRaw !== "sandbox" && envRaw !== "production") {
    return deshabilitado({
      motivo: "PayPal no disponible: PAYPAL_ENV invalido (use sandbox o production).",
    })
  }

  const env: PaypalEnv = envRaw

  const tarifa = parsearTarifa()
  if ("error" in tarifa) {
    return deshabilitado({ motivo: tarifa.error, env })
  }

  const baseUrl = resolverBaseUrl(leerEnv("PAYPAL_BASE_URL"), env)
  if (!baseUrl) {
    return deshabilitado({
      motivo:
        "PayPal no disponible: PAYPAL_BASE_URL invalida (debe ser una URL https absoluta).",
      env,
      fee: tarifa.fee,
    })
  }

  return {
    disponible: true,
    motivo: null,
    env,
    baseUrl,
    clientId: clientId!,
    clientSecret: clientSecret!,
    webhookId: webhookId!,
    fee: tarifa.fee,
  }
}
