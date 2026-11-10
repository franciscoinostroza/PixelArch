import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-02 (AC-1, AC-2, AC-3, AC-6; RF-1, RF-2, RF-4, RF-8): guard Clerk-only del
 * portal. No toca Prisma ni el CRM; falla cerrado si Clerk no responde.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUser: vi.fn(),
  clerkClient: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

import { resolverAdminPropuestas } from "@/lib/propuestas/auth"

function usuario(role: unknown, extra: Record<string, unknown> = {}) {
  mocks.auth.mockResolvedValue({ userId: "user_1" })
  mocks.getUser.mockResolvedValue({
    id: "user_1",
    fullName: "Ana Perez",
    firstName: "Ana",
    publicMetadata: { role },
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })
})

describe("resolverAdminPropuestas (AC-1, AC-2, AC-3)", () => {
  it("devuelve SIN_SESION sin consultar Clerk si no hay sesion", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: false,
      motivo: "SIN_SESION",
      esAsistente: false,
    })
    expect(mocks.clerkClient).not.toHaveBeenCalled()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("devuelve NO_ADMIN con esAsistente para el redirect del CRM", async () => {
    usuario("asistente")

    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: false,
      motivo: "NO_ADMIN",
      esAsistente: true,
    })
  })

  it("rechaza roles desconocidos sin tratarlos como asistente", async () => {
    for (const role of ["assistant", "user", "ADMIN", "", null, undefined]) {
      usuario(role)

      await expect(resolverAdminPropuestas(), String(role)).resolves.toEqual({
        ok: false,
        motivo: "NO_ADMIN",
        esAsistente: false,
      })
    }
  })

  it("acepta al admin con su userId y nombre de Clerk", async () => {
    usuario("admin")

    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: true,
      admin: { userId: "user_1", nombre: "Ana Perez" },
    })
  })

  it("usa firstName o el fallback Admin cuando falta fullName", async () => {
    usuario("admin", { fullName: null })
    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: true,
      admin: { userId: "user_1", nombre: "Ana" },
    })

    usuario("admin", { fullName: "   ", firstName: null })
    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: true,
      admin: { userId: "user_1", nombre: "Admin" },
    })
  })

  it("falla cerrado si Clerk lanza al autenticar", async () => {
    mocks.auth.mockRejectedValue(new Error("clerk caido"))

    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: false,
      motivo: "SIN_SESION",
      esAsistente: false,
    })
  })

  it("falla cerrado si Clerk no puede leer el usuario", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_1" })
    mocks.clerkClient.mockRejectedValue(new Error("clerk caido"))

    await expect(resolverAdminPropuestas()).resolves.toEqual({
      ok: false,
      motivo: "SIN_SESION",
      esAsistente: false,
    })
  })

  it("no importa Prisma ni usa los guards del CRM (AC-6)", () => {
    const fuente = readFileSync(
      join(process.cwd(), "src", "lib", "propuestas", "auth.ts"),
      "utf8",
    )

    expect(fuente).not.toMatch(/@\/lib\/prisma/)
    expect(fuente).not.toMatch(/prisma\./)
    expect(fuente).not.toMatch(/requireStaff|requireAdmin/)
  })
})

describe("aislamiento del shell T-02 (AC-3, AC-6)", () => {
  const ARCHIVOS_PORTAL = [
    ["lib", "propuestas", "auth.ts"],
    ["lib", "propuestas", "errores.ts"],
    ["lib", "propuestas", "fechas.ts"],
    ["app", "(propuestas)", "layout.tsx"],
    ["app", "(propuestas)", "propuestas", "page.tsx"],
    ["components", "propuestas", "portal-shell.tsx"],
    ["components", "propuestas", "portal-sidebar.tsx"],
    ["components", "propuestas", "estado-vacio.tsx"],
  ] as const

  function fuenteT02(partes: readonly string[]): string {
    return readFileSync(join(process.cwd(), "src", ...partes), "utf8")
  }

  it("no lee ni escribe modelos del CRM desde el portal (AC-3, AC-6)", () => {
    for (const partes of ARCHIVOS_PORTAL) {
      const fuente = fuenteT02(partes)
      const archivo = partes.join("/")

      expect(fuente, archivo).not.toMatch(
        /prisma\.(cliente|pago|suscripcion|enlacePago|proyecto|hito)\b/i,
      )
      expect(fuente, archivo).not.toMatch(/@\/lib\/prisma\/(cliente|pago)/i)
      expect(fuente, archivo).not.toMatch(/requireStaff|requireAdmin/)
    }
  })

  it("no importa ni llama a Resend: T-02 no envia emails (T-02, sin envio)", () => {
    for (const partes of ARCHIVOS_PORTAL) {
      const fuente = fuenteT02(partes)
      const archivo = partes.join("/")

      expect(fuente, archivo).not.toMatch(/@\/lib\/resend/i)
      expect(fuente, archivo).not.toMatch(/@\/lib\/notifications/i)
      expect(fuente, archivo).not.toMatch(/\bResend\b/)
      expect(fuente, archivo).not.toMatch(/sendPaymentReceipt|sendEmail/i)
    }
  })
})
