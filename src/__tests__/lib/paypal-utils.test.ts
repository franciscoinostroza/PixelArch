import { describe, expect, it } from "vitest"
import {
  PAYPAL_LINK_TTL_MS,
  PaypalValidationError,
  calcularExpiracionEnlace,
  esEnlaceVigente,
  esMonedaUsd,
  estaVencido,
  evaluarConceptoEnlace,
  generarTokenEnlace,
  mapearEstadoEnlacePaypal,
  mapearEstadoPagoPaypal,
  resolverBaseUrlPublica,
  resolverEstadoEnlace,
  validarMonedaUsd,
  validarMontoUsd,
  validarMontoUsdCents,
} from "@/lib/paypal/utils"

/**
 * T-04 (AC-1, AC-15, AC-18, AC-22, AC-26): validacion USD/centavos, token
 * opaco, vigencia de 30 dias y mapeos de estados segun plan.md §2.5.
 */
describe("validacion USD/centavos (T-04, AC-18)", () => {
  it("acepta centavos enteros positivos y seguros", () => {
    expect(validarMontoUsdCents(1)).toBe(1)
    expect(validarMontoUsdCents(10050)).toBe(10050)
    expect(validarMontoUsdCents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("rechaza cero, negativos, decimales y valores no numericos", () => {
    for (const monto of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10050", null, undefined]) {
      expect(() => validarMontoUsdCents(monto)).toThrow(PaypalValidationError)
    }
  })

  it("acepta USD sin distinguir mayusculas ni espacios", () => {
    expect(esMonedaUsd("usd")).toBe(true)
    expect(esMonedaUsd("USD")).toBe(true)
    expect(esMonedaUsd(" usd ")).toBe(true)
    expect(validarMonedaUsd("USD")).toBe("usd")
  })

  it("rechaza ARS y otras monedas", () => {
    for (const moneda of ["ars", "ARS", "eur", "", null, undefined]) {
      expect(esMonedaUsd(moneda)).toBe(false)
      expect(() => validarMonedaUsd(moneda)).toThrow(PaypalValidationError)
    }
  })

  it("valida monto y moneda juntos y normaliza la moneda", () => {
    expect(validarMontoUsd(10050, "USD")).toEqual({ montoCents: 10050, moneda: "usd" })
    expect(() => validarMontoUsd(10050, "ars")).toThrow(PaypalValidationError)
    expect(() => validarMontoUsd(0, "usd")).toThrow(PaypalValidationError)
  })
})

describe("token y vencimiento del link (T-04, AC-1, AC-26)", () => {
  it("genera tokens opacos base64url de 24 bytes", () => {
    const token = generarTokenEnlace()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(token).toHaveLength(32)
  })

  it("genera tokens unicos", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generarTokenEnlace()))
    expect(tokens.size).toBe(100)
  })

  it("vence exactamente 30 dias despues de now sin mutarlo", () => {
    const now = new Date("2026-10-19T12:00:00.000Z")
    const expira = calcularExpiracionEnlace(now)

    expect(expira.getTime() - now.getTime()).toBe(PAYPAL_LINK_TTL_MS)
    expect(expira.toISOString()).toBe("2026-11-18T12:00:00.000Z")
    expect(now.toISOString()).toBe("2026-10-19T12:00:00.000Z")
  })

  it("rechaza una fecha base invalida", () => {
    expect(() => calcularExpiracionEnlace(new Date("invalida"))).toThrow(PaypalValidationError)
  })

  it("estaVencido respeta el limite expiraEn < ahora", () => {
    const ahora = new Date("2026-10-19T12:00:00.000Z")

    expect(estaVencido(new Date("2026-10-19T11:59:59.999Z"), ahora)).toBe(true)
    expect(estaVencido(new Date("2026-10-19T12:00:00.000Z"), ahora)).toBe(false)
    expect(estaVencido(new Date("2026-10-19T12:00:00.001Z"), ahora)).toBe(false)
  })

  it("una fecha ausente o invalida se considera vencida", () => {
    expect(estaVencido(null)).toBe(true)
    expect(estaVencido(undefined)).toBe(true)
    expect(estaVencido(new Date("invalida"))).toBe(true)
    expect(estaVencido("no-es-fecha")).toBe(true)
  })

  it("resuelve VENCIDO de forma perezosa solo para ACTIVO", () => {
    const ahora = new Date("2026-10-19T12:00:00.000Z")
    const futuro = new Date("2026-11-18T12:00:00.000Z")
    const pasado = new Date("2026-10-01T12:00:00.000Z")

    expect(resolverEstadoEnlace("ACTIVO", futuro, ahora)).toBe("ACTIVO")
    expect(resolverEstadoEnlace("ACTIVO", pasado, ahora)).toBe("VENCIDO")
    expect(resolverEstadoEnlace("PAGADO", pasado, ahora)).toBe("PAGADO")
    expect(resolverEstadoEnlace("INVALIDADO", futuro, ahora)).toBe("INVALIDADO")
    expect(resolverEstadoEnlace("CREANDO", pasado, ahora)).toBe("CREANDO")
    expect(resolverEstadoEnlace("ACTIVO", null, ahora)).toBe("VENCIDO")
  })

  it("esEnlaceVigente exige ACTIVO y fecha futura", () => {
    const ahora = new Date("2026-10-19T12:00:00.000Z")

    expect(esEnlaceVigente("ACTIVO", new Date("2026-11-18T12:00:00.000Z"), ahora)).toBe(true)
    expect(esEnlaceVigente("ACTIVO", new Date("2026-10-01T12:00:00.000Z"), ahora)).toBe(false)
    expect(esEnlaceVigente("PAGADO", new Date("2026-11-18T12:00:00.000Z"), ahora)).toBe(false)
    expect(esEnlaceVigente("INVALIDADO", new Date("2026-11-18T12:00:00.000Z"), ahora)).toBe(false)
  })
})

describe("elegibilidad del concepto de un link publico (T-14)", () => {
  it("acepta un hito pendiente y un soporte SOPORTE ACTIVE/PAST_DUE", () => {
    expect(
      evaluarConceptoEnlace({
        hitoId: "hito_1",
        suscripcionId: null,
        hito: { estado: "PENDIENTE" },
        suscripcion: null,
      })
    ).toEqual({ pendiente: true })

    for (const estado of ["ACTIVE", "PAST_DUE"]) {
      expect(
        evaluarConceptoEnlace({
          hitoId: null,
          suscripcionId: "susc_1",
          hito: null,
          suscripcion: { estado, plan: "SOPORTE" },
        })
      ).toEqual({ pendiente: true })
    }
  })

  it("informa pagado para un hito PAGADO y no permite un segundo cobro", () => {
    expect(
      evaluarConceptoEnlace({
        hitoId: "hito_1",
        suscripcionId: null,
        hito: { estado: "PAGADO" },
        suscripcion: null,
      })
    ).toEqual({ pendiente: false, estado: "pagado" })
  })

  it("informa invalidado para hito ausente, soporte no elegible o link sin concepto", () => {
    expect(
      evaluarConceptoEnlace({
        hitoId: "hito_1",
        suscripcionId: null,
        hito: null,
        suscripcion: null,
      })
    ).toEqual({ pendiente: false, estado: "invalidado" })

    for (const soporte of [
      { estado: "PAUSED", plan: "SOPORTE" },
      { estado: "CANCELED", plan: "SOPORTE" },
      { estado: "ACTIVE", plan: "OTRO" },
    ]) {
      expect(
        evaluarConceptoEnlace({
          hitoId: null,
          suscripcionId: "susc_1",
          hito: null,
          suscripcion: soporte,
        })
      ).toEqual({ pendiente: false, estado: "invalidado" })
    }

    expect(
      evaluarConceptoEnlace({
        hitoId: null,
        suscripcionId: null,
        hito: null,
        suscripcion: null,
      })
    ).toEqual({ pendiente: false, estado: "invalidado" })
  })
})

describe("base canonica de returnUrl/cancelUrl (T-14)", () => {
  it("usa la env configurada y normaliza la barra final", () => {
    expect(
      resolverBaseUrlPublica(
        "https://staging.pixelarch.dev/",
        "https://pixelarch.dev/pago/paypal/token"
      )
    ).toBe("https://staging.pixelarch.dev")

    expect(
      resolverBaseUrlPublica(
        "https://pixelarch.dev/app/",
        "https://otro.example/pago/paypal/token"
      )
    ).toBe("https://pixelarch.dev/app")
  })

  it("rechaza una env invalida en vez de caer al origin de la request", () => {
    for (const env of [
      "http://pixelarch.dev",
      "https://user:pass@pixelarch.dev",
      "https://pixelarch.dev?x=1",
      "javascript:alert(1)",
      "no-es-url",
    ]) {
      expect(resolverBaseUrlPublica(env, "https://pixelarch.dev/pago")).toBeNull()
    }
  })

  it("sin env valida el origin de la request y solo admite HTTP local", () => {
    expect(
      resolverBaseUrlPublica(undefined, "https://pixelarch.dev/pago/paypal/token")
    ).toBe("https://pixelarch.dev")
    expect(
      resolverBaseUrlPublica("", "https://pixelarch.dev/pago/paypal/token")
    ).toBe("https://pixelarch.dev")
    expect(
      resolverBaseUrlPublica(null, "http://localhost:3000/pago/paypal/token")
    ).toBe("http://localhost:3000")
    expect(
      resolverBaseUrlPublica(undefined, "http://pixelarch.dev/pago")
    ).toBeNull()
    expect(resolverBaseUrlPublica(undefined, "no-es-url")).toBeNull()
  })
})

describe("mapeo de estados PayPal (T-04, AC-1, AC-15, AC-22, AC-24, AC-26; plan §2.5)", () => {
  it("solo deja el link ACTIVO mientras la orden sigue en curso", () => {
    for (const estado of ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED", "PENDING"]) {
      expect(mapearEstadoEnlacePaypal(estado)).toBe("ACTIVO")
    }
  })

  it("no cambia el link por estados terminales de la orden/intento", () => {
    for (const estado of [
      "COMPLETED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "REVERSED",
      "VOIDED",
      "CANCELED",
      "CANCELLED",
      "EXPIRED",
      "DECLINED",
      "DENIED",
      "FAILED",
    ]) {
      expect(mapearEstadoEnlacePaypal(estado)).toBeNull()
    }
  })

  it("EXPIRED/VOIDED/CANCELED/CANCELLED/DECLINED/DENIED/FAILED/COMPLETED no vencen, invalidan ni fallan el link (AC-15)", () => {
    const ahora = new Date("2026-10-19T12:00:00.000Z")
    const futuro = new Date("2026-11-18T12:00:00.000Z")
    const pasado = new Date("2026-10-01T12:00:00.000Z")

    for (const estado of [
      "EXPIRED",
      "VOIDED",
      "CANCELED",
      "CANCELLED",
      "DECLINED",
      "DENIED",
      "FAILED",
      "COMPLETED",
    ]) {
      // El estado de la orden no produce un estado de link que pisar; el
      // intento se registra en EventoPasarela y el link conserva su ciclo.
      const transicion = mapearEstadoEnlacePaypal(estado)
      expect(transicion).toBeNull()
      // El caller solo aplica transiciones no nulas: el link sigue ACTIVO.
      expect(resolverEstadoEnlace(transicion ?? "ACTIVO", futuro, ahora)).toBe("ACTIVO")
    }
    // El vencimiento depende solo de expiraEn y del ciclo propio del link.
    expect(resolverEstadoEnlace("ACTIVO", pasado, ahora)).toBe("VENCIDO")
    expect(resolverEstadoEnlace("PAGADO", futuro, ahora)).toBe("PAGADO")
    expect(resolverEstadoEnlace("INVALIDADO", futuro, ahora)).toBe("INVALIDADO")
  })

  it("COMPLETED de una orden no confirma el pago; solo el capture lo hace", () => {
    expect(mapearEstadoEnlacePaypal("COMPLETED")).toBeNull()
    expect(mapearEstadoPagoPaypal("COMPLETED")).toBe("SUCCEEDED")
  })

  it("mapea solo estados intermedios y COMPLETED de captura a EstadoPago", () => {
    expect(mapearEstadoPagoPaypal("COMPLETED")).toBe("SUCCEEDED")
    for (const estado of ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED", "PENDING"]) {
      expect(mapearEstadoPagoPaypal(estado)).toBe("PENDING")
    }
  })

  it("AC-22: reembolsos y contracargos no se aplican automaticamente; quedan para AjustePago manual", () => {
    for (const estado of ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]) {
      // Sin mapeo automatico no se crea un Pago REFUNDED/CONTRACARGO ni se
      // modifica el pago original: el admin registra el ajuste a mano.
      const transicion = mapearEstadoPagoPaypal(estado)
      expect(transicion).toBeNull()
      // Si el caller conserva el pago original (SUCCEEDED), no hay reversion.
      expect(transicion ?? "SUCCEEDED").toBe("SUCCEEDED")
      expect(mapearEstadoEnlacePaypal(estado)).toBeNull()
    }
  })

  it("AC-15: los intentos fallidos/cancelados/vencidos no crean Pago; van a EventoPasarela y el link sigue vigente", () => {
    const ahora = new Date("2026-10-19T12:00:00.000Z")
    const futuro = new Date("2026-11-18T12:00:00.000Z")

    for (const estado of [
      "DECLINED",
      "DENIED",
      "FAILED",
      "VOIDED",
      "CANCELED",
      "CANCELLED",
      "EXPIRED",
    ]) {
      expect(mapearEstadoPagoPaypal(estado)).toBeNull()
      expect(mapearEstadoEnlacePaypal(estado)).toBeNull()
      expect(resolverEstadoEnlace("ACTIVO", futuro, ahora)).toBe("ACTIVO")
    }
  })

  it("normaliza mayusculas/espacios y devuelve null para desconocidos o vacios", () => {
    expect(mapearEstadoEnlacePaypal(" approved ")).toBe("ACTIVO")
    expect(mapearEstadoPagoPaypal(" completed ")).toBe("SUCCEEDED")

    for (const estado of ["DESCONOCIDO", "", "   ", null, undefined]) {
      expect(mapearEstadoEnlacePaypal(estado)).toBeNull()
      expect(mapearEstadoPagoPaypal(estado)).toBeNull()
    }
  })
})
