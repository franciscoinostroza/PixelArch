import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * T-03 (AC-6, AC-43; RF-62): aislamiento estatico del portal respecto del CRM.
 *
 * El portal de propuestas tiene modelos y codigo propios. Ningun archivo del
 * portal debe consultar ni escribir `prisma.cliente`, `prisma.pago`,
 * `prisma.suscripcion`, `prisma.enlacePago`, `prisma.proyecto` ni
 * `prisma.hito`, ni usar los guards del CRM que consultan `Cliente`.
 *
 * El escaneo es de solo lectura: no importa modulos de la app ni toca la base.
 */

const ROOT = process.cwd()

const DIRS_PORTAL = [
  path.join(ROOT, "src", "lib", "propuestas"),
  path.join(ROOT, "src", "app", "(propuestas)"),
  path.join(ROOT, "src", "app", "api", "propuestas"),
  path.join(ROOT, "src", "components", "propuestas"),
]

const CONSULTA_CRM =
  /prisma\.(cliente|pago|suscripcion|enlacePago|proyecto|hito)\b/i
const GUARD_CRM = /requireStaff|requireAdmin/
const ID_CRM = /\b(clienteId|pagoId|suscripcionId|enlacePagoId|proyectoId|hitoId)\b/

function archivosFuente(directorio: string): string[] {
  if (!existsSync(directorio)) return []

  const archivos: string[] = []

  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const completo = path.join(directorio, entrada.name)

    if (entrada.isDirectory()) {
      archivos.push(...archivosFuente(completo))
      continue
    }

    if (/\.(ts|tsx)$/.test(entrada.name)) archivos.push(completo)
  }

  return archivos
}

const ARCHIVOS = DIRS_PORTAL.flatMap(archivosFuente)

function relativo(archivo: string): string {
  return path.relative(ROOT, archivo).split(path.sep).join("/")
}

describe("T-03: aislamiento del portal respecto del CRM (AC-6, AC-43)", () => {
  it("escanea los archivos reales del portal (el test no es vacio)", () => {
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(5)

    const nombres = ARCHIVOS.map(relativo)

    expect(nombres).toContain("src/lib/propuestas/auth.ts")
    expect(nombres).toContain("src/app/(propuestas)/layout.tsx")
    expect(nombres).toContain("src/app/(propuestas)/propuestas/page.tsx")
  })

  it("no consulta ni escribe modelos del CRM desde el portal", () => {
    for (const archivo of ARCHIVOS) {
      expect(readFileSync(archivo, "utf8"), relativo(archivo)).not.toMatch(
        CONSULTA_CRM,
      )
    }
  })

  it("no usa los guards del CRM que consultan Cliente", () => {
    for (const archivo of ARCHIVOS) {
      expect(readFileSync(archivo, "utf8"), relativo(archivo)).not.toMatch(
        GUARD_CRM,
      )
    }
  })

  it("no declara ids de modelos del CRM en el codigo del portal", () => {
    for (const archivo of ARCHIVOS) {
      expect(readFileSync(archivo, "utf8"), relativo(archivo)).not.toMatch(
        ID_CRM,
      )
    }
  })
})
