import { describe, expect, it } from "vitest"
import {
  PAYPAL_MENSAJE_TIMEZONE,
  armarMensajePaypal,
} from "@/lib/paypal/messages"
import { PaypalValidationError } from "@/lib/paypal/utils"
import { formatearMonto } from "@/lib/pagos"

/**
 * T-05 (AC-3, RNF-14): plantillas puras de email y WhatsApp en ES/EN.
 * Montos ES en es-AR (`US$100,50`) y EN en en-US (`US$100.50`); fechas en
 * America/Argentina/Buenos_Aires para que el resultado no dependa del entorno.
 */

const VENCIMIENTO = new Date("2026-11-18T15:00:00.000Z")

const base = {
  concepto: "Anticipo del proyecto",
  montoAcordadoCents: 10050,
  comisionCents: 606,
  totalCents: 10656,
  moneda: "usd" as const,
  link: "https://pixelarch.dev/pago/paypal/token-opaco-123",
  vencimiento: VENCIMIENTO,
  clienteNombre: "Ana Pérez",
  nota: "Acordado por email.",
}

const sinOpcionales = {
  concepto: base.concepto,
  montoAcordadoCents: base.montoAcordadoCents,
  comisionCents: base.comisionCents,
  totalCents: base.totalCents,
  moneda: base.moneda,
  link: base.link,
  vencimiento: base.vencimiento,
}

describe("armarMensajePaypal — EMAIL es (T-05, AC-3)", () => {
  it("incluye concepto, desglose USD, link, vencimiento y nota (AC-3)", () => {
    const mensaje = armarMensajePaypal({ ...base, idioma: "es", canal: "EMAIL" })

    expect(mensaje.asunto).toBe("Cobro por PayPal — Anticipo del proyecto")
    expect(mensaje.cuerpo).toContain("Hola Ana Pérez,")
    expect(mensaje.cuerpo).toContain("Concepto: Anticipo del proyecto")
    expect(mensaje.cuerpo).toContain(
      `Monto acordado: ${formatearMonto(10050, "usd", "es-AR")}`
    )
    expect(mensaje.cuerpo).toContain(
      `Comisión de PayPal: ${formatearMonto(606, "usd", "es-AR")}`
    )
    expect(mensaje.cuerpo).toContain(
      `Total a pagar (incluye la comisión de PayPal): ${formatearMonto(10656, "usd", "es-AR")}`
    )
    expect(mensaje.cuerpo).toContain("Monto acordado: US$100,50")
    expect(mensaje.cuerpo).toContain("Comisión de PayPal: US$6,06")
    expect(mensaje.cuerpo).toContain(
      "Total a pagar (incluye la comisión de PayPal): US$106,56"
    )
    expect(mensaje.cuerpo).toContain(base.link)
    expect(mensaje.cuerpo).toContain(
      "Vencimiento del link: 18/11/2026 (hora de Argentina)."
    )
    expect(mensaje.cuerpo).toContain("Nota: Acordado por email.")
    expect(mensaje.cuerpo).not.toContain("<")
  })

  it("colapsa espacios y saltos de linea del concepto", () => {
    const mensaje = armarMensajePaypal({
      ...base,
      concepto: "  Anticipo\n  del proyecto  ",
      idioma: "es",
      canal: "EMAIL",
    })

    expect(mensaje.asunto).toBe("Cobro por PayPal — Anticipo del proyecto")
    expect(mensaje.cuerpo).toContain("Concepto: Anticipo del proyecto")
  })
})

describe("armarMensajePaypal — EMAIL en (T-05, AC-3)", () => {
  it("usa en-US para montos y fechas, y conserva link y desglose", () => {
    const mensaje = armarMensajePaypal({
      ...base,
      concepto: "Project deposit",
      idioma: "en",
      canal: "EMAIL",
    })

    expect(mensaje.asunto).toBe("PayPal payment — Project deposit")
    expect(mensaje.cuerpo).toContain("Hi Ana Pérez,")
    expect(mensaje.cuerpo).toContain("Concept: Project deposit")
    expect(mensaje.cuerpo).toContain(
      `Agreed amount: ${formatearMonto(10050, "usd", "en-US")}`
    )
    expect(mensaje.cuerpo).toContain(
      `PayPal fee: ${formatearMonto(606, "usd", "en-US")}`
    )
    expect(mensaje.cuerpo).toContain(
      `Total to pay (includes the PayPal fee): ${formatearMonto(10656, "usd", "en-US")}`
    )
    expect(mensaje.cuerpo).toContain("Agreed amount: US$100.50")
    expect(mensaje.cuerpo).toContain("PayPal fee: US$6.06")
    expect(mensaje.cuerpo).toContain(
      "Total to pay (includes the PayPal fee): US$106.56"
    )
    expect(mensaje.cuerpo).toContain(base.link)
    expect(mensaje.cuerpo).toContain("Link expiry: 11/18/2026 (Argentina time).")
    expect(mensaje.cuerpo).toContain("Note: Acordado por email.")
  })
})

describe("armarMensajePaypal — WHATSAPP (T-05, AC-3)", () => {
  it("devuelve { texto } en es con los mismos datos obligatorios", () => {
    const mensaje = armarMensajePaypal({ ...base, idioma: "es", canal: "WHATSAPP" })

    expect(mensaje.texto).toContain(
      "Hola Ana Pérez, te paso el detalle del cobro por PayPal:"
    )
    expect(mensaje.texto).toContain("Concepto: Anticipo del proyecto")
    expect(mensaje.texto).toContain("Monto acordado: US$100,50")
    expect(mensaje.texto).toContain("Comisión de PayPal: US$6,06")
    expect(mensaje.texto).toContain(
      "Total a pagar (incluye la comisión de PayPal): US$106,56"
    )
    expect(mensaje.texto).toContain(base.link)
    expect(mensaje.texto).toContain(
      "Vencimiento del link: 18/11/2026 (hora de Argentina)."
    )
    expect(mensaje.texto).toContain("Nota: Acordado por email.")
    expect(mensaje).not.toHaveProperty("asunto")
    expect(mensaje).not.toHaveProperty("cuerpo")
  })

  it("devuelve { texto } en en con montos y fecha en-US", () => {
    const mensaje = armarMensajePaypal({
      ...base,
      concepto: "Project deposit",
      idioma: "en",
      canal: "WHATSAPP",
    })

    expect(mensaje.texto).toContain(
      "Hi Ana Pérez, here are the details of your PayPal payment:"
    )
    expect(mensaje.texto).toContain("Concept: Project deposit")
    expect(mensaje.texto).toContain("Agreed amount: US$100.50")
    expect(mensaje.texto).toContain("PayPal fee: US$6.06")
    expect(mensaje.texto).toContain(
      "Total to pay (includes the PayPal fee): US$106.56"
    )
    expect(mensaje.texto).toContain(base.link)
    expect(mensaje.texto).toContain("Link expiry: 11/18/2026 (Argentina time).")
    expect(mensaje.texto).toContain("Note: Acordado por email.")
  })
})

describe("armarMensajePaypal — montos con miles y centavos (T-05, AC-18, RNF-14)", () => {
  const miles = {
    ...base,
    concepto: "Soporte 3 meses",
    montoAcordadoCents: 100050,
    comisionCents: 6060,
    totalCents: 106110,
  }

  it("formatea es-AR con puntos de miles y coma decimal", () => {
    const mensaje = armarMensajePaypal({ ...miles, idioma: "es", canal: "EMAIL" })

    expect(mensaje.cuerpo).toContain("Monto acordado: US$1.000,50")
    expect(mensaje.cuerpo).toContain("Comisión de PayPal: US$60,60")
    expect(mensaje.cuerpo).toContain(
      "Total a pagar (incluye la comisión de PayPal): US$1.061,10"
    )
  })

  it("formatea en-US con comas de miles y punto decimal", () => {
    const mensaje = armarMensajePaypal({ ...miles, idioma: "en", canal: "EMAIL" })

    expect(mensaje.cuerpo).toContain("Agreed amount: US$1,000.50")
    expect(mensaje.cuerpo).toContain("PayPal fee: US$60.60")
    expect(mensaje.cuerpo).toContain(
      "Total to pay (includes the PayPal fee): US$1,061.10"
    )
  })

  it("muestra comision cero cuando la tarifa no agrega comision", () => {
    const mensaje = armarMensajePaypal({
      ...base,
      comisionCents: 0,
      totalCents: 10050,
      idioma: "es",
      canal: "EMAIL",
    })

    expect(mensaje.cuerpo).toContain("Comisión de PayPal: US$0,00")
    expect(mensaje.cuerpo).toContain(
      "Total a pagar (incluye la comisión de PayPal): US$100,50"
    )
  })
})

describe("armarMensajePaypal — campos opcionales (T-05, AC-3)", () => {
  it("omite nombre y nota sin dejar marcadores vacios", () => {
    const email = armarMensajePaypal({
      ...sinOpcionales,
      idioma: "es",
      canal: "EMAIL",
    })
    expect(email.cuerpo.startsWith("Hola,\n")).toBe(true)
    expect(email.cuerpo).not.toContain("undefined")
    expect(email.cuerpo).not.toContain("null")
    expect(email.cuerpo).not.toContain("Nota:")

    const whatsapp = armarMensajePaypal({
      ...sinOpcionales,
      idioma: "en",
      canal: "WHATSAPP",
    })
    expect(whatsapp.texto.startsWith("Hi, here are the details")).toBe(true)
    expect(whatsapp.texto).not.toContain("Note:")
  })

  it("trata nombre y nota vacios como ausentes", () => {
    const email = armarMensajePaypal({
      ...sinOpcionales,
      idioma: "es",
      canal: "EMAIL",
      clienteNombre: "   ",
      nota: "  ",
    })

    expect(email.cuerpo.startsWith("Hola,\n")).toBe(true)
    expect(email.cuerpo).not.toContain("Nota:")
  })
})

describe("armarMensajePaypal — privacidad (T-05, RNF-14)", () => {
  it("genera solo texto plano en ambos canales e idiomas, sin HTML", () => {
    for (const idioma of ["es", "en"] as const) {
      const email = armarMensajePaypal({ ...base, idioma, canal: "EMAIL" })
      const whatsapp = armarMensajePaypal({ ...base, idioma, canal: "WHATSAPP" })

      for (const texto of [`${email.asunto}\n${email.cuerpo}`, whatsapp.texto]) {
        expect(texto).not.toMatch(/<[a-z!/]/i)
        expect(texto).not.toContain("&nbsp;")
      }
    }
  })

  it("no filtra datos del pagador aunque lleguen en el objeto", () => {
    const conDatosDelPagador = {
      ...base,
      idioma: "es" as const,
      canal: "EMAIL" as const,
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Payer Ejemplo",
      payerEmail: "payer@example.com",
      email_address: "otro@example.com",
      payerId: "PAYER-123",
    }

    const mensaje = armarMensajePaypal(conDatosDelPagador)
    const texto = `${mensaje.asunto}\n${mensaje.cuerpo}`

    expect(texto).toContain("Ana Pérez")
    for (const dato of [
      "pagador@example.com",
      "Payer Ejemplo",
      "payer@example.com",
      "otro@example.com",
      "PAYER-123",
    ]) {
      expect(texto).not.toContain(dato)
    }
  })
})

describe("armarMensajePaypal — fechas deterministas (T-05, AC-3)", () => {
  it("muestra el dia en America/Argentina/Buenos_Aires, no en UTC", () => {
    // 2026-11-19 02:30 UTC = 2026-11-18 23:30 en Argentina.
    const vencimiento = new Date("2026-11-19T02:30:00.000Z")

    const emailEs = armarMensajePaypal({
      ...base,
      vencimiento,
      idioma: "es",
      canal: "EMAIL",
    })
    const emailEn = armarMensajePaypal({
      ...base,
      vencimiento,
      idioma: "en",
      canal: "EMAIL",
    })

    expect(PAYPAL_MENSAJE_TIMEZONE).toBe("America/Argentina/Buenos_Aires")
    expect(emailEs.cuerpo).toContain(
      "Vencimiento del link: 18/11/2026 (hora de Argentina)."
    )
    expect(emailEs.cuerpo).not.toContain("19/11/2026")
    expect(emailEn.cuerpo).toContain("Link expiry: 11/18/2026 (Argentina time).")
    expect(emailEn.cuerpo).not.toContain("11/19/2026")
  })

  it("acepta el vencimiento como ISO con hora y aplica la misma zona fija", () => {
    const email = armarMensajePaypal({
      ...base,
      vencimiento: "2026-11-19T02:30:00.000Z",
      idioma: "en",
      canal: "EMAIL",
    })

    expect(email.cuerpo).toContain("Link expiry: 11/18/2026 (Argentina time).")
    expect(email.cuerpo).not.toContain("11/19/2026")
  })

  it("es determinista para la misma entrada", () => {
    const input = { ...base, idioma: "es" as const, canal: "WHATSAPP" as const }

    expect(armarMensajePaypal(input)).toEqual(armarMensajePaypal(input))
  })
})

describe("armarMensajePaypal — validacion de entrada (T-05, AC-3, RNF-4)", () => {
  it("rechaza un total que no reconcilia monto acordado + comision", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        totalCents: 10655,
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza moneda distinta de USD", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        moneda: "ars" as never,
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza un vencimiento invalido", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        vencimiento: "no-es-fecha",
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza comisiones negativas y montos no enteros", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        comisionCents: -1,
        totalCents: 10049,
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        montoAcordadoCents: 10050.5,
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        comisionCents: 6.06,
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        totalCents: 10656.5,
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza conceptos y links vacios o solo con espacios", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        concepto: "   ",
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "en",
        canal: "WHATSAPP",
        link: "\n\t ",
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza idioma, canal y tipos de vencimiento invalidos", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "fr" as never,
        canal: "EMAIL",
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "SMS" as never,
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        vencimiento: new Date("no-es-fecha"),
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        vencimiento: null as unknown as Date,
      })
    ).toThrow(PaypalValidationError)
  })

  it("rechaza montos cero o negativos", () => {
    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        montoAcordadoCents: 0,
        comisionCents: 606,
        totalCents: 606,
      })
    ).toThrow(PaypalValidationError)

    expect(() =>
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        montoAcordadoCents: -100,
        comisionCents: 0,
        totalCents: -100,
      })
    ).toThrow(PaypalValidationError)
  })

  it("no expone concepto, link ni nombre del cliente en el error", () => {
    const nombre = "Cliente Secreto"
    const link = "https://pixelarch.dev/pago/paypal/token-secreto"
    let error: unknown

    try {
      armarMensajePaypal({
        ...base,
        idioma: "es",
        canal: "EMAIL",
        clienteNombre: nombre,
        link,
        totalCents: 1,
      })
    } catch (capturado) {
      error = capturado
    }

    expect(error).toBeInstanceOf(PaypalValidationError)
    const mensajeError = (error as PaypalValidationError).message
    expect(mensajeError).not.toContain(nombre)
    expect(mensajeError).not.toContain(link)
    expect(mensajeError).not.toContain("token-secreto")
  })
})
