import { describe, expect, it } from "vitest"

/**
 * T-19 (AC-11, AC-12, AC-19): helpers puros de historial.
 *
 * Cubren filtros por pasarela/revision, concepto, referencias externas,
 * desglose y diferencia, envio, autor, estado visible y elegibilidad del
 * recibo. Todo sin Prisma, sin React y sin red. El caso de PII verifica que la
 * fila compuesta no filtre datos del cliente ni del pagador.
 */

import {
  CANAL_ENVIO_LABEL,
  ESTADO_REVISION_LABEL,
  ESTADOS_REVISION_HISTORIAL,
  IDIOMA_LABEL,
  ORIGEN_PAGO_LABEL,
  PASARELA_LABEL,
  PASARELAS_HISTORIAL,
  coincideFiltroHistorial,
  etiquetaPasarela,
  etiquetaRevision,
  evaluarElegibilidadRecibo,
  filtrarPagosHistorial,
  formatearMontoHistorial,
  mapearAutorPago,
  mapearConceptoPago,
  mapearDesglosePago,
  mapearEnvioPago,
  mapearEstadoPagoVisible,
  mapearPagoHistorial,
  mapearReferenciasPago,
  normalizarPasarela,
  pasarelaEfectiva,
  type PagoHistorialInput,
} from "@/lib/paypal/view"

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const RECIBO = "PAY-20261020-ABCDEF123456"

function pagoBase(overrides: Partial<PagoHistorialInput> = {}): PagoHistorialInput {
  return {
    id: "pago_1",
    estadoPago: "SUCCEEDED",
    revisionEstado: null,
    monto: 10656,
    montoAcordado: 10050,
    comision: 606,
    montoEsperado: 10656,
    moneda: "usd",
    pasarela: "PAYPAL",
    origen: "AUTOMATICO",
    externalId: "CAPTURE-1",
    paypalOrderId: "ORDER-1",
    reciboId: RECIBO,
    reciboEmitidoEn: AHORA,
    creadoEn: AHORA,
    registradoPor: null,
    hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
    suscripcion: null,
    enlacePago: {
      concepto: "Sitio ACME — Anticipo",
      descripcion: "Anticipo 50%",
      externalId: "ORDER-1",
      generadoPorNombre: "Ana Admin",
      enviadoEn: AHORA,
      canalEnvio: "EMAIL",
      idioma: "es",
    },
    ...overrides,
  }
}

describe("normalizacion y etiquetas (AC-11)", () => {
  it("expone las pasarelas y revisiones permitidas en el historial", () => {
    expect(PASARELAS_HISTORIAL).toEqual(["PAYPAL", "MERCADOPAGO", "MANUAL"])
    expect(ESTADOS_REVISION_HISTORIAL).toEqual([
      "PENDIENTE",
      "ACEPTADO",
      "RECHAZADO",
    ])
    expect(PASARELA_LABEL).toEqual({
      PAYPAL: "PayPal",
      MERCADOPAGO: "Mercado Pago",
      MANUAL: "Manual",
    })
    expect(ESTADO_REVISION_LABEL.PENDIENTE).toBe("Pendiente")
    expect(ORIGEN_PAGO_LABEL.AUTOMATICO).toBe("Automático")
    expect(CANAL_ENVIO_LABEL.WHATSAPP).toBe("WhatsApp")
    expect(IDIOMA_LABEL.en).toBe("Inglés")
  })

  it("normaliza pasarelas sin distinguir mayusculas ni espacios", () => {
    expect(normalizarPasarela(" paypal ")).toBe("PAYPAL")
    expect(normalizarPasarela("MercadoPago")).toBe("MERCADOPAGO")
    expect(normalizarPasarela("manual")).toBe("MANUAL")
    expect(normalizarPasarela("stripe")).toBeNull()
    expect(normalizarPasarela("")).toBeNull()
    expect(normalizarPasarela(null)).toBeNull()
    expect(normalizarPasarela(undefined)).toBeNull()
  })

  it("trata una pasarela ausente como MANUAL, el default de Prisma", () => {
    expect(pasarelaEfectiva(null)).toBe("MANUAL")
    expect(pasarelaEfectiva(undefined)).toBe("MANUAL")
    expect(pasarelaEfectiva("PAYPAL")).toBe("PAYPAL")
    expect(etiquetaPasarela(null)).toBe("Manual")
    expect(etiquetaPasarela("PAYPAL")).toBe("PayPal")
    expect(etiquetaPasarela("MERCADOPAGO")).toBe("Mercado Pago")
  })

  it("etiqueta la revision y descarta valores desconocidos", () => {
    expect(etiquetaRevision("PENDIENTE")).toBe("Pendiente")
    expect(etiquetaRevision("aceptado")).toBe("Aceptado")
    expect(etiquetaRevision("RECHAZADO")).toBe("Rechazado")
    expect(etiquetaRevision(null)).toBeNull()
    expect(etiquetaRevision("OTRO")).toBeNull()
  })
})

describe("filtros de historial (AC-11, AC-12)", () => {
  const pagos = [
    { id: "paypal", pasarela: "PAYPAL", revisionEstado: null },
    { id: "mercadopago", pasarela: "MERCADOPAGO", revisionEstado: null },
    { id: "manual", pasarela: "MANUAL", revisionEstado: null },
    { id: "legacy", pasarela: null, revisionEstado: "PENDIENTE" },
    { id: "aceptado", pasarela: "PAYPAL", revisionEstado: "ACEPTADO" },
  ]

  it("sin filtros devuelve todas las filas", () => {
    expect(filtrarPagosHistorial(pagos)).toEqual(pagos)
    expect(filtrarPagosHistorial(pagos, {})).toEqual(pagos)
    expect(filtrarPagosHistorial([], { pasarela: "PAYPAL" })).toEqual([])
  })

  it("filtra por cada pasarela y conserva el orden y la identidad", () => {
    const soloPaypal = filtrarPagosHistorial(pagos, { pasarela: "PAYPAL" })
    expect(soloPaypal.map((p) => p.id)).toEqual(["paypal", "aceptado"])
    expect(soloPaypal[0]).toBe(pagos[0])

    expect(
      filtrarPagosHistorial(pagos, { pasarela: "MERCADOPAGO" }).map((p) => p.id)
    ).toEqual(["mercadopago"])
    expect(
      filtrarPagosHistorial(pagos, { pasarela: "MANUAL" }).map((p) => p.id)
    ).toEqual(["manual", "legacy"])
  })

  it("filtra por estado de revision exacto", () => {
    expect(
      filtrarPagosHistorial(pagos, { revision: "PENDIENTE" }).map((p) => p.id)
    ).toEqual(["legacy"])
    expect(
      filtrarPagosHistorial(pagos, { revision: "ACEPTADO" }).map((p) => p.id)
    ).toEqual(["aceptado"])
    expect(filtrarPagosHistorial(pagos, { revision: "RECHAZADO" })).toEqual([])
  })

  it("combina pasarela y revision", () => {
    expect(
      filtrarPagosHistorial(pagos, {
        pasarela: "PAYPAL",
        revision: "ACEPTADO",
      }).map((p) => p.id)
    ).toEqual(["aceptado"])
    expect(
      filtrarPagosHistorial(pagos, {
        pasarela: "MERCADOPAGO",
        revision: "PENDIENTE",
      })
    ).toEqual([])
  })

  it("ignora filtros vacios o invalidos en vez de romper", () => {
    expect(filtrarPagosHistorial(pagos, { pasarela: "" })).toEqual(pagos)
    expect(filtrarPagosHistorial(pagos, { pasarela: "STRIPE" })).toEqual(pagos)
    expect(filtrarPagosHistorial(pagos, { revision: "OTRO" })).toEqual(pagos)
    expect(coincideFiltroHistorial(pagos[0])).toBe(true)
  })
})

describe("mapeo de concepto (AC-11, AC-12)", () => {
  it("combina proyecto y hito", () => {
    expect(
      mapearConceptoPago({
        hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
        enlacePago: { concepto: "Concepto del link", descripcion: "50%" },
      })
    ).toEqual({
      tipo: "HITO",
      titulo: "Sitio ACME — Anticipo",
      descripcion: "50%",
      proyecto: "Sitio ACME",
      hito: "Anticipo",
      servicio: null,
    })
  })

  it("tolera hito sin proyecto y usa el concepto del enlace como detalle", () => {
    expect(
      mapearConceptoPago({
        hito: { titulo: "Entrega", proyecto: null },
        enlacePago: { concepto: "Entrega final", descripcion: null },
      })
    ).toMatchObject({
      tipo: "HITO",
      titulo: "Entrega",
      descripcion: "Entrega final",
      proyecto: null,
      hito: "Entrega",
    })
  })

  it("mapea soporte con servicio y concepto del enlace", () => {
    expect(
      mapearConceptoPago({
        suscripcion: { servicio: { nombre: "Soporte ACME" } },
        enlacePago: {
          concepto: "Soporte — 3 meses",
          descripcion: "Cobro trimestral",
        },
      })
    ).toEqual({
      tipo: "SOPORTE",
      titulo: "Soporte ACME",
      descripcion: "Cobro trimestral",
      proyecto: null,
      hito: null,
      servicio: "Soporte ACME",
    })
  })

  it("usa el concepto del enlace si el soporte no tiene nombre de servicio", () => {
    expect(
      mapearConceptoPago({
        suscripcion: {},
        enlacePago: { concepto: "Soporte — 1 mes" },
      })
    ).toMatchObject({
      tipo: "SOPORTE",
      titulo: "Soporte — 1 mes",
      descripcion: null,
      servicio: null,
    })

    expect(mapearConceptoPago({ suscripcion: {} })).toMatchObject({
      tipo: "SOPORTE",
      titulo: "Soporte",
    })
  })

  it("cae al enlace cuando no hay hito ni soporte", () => {
    expect(
      mapearConceptoPago({
        enlacePago: { concepto: "Cobro suelto", descripcion: "Detalle" },
      })
    ).toEqual({
      tipo: "ENLACE",
      titulo: "Cobro suelto",
      descripcion: "Detalle",
      proyecto: null,
      hito: null,
      servicio: null,
    })
  })

  it("devuelve un concepto generico sin datos y tolera blancos", () => {
    expect(mapearConceptoPago({})).toMatchObject({
      tipo: "SIN_CONCEPTO",
      titulo: "Pago sin concepto",
      descripcion: null,
    })
    expect(
      mapearConceptoPago({
        hito: { titulo: "   ", proyecto: { titulo: "" } },
        suscripcion: null,
        enlacePago: { concepto: "  ", descripcion: "  " },
      })
    ).toMatchObject({
      tipo: "SIN_CONCEPTO",
      titulo: "Pago sin concepto",
      descripcion: null,
    })
  })
})

describe("mapeo de referencias externas (AC-11, AC-12)", () => {
  it("mapea capture y order de PayPal", () => {
    const referencias = mapearReferenciasPago({
      pasarela: "PAYPAL",
      externalId: "CAPTURE-1",
      paypalOrderId: "ORDER-1",
      enlacePago: { externalId: "ORDER-1" },
    })

    expect(referencias).toMatchObject({
      captureId: "CAPTURE-1",
      orderId: "ORDER-1",
      preferenceId: null,
      paymentId: null,
      referenciaExterna: null,
    })
    expect(referencias.principal).toEqual({
      tipo: "CAPTURE",
      etiqueta: "Capture CAPTURE-1",
      valor: "CAPTURE-1",
    })
    expect(referencias.todas.map((r) => r.etiqueta)).toEqual([
      "Capture CAPTURE-1",
      "Orden ORDER-1",
    ])
  })

  it("usa el externalId del enlace como orden si falta paypalOrderId", () => {
    const referencias = mapearReferenciasPago({
      pasarela: "PAYPAL",
      externalId: "CAPTURE-1",
      paypalOrderId: null,
      enlacePago: { externalId: "ORDER-ENLACE" },
    })
    expect(referencias.orderId).toBe("ORDER-ENLACE")
    expect(referencias.todas.map((r) => r.valor)).toEqual([
      "CAPTURE-1",
      "ORDER-ENLACE",
    ])
  })

  it("mapea preferencia e id de pago de Mercado Pago", () => {
    const referencias = mapearReferenciasPago({
      pasarela: "MERCADOPAGO",
      externalId: "PAYMENT-MP-1",
      paypalOrderId: "IGNORADO",
      enlacePago: { externalId: "PREFERENCE-1" },
    })

    expect(referencias).toMatchObject({
      captureId: null,
      orderId: null,
      preferenceId: "PREFERENCE-1",
      paymentId: "PAYMENT-MP-1",
      referenciaExterna: null,
    })
    expect(referencias.todas.map((r) => r.etiqueta)).toEqual([
      "Preferencia PREFERENCE-1",
      "Pago MP PAYMENT-MP-1",
    ])
  })

  it("mapea la referencia libre de un pago manual", () => {
    const referencias = mapearReferenciasPago({
      pasarela: "MANUAL",
      externalId: "TRANSFERENCIA-123",
      paypalOrderId: "IGNORADO",
      enlacePago: { externalId: "IGNORADO" },
    })
    expect(referencias.referenciaExterna).toBe("TRANSFERENCIA-123")
    expect(referencias.principal).toEqual({
      tipo: "EXTERNAL",
      etiqueta: "Referencia TRANSFERENCIA-123",
      valor: "TRANSFERENCIA-123",
    })
  })

  it("no repite referencias y tolera filas sin datos", () => {
    const referencias = mapearReferenciasPago({
      pasarela: "PAYPAL",
      externalId: "MISMO-ID",
      paypalOrderId: "MISMO-ID",
      enlacePago: { externalId: "MISMO-ID" },
    })
    expect(referencias.todas).toHaveLength(1)

    const vacias = mapearReferenciasPago({ pasarela: null })
    expect(vacias.principal).toBeNull()
    expect(vacias.todas).toEqual([])
    expect(vacias.captureId).toBeNull()
    expect(vacias.orderId).toBeNull()
    expect(vacias.preferenceId).toBeNull()
    expect(vacias.paymentId).toBeNull()
    expect(vacias.referenciaExterna).toBeNull()
  })
})

describe("desglose y diferencias (AC-11, AC-24)", () => {
  it("formatea el desglose normal en USD con es-AR", () => {
    const desglose = mapearDesglosePago({
      montoAcordado: 10050,
      comision: 606,
      monto: 10656,
      montoEsperado: 10656,
      moneda: "usd",
    })

    expect(desglose).toMatchObject({
      montoAcordado: 10050,
      comision: 606,
      monto: 10656,
      montoEsperado: 10656,
      diferencia: 0,
      moneda: "usd",
      monedaOriginal: "USD",
      monedaEtiqueta: "USD",
      tieneDiferencia: false,
    })
    expect(desglose.formateado).toEqual({
      montoAcordado: "US$100,50",
      comision: "US$6,06",
      monto: "US$106,56",
      montoEsperado: "US$106,56",
      diferencia: "US$0,00",
    })
  })

  it("expone diferencias positivas y negativas con signo", () => {
    const mayor = mapearDesglosePago({
      monto: 12000,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      moneda: "usd",
    })
    expect(mayor.diferencia).toBe(1344)
    expect(mayor.formateado.diferencia).toBe("+US$13,44")
    expect(mayor.tieneDiferencia).toBe(true)

    const parcial = mapearDesglosePago({
      monto: 5000,
      montoEsperado: 10656,
      moneda: "usd",
    })
    expect(parcial.diferencia).toBe(-5656)
    expect(parcial.formateado.diferencia).toBe("-US$56,56")
    expect(parcial.tieneDiferencia).toBe(true)
  })

  it("devuelve null en diferencia si no hay monto esperado", () => {
    const desglose = mapearDesglosePago({
      monto: 5000,
      montoEsperado: null,
      moneda: "usd",
    })
    expect(desglose.diferencia).toBeNull()
    expect(desglose.formateado.diferencia).toBeNull()
    expect(desglose.tieneDiferencia).toBe(false)
  })

  it("tolera montos ausentes o invalidos sin romper el formato", () => {
    const desglose = mapearDesglosePago({
      montoAcordado: null,
      comision: undefined,
      monto: Number.NaN,
      montoEsperado: -1,
      moneda: null,
    })

    expect(desglose).toMatchObject({
      montoAcordado: null,
      comision: null,
      monto: null,
      montoEsperado: null,
      diferencia: null,
      moneda: "usd",
      monedaOriginal: null,
      monedaEtiqueta: "USD",
      tieneDiferencia: false,
    })
    expect(desglose.formateado).toEqual({
      montoAcordado: null,
      comision: null,
      monto: null,
      montoEsperado: null,
      diferencia: null,
    })
  })

  it("formatea ARS y respeta el locale inyectado", () => {
    const desglose = mapearDesglosePago({
      monto: 3850000,
      montoEsperado: 3800000,
      montoAcordado: 3000000,
      comision: 850000,
      moneda: "ars",
    })
    expect(desglose.moneda).toBe("ars")
    expect(desglose.monedaEtiqueta).toBe("ARS")
    expect(desglose.formateado.monto).toBe("$38.500 ARS")
    expect(desglose.formateado.diferencia).toBe("+$500 ARS")

    expect(formatearMontoHistorial(10050, "usd")).toBe("US$100,50")
    expect(formatearMontoHistorial(100050, "usd")).toBe("US$1.000,50")
    expect(formatearMontoHistorial(10050, "usd", "en-US")).toBe("US$100.50")
    expect(formatearMontoHistorial(null, "usd")).toBeNull()
    expect(formatearMontoHistorial(1.5, "usd")).toBeNull()
    expect(formatearMontoHistorial(-1, "usd")).toBeNull()
  })
})

describe("canal, fecha de envio y autor (AC-12)", () => {
  it("mapea canal, fecha e idioma de un envio completo", () => {
    const envio = mapearEnvioPago({
      canalEnvio: "email",
      enviadoEn: AHORA,
      idioma: "ES",
    })
    expect(envio).toEqual({
      canalEnvio: "EMAIL",
      canalEtiqueta: "Email",
      enviadoEn: AHORA,
      enviadoEnIso: "2026-10-20T12:00:00.000Z",
      idioma: "es",
      idiomaEtiqueta: "Español",
      enviado: true,
    })
  })

  it("mapea WhatsApp/copia y conserva canales desconocidos", () => {
    expect(mapearEnvioPago({ canalEnvio: "WHATSAPP", idioma: "en" })).toMatchObject({
      canalEtiqueta: "WhatsApp",
      idiomaEtiqueta: "Inglés",
      enviado: false,
    })
    expect(mapearEnvioPago({ canalEnvio: "COPIA" })).toMatchObject({
      canalEtiqueta: "Copia",
    })
    expect(mapearEnvioPago({ canalEnvio: "sms", idioma: "pt" })).toMatchObject({
      canalEnvio: "SMS",
      canalEtiqueta: "SMS",
      idioma: "pt",
      idiomaEtiqueta: "pt",
    })
  })

  it("tolera enlaces nulos, fechas invalidas y campos vacios", () => {
    expect(mapearEnvioPago(null)).toEqual({
      canalEnvio: null,
      canalEtiqueta: null,
      enviadoEn: null,
      enviadoEnIso: null,
      idioma: null,
      idiomaEtiqueta: null,
      enviado: false,
    })
    expect(
      mapearEnvioPago({
        canalEnvio: "   ",
        enviadoEn: new Date(Number.NaN),
        idioma: " ",
      }).enviado
    ).toBe(false)
  })

  it("prioriza quien genero el link y cae a quien registro el pago", () => {
    expect(
      mapearAutorPago({
        registradoPor: "Registro Admin",
        enlacePago: { generadoPorNombre: "Ana Admin" },
      })
    ).toEqual({
      generadoPorNombre: "Ana Admin",
      registradoPor: "Registro Admin",
      nombre: "Ana Admin",
      fuente: "ENLACE",
    })

    expect(
      mapearAutorPago({ registradoPor: "Registro Admin", enlacePago: null })
    ).toEqual({
      generadoPorNombre: null,
      registradoPor: "Registro Admin",
      nombre: "Registro Admin",
      fuente: "REGISTRO",
    })

    expect(mapearAutorPago({})).toEqual({
      generadoPorNombre: null,
      registradoPor: null,
      nombre: null,
      fuente: null,
    })
  })
})

describe("estado visible (AC-11, AC-27)", () => {
  it("muestra Pagado, Fallido, Reembolsado, Pendiente y Contracargo", () => {
    expect(mapearEstadoPagoVisible("SUCCEEDED")).toMatchObject({
      etiqueta: "Pagado",
      tono: "mint",
      clave: "SUCCEEDED",
      requiereAccion: false,
    })
    expect(mapearEstadoPagoVisible("FAILED")).toMatchObject({
      etiqueta: "Fallido",
      tono: "red",
    })
    expect(mapearEstadoPagoVisible("REFUNDED")).toMatchObject({
      etiqueta: "Reembolsado",
      tono: "gray",
    })
    expect(mapearEstadoPagoVisible("PENDING")).toMatchObject({
      etiqueta: "Pendiente",
      tono: "yellow",
    })
    expect(mapearEstadoPagoVisible("CONTRACARGO")).toMatchObject({
      etiqueta: "Contracargo",
      tono: "red",
    })
  })

  it("distingue la revision pendiente, aceptada y rechazada", () => {
    expect(mapearEstadoPagoVisible("REVISION", "PENDIENTE")).toMatchObject({
      etiqueta: "En revisión",
      tono: "yellow",
      clave: "REVISION:PENDIENTE",
      requiereAccion: true,
    })
    expect(mapearEstadoPagoVisible("REVISION", "ACEPTADO")).toMatchObject({
      etiqueta: "Revisión aceptada",
      tono: "mint",
      clave: "REVISION:ACEPTADO",
      requiereAccion: false,
    })
    expect(mapearEstadoPagoVisible("REVISION", "RECHAZADO")).toMatchObject({
      etiqueta: "Revisión rechazada",
      tono: "red",
      clave: "REVISION:RECHAZADO",
      requiereAccion: false,
    })
  })

  it("trata una revision sin estado como pendiente de accion", () => {
    expect(mapearEstadoPagoVisible("revision", null)).toMatchObject({
      estadoPago: "REVISION",
      revisionEstado: null,
      etiqueta: "En revisión",
      clave: "REVISION:SIN_ESTADO",
      requiereAccion: true,
    })
  })

  it("tolera estados desconocidos o nulos", () => {
    expect(mapearEstadoPagoVisible(null, null)).toEqual({
      estadoPago: null,
      revisionEstado: null,
      etiqueta: "Desconocido",
      tono: "gray",
      clave: "DESCONOCIDO",
      requiereAccion: false,
    })
    expect(mapearEstadoPagoVisible("OTRO")).toMatchObject({
      estadoPago: null,
      etiqueta: "Desconocido",
    })
  })
})

describe("elegibilidad del recibo (AC-10, AC-11, AC-12)", () => {
  it("habilita el recibo de un pago PayPal con recibo y capture id", () => {
    const recibo = evaluarElegibilidadRecibo({
      id: "pago_1",
      pasarela: "PAYPAL",
      reciboId: RECIBO,
      reciboEmitidoEn: AHORA,
      externalId: "CAPTURE-1",
      paypalOrderId: "ORDER-1",
    })

    expect(recibo).toEqual({
      disponible: true,
      motivo: "DISPONIBLE",
      reciboId: RECIBO,
      referencia: "CAPTURE-1",
      emitidoEn: AHORA,
      emitidoEnIso: "2026-10-20T12:00:00.000Z",
      href: "/admin/pagos/pago_1/recibo",
    })
  })

  it("acepta el order id del pago y no usa el externalId del enlace", () => {
    expect(
      evaluarElegibilidadRecibo({
        id: "pago_2",
        pasarela: "PAYPAL",
        reciboId: RECIBO,
        externalId: null,
        paypalOrderId: "ORDER-1",
      })
    ).toMatchObject({
      disponible: true,
      referencia: "ORDER-1",
      href: "/admin/pagos/pago_2/recibo",
    })

    // La pagina del recibo exige una referencia guardada en `Pago`; el link
    // por si solo no habilita un recibo que la pagina no podria abrir.
    expect(
      evaluarElegibilidadRecibo({
        id: "pago_3",
        pasarela: "PAYPAL",
        reciboId: RECIBO,
        enlacePago: { externalId: "ORDER-ENLACE" },
      })
    ).toMatchObject({
      disponible: false,
      motivo: "SIN_REFERENCIA",
      referencia: null,
      href: null,
    })
  })

  it("nunca habilita el recibo de Mercado Pago o manual", () => {
    for (const pasarela of ["MERCADOPAGO", "MANUAL", null, undefined]) {
      const recibo = evaluarElegibilidadRecibo({
        id: "pago_mp",
        pasarela,
        reciboId: RECIBO,
        externalId: "REF-1",
      })
      expect(recibo).toMatchObject({
        disponible: false,
        motivo: "NO_PAYPAL",
        href: null,
      })
    }
  })

  it("distingue falta de recibo y falta de referencia", () => {
    expect(
      evaluarElegibilidadRecibo({
        id: "pago_4",
        pasarela: "PAYPAL",
        reciboId: null,
        externalId: "CAPTURE-1",
      })
    ).toMatchObject({
      disponible: false,
      motivo: "SIN_RECIBO",
      reciboId: null,
      referencia: "CAPTURE-1",
      href: null,
    })

    expect(
      evaluarElegibilidadRecibo({
        id: "pago_5",
        pasarela: "PAYPAL",
        reciboId: "   ",
        externalId: "   ",
        paypalOrderId: "",
        enlacePago: { externalId: "  " },
      })
    ).toMatchObject({
      disponible: false,
      motivo: "SIN_RECIBO",
      reciboId: null,
      referencia: null,
    })

    expect(
      evaluarElegibilidadRecibo({
        id: "pago_6",
        pasarela: "PAYPAL",
        reciboId: RECIBO,
      })
    ).toMatchObject({
      disponible: false,
      motivo: "SIN_REFERENCIA",
      reciboId: RECIBO,
      referencia: null,
      href: null,
    })
  })

  it("tolera una fecha de emision invalida", () => {
    expect(
      evaluarElegibilidadRecibo({
        id: "pago_7",
        pasarela: "PAYPAL",
        reciboId: RECIBO,
        externalId: "CAPTURE-1",
        reciboEmitidoEn: new Date(Number.NaN),
      })
    ).toMatchObject({
      emitidoEn: null,
      emitidoEnIso: null,
      disponible: true,
    })
  })
})

describe("fila compuesta del historial (AC-11, AC-12, AC-19)", () => {
  it("compone concepto, referencias, desglose, envio, autor, estado y recibo", () => {
    const fila = mapearPagoHistorial(pagoBase())

    expect(fila).toMatchObject({
      id: "pago_1",
      creadoEn: AHORA,
      creadoEnIso: "2026-10-20T12:00:00.000Z",
      pasarela: "PAYPAL",
      pasarelaEtiqueta: "PayPal",
      origen: "AUTOMATICO",
      origenEtiqueta: "Automático",
    })
    expect(fila.concepto.titulo).toBe("Sitio ACME — Anticipo")
    expect(fila.referencias.principal?.etiqueta).toBe("Capture CAPTURE-1")
    expect(fila.desglose.formateado.monto).toBe("US$106,56")
    expect(fila.desglose.formateado.diferencia).toBe("US$0,00")
    expect(fila.envio).toMatchObject({
      canalEtiqueta: "Email",
      idiomaEtiqueta: "Español",
      enviado: true,
    })
    expect(fila.autor.nombre).toBe("Ana Admin")
    expect(fila.estado.etiqueta).toBe("Pagado")
    expect(fila.recibo.disponible).toBe(true)
    expect(fila.recibo.href).toBe("/admin/pagos/pago_1/recibo")
  })

  it("usa MANUAL y datos vacios cuando la fila historica esta incompleta", () => {
    const fila = mapearPagoHistorial({
      id: "pago_legacy",
      estadoPago: "SUCCEEDED",
      monto: 2500,
      moneda: "ars",
      enlacePago: null,
      hito: null,
      suscripcion: null,
    })

    expect(fila).toMatchObject({
      pasarela: "MANUAL",
      pasarelaEtiqueta: "Manual",
      origen: null,
      origenEtiqueta: null,
      creadoEn: null,
      creadoEnIso: null,
    })
    expect(fila.concepto.tipo).toBe("SIN_CONCEPTO")
    expect(fila.referencias.principal).toBeNull()
    expect(fila.desglose.formateado.monto).toBe("$25 ARS")
    expect(fila.desglose.montoAcordado).toBeNull()
    expect(fila.desglose.montoEsperado).toBeNull()
    expect(fila.envio.enviado).toBe(false)
    expect(fila.autor.nombre).toBeNull()
    expect(fila.recibo.disponible).toBe(false)
    expect(fila.recibo.motivo).toBe("NO_PAYPAL")
  })

  it("no filtra PII del cliente ni del pagador aunque el caller la pase", () => {
    const conPii = {
      ...pagoBase(),
      cliente: {
        nombre: "Cliente Secreto",
        email: "cliente.secreto@example.com",
      },
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador Secreto",
      payer: {
        email_address: "payer@example.com",
        name: { given_name: "Payer", surname: "Secreto" },
      },
      email: "otro@example.com",
    } as unknown as PagoHistorialInput

    const fila = mapearPagoHistorial(conPii)
    const serializado = JSON.stringify(fila)

    for (const valor of [
      "Cliente Secreto",
      "cliente.secreto@example.com",
      "pagador@example.com",
      "Pagador Secreto",
      "payer@example.com",
      "Payer",
      "otro@example.com",
    ]) {
      expect(serializado).not.toContain(valor)
    }

    expect(Object.keys(fila)).not.toContain("cliente")
    expect(Object.keys(fila)).not.toContain("pagador")
    expect(Object.keys(fila)).not.toContain("email")
    expect(Object.keys(fila.concepto)).not.toContain("cliente")
  })
})
