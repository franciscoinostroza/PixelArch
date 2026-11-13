import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * T-23 (AC-44; RF-59, RF-61): matriz de cobertura de los AC del portal.
 *
 * Cada AC-1..AC-44 tiene al menos un archivo de test de la feature 004 que lo
 * nombra (en el titulo, un `describe` o un comentario). El test es estatico:
 * solo lee archivos, no importa modulos de la app ni hace red.
 *
 * AC-44 (suite sin red) se cubre con `propuestas-sin-red.test.ts`. AC-45 es un
 * criterio de regresion (suite completa, typecheck, lint y build) que no se
 * puede demostrar con un test unitario: queda delegado a T-25.
 */

const ROOT = process.cwd()
const DIR_TESTS = path.join(ROOT, "src", "__tests__")
const ARCHIVO_META = "src/__tests__/lib/propuestas-cobertura.test.ts"

/**
 * Un representante por AC. Se elige el test que ejercita directamente la
 * funcionalidad, no un archivo que solo menciona el criterio de pasada.
 */
const MATRIZ: Record<string, string> = {
  "AC-1": "src/__tests__/middleware-propuestas.test.ts",
  "AC-2": "src/__tests__/middleware-propuestas.test.ts",
  "AC-3": "src/__tests__/app/propuestas-auth.test.tsx",
  "AC-4": "src/__tests__/middleware-propuestas.test.ts",
  "AC-5": "src/__tests__/middleware-propuestas.test.ts",
  "AC-6": "src/__tests__/lib/propuestas-aislamiento.test.ts",
  "AC-7": "src/__tests__/api/propuestas/campanas.test.ts",
  "AC-8": "src/__tests__/lib/propuestas-places.test.ts",
  "AC-9": "src/__tests__/lib/propuestas-web.test.ts",
  "AC-10": "src/__tests__/lib/propuestas-web.test.ts",
  "AC-11": "src/__tests__/lib/propuestas-consumo.test.ts",
  "AC-12": "src/__tests__/lib/propuestas-places.test.ts",
  "AC-13": "src/__tests__/api/propuestas/prospectos.test.ts",
  "AC-14": "src/__tests__/lib/propuestas-dedupe.test.ts",
  "AC-15": "src/__tests__/lib/propuestas-supresion.test.ts",
  "AC-16": "src/__tests__/lib/propuestas-supresion.test.ts",
  "AC-17": "src/__tests__/lib/propuestas-supresion.test.ts",
  "AC-18": "src/__tests__/lib/propuestas-supresion.test.ts",
  "AC-19": "src/__tests__/lib/propuestas-normalizar.test.ts",
  "AC-20": "src/__tests__/lib/propuestas-auditoria.test.ts",
  "AC-21": "src/__tests__/lib/propuestas-score.test.ts",
  "AC-22": "src/__tests__/lib/propuestas-plantillas.test.ts",
  "AC-23": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-24": "src/__tests__/lib/propuestas-transiciones.test.ts",
  "AC-25": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-26": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-27": "src/__tests__/lib/propuestas-transiciones.test.ts",
  "AC-28": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-29": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-30": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-31": "src/__tests__/api/propuestas/envios.test.ts",
  "AC-32": "src/__tests__/lib/propuestas-email.test.ts",
  "AC-33": "src/__tests__/api/opt-out.test.ts",
  "AC-34": "src/__tests__/api/opt-out.test.ts",
  "AC-35": "src/__tests__/api/opt-out.test.ts",
  "AC-36": "src/__tests__/api/propuestas/supresiones.test.ts",
  "AC-37": "src/__tests__/api/propuestas/arco.test.ts",
  "AC-38": "src/__tests__/app/propuestas-pages.test.tsx",
  "AC-39": "src/__tests__/app/propuestas-pages.test.tsx",
  "AC-40": "src/__tests__/lib/propuestas-retencion.test.ts",
  "AC-41": "src/__tests__/lib/propuestas-privacidad.test.ts",
  "AC-42": "src/__tests__/lib/propuestas-config.test.ts",
  "AC-43": "src/__tests__/lib/propuestas-schema.test.ts",
  "AC-44": "src/__tests__/lib/propuestas-sin-red.test.ts",
}

/**
 * AC-45 no tiene representante en esta matriz: es un criterio de regresion
 * (suite completa + typecheck + lint + build) que cierra T-25, no un test de
 * esta feature. Este archivo no lo simula ni lo autoasigna.
 */
const TODOS_LOS_AC = Array.from({ length: 44 }, (_, indice) => `AC-${indice + 1}`)

function archivosTest(directorio: string): string[] {
  if (!existsSync(directorio)) return []

  const archivos: string[] = []

  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const completo = path.join(directorio, entrada.name)

    if (entrada.isDirectory()) {
      archivos.push(...archivosTest(completo))
      continue
    }

    if (/\.test\.(ts|tsx)$/.test(entrada.name)) archivos.push(completo)
  }

  return archivos
}

function relativo(archivo: string): string {
  return path.relative(ROOT, archivo).split(path.sep).join("/")
}

/** Tests de la feature 004: middleware, APIs, paginas y lib del portal. */
function esTestDePropuestas(archivo: string): boolean {
  const base = path.basename(archivo)
  const rel = relativo(archivo)

  return (
    base.includes("propuestas") ||
    base === "opt-out.test.ts" ||
    rel.includes("/propuestas/")
  )
}

const ARCHIVOS_004 = archivosTest(DIR_TESTS).filter(esTestDePropuestas)
const FUENTES = new Map(
  ARCHIVOS_004.map((archivo) => [relativo(archivo), readFileSync(archivo, "utf8")]),
)

function contieneAc(fuente: string, ac: string): boolean {
  return new RegExp(`\\b${ac}\\b`).test(fuente)
}

describe("matriz AC del portal de propuestas (T-23, AC-44)", () => {
  it("encuentra los tests reales de la feature (la matriz no es vacia)", () => {
    expect(ARCHIVOS_004.length).toBeGreaterThanOrEqual(20)

    for (const critico of [
      "src/__tests__/middleware-propuestas.test.ts",
      "src/__tests__/lib/propuestas-privacidad.test.ts",
      "src/__tests__/lib/propuestas-sin-red.test.ts",
      "src/__tests__/lib/propuestas-cobertura.test.ts",
      "src/__tests__/api/opt-out.test.ts",
    ]) {
      expect(FUENTES.has(critico), critico).toBe(true)
    }
  })

  it("cada AC-1..AC-44 tiene un archivo representante existente y lo menciona", () => {
    expect(Object.keys(MATRIZ)).toHaveLength(44)
    expect(Object.keys(MATRIZ)).toEqual(TODOS_LOS_AC)

    for (const [ac, archivo] of Object.entries(MATRIZ)) {
      const fuente = FUENTES.get(archivo)
      expect(fuente, `${ac}: falta ${archivo}`).toBeDefined()
      expect(contieneAc(fuente ?? "", ac), `${ac} no aparece en ${archivo}`).toBe(
        true,
      )
    }
  })

  it("los representantes son tests reales y no el archivo meta", () => {
    for (const [ac, archivo] of Object.entries(MATRIZ)) {
      const completo = path.join(ROOT, archivo)

      expect(existsSync(completo), `${ac}: falta ${archivo}`).toBe(true)
      expect(esTestDePropuestas(completo), `${ac}: ${archivo}`).toBe(true)
      expect(archivo, `${ac} no puede apuntar al archivo meta`).not.toBe(
        ARCHIVO_META,
      )

      const fuente = FUENTES.get(archivo) ?? ""
      expect(fuente, `${ac}: ${archivo}`).toMatch(/\b(?:it|test)\s*\(/)
    }
  })

  it("AC-44 tiene evidencia concreta de suite sin red", () => {
    const sinRed = FUENTES.get(MATRIZ["AC-44"] ?? "") ?? ""
    expect(sinRed).toContain("instalarGuardRedPropuestas")
    expect(sinRed).toContain("places.googleapis.com")
    expect(sinRed).toContain("api.resend.com")
    expect(sinRed).toContain("api.openai.com")
    expect(sinRed).toContain("LLM")
  })

  it("AC-45 no tiene representante: queda delegado a T-25", () => {
    // AC-45 exige ejecutar la suite completa, typecheck, lint y build. No se
    // puede demostrar con un test unitario ni con este archivo meta; por eso
    // no se le asigna ningun archivo en la matriz.
    expect(MATRIZ).not.toHaveProperty("AC-45")
  })

  it("ningun AC-1..AC-44 queda solo en este archivo meta", () => {
    const fuentesReales = [...FUENTES.entries()].filter(
      ([archivo]) => archivo !== ARCHIVO_META,
    )

    const sinCobertura = TODOS_LOS_AC.filter(
      (ac) => !fuentesReales.some(([, fuente]) => contieneAc(fuente, ac)),
    )

    expect(sinCobertura).toEqual([])
  })

  it("el setup global instala el guard que impide salir a Places/Resend/LLM", () => {
    const setup = readFileSync(
      path.join(ROOT, "src", "__tests__", "setup.ts"),
      "utf8",
    )

    expect(setup).toContain("instalarGuardRedPropuestas")
    expect(setup).toContain("instalarGuardRedPasarelas")
  })

  it("documenta que la suite es estatica y no hace llamadas reales (AC-44)", () => {
    // Este archivo solo lee el filesystem. Si se agrega red aca, el guard de
    // setup.ts bloquearia Places/Resend/LLM y el test fallaria antes de pasar.
    expect(ARCHIVOS_004.every((archivo) => existsSync(archivo))).toBe(true)
  })
})
