import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  SCORE_VERSION,
  calcularScore,
  type EntradaScore,
  type ScoreComponente,
  type ScoreResultado,
} from "@/lib/propuestas/score"

/**
 * T-07 (AC-21; RF-33): score v1 determinista, en rango 0-100, con desglose y
 * motivos. Los datos faltantes no se inventan: cada ausencia resta y explica.
 *
 * Modulo puro: no hay red, Prisma, emails, fechas ni azar. Los datos son
 * ficticios.
 */

const EMAIL = "info@consultora-ejemplo.com"

const BASE: EntradaScore = {
  email: EMAIL,
  emailFuenteUrl: "https://consultora-ejemplo.com/contacto",
  sitioWeb: "https://consultora-ejemplo.com",
  telefono: "+54 11 5555-5555",
  ciudad: "CABA",
  rubro: "Marketing digital",
  campana: {
    rubro: "marketing digital",
    zona: "Caba",
  },
  auditoria: {
    estado: "OK",
    scores: {
      velocidad: 0,
      ssl: 0,
      seo: 0,
      seguridad: 0,
    },
  },
}

function componente(
  resultado: ScoreResultado,
  clave: ScoreComponente["clave"],
): ScoreComponente {
  const encontrado = resultado.componentes.find((item) => item.clave === clave)
  if (!encontrado) throw new Error(`Falta el componente ${clave}`)
  return encontrado
}

function motivos(resultado: ScoreResultado, clave: ScoreComponente["clave"]): string {
  return componente(resultado, clave).motivos.join(" ").toLowerCase()
}

describe("T-07: calcularScore determinista y en rango (AC-21)", () => {
  it("devuelve el mismo resultado para los mismos datos", () => {
    const primero = calcularScore(BASE)
    const segundo = calcularScore({ ...BASE })

    expect(segundo).toEqual(primero)
    expect(JSON.stringify(segundo)).toBe(JSON.stringify(primero))
    expect(primero.version).toBe(SCORE_VERSION)
    expect(primero.version).toBe("v1")
  })

  it("suma 100 con datos completos y desglose 30/20/20/15/15", () => {
    const resultado = calcularScore(BASE)

    expect(resultado.total).toBe(100)
    expect(resultado.componentes.map((item) => item.maximo)).toEqual([
      30, 20, 20, 15, 15,
    ])
    expect(resultado.componentes.map((item) => item.puntos)).toEqual([
      30, 20, 20, 15, 15,
    ])
    expect(resultado.componentes.map((item) => item.clave)).toEqual([
      "CONTACTO_PROFESIONAL",
      "SITIO_PROPIO",
      "OPORTUNIDAD_TECNICA",
      "ENCAJE_CAMPANA",
      "COMPLETITUD",
    ])
  })

  it("nunca sale de 0-100 ni cada componente de su maximo", () => {
    const entradas: EntradaScore[] = [
      {},
      BASE,
      { ...BASE, auditoria: null },
      { ...BASE, auditoria: { estado: "OK", scores: { velocidad: 999 } } },
      {
        ...BASE,
        auditoria: {
          estado: "OK",
          scores: { velocidad: -50, ssl: 500, seo: 120, seguridad: -1 },
        },
      },
      {
        ...BASE,
        campana: null,
        email: null,
        sitioWeb: null,
        telefono: null,
        ciudad: null,
        rubro: null,
      },
    ]

    for (const entrada of entradas) {
      const resultado = calcularScore(entrada)

      expect(resultado.total).toBeGreaterThanOrEqual(0)
      expect(resultado.total).toBeLessThanOrEqual(100)

      for (const item of resultado.componentes) {
        expect(item.puntos).toBeGreaterThanOrEqual(0)
        expect(item.puntos).toBeLessThanOrEqual(item.maximo)
      }

      const sumaMaximos = resultado.componentes.reduce(
        (suma, item) => suma + item.maximo,
        0,
      )
      expect(sumaMaximos).toBe(100)
    }
  })
})

describe("T-07: contacto profesional (AC-21)", () => {
  it("sin email suma 0 y lo explica", () => {
    const resultado = calcularScore({ ...BASE, email: null })
    const contacto = componente(resultado, "CONTACTO_PROFESIONAL")

    expect(contacto.puntos).toBe(0)
    expect(motivos(resultado, "CONTACTO_PROFESIONAL")).toContain("email")
  })

  it("un email sin fuente no suma ni se asume publicado", () => {
    const resultado = calcularScore({
      ...BASE,
      emailFuenteUrl: null,
      fuenteUrl: null,
    })

    expect(componente(resultado, "CONTACTO_PROFESIONAL").puntos).toBe(0)
    expect(motivos(resultado, "CONTACTO_PROFESIONAL")).toContain("fuente")
  })

  it("una fuente invalida no cuenta como fuente", () => {
    const invalidas = [
      "javascript:alert(1)",
      "consultora-ejemplo.com/contacto",
      "mailto:info@consultora-ejemplo.com",
      "",
    ]

    for (const fuente of invalidas) {
      const resultado = calcularScore({
        ...BASE,
        emailFuenteUrl: fuente,
        fuenteUrl: null,
      })

      expect(
        componente(resultado, "CONTACTO_PROFESIONAL").puntos,
        fuente,
      ).toBe(0)
    }
  })

  it("acepta la fuente general del prospecto para una carga manual", () => {
    const resultado = calcularScore({
      ...BASE,
      emailFuenteUrl: null,
      fuenteUrl: "https://consultora-ejemplo.com/nosotros",
    })

    expect(componente(resultado, "CONTACTO_PROFESIONAL").puntos).toBe(30)
  })

  it("un email malformado no suma aunque declare una fuente valida (AC-21)", () => {
    const invalidos = [
      "no-es-email",
      "info@",
      "@consultora-ejemplo.com",
      "info @consultora-ejemplo.com",
      "info@@consultora-ejemplo.com",
    ]

    for (const email of invalidos) {
      const resultado = calcularScore({ ...BASE, email })

      expect(
        componente(resultado, "CONTACTO_PROFESIONAL").puntos,
        email,
      ).toBe(0)
      expect(motivos(resultado, "CONTACTO_PROFESIONAL")).toContain("email")
    }
  })
})

describe("T-07: sitio propio (AC-21)", () => {
  it("sin sitio suma 0 y lo explica", () => {
    const resultado = calcularScore({ ...BASE, sitioWeb: null })

    expect(componente(resultado, "SITIO_PROPIO").puntos).toBe(0)
    expect(motivos(resultado, "SITIO_PROPIO")).toContain("sitio")
  })

  it("un sitio social o agregador no es sitio propio", () => {
    for (const sitio of [
      "https://facebook.com/consultora-ejemplo",
      "https://www.instagram.com/consultora-ejemplo",
      "https://linktr.ee/consultora-ejemplo",
      "https://mercadolibre.com.ar/consultora-ejemplo",
    ]) {
      const resultado = calcularScore({ ...BASE, sitioWeb: sitio })

      expect(
        componente(resultado, "SITIO_PROPIO").puntos,
        sitio,
      ).toBe(0)
      expect(motivos(resultado, "SITIO_PROPIO")).toContain("propio")
    }
  })

  it("suma 10 por sitio, 5 por HTTPS y 5 por auditoria OK", () => {
    const soloHttp = calcularScore({
      ...BASE,
      sitioWeb: "http://consultora-ejemplo.com",
      auditoria: null,
    })
    expect(componente(soloHttp, "SITIO_PROPIO").puntos).toBe(10)

    const conHttps = calcularScore({
      ...BASE,
      auditoria: null,
    })
    expect(componente(conHttps, "SITIO_PROPIO").puntos).toBe(15)

    const conAuditoria = calcularScore(BASE)
    expect(componente(conAuditoria, "SITIO_PROPIO").puntos).toBe(20)
  })

  it("no suma el bonus de auditoria si la auditoria no termino OK", () => {
    const resultado = calcularScore({
      ...BASE,
      auditoria: { estado: "FALLIDA" },
    })

    expect(componente(resultado, "SITIO_PROPIO").puntos).toBe(15)
  })
})

describe("T-07: oportunidad tecnica (AC-21)", () => {
  it("sin auditoria suma 0 con motivo", () => {
    for (const auditoria of [null, undefined]) {
      const resultado = calcularScore({ ...BASE, auditoria })

      expect(componente(resultado, "OPORTUNIDAD_TECNICA").puntos).toBe(0)
      expect(motivos(resultado, "OPORTUNIDAD_TECNICA")).toContain("auditoria")
    }
  })

  it("una auditoria fallida no inventa puntajes", () => {
    const resultado = calcularScore({
      ...BASE,
      auditoria: { estado: "FALLIDA" },
    })

    expect(componente(resultado, "OPORTUNIDAD_TECNICA").puntos).toBe(0)
    expect(motivos(resultado, "OPORTUNIDAD_TECNICA")).toContain(
      "no termino correctamente",
    )
  })

  it("exige los cuatro puntajes completos", () => {
    const resultado = calcularScore({
      ...BASE,
      auditoria: { estado: "OK", scores: { velocidad: 40 } },
    })

    expect(componente(resultado, "OPORTUNIDAD_TECNICA").puntos).toBe(0)
    expect(motivos(resultado, "OPORTUNIDAD_TECNICA")).toContain(
      "cuatro puntajes",
    )
  })

  it("calcula round(20 * (1 - promedio/100))", () => {
    const promedio = 40
    const resultado = calcularScore({
      ...BASE,
      auditoria: {
        estado: "OK",
        scores: {
          velocidad: promedio,
          ssl: promedio,
          seo: promedio,
          seguridad: promedio,
        },
      },
    })

    expect(componente(resultado, "OPORTUNIDAD_TECNICA").puntos).toBe(12)
  })

  it("acota los puntajes de auditoria a 0-100 en vez de desbordar", () => {
    const perfecta = calcularScore({
      ...BASE,
      auditoria: {
        estado: "OK",
        scores: { velocidad: 150, ssl: 150, seo: 150, seguridad: 150 },
      },
    })
    expect(componente(perfecta, "OPORTUNIDAD_TECNICA").puntos).toBe(0)

    const pesima = calcularScore({
      ...BASE,
      auditoria: {
        estado: "OK",
        scores: { velocidad: -20, ssl: -20, seo: -20, seguridad: -20 },
      },
    })
    expect(componente(pesima, "OPORTUNIDAD_TECNICA").puntos).toBe(20)
  })
})

describe("T-07: encaje de campana (AC-21)", () => {
  it("sin criterios de campana no suma ni resta y se informa", () => {
    const resultado = calcularScore({ ...BASE, campana: null })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(0)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("sin criterio")
    expect(resultado.total).toBe(85)
  })

  it("suma 8 por rubro y 7 por zona, normalizando mayusculas y acentos", () => {
    const resultado = calcularScore({
      ...BASE,
      rubro: "Consultoría",
      ciudad: "Buenos Aires",
      campana: { rubro: "consultoria", zona: "buenos aires" },
    })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(15)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("rubro coincide")
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("zona coincide")
  })

  it("no inventa una coincidencia si falta el dato del prospecto", () => {
    const resultado = calcularScore({
      ...BASE,
      rubro: null,
      ciudad: null,
      campana: { rubro: "marketing", zona: "caba" },
    })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(0)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("falta el rubro")
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("falta la ciudad")
  })

  it("un rubro o zona distintos no suman", () => {
    const resultado = calcularScore({
      ...BASE,
      rubro: "Contabilidad",
      ciudad: "Rosario",
      campana: { rubro: "marketing", zona: "caba" },
    })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(0)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("rubro no coincide")
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("zona no coincide")
  })

  it("si la campana no define un campo, ese campo no resta", () => {
    const resultado = calcularScore({
      ...BASE,
      campana: { rubro: "marketing digital" },
    })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(8)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("sin criterio")
  })

  it("acepta `ciudad` como alias de `zona` en la campana", () => {
    const resultado = calcularScore({
      ...BASE,
      ciudad: "CABA",
      campana: { rubro: "marketing digital", ciudad: "caba" },
    })

    expect(componente(resultado, "ENCAJE_CAMPANA").puntos).toBe(15)
    expect(motivos(resultado, "ENCAJE_CAMPANA")).toContain("zona coincide")
  })
})

describe("T-07: completitud (AC-21)", () => {
  it("suma 5 por sitio, ciudad y telefono", () => {
    const resultado = calcularScore(BASE)
    expect(componente(resultado, "COMPLETITUD").puntos).toBe(15)
  })

  it("cada faltante suma 0 con un motivo", () => {
    const sinTelefono = calcularScore({ ...BASE, telefono: null })
    expect(componente(sinTelefono, "COMPLETITUD").puntos).toBe(10)
    expect(motivos(sinTelefono, "COMPLETITUD")).toContain("telefono")

    const sinCiudad = calcularScore({ ...BASE, ciudad: null })
    expect(componente(sinCiudad, "COMPLETITUD").puntos).toBe(10)
    expect(motivos(sinCiudad, "COMPLETITUD")).toContain("ciudad")

    const sinSitio = calcularScore({ ...BASE, sitioWeb: null })
    expect(componente(sinSitio, "COMPLETITUD").puntos).toBe(10)
    expect(motivos(sinSitio, "COMPLETITUD")).toContain("sitio")

    const vacio = calcularScore({})
    expect(componente(vacio, "COMPLETITUD").puntos).toBe(0)
  })

  it("un telefono invalido no completa el dato", () => {
    for (const telefono of ["", "abc", "123", "tel:555", "1234567890123456"]) {
      const resultado = calcularScore({ ...BASE, telefono })

      expect(
        componente(resultado, "COMPLETITUD").puntos,
        telefono,
      ).toBe(10)
    }
  })
})

describe("T-07: entradas invalidas y PII (AC-21, AC-41)", () => {
  it("no lanza con entradas ausentes o malformadas y falla cerrado", () => {
    const entradas = [
      undefined,
      null,
      {},
      { email: 42, auditoria: "no-es-objeto" },
      {
        auditoria: {
          estado: 123,
          scores: { velocidad: "40", ssl: null, seo: {}, seguridad: [] },
        },
      },
    ]

    for (const entrada of entradas) {
      const resultado = calcularScore(
        entrada as unknown as EntradaScore | null | undefined,
      )

      expect(resultado.version).toBe("v1")
      expect(resultado.componentes).toHaveLength(5)
      expect(resultado.total).toBeGreaterThanOrEqual(0)
      expect(resultado.total).toBeLessThanOrEqual(100)
    }
  })

  it("el desglose no incluye email, telefono ni datos del negocio", () => {
    const serializado = JSON.stringify(calcularScore(BASE))

    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain("5555")
    expect(serializado).not.toContain("consultora-ejemplo")
    expect(serializado).not.toContain("CABA")
  })
})

describe("T-07: score puro sin red, Prisma ni entorno (AC-21, AC-41)", () => {
  const FUENTE = "src/lib/propuestas/score.ts"

  it("no importa proveedores, red, entorno, logging ni azar", () => {
    const fuente = readFileSync(path.join(process.cwd(), FUENTE), "utf8")

    expect(fuente).not.toMatch(/@prisma\/client|prisma\./)
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
    expect(fuente).not.toMatch(/node:(?:http|https|dns|net|tls)/)
    expect(fuente).not.toMatch(/\bprocess\.env\b/)
    expect(fuente).not.toMatch(/\bMath\.random\b/)
    expect(fuente).not.toMatch(/\bDate\.now\b|new Date\b/)
    expect(fuente).not.toMatch(/\b(?:console|logger|captureException)\b/)
    expect(fuente).not.toMatch(/\bResend\b|\bresend\b/)
  })
})
