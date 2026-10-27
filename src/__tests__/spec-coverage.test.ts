import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * T-34 (AC-21): meta-test de cobertura de criterios de aceptacion.
 *
 * Lee `specs/001-paypal-pagos/spec.md`, extrae los AC definidos en la seccion 5
 * y verifica que cada uno aparezca al menos en un test real (`it`/`test`).
 * Los comentarios y los titulos de `describe` no cuentan: una referencia
 * documental no es cobertura. AC-29 es la unica excepcion: es una validacion
 * manual de punta a punta en sandbox, fuera de CI, en Railway staging con
 * Postgres separado (plan.md §7.7 y T-36..T-38).
 *
 * Este archivo se excluye del escaneo para que no se auto-cubra.
 */

const ROOT = process.cwd()
const SPEC = path.join(ROOT, "specs", "001-paypal-pagos", "spec.md")
const PLAN = path.join(ROOT, "specs", "001-paypal-pagos", "plan.md")
const TESTS = path.join(ROOT, "src", "__tests__")
const ESTE_ARCHIVO = path.join(TESTS, "spec-coverage.test.ts")

const AC_MANUAL_SANDBOX: Record<string, string> = {
  "AC-29":
    "Validacion manual de punta a punta en sandbox, fuera de CI: Railway staging con Postgres separado y checklist de plan.md §7.7 (T-36..T-38).",
}

function leer(archivo: string): string {
  return readFileSync(archivo, "utf8")
}

function archivosDeTest(directorio: string): string[] {
  const archivos: string[] = []

  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const completo = path.join(directorio, entrada.name)

    if (entrada.isDirectory()) {
      if (entrada.name === "helpers") continue
      archivos.push(...archivosDeTest(completo))
      continue
    }

    if (!/\.test\.tsx?$/.test(entrada.name)) continue
    if (path.resolve(completo) === path.resolve(ESTE_ARCHIVO)) continue
    archivos.push(completo)
  }

  return archivos
}

/** AC definidos en la seccion 5 de la spec (`- **AC-n:** ...`). */
function acsDefinidos(spec: string): number[] {
  const inicio = spec.indexOf("## 5. Criterios de aceptacion")
  const fin = spec.indexOf("## 6. Fuera de alcance")
  if (inicio < 0 || fin < 0 || fin <= inicio) {
    throw new Error("No se pudo ubicar la seccion 5 de criterios de aceptacion en spec.md")
  }

  const seccion = spec.slice(inicio, fin)
  return [...seccion.matchAll(/^\s*-\s+\*\*AC-(\d+):\*\*/gm)].map((match) =>
    Number(match[1])
  )
}

function acsMencionados(texto: string): number[] {
  return [...texto.matchAll(/\bAC-(\d+)\b/g)].map((match) => Number(match[1]))
}

/**
 * Quita comentarios de linea y bloque sin tocar strings ni templates. El
 * meta-test cuenta solo tests reales: `// AC-x` o un bloque de documentacion
 * no deben hacer pasar la cobertura.
 */
function sinComentarios(codigo: string): string {
  const salida: string[] = []
  let estado: "codigo" | "simple" | "doble" | "template" | "linea" | "bloque" =
    "codigo"

  for (let i = 0; i < codigo.length; i++) {
    const actual = codigo[i]
    const siguiente = codigo[i + 1]

    if (estado === "linea") {
      if (actual === "\n") {
        salida.push(actual)
        estado = "codigo"
      }
      continue
    }

    if (estado === "bloque") {
      if (actual === "*" && siguiente === "/") {
        i++
        estado = "codigo"
      } else if (actual === "\n") {
        salida.push(actual)
      }
      continue
    }

    if (estado === "simple" || estado === "doble" || estado === "template") {
      salida.push(actual)
      if (actual === "\\" && i + 1 < codigo.length) {
        salida.push(codigo[i + 1])
        i++
        continue
      }
      if (estado === "simple" && actual === "'") estado = "codigo"
      else if (estado === "doble" && actual === '"') estado = "codigo"
      else if (estado === "template" && actual === "`") estado = "codigo"
      continue
    }

    if (actual === "/" && siguiente === "/") {
      estado = "linea"
      i++
      continue
    }
    if (actual === "/" && siguiente === "*") {
      estado = "bloque"
      i++
      continue
    }

    if (actual === "'") estado = "simple"
    else if (actual === '"') estado = "doble"
    else if (actual === "`") estado = "template"
    salida.push(actual)
  }

  return salida.join("")
}

/** Indice del `)` que cierra el parentesis abierto en `apertura`, o -1. */
function cierreDeParentesis(texto: string, apertura: number): number {
  let profundidad = 0
  let estado: "codigo" | "simple" | "doble" | "template" = "codigo"

  for (let i = apertura; i < texto.length; i++) {
    const actual = texto[i]

    if (estado !== "codigo") {
      if (actual === "\\" && i + 1 < texto.length) {
        i++
        continue
      }
      if (estado === "simple" && actual === "'") estado = "codigo"
      else if (estado === "doble" && actual === '"') estado = "codigo"
      else if (estado === "template" && actual === "`") estado = "codigo"
      continue
    }

    if (actual === "'") estado = "simple"
    else if (actual === '"') estado = "doble"
    else if (actual === "`") estado = "template"
    else if (actual === "(") profundidad++
    else if (actual === ")") {
      profundidad--
      if (profundidad === 0) return i
    }
  }

  return -1
}

/**
 * Extrae el texto de cada llamada `it(...)`/`test(...)` y de sus variantes
 * encadenadas (`it.each(...)("...")`, `test.skip(...)`). Quedan fuera los
 * comentarios y los `describe(...)`: una referencia en la documentacion no
 * cuenta como test.
 */
function bloquesDeTest(codigo: string): string[] {
  const texto = sinComentarios(codigo)
  const bloques: string[] = []

  for (const match of texto.matchAll(/\b(it|test)\b/g)) {
    const indice = match.index
    if (indice === undefined) continue

    let i = indice + match[0].length

    while (i < texto.length) {
      while (i < texto.length && /\s/.test(texto[i])) i++

      if (texto[i] === ".") {
        i++
        const inicioModificador = i
        while (i < texto.length && /[A-Za-z0-9_$]/.test(texto[i])) i++
        const modificador = texto.slice(inicioModificador, i)
        while (i < texto.length && /\s/.test(texto[i])) i++
        if (texto[i] !== "(") break

        const finModificador = cierreDeParentesis(texto, i)
        if (finModificador < 0) break

        // `it.each([...])("titulo", ...)`: el primer parentesis es la tabla y
        // el siguiente contiene el test. `it.skip(...)` es el test directo.
        if (modificador === "each") {
          i = finModificador + 1
          continue
        }

        bloques.push(texto.slice(i + 1, finModificador))
        break
      }

      if (texto[i] === "(") {
        const fin = cierreDeParentesis(texto, i)
        if (fin < 0) break
        bloques.push(texto.slice(i + 1, fin))
      }
      break
    }
  }

  return bloques
}

describe("cobertura de AC de la spec (AC-21)", () => {
  const spec = leer(SPEC)
  const definidos = acsDefinidos(spec)
  const archivos = archivosDeTest(TESTS)

  it("la spec define exactamente AC-1 a AC-29", () => {
    expect(definidos).toEqual(Array.from({ length: 29 }, (_, indice) => indice + 1))
  })

  it("encuentra archivos de test para escanear (no se auto-cubre)", () => {
    expect(archivos.length).toBeGreaterThan(20)
    expect(archivos.map((archivo) => path.resolve(archivo))).not.toContain(
      path.resolve(ESTE_ARCHIVO)
    )
  })

  it("ignora comentarios y describe al contar ACs (solo it/test)", () => {
    const ejemplo = `
      // AC-90 en un comentario de linea
      /* AC-91 en un comentario de bloque */
      describe("caso AC-92", () => {
        it("cubre AC-1", () => {
          expect("AC-93").toBeDefined()
        })
      })
    `

    expect(acsMencionados(bloquesDeTest(ejemplo).join("\n"))).toEqual([1, 93])
  })

  it("reconoce it.each y test.skip como tests reales", () => {
    const ejemplo = `
      describe("AC-50 fuera de un test", () => {
        it.each([1, 2])("caso %s AC-2", () => {})
        test.skip("caso AC-3", () => {})
      })
    `

    expect(acsMencionados(bloquesDeTest(ejemplo).join("\n"))).toEqual([2, 3])
  })

  it("cada AC funcional aparece al menos en un test real (it/test)", () => {
    const referencias = new Map<number, string[]>()

    for (const archivo of archivos) {
      const relativo = path.relative(ROOT, archivo)
      const tests = bloquesDeTest(leer(archivo)).join("\n")
      for (const ac of acsMencionados(tests)) {
        const lista = referencias.get(ac) ?? []
        if (!lista.includes(relativo)) lista.push(relativo)
        referencias.set(ac, lista)
      }
    }

    const faltantes = definidos.filter(
      (ac) =>
        !AC_MANUAL_SANDBOX[`AC-${ac}`] && (referencias.get(ac)?.length ?? 0) === 0
    )

    expect(
      faltantes,
      `AC sin ningun test que los mencione: ${faltantes
        .map((ac) => `AC-${ac}`)
        .join(", ")}`
    ).toEqual([])

    for (const ac of definidos) {
      if (AC_MANUAL_SANDBOX[`AC-${ac}`]) continue
      expect(referencias.get(ac)?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it("no hay referencias a AC que no existan en la spec", () => {
    const existentes = new Set(definidos)
    const invalidas = new Set<number>()

    for (const archivo of archivos) {
      const tests = bloquesDeTest(leer(archivo)).join("\n")
      for (const ac of acsMencionados(tests)) {
        if (!existentes.has(ac)) invalidas.add(ac)
      }
    }

    expect([...invalidas].sort((a, b) => a - b)).toEqual([])
  })

  it("AC-29 queda documentado como validacion manual/sandbox fuera de CI", () => {
    const nota = AC_MANUAL_SANDBOX["AC-29"]

    expect(nota).toBeDefined()
    expect(nota).toContain("sandbox")
    expect(nota).toContain("Railway staging")
    expect(nota).toContain("manual")
    expect(nota).toContain("§7.7")

    // La validacion sandbox final esta documentada en el plan, no en la suite.
    const plan = leer(PLAN)
    const inicioChecklist = plan.indexOf("### 7.7 Checklist de sandbox")
    const finChecklist = plan.indexOf("## 8. Riesgos y supuestos")
    expect(inicioChecklist).toBeGreaterThanOrEqual(0)
    expect(finChecklist).toBeGreaterThan(inicioChecklist)

    const checklist = plan.slice(inicioChecklist, finChecklist)
    expect(checklist).toContain("Railway staging")
    expect(checklist).toContain("BD separada")
    expect(checklist).toContain("no cuenta como validacion final")
    expect(checklist).toContain("Local/ngrok solo para desarrollo")
    expect(checklist.toLowerCase()).toContain("sandbox")
  })
})
