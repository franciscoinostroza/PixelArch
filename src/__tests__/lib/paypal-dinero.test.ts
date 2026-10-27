import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatearMonto } from "@/lib/pagos"
import {
  createOrder,
  formatearMontoPaypal,
  parsearMontoPaypal,
  resetPaypalTokenCache,
} from "@/lib/paypal/client"
import {
  calcularGrossUp,
  snapshotTarifa,
  validarMontoUsdCents,
  validarTarifa,
} from "@/lib/paypal/fees"
import { armarMensajePaypal } from "@/lib/paypal/messages"
import {
  REDACTED,
  redactSensitiveData,
  redactSensitiveString,
  redactSentryEvent,
} from "@/lib/paypal/redact"
import { PaypalValidationError, validarMontoUsd } from "@/lib/paypal/utils"
import { formatearMontoHistorial } from "@/lib/paypal/view"

/**
 * T-31 (AC-18, AC-19, AC-24, AC-28): bloque de dinero y PII.
 *
 * - US$100,50 se guarda como 10050 centavos enteros y se muestra en es-AR
 *   (`US$100,50`, `US$1.000,50`); `US$100.50` es la unica excepcion EN.
 * - Gross-up entero con redondeo hacia arriba, tarifa cero y tarifas invalidas.
 * - Logs y Sentry conservan ids/monto/moneda/estado y nunca email ni nombre.
 * - El checkout PayPal permite guest checkout y no envia datos del pagador.
 *
 * Sin red: cualquier `fetch` real a api-m*.paypal.com lo bloquea el guard de
 * T-33; en este archivo `fetch` se mockea cuando hace falta.
 */

const VENCIMIENTO = new Date("2026-11-18T15:00:00.000Z")

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
    PAYPAL_BASE_URL: "https://paypal.test",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) process.env[key] = value
  }
}

function respuestaJson(status: number, body: unknown): Response {
  return {
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function ordenPaypal(): Record<string, unknown> {
  return {
    id: "ORDER-123",
    status: "CREATED",
    purchase_units: [
      {
        reference_id: "default",
        custom_id: "enlace-abc",
        invoice_id: "enlace-abc",
        amount: { currency_code: "USD", value: "106.56" },
        payments: { captures: [] },
      },
    ],
    links: [
      {
        rel: "payer-action",
        href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123",
      },
    ],
  }
}

beforeEach(() => {
  for (const key of PAYPAL_KEYS) originalEnv.set(key, process.env[key])
  resetPaypalTokenCache()
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

describe("centavos USD y formato es-AR (AC-18, AC-24)", () => {
  it("US$100,50 se guarda como 10050 centavos enteros y se muestra US$100,50", () => {
    const centavos = validarMontoUsdCents(10050)

    expect(centavos).toBe(10050)
    expect(Number.isSafeInteger(centavos)).toBe(true)
    expect(formatearMonto(centavos, "usd")).toBe("US$100,50")
    expect(formatearMontoHistorial(centavos, "usd")).toBe("US$100,50")
    expect(formatearMontoPaypal(centavos)).toBe("100.50")
  })

  it("US$1.000,50 usa punto de miles y coma decimal en es-AR", () => {
    expect(validarMontoUsdCents(100050)).toBe(100050)
    expect(formatearMonto(100050, "usd")).toBe("US$1.000,50")
    expect(formatearMontoHistorial(100050, "usd")).toBe("US$1.000,50")
    expect(formatearMontoPaypal(100050)).toBe("1000.50")
  })

  it("US$100.50 (en-US) solo se usa con locale explicito en-US", () => {
    expect(formatearMonto(10050, "usd")).toBe("US$100,50")
    expect(formatearMonto(10050, "usd", "es-AR")).toBe("US$100,50")
    expect(formatearMonto(10050, "usd", "en-US")).toBe("US$100.50")
    expect(formatearMonto(100050, "usd", "en-US")).toBe("US$1,000.50")
    expect(formatearMontoHistorial(10050, "usd", "en-US")).toBe("US$100.50")
  })

  it("redondea centavos de PayPal sin floats ni ARS", () => {
    expect(parsearMontoPaypal("100.50")).toBe(10050)
    expect(parsearMontoPaypal("100.5")).toBe(10050)
    expect(parsearMontoPaypal("100,50")).toBeNull()
    expect(parsearMontoPaypal("US$100.50")).toBeNull()
    expect(parsearMontoPaypal(10050)).toBeNull()

    expect(() => validarMontoUsd(10050, "ars")).toThrow(PaypalValidationError)
    expect(() => validarMontoUsd(10050, "ARS")).toThrow(PaypalValidationError)
    expect(validarMontoUsd(10050, "usd")).toEqual({ montoCents: 10050, moneda: "usd" })
    expect(validarMontoUsd(10050, "USD")).toEqual({ montoCents: 10050, moneda: "usd" })
  })

  it("rechaza montos invalidos: cero, negativos, fracciones, NaN, infinito y fuera de rango", () => {
    for (const monto of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => validarMontoUsdCents(monto)).toThrow(PaypalValidationError)
    }

    expect(validarMontoUsdCents(1)).toBe(1)
    expect(() => validarMontoUsdCents("10050")).toThrow(PaypalValidationError)
    expect(() => validarMontoUsdCents(null)).toThrow(PaypalValidationError)
  })
})

describe("gross-up entero, redondeo y limites (AC-18, AC-24)", () => {
  it("aplica el ejemplo del plan: 10050 -> total 10656 / comision 606", () => {
    const resultado = calcularGrossUp(10050)

    expect(resultado).toEqual({
      montoAcordadoCents: 10050,
      comisionCents: 606,
      totalCents: 10656,
      feeBps: 540,
      feeFixedCents: 30,
    })
    expect(resultado.montoAcordadoCents + resultado.comisionCents).toBe(
      resultado.totalCents
    )
  })

  it("redondea hacia arriba para que el neto no quede por debajo del acordado", () => {
    const resultado = calcularGrossUp(100, { bps: 540, fixedCents: 0 })

    // 100 * 10000 / 9460 = 105,708... -> 106 centavos.
    expect(resultado.totalCents).toBe(106)
    expect(resultado.comisionCents).toBe(6)

    const minimo = calcularGrossUp(1, { bps: 540, fixedCents: 30 })
    // (1 + 30) * 10000 / 9460 = 32,769... -> 33 centavos.
    expect(minimo.totalCents).toBe(33)
    expect(minimo.comisionCents).toBe(32)
  })

  it("con tarifa cero no agrega comision y el snapshot sigue siendo valido", () => {
    const resultado = calcularGrossUp(10050, { bps: 0, fixedCents: 0 })

    expect(resultado.totalCents).toBe(10050)
    expect(resultado.comisionCents).toBe(0)
    expect(resultado.feeBps).toBe(0)
    expect(resultado.feeFixedCents).toBe(0)
    expect(snapshotTarifa({ bps: 0, fixedCents: 0 })).toEqual({
      feeBps: 0,
      feeFixedCents: 0,
    })
    expect(validarTarifa({ bps: 0, fixedCents: 0 })).toEqual({
      bps: 0,
      fixedCents: 0,
    })
  })

  it("con bps cero solo suma la comision fija", () => {
    const resultado = calcularGrossUp(10050, { bps: 0, fixedCents: 30 })

    expect(resultado.totalCents).toBe(10080)
    expect(resultado.comisionCents).toBe(30)
  })

  it("reconcilia exactamente en todo el rango de centavos probado", () => {
    for (let monto = 1; monto <= 2_000; monto += 1) {
      const resultado = calcularGrossUp(monto)
      expect(Number.isSafeInteger(resultado.totalCents)).toBe(true)
      expect(Number.isSafeInteger(resultado.comisionCents)).toBe(true)
      expect(resultado.totalCents).toBeGreaterThanOrEqual(monto)
      expect(resultado.totalCents - resultado.montoAcordadoCents).toBe(
        resultado.comisionCents
      )
    }
  })

  it("admite el maximo de bps (9999) sin dividir por cero", () => {
    const resultado = calcularGrossUp(1, { bps: 9999, fixedCents: 0 })

    expect(resultado.totalCents).toBe(10_000)
    expect(resultado.comisionCents).toBe(9_999)
  })

  it("rechaza tarifas invalidas (negativas, no enteras, fuera de rango o infinitas)", () => {
    for (const bps of [-1, 10_000, 1.5, NaN, Infinity]) {
      expect(() => validarTarifa({ bps, fixedCents: 30 })).toThrow(
        PaypalValidationError
      )
      expect(() => calcularGrossUp(10050, { bps, fixedCents: 30 })).toThrow(
        PaypalValidationError
      )
    }

    for (const fixedCents of [-1, 0.5, NaN, Infinity]) {
      expect(() => validarTarifa({ bps: 540, fixedCents })).toThrow(
        PaypalValidationError
      )
      expect(() => calcularGrossUp(10050, { bps: 540, fixedCents })).toThrow(
        PaypalValidationError
      )
    }

    expect(() => snapshotTarifa({ bps: 10_000, fixedCents: 30 })).toThrow(
      PaypalValidationError
    )
    expect(() => snapshotTarifa({ bps: 540, fixedCents: -1 })).toThrow(
      PaypalValidationError
    )
  })

  it("rechaza montos cuyo calculo excede el rango entero seguro", () => {
    const maxBaseSegura = Math.floor(Number.MAX_SAFE_INTEGER / 10_000)

    expect(() =>
      calcularGrossUp(maxBaseSegura + 1, { bps: 0, fixedCents: 0 })
    ).toThrow(PaypalValidationError)
    expect(() =>
      calcularGrossUp(maxBaseSegura, { bps: 0, fixedCents: 1 })
    ).toThrow(PaypalValidationError)
    expect(() => calcularGrossUp(Number.MAX_SAFE_INTEGER)).toThrow(
      PaypalValidationError
    )
  })
})

describe("plantillas ES/EN y excepcion en-US (AC-18, AC-28, RNF-14)", () => {
  const base = {
    concepto: "Anticipo del proyecto",
    montoAcordadoCents: 10050,
    comisionCents: 606,
    totalCents: 10656,
    moneda: "usd" as const,
    link: "https://pixelarch.dev/pago/paypal/token-opaco-123",
    vencimiento: VENCIMIENTO,
  }

  it("la plantilla ES usa es-AR y nunca el formato en-US", () => {
    const mensaje = armarMensajePaypal({ ...base, idioma: "es", canal: "EMAIL" })

    expect(mensaje.cuerpo).toContain("Monto acordado: US$100,50")
    expect(mensaje.cuerpo).toContain("Comisión de PayPal: US$6,06")
    expect(mensaje.cuerpo).toContain("Total a pagar (incluye la comisión de PayPal): US$106,56")
    expect(mensaje.cuerpo).not.toContain("US$100.50")
    expect(mensaje.cuerpo).not.toContain("US$6.06")
  })

  it("la plantilla EN usa en-US como unica excepcion documentada", () => {
    const mensaje = armarMensajePaypal({ ...base, idioma: "en", canal: "EMAIL" })

    expect(mensaje.cuerpo).toContain("Agreed amount: US$100.50")
    expect(mensaje.cuerpo).toContain("PayPal fee: US$6.06")
    expect(mensaje.cuerpo).toContain("Total to pay (includes the PayPal fee): US$106.56")
    expect(mensaje.cuerpo).not.toContain("US$100,50")
    expect(mensaje.cuerpo).not.toContain("US$6,06")
  })

  it("los miles se localizan de forma consistente en cada idioma", () => {
    const miles = {
      ...base,
      concepto: "Soporte 3 meses",
      montoAcordadoCents: 100050,
      comisionCents: 6060,
      totalCents: 106110,
    }

    const es = armarMensajePaypal({ ...miles, idioma: "es", canal: "WHATSAPP" })
    const en = armarMensajePaypal({ ...miles, idioma: "en", canal: "WHATSAPP" })

    expect(es.texto).toContain("Monto acordado: US$1.000,50")
    expect(es.texto).not.toContain("US$1,000.50")
    expect(en.texto).toContain("Agreed amount: US$1,000.50")
    expect(en.texto).not.toContain("US$1.000,50")
  })
})

describe("guest checkout y datos del pagador (AC-28)", () => {
  it("crea la orden con guest checkout permitido y sin datos personales", async () => {
    configurar()
    const mock = vi.fn((url: string, init: RequestInit) => {
      void init
      if (url.endsWith("/v1/oauth2/token")) {
        return Promise.resolve(
          respuestaJson(200, { access_token: "TOKEN-1", expires_in: 3600 })
        )
      }
      if (url.endsWith("/v2/checkout/orders")) {
        return Promise.resolve(respuestaJson(201, ordenPaypal()))
      }
      throw new Error(`URL inesperada en el mock: ${url}`)
    })
    vi.stubGlobal("fetch", mock)

    const total = calcularGrossUp(10050).totalCents
    expect(total).toBe(10656)

    await createOrder({
      montoCents: total,
      referencia: "enlace-abc",
      descripcion: "Anticipo",
      returnUrl: "https://pixelarch.dev/pago/paypal/retorno?enlace=abc",
      cancelUrl: "https://pixelarch.dev/pago/paypal/cancelado",
    })

    const llamadaOrden = mock.mock.calls.find(([url]) =>
      String(url).endsWith("/v2/checkout/orders")
    )
    if (!llamadaOrden) throw new Error("No se creo la orden PayPal")

    const cuerpo = JSON.parse(String(llamadaOrden[1].body)) as Record<string, unknown>
    const fuente = cuerpo.payment_source as Record<string, unknown>
    const paypal = fuente.paypal as Record<string, unknown>
    const contexto = paypal.experience_context as Record<string, unknown>

    expect(cuerpo.intent).toBe("CAPTURE")
    expect(contexto).toMatchObject({
      landing_page: "NO_PREFERENCE",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
    })
    expect(contexto).not.toHaveProperty("landing_page", "LOGIN")
    expect(contexto).not.toHaveProperty("landing_page", "GUEST_CHECKOUT")

    // No se envia PII del pagador ni un email del cliente al checkout.
    expect(cuerpo).not.toHaveProperty("payer")
    const serializado = JSON.stringify(cuerpo)
    expect(serializado).not.toContain("@")
    expect(serializado).not.toContain("email")
    expect(serializado).not.toContain("given_name")
    expect(serializado).not.toContain("surname")
    expect(serializado).not.toContain("payer_name")

    const unidades = cuerpo.purchase_units as Record<string, unknown>[]
    expect(unidades[0].amount).toEqual({ currency_code: "USD", value: "106.56" })
  })
})

describe("logs y Sentry sin PII (AC-19, RNF-6)", () => {
  it("un log de pago conserva ids, monto, moneda y estado, y borra email/nombre", () => {
    const log = redactSensitiveData({
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      externalId: "CAPTURE-1",
      paypalOrderId: "ORDER-1",
      monto: 10656,
      moneda: "usd",
      estado: "SUCCEEDED",
      pagador: {
        email: "pagador@example.com",
        nombre: "Ana Perez",
        payer_id: "PAYER-1",
      },
    })

    expect(log).toMatchObject({
      pagoId: "pago_1",
      enlaceId: "enlace_1",
      externalId: "CAPTURE-1",
      paypalOrderId: "ORDER-1",
      monto: 10656,
      moneda: "usd",
      estado: "SUCCEEDED",
    })
    expect(log.pagador).toEqual({
      email: REDACTED,
      nombre: REDACTED,
      payer_id: REDACTED,
    })

    const serializado = JSON.stringify(log)
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Ana Perez")
    expect(serializado).not.toContain("PAYER-1")
  })

  it("redacta email y nombre en una linea de log sin perder el pago", () => {
    const linea = redactSensitiveString(
      "Pago CAPTURE-1 SUCCEEDED por 10656 usd para pagador@example.com (nombre=Ana Perez)"
    )

    expect(linea).toContain("CAPTURE-1")
    expect(linea).toContain("SUCCEEDED")
    expect(linea).toContain("10656")
    expect(linea).not.toContain("pagador@example.com")
    expect(linea).not.toContain("Ana Perez")
    expect(linea).not.toContain("Perez")
    expect(linea).toContain(REDACTED)
  })

  it("redacta el nombre y la direccion completos en una asignacion libre", () => {
    const linea = redactSensitiveString(
      "Pago CAPTURE-1 SUCCEEDED; nombre=Ana Perez; address=Avenida Siempreviva 742; estado=SUCCEEDED"
    )

    expect(linea).toContain("CAPTURE-1")
    expect(linea).not.toContain("Perez")
    expect(linea).not.toContain("Siempreviva")
    expect(linea).toContain("estado=SUCCEEDED")
    expect(linea.match(/\[REDACTED\]/g)).toHaveLength(2)
  })

  it("Sentry recibe el evento sin email ni nombre en extras, contextos, breadcrumbs y user", () => {
    const evento = {
      extra: {
        pagoId: "pago_1",
        monto: 10656,
        pagador: { email: "pagador@example.com", nombre: "Ana Perez" },
      },
      contexts: {
        paypal: { email_address: "pagador@example.com", estado: "SUCCEEDED" },
      },
      breadcrumbs: [
        {
          category: "paypal",
          message: "Pago de pagador@example.com",
          data: { payer_id: "PAYER-1", externalId: "CAPTURE-1" },
        },
      ],
      request: {
        url: "https://pixelarch.dev/pago/paypal/token-secreto-123",
        data: { email: "pagador@example.com" },
      },
      user: { id: "user_1", email: "pagador@example.com", name: "Ana Perez" },
      tags: { payerEmail: "pagador@example.com", estado: "SUCCEEDED" },
      exception: {
        values: [{ type: "Error", value: "Fallo para pagador@example.com" }],
      },
      message: "Fallo para pagador@example.com",
      level: "error",
    }

    const salida = redactSentryEvent(evento)

    const extra = salida.extra as Record<string, unknown>
    const pagador = extra.pagador as Record<string, unknown>
    expect(extra.pagoId).toBe("pago_1")
    expect(extra.monto).toBe(10656)
    expect(pagador.email).toBe(REDACTED)
    expect(pagador.nombre).toBe(REDACTED)

    const contexts = salida.contexts as Record<string, Record<string, unknown>>
    expect(contexts.paypal.email_address).toBe(REDACTED)
    expect(contexts.paypal.estado).toBe("SUCCEEDED")

    const breadcrumbs = salida.breadcrumbs as Array<Record<string, unknown>>
    const breadcrumbData = breadcrumbs[0].data as Record<string, unknown>
    expect(String(breadcrumbs[0].message)).not.toContain("pagador@example.com")
    expect(breadcrumbData.payer_id).toBe(REDACTED)
    expect(breadcrumbData.externalId).toBe("CAPTURE-1")

    const request = salida.request as Record<string, unknown>
    expect(String(request.url)).not.toContain("token-secreto-123")
    expect((request.data as Record<string, unknown>).email).toBe(REDACTED)

    const user = salida.user as Record<string, unknown>
    expect(user.id).toBe("user_1")
    expect(user.email).toBe(REDACTED)
    expect(user.name).toBe(REDACTED)

    const tags = salida.tags as Record<string, unknown>
    expect(tags.payerEmail).toBe(REDACTED)
    expect(tags.estado).toBe("SUCCEEDED")

    const exception = salida.exception as { values: Array<Record<string, unknown>> }
    expect(String(exception.values[0].value)).not.toContain("pagador@example.com")
    expect(String(salida.message)).not.toContain("pagador@example.com")

    const serializado = JSON.stringify(salida)
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Ana Perez")
    expect(serializado).not.toContain("Perez")
    expect(serializado).not.toContain("PAYER-1")
    expect(serializado).not.toContain("token-secreto-123")
  })
})
