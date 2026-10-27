import { describe, expect, it } from "vitest"

/**
 * T-21/T-22: seleccion del link PayPal vigente y del ultimo intento no vigente
 * para el detalle del cliente y `/admin/cobros`. Logica pura, sin DB ni red.
 */

import {
  datosPaypalEnlaces,
  enlacePaypalVigente,
  esSoportePaypalElegible,
  formatearFechaEnlace,
  paypalBlockDesdeConfig,
  ultimoIntentoPaypal,
  type EnlacePaypalVista,
} from "@/lib/paypal/links-view"

const AHORA = new Date("2026-10-27T12:00:00.000Z")

function enlace(
  overrides: Partial<EnlacePaypalVista> = {}
): EnlacePaypalVista {
  return {
    id: "enlace_1",
    url: "https://pixelarch.dev/pago/paypal/token-1",
    total: 10656,
    montoAcordado: 10050,
    comision: 606,
    expiraEn: "2026-11-18T12:00:00.000Z",
    estado: "ACTIVO",
    meses: 1,
    idioma: "es",
    creadoEn: "2026-10-20T12:00:00.000Z",
    ...overrides,
  }
}

describe("paypal links view: enlace vigente (AC-2, AC-26)", () => {
  it("elige el link ACTIVO no vencido mas reciente", () => {
    const vigente = enlacePaypalVigente(
      [
        enlace({ id: "viejo", creadoEn: "2026-10-20T12:00:00.000Z" }),
        enlace({ id: "nuevo", creadoEn: "2026-10-26T12:00:00.000Z" }),
      ],
      AHORA
    )

    expect(vigente?.enlaceId).toBe("nuevo")
    expect(vigente?.url).toBe("https://pixelarch.dev/pago/paypal/token-1")
    expect(vigente?.expiraEn).toBe("2026-11-18T12:00:00.000Z")
    expect(vigente?.reutilizado).toBe(true)
  })

  it("ignora vencidos, sin URL y no ACTIVO", () => {
    const vigente = enlacePaypalVigente(
      [
        enlace({ id: "vencido", expiraEn: "2026-10-01T00:00:00.000Z" }),
        enlace({ id: "invalidado", estado: "INVALIDADO" }),
        enlace({ id: "sin-url", url: null }),
        enlace({ id: "pagado", estado: "PAGADO" }),
      ],
      AHORA
    )

    expect(vigente).toBeNull()
  })

  it("devuelve null sin links o con una fecha invalida", () => {
    expect(enlacePaypalVigente(null, AHORA)).toBeNull()
    expect(enlacePaypalVigente([], AHORA)).toBeNull()
    expect(enlacePaypalVigente([enlace()], new Date("no-es-fecha"))).toBeNull()
  })
})

describe("paypal links view: ultimo intento (AC-15)", () => {
  it("devuelve el ultimo intento fallido con su motivo", () => {
    const intento = ultimoIntentoPaypal(
      [
        enlace({
          id: "fallido",
          estado: "FALLIDO",
          ultimoError: "PayPal no pudo crear el checkout.",
          creadoEn: "2026-10-25T12:00:00.000Z",
        }),
      ],
      AHORA
    )

    expect(intento).toMatchObject({
      enlaceId: "fallido",
      estado: "FALLIDO",
      motivo: "PayPal no pudo crear el checkout.",
      total: 10656,
      meses: 1,
      idioma: "es",
    })
  })

  it("considera un ACTIVO con expiraEn pasado como vencido", () => {
    const intento = ultimoIntentoPaypal(
      [enlace({ expiraEn: "2026-10-01T00:00:00.000Z" })],
      AHORA
    )

    expect(intento?.estado).toBe("VENCIDO")
    expect(intento?.motivo).toBeNull()
  })

  it("ignora un link vigente, PAGADO o CREANDO", () => {
    expect(ultimoIntentoPaypal([enlace()], AHORA)).toBeNull()
    expect(
      ultimoIntentoPaypal([enlace({ estado: "PAGADO" })], AHORA)
    ).toBeNull()
    expect(
      ultimoIntentoPaypal([enlace({ estado: "CREANDO" })], AHORA)
    ).toBeNull()
  })

  it("toma el intento mas reciente entre los no vigentes", () => {
    const intento = ultimoIntentoPaypal(
      [
        enlace({
          id: "viejo",
          estado: "FALLIDO",
          creadoEn: "2026-10-20T12:00:00.000Z",
        }),
        enlace({
          id: "nuevo",
          estado: "INVALIDADO",
          motivoInvalido: "REGENERADO",
          creadoEn: "2026-10-26T12:00:00.000Z",
        }),
      ],
      AHORA
    )

    expect(intento?.enlaceId).toBe("nuevo")
    expect(intento?.estado).toBe("INVALIDADO")
    expect(intento?.motivo).toBe("REGENERADO")
  })
})

describe("paypal links view: elegibilidad y configuracion compartida", () => {
  it("mapea paypalConfig a la configuracion de UI", () => {
    expect(
      paypalBlockDesdeConfig({
        disponible: true,
        fee: { bps: 540, fixedCents: 30 },
      })
    ).toEqual({ disponible: true, feeBps: 540, feeFixedCents: 30 })
  })

  it.each([
    ["ACTIVE", "SOPORTE", true],
    ["PAST_DUE", "SOPORTE", true],
    ["PAUSED", "SOPORTE", false],
    ["CANCELED", "SOPORTE", false],
    ["ACTIVE", "BASICO", false],
    ["ACTIVE", "MANTENIMIENTO", false],
  ] as const)(
    "evalua el soporte %s/%s como elegible=%s",
    (estado, plan, esperado) => {
      expect(esSoportePaypalElegible({ estado, plan })).toBe(esperado)
    }
  )

  it("no depende de proximoPago: un soporte lejano o sin fecha sigue elegible", () => {
    const lejano = {
      plan: "SOPORTE" as const,
      estado: "ACTIVE",
      proximoPago: new Date("2027-01-01T00:00:00.000Z"),
    }
    const sinFecha = {
      plan: "SOPORTE" as const,
      estado: "PAST_DUE",
      proximoPago: null,
    }

    expect(esSoportePaypalElegible(lejano)).toBe(true)
    expect(esSoportePaypalElegible(sinFecha)).toBe(true)
  })
})

describe("paypal links view: datos para la fila y el modal", () => {
  it("prioriza el link vigente y no expone un intento anterior", () => {
    const datos = datosPaypalEnlaces(
      [
        enlace({ estado: "FALLIDO", creadoEn: "2026-10-01T12:00:00.000Z" }),
        enlace({ id: "vigente", creadoEn: "2026-10-20T12:00:00.000Z" }),
      ],
      AHORA
    )

    expect(datos.enlaceExistente?.enlaceId).toBe("vigente")
    expect(datos.ultimoIntento).toBeNull()
    expect(datos.resumen).toMatch(/^Link PayPal vigente · vence /)
  })

  it("resume el ultimo intento cuando no hay link vigente", () => {
    const datos = datosPaypalEnlaces(
      [
        enlace({
          estado: "FALLIDO",
          creadoEn: "2026-10-25T12:00:00.000Z",
        }),
      ],
      AHORA
    )

    expect(datos.enlaceExistente).toBeNull()
    expect(datos.ultimoIntento?.estado).toBe("FALLIDO")
    expect(datos.resumen).toMatch(
      /^PayPal: último intento fallido · /
    )
  })

  it("no muestra nada si no hay links utiles", () => {
    const datos = datosPaypalEnlaces([], AHORA)

    expect(datos).toEqual({
      enlaceExistente: null,
      ultimoIntento: null,
      resumen: null,
    })
  })

  it("formatea la fecha en es-AR", () => {
    expect(formatearFechaEnlace("2026-11-18T12:00:00.000Z")).toBe("18 nov")
    expect(formatearFechaEnlace("2026-11-18T12:00:00.000Z", true)).toBe(
      "18 de nov de 2026"
    )
    expect(formatearFechaEnlace("no-es-fecha")).toBe("")
  })
})
