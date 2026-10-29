import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  RECIBO_MP_CONCEPTO_MAX,
  RECIBO_MP_REFERENCIA_MAX,
  ReciboMpValidationError,
} from "@/lib/mp-utils"
import {
  RECIBO_MP_CONCEPTO_DEFAULT,
  RECIBO_MP_HASH_HEX,
  RECIBO_MP_ID_MAX,
  RECIBO_MP_PREFIJO,
  construirReciboMercadoPago,
  evaluarDatosReciboMercadoPago,
  generarReciboIdMp,
  type DatosReciboMercadoPagoInput,
  type EvaluacionDatosReciboMpInput,
} from "@/lib/mp-recibo"

/**
 * T-01 (AC-6, AC-7, AC-9, AC-10, AC-11, AC-12, AC-25): dominio del recibo
 * interno de Mercado Pago.
 *
 * El identificador se deriva de la referencia externa y de la fecha del recibo
 * (D-1a): estable, unico, sin PII y sin prefijo `PAY-`. La construccion y la
 * evaluacion no tocan red, base de datos ni emails.
 */

const AHORA = new Date("2026-10-29T12:00:00.000Z")

function capturarErrorReciboMp(fn: () => unknown): ReciboMpValidationError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ReciboMpValidationError)
    return error as ReciboMpValidationError
  }
  throw new Error("Se esperaba un ReciboMpValidationError")
}

function datosRecibo(
  overrides: Partial<DatosReciboMercadoPagoInput> = {}
): DatosReciboMercadoPagoInput {
  return {
    referenciaExterna: "1234567890",
    concepto: "Sitio ACME — Anticipo",
    monto: 100000,
    montoAcordado: 100000,
    comision: 0,
    moneda: "ars",
    fecha: AHORA,
    ...overrides,
  }
}

function datosEvaluacion(
  overrides: Partial<EvaluacionDatosReciboMpInput> = {}
): EvaluacionDatosReciboMpInput {
  return {
    estadoPago: "SUCCEEDED",
    referenciaExterna: "1234567890",
    monto: 100000,
    montoAcordado: 100000,
    comision: 0,
    moneda: "ars",
    concepto: "Sitio ACME — Anticipo",
    fechaEmision: null,
    fechaPago: AHORA,
    ...overrides,
  }
}

describe("generarReciboIdMp (AC-11, AC-19)", () => {
  it("genera MP-AAAAMMDD-<32 hex> con la fecha en UTC", () => {
    const id = generarReciboIdMp("1234567890", AHORA)

    expect(id).toMatch(
      new RegExp(`^MP-20261029-[0-9A-F]{${RECIBO_MP_HASH_HEX}}$`)
    )
    expect(id.startsWith(`${RECIBO_MP_PREFIJO}-`)).toBe(true)
    expect(id.length).toBeLessThanOrEqual(RECIBO_MP_ID_MAX)
  })

  it("usa la fecha UTC aunque el instante caiga en otro dia local", () => {
    // 2026-12-31T23:30Z es 2027-01-01 en UTC+... solo al este; el limite real
    // es que el prefijo nunca dependa de la zona horaria del servidor.
    expect(generarReciboIdMp("pago-1", new Date("2026-12-31T23:30:00.000Z"))).toMatch(
      /^MP-20261231-[0-9A-F]{32}$/
    )
    expect(generarReciboIdMp("pago-1", new Date("2027-01-01T00:30:00.000Z"))).toMatch(
      /^MP-20270101-[0-9A-F]{32}$/
    )
  })

  it("mantiene fijado el algoritmo del identificador (golden id)", () => {
    // Si este valor cambia, cambian los numeros de recibo de todos los pagos
    // historicos de Mercado Pago: el algoritmo solo debe cambiar con D-1a.
    expect(generarReciboIdMp("1234567890", AHORA)).toBe(
      "MP-20261029-C775E7B757EDE630CD0AA1113BD10266"
    )
  })

  it("es estable entre llamadas con la misma referencia y fecha", () => {
    const primero = generarReciboIdMp("1234567890", AHORA)
    const segundo = generarReciboIdMp("1234567890", new Date(AHORA.getTime()))

    expect(segundo).toBe(primero)
  })

  it("ignora espacios alrededor de la referencia", () => {
    expect(generarReciboIdMp("  1234567890  ", AHORA)).toBe(
      generarReciboIdMp("1234567890", AHORA)
    )
  })

  it("es distinto para pagos distintos (AC-11)", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      ids.add(generarReciboIdMp(`payment-${i}`, AHORA))
    }
    expect(ids.size).toBe(500)
    expect(generarReciboIdMp("1234567890", AHORA)).not.toBe(
      generarReciboIdMp("1234567891", AHORA)
    )
  })

  it("es distinto si cambia la fecha del recibo", () => {
    expect(generarReciboIdMp("1234567890", AHORA)).not.toBe(
      generarReciboIdMp("1234567890", new Date("2026-10-30T12:00:00.000Z"))
    )
  })

  it("no expone PII ni ids internos y no usa el prefijo PAY-", () => {
    const id = generarReciboIdMp("cliente@example.com", AHORA)
    const serializado = id.toLowerCase()

    expect(id).toMatch(/^MP-[0-9]{8}-[0-9A-F]{32}$/)
    expect(id.startsWith("PAY-")).toBe(false)
    expect(serializado).not.toContain("cliente")
    expect(serializado).not.toContain("example")
    expect(id).not.toContain("@")
    expect(id).not.toContain("hito")
    expect(id).not.toContain("suscripcion")
  })

  it("rechaza una referencia vacia o demasiado larga", () => {
    expect(capturarErrorReciboMp(() => generarReciboIdMp("", AHORA)).campo).toBe(
      "referenciaExterna"
    )
    expect(
      capturarErrorReciboMp(() => generarReciboIdMp("   ", AHORA)).campo
    ).toBe("referenciaExterna")
    expect(
      capturarErrorReciboMp(() =>
        generarReciboIdMp("X".repeat(RECIBO_MP_REFERENCIA_MAX + 1), AHORA)
      ).campo
    ).toBe("referenciaExterna")
  })

  it("rechaza una fecha invalida", () => {
    expect(
      capturarErrorReciboMp(() =>
        generarReciboIdMp("1234567890", new Date(Number.NaN))
      ).campo
    ).toBe("fecha")
  })
})

describe("construirReciboMercadoPago (AC-6, AC-7, AC-12)", () => {
  it("arma el snapshot ARS con claves exactas y sin datos extra", () => {
    // El caller puede mandar campos extra: el recibo solo conserva los suyos.
    const entrada = {
      ...datosRecibo(),
      clienteId: "cli_123",
      hitoId: "hito_123",
      pagadorEmail: "pagador@example.com",
      tarjeta: "4111111111111111",
    } as DatosReciboMercadoPagoInput

    const recibo = construirReciboMercadoPago(entrada)

    expect(recibo).toEqual({
      reciboId: generarReciboIdMp("1234567890", AHORA),
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 100000,
      comision: 0,
      total: 100000,
      moneda: "ars",
      fecha: AHORA,
      pasarela: "MERCADOPAGO",
      referenciaExterna: "1234567890",
    })
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

    const serializado = JSON.stringify(recibo)
    expect(serializado).not.toContain("cli_123")
    expect(serializado).not.toContain("hito_123")
    expect(serializado).not.toContain("pagador")
    expect(serializado).not.toContain("4111111111111111")
  })

  it("acepta USD y lo normaliza a minusculas", () => {
    const recibo = construirReciboMercadoPago(
      datosRecibo({ moneda: "USD", monto: 10050, montoAcordado: 10050 })
    )
    expect(recibo.moneda).toBe("usd")
  })

  it("usa el monto cobrado como acordado si falta montoAcordado", () => {
    const recibo = construirReciboMercadoPago(
      datosRecibo({ montoAcordado: null, comision: null })
    )
    expect(recibo.montoAcordado).toBe(100000)
    expect(recibo.comision).toBe(0)
    expect(recibo.total).toBe(100000)
  })

  it("conserva el desglose con comision mayor que 0", () => {
    const recibo = construirReciboMercadoPago(
      datosRecibo({ monto: 10606, montoAcordado: 10000, comision: 606 })
    )
    expect(recibo.montoAcordado + recibo.comision).toBe(recibo.total)
    expect(recibo.comision).toBe(606)
  })

  it("no muta la fecha original", () => {
    const fecha = new Date(AHORA.getTime())
    const recibo = construirReciboMercadoPago(datosRecibo({ fecha }))

    recibo.fecha.setUTCFullYear(2030)
    expect(fecha.toISOString()).toBe(AHORA.toISOString())
  })

  it("acepta exactamente las longitudes maximas de referencia y concepto", () => {
    const recibo = construirReciboMercadoPago(
      datosRecibo({
        referenciaExterna: "X".repeat(RECIBO_MP_REFERENCIA_MAX),
        concepto: "C".repeat(RECIBO_MP_CONCEPTO_MAX),
      })
    )
    expect(recibo.referenciaExterna).toHaveLength(RECIBO_MP_REFERENCIA_MAX)
    expect(recibo.concepto).toHaveLength(RECIBO_MP_CONCEPTO_MAX)
  })

  it("muestra la referencia completa, sin truncar (AC-12)", () => {
    const referencia = "1234567890-abcdefghijklmnopqrstuvwxyz"
    expect(
      construirReciboMercadoPago(datosRecibo({ referenciaExterna: referencia }))
        .referenciaExterna
    ).toBe(referencia)
  })

  it("rechaza una moneda no soportada", () => {
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(datosRecibo({ moneda: "eur" }))
      ).campo
    ).toBe("moneda")
  })

  it("rechaza una fecha invalida", () => {
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(datosRecibo({ fecha: new Date(Number.NaN) }))
      ).campo
    ).toBe("fecha")
  })

  it("rechaza conceptos y referencias vacios o demasiado largos", () => {
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(datosRecibo({ concepto: "  " }))
      ).campo
    ).toBe("concepto")
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(
          datosRecibo({ concepto: "C".repeat(RECIBO_MP_CONCEPTO_MAX + 1) })
        )
      ).campo
    ).toBe("concepto")
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(datosRecibo({ referenciaExterna: "" }))
      ).campo
    ).toBe("referenciaExterna")
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(
          datosRecibo({
            referenciaExterna: "X".repeat(RECIBO_MP_REFERENCIA_MAX + 1),
          })
        )
      ).campo
    ).toBe("referenciaExterna")
  })

  it("rechaza totales que no reconcilian (AC-25)", () => {
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(
          datosRecibo({ monto: 10605, montoAcordado: 10000, comision: 606 })
        )
      ).campo
    ).toBe("total")
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(
          datosRecibo({ monto: 10605, montoAcordado: 10000, comision: 606 })
        )
      ).campo
    ).toBe("total")
    expect(
      capturarErrorReciboMp(() =>
        construirReciboMercadoPago(
          datosRecibo({ monto: 10606, montoAcordado: null, comision: 606 })
        )
      ).campo
    ).toBe("total")
  })
})

describe("evaluarDatosReciboMercadoPago (AC-9, AC-10, AC-25)", () => {
  it("emite recibo ARS para un pago confirmado", () => {
    const resultado = evaluarDatosReciboMercadoPago(datosEvaluacion())
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")

    expect(resultado.recibo).toEqual({
      reciboId: generarReciboIdMp("1234567890", AHORA),
      concepto: "Sitio ACME — Anticipo",
      montoAcordado: 100000,
      comision: 0,
      total: 100000,
      moneda: "ars",
      fecha: AHORA,
      pasarela: "MERCADOPAGO",
      referenciaExterna: "1234567890",
    })
  })

  it("emite recibo USD con referencia externa historica o futura (AC-7)", () => {
    const resultado = evaluarDatosReciboMercadoPago(
      datosEvaluacion({
        monto: 10606,
        montoAcordado: 10000,
        comision: 606,
        moneda: "USD",
      })
    )
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")
    expect(resultado.recibo.moneda).toBe("usd")
    expect(resultado.recibo.montoAcordado + resultado.recibo.comision).toBe(
      resultado.recibo.total
    )
  })

  it("usa el monto cobrado si no hay montoAcordado", () => {
    const resultado = evaluarDatosReciboMercadoPago(
      datosEvaluacion({ montoAcordado: null, comision: null })
    )
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")
    expect(resultado.recibo.montoAcordado).toBe(100000)
    expect(resultado.recibo.comision).toBe(0)
  })

  it.each(["REVISION", "REFUNDED", "CONTRACARGO"] as const)(
    "emite recibo para el estado %s y nunca lo altera",
    (estado) => {
      const resultado = evaluarDatosReciboMercadoPago(
        datosEvaluacion({ estadoPago: estado })
      )
      expect(resultado.ok).toBe(true)
      if (!resultado.ok) throw new Error("se esperaba un recibo")
      expect(resultado.recibo.total).toBe(100000)
      expect(resultado.recibo.pasarela).toBe("MERCADOPAGO")
    }
  )

  it("usa el concepto por defecto si no se informa (RF-9)", () => {
    for (const concepto of [null, undefined, "", "   "]) {
      const resultado = evaluarDatosReciboMercadoPago(
        datosEvaluacion({ concepto })
      )
      expect(resultado.ok).toBe(true)
      if (!resultado.ok) throw new Error("se esperaba un recibo")
      expect(resultado.recibo.concepto).toBe(RECIBO_MP_CONCEPTO_DEFAULT)
    }
  })

  it("prioriza la fecha de emision y la usa tambien en el id (RF-19)", () => {
    const emision = new Date("2026-11-05T08:00:00.000Z")
    const resultado = evaluarDatosReciboMercadoPago(
      datosEvaluacion({ fechaEmision: emision })
    )
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")
    expect(resultado.recibo.fecha.toISOString()).toBe(emision.toISOString())
    expect(resultado.recibo.reciboId).toBe(
      generarReciboIdMp("1234567890", emision)
    )
    expect(resultado.recibo.reciboId).toMatch(/^MP-20261105-/)
  })

  it("es estable entre dos aperturas del mismo pago (AC-11)", () => {
    const primera = evaluarDatosReciboMercadoPago(datosEvaluacion())
    const segunda = evaluarDatosReciboMercadoPago(datosEvaluacion())
    expect(primera.ok && segunda.ok).toBe(true)
    if (!primera.ok || !segunda.ok) throw new Error("se esperaba un recibo")
    expect(segunda.recibo.reciboId).toBe(primera.recibo.reciboId)
  })

  it("conserva la referencia externa exacta y completa hasta el maximo (AC-12)", () => {
    const referencia = "1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdef"
    const resultado = evaluarDatosReciboMercadoPago(
      datosEvaluacion({ referenciaExterna: referencia })
    )
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")
    expect(resultado.recibo.referenciaExterna).toBe(referencia)

    const alMaximo = "9".repeat(RECIBO_MP_REFERENCIA_MAX)
    const limite = evaluarDatosReciboMercadoPago(
      datosEvaluacion({ referenciaExterna: alMaximo })
    )
    expect(limite.ok).toBe(true)
    if (!limite.ok) throw new Error("se esperaba un recibo")
    expect(limite.recibo.referenciaExterna).toBe(alMaximo)
    expect(limite.recibo.referenciaExterna).toHaveLength(
      RECIBO_MP_REFERENCIA_MAX
    )
  })

  it.each([
    ["FAILED", "ESTADO"],
    ["PENDING", "ESTADO"],
    [null, "ESTADO"],
    [undefined, "ESTADO"],
    ["OTRO", "ESTADO"],
  ] as const)("no emite recibo con estado %s", (estadoPago, motivo) => {
    expect(
      evaluarDatosReciboMercadoPago(datosEvaluacion({ estadoPago }))
    ).toEqual({ ok: false, motivo })
  })

  it.each([
    ["sin referencia", null],
    ["referencia vacia", ""],
    ["referencia en blanco", "   "],
  ] as const)("no emite recibo %s (AC-20)", (_caso, referenciaExterna) => {
    expect(
      evaluarDatosReciboMercadoPago(datosEvaluacion({ referenciaExterna }))
    ).toEqual({ ok: false, motivo: "SIN_REFERENCIA" })
  })

  it.each([
    ["referencia demasiado larga", { referenciaExterna: "X".repeat(RECIBO_MP_REFERENCIA_MAX + 1) }],
    ["concepto demasiado largo", { concepto: "C".repeat(RECIBO_MP_CONCEPTO_MAX + 1) }],
    ["monto ausente", { monto: null }],
    ["monto no informado", { monto: undefined }],
    ["monto decimal", { monto: 100.5 }],
    ["fecha de pago invalida", { fechaPago: "no-es-fecha" }],
    ["sin fecha de emision ni de pago", { fechaEmision: null, fechaPago: null }],
    ["moneda no soportada", { moneda: "eur" }],
    ["total que no reconcilia", { monto: 10605 }],
    ["comision sin monto acordado", { monto: 10606, montoAcordado: null, comision: 606 }],
    ["monto acordado negativo", { monto: 100000, montoAcordado: -1 }],
    ["comision negativa", { monto: 100000, montoAcordado: 100000, comision: -1 }],
    ["comision decimal", { monto: 100000, montoAcordado: 100000, comision: 0.5 }],
  ] as const)(
    "no emite recibo con %s (AC-25)",
    (_caso, overrides) => {
      expect(
        evaluarDatosReciboMercadoPago(
          datosEvaluacion(overrides as Partial<EvaluacionDatosReciboMpInput>)
        )
      ).toEqual({ ok: false, motivo: "DATOS_INCONSISTENTES" })
    }
  )

  it("no cae a la fecha del pago si la emision existe pero es invalida", () => {
    expect(
      evaluarDatosReciboMercadoPago(
        datosEvaluacion({ fechaEmision: new Date(Number.NaN) })
      )
    ).toEqual({ ok: false, motivo: "DATOS_INCONSISTENTES" })
  })

  it("no filtra PII ni ids internos aunque el caller los pase", () => {
    const resultado = evaluarDatosReciboMercadoPago({
      ...datosEvaluacion(),
      clienteId: "cli_123",
      hitoId: "hito_123",
      enlacePagoId: "enlace_123",
      pagadorEmail: "pagador@example.com",
      tarjeta: "4111111111111111",
    } as EvaluacionDatosReciboMpInput)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error("se esperaba un recibo")

    const serializado = JSON.stringify(resultado.recibo)
    expect(serializado).not.toContain("cli_123")
    expect(serializado).not.toContain("hito_123")
    expect(serializado).not.toContain("enlace_123")
    expect(serializado).not.toContain("pagador")
    expect(serializado).not.toContain("4111111111111111")
    expect(serializado).not.toContain("PAY-")
  })
})

/**
 * T-01 exige un split explicito: `mp-utils.ts` es browser-safe (lo importa la
 * elegibilidad del historial, que llega a un componente cliente) y
 * `mp-recibo.ts` es server-only (usa `node:crypto`). El plan R-8 advierte que
 * un import de servidor en el modulo browser-safe rompe el bundle cliente.
 */
describe("limite server/client del dominio MP (T-01, R-8)", () => {
  function leerFuente(ruta: string): string {
    return readFileSync(join(process.cwd(), ruta), "utf8")
  }

  /** Imports que no pueden aparecer en un modulo browser-safe. */
  const IMPORT_SOLO_SERVIDOR =
    /(?:from\s+|require\s*\(\s*)["'](?:node:[^"']+|crypto|@prisma\/client|@\/lib\/prisma|@\/lib\/resend|@\/lib\/mercadopago|react|react-dom|next(?:\/[^"']*)?|resend|mercadopago)["']/

  it("mp-utils y pagos son browser-safe: sin node:crypto, Prisma, React ni red", () => {
    for (const ruta of ["src/lib/mp-utils.ts", "src/lib/pagos.ts"]) {
      const fuente = leerFuente(ruta)
      expect(fuente, ruta).not.toMatch(IMPORT_SOLO_SERVIDOR)
      expect(fuente, ruta).not.toMatch(/\bfetch\s*\(/)
    }

    const mpUtils = leerFuente("src/lib/mp-utils.ts")
    // La unica dependencia de mp-utils es el modulo puro de fechas/montos.
    expect(mpUtils).toMatch(/from\s+["']@\/lib\/pagos["']/)
    // Y nunca el modulo server-only: arrastraria `node:crypto` al cliente.
    expect(mpUtils).not.toMatch(/@\/lib\/mp-recibo/)
  })

  it("mp-recibo solo importa node:crypto y mp-utils: sin Prisma, React ni red", () => {
    const fuente = leerFuente("src/lib/mp-recibo.ts")

    expect(fuente).toMatch(/from\s+["']node:crypto["']/)
    expect(fuente).toMatch(/from\s+["']@\/lib\/mp-utils["']/)
    // `node:crypto` es el unico built-in permitido; nada de Prisma/React/red.
    expect(fuente).not.toMatch(
      /(?:from\s+|require\s*\(\s*)["'](?:@prisma\/client|@\/lib\/prisma|@\/lib\/resend|@\/lib\/mercadopago|react|react-dom|next(?:\/[^"']*)?|resend|mercadopago)["']/
    )
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
  })
})
