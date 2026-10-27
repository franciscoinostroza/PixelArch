import { describe, expect, it } from "vitest"

/**
 * T-10 (AC-10, AC-24): recibo interno de PayPal.
 *
 * Se prueban el identificador unico sin PII y el snapshot del recibo
 * (concepto, monto acordado, comision, total, USD, fecha, pasarela y
 * referencia externa), sin HTML/PDF ni datos del pagador.
 */

import {
  RECIBO_PAYPAL_ALEATORIO_BYTES,
  RECIBO_PAYPAL_CONCEPTO_MAX,
  RECIBO_PAYPAL_ID_MAX,
  RECIBO_PAYPAL_REFERENCIA_MAX,
  construirReciboPaypal,
  generarReciboId,
  type DatosReciboPaypalInput,
} from "@/lib/paypal/receipts"
import { PaypalValidationError } from "@/lib/paypal/utils"

const AHORA = new Date("2026-10-20T12:00:00.000Z")

function datosBase(
  overrides: Partial<DatosReciboPaypalInput> = {}
): DatosReciboPaypalInput {
  return {
    reciboId: "PAY-20261020-ABCDEF123456",
    concepto: "Sitio ACME — Anticipo",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    fecha: AHORA,
    referenciaExterna: "CAPTURE-ABC-1",
    ...overrides,
  }
}

describe("generarReciboId (AC-10)", () => {
  it("genera un id con fecha UTC y sufijo aleatorio, sin PII", () => {
    const id = generarReciboId(AHORA)

    expect(id).toMatch(
      new RegExp(
        `^PAY-20261020-[0-9A-F]{${RECIBO_PAYPAL_ALEATORIO_BYTES * 2}}$`
      )
    )
    expect(id).not.toContain("@")
    expect(id).not.toContain(" ")
  })

  it("genera identificadores unicos", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      ids.add(generarReciboId(AHORA))
    }
    expect(ids.size).toBe(500)
  })

  it("usa la fecha UTC para el prefijo", () => {
    const finDeAnio = new Date("2026-12-31T23:30:00.000Z")
    expect(generarReciboId(finDeAnio)).toMatch(/^PAY-20261231-[0-9A-F]{12}$/)
  })

  it("rechaza una fecha invalida", () => {
    expect(() => generarReciboId(new Date(Number.NaN))).toThrow(
      PaypalValidationError
    )
  })
})

describe("construirReciboPaypal (AC-10, AC-24)", () => {
  it("arma el snapshot con desglose exacto y sin datos del pagador", () => {
    // El caller puede mandar campos extra: el recibo solo conserva los suyos.
    const entrada = {
      ...datosBase(),
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador",
      tarjeta: "4111111111111111",
    } as DatosReciboPaypalInput

    const recibo = construirReciboPaypal(entrada)

    expect(recibo).toEqual({
      reciboId: "PAY-20261020-ABCDEF123456",
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      moneda: "usd",
      fecha: AHORA,
      pasarela: "PAYPAL",
      referenciaExterna: "CAPTURE-ABC-1",
    })
    expect(recibo.montoAcordado + recibo.comision).toBe(recibo.total)
    expect(recibo.moneda).toBe("usd")
    expect(recibo.pasarela).toBe("PAYPAL")

    const serializado = JSON.stringify(recibo)
    expect(serializado).not.toContain("pagador")
    expect(serializado).not.toContain("Pagador")
    expect(serializado).not.toContain("4111111111111111")
    expect(Object.keys(recibo).sort()).toEqual(
      [
        "comision",
        "concepto",
        "fecha",
        "moneda",
        "montoAcordado",
        "pasarela",
        "reciboId",
        "referenciaExterna",
        "total",
      ].sort()
    )
  })

  it("normaliza USD escrito en mayusculas", () => {
    const recibo = construirReciboPaypal(datosBase({ moneda: "USD" }))
    expect(recibo.moneda).toBe("usd")
  })

  it("no muta la fecha original", () => {
    const fecha = new Date(AHORA.getTime())
    const recibo = construirReciboPaypal(datosBase({ fecha }))

    recibo.fecha.setUTCFullYear(2030)
    expect(fecha.toISOString()).toBe(AHORA.toISOString())
  })

  it("rechaza ARS: PayPal solo emite recibos en USD", () => {
    expect(() => construirReciboPaypal(datosBase({ moneda: "ars" }))).toThrow(
      PaypalValidationError
    )
  })

  it("rechaza un desglose que no reconcilia", () => {
    expect(() =>
      construirReciboPaypal(datosBase({ total: 10655 }))
    ).toThrow(PaypalValidationError)
  })

  it("acepta exactamente las longitudes maximas de los campos de texto", () => {
    const recibo = construirReciboPaypal(
      datosBase({
        reciboId: "R".repeat(RECIBO_PAYPAL_ID_MAX),
        concepto: "C".repeat(RECIBO_PAYPAL_CONCEPTO_MAX),
        referenciaExterna: "X".repeat(RECIBO_PAYPAL_REFERENCIA_MAX),
      })
    )

    expect(recibo.reciboId).toHaveLength(RECIBO_PAYPAL_ID_MAX)
    expect(recibo.concepto).toHaveLength(RECIBO_PAYPAL_CONCEPTO_MAX)
    expect(recibo.referenciaExterna).toHaveLength(RECIBO_PAYPAL_REFERENCIA_MAX)
  })

  it.each([
    [
      "reciboId",
      { reciboId: "R".repeat(RECIBO_PAYPAL_ID_MAX + 1) },
    ],
    [
      "concepto",
      { concepto: "C".repeat(RECIBO_PAYPAL_CONCEPTO_MAX + 1) },
    ],
    [
      "referenciaExterna",
      { referenciaExterna: "X".repeat(RECIBO_PAYPAL_REFERENCIA_MAX + 1) },
    ],
  ])("rechaza %s por encima de la longitud maxima", (_campo, overrides) => {
    expect(() =>
      construirReciboPaypal(datosBase(overrides as Partial<DatosReciboPaypalInput>))
    ).toThrow(PaypalValidationError)
  })

  it.each([
    ["monto acordado 0", { montoAcordado: 0 }],
    ["monto acordado negativo", { montoAcordado: -1 }],
    ["monto acordado decimal", { montoAcordado: 100.5 }],
    ["comision negativa", { comision: -1 }],
    ["comision decimal", { comision: 6.06 }],
    ["total 0", { total: 0 }],
    ["recibo vacio", { reciboId: "  " }],
    ["concepto vacio", { concepto: "  " }],
    ["referencia vacia", { referenciaExterna: "" }],
    ["fecha invalida", { fecha: new Date(Number.NaN) }],
  ])("rechaza %s", (_caso, overrides) => {
    expect(() =>
      construirReciboPaypal(datosBase(overrides as Partial<DatosReciboPaypalInput>))
    ).toThrow(PaypalValidationError)
  })
})
