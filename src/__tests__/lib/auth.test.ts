import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUser: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: vi.fn(async () => ({ users: { getUser: mocks.getUser } })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { cliente: { findUnique: mocks.findUnique } },
}))

import { requireAdmin, requireStaff } from "@/lib/auth"
import {
  SECCIONES_ASISTENTE,
  esRolStaff,
  esRutaAdminPermitida,
  rutaInicioRol,
} from "@/lib/roles"

const CLIENTE = {
  id: "cliente_1",
  clerkUserId: "user_1",
  nombre: "Cliente Demo",
  email: "cliente@example.com",
  empresa: null,
  telefono: null,
  notas: null,
  activo: true,
  creadoEn: new Date("2026-01-01T12:00:00.000Z"),
  actualizadoEn: new Date("2026-01-01T12:00:00.000Z"),
}

function sesion(role?: unknown, extra: Record<string, unknown> = {}) {
  mocks.auth.mockResolvedValue({ userId: "user_1" })
  mocks.getUser.mockResolvedValue({
    id: "user_1",
    fullName: "Ana Perez",
    firstName: "Ana",
    publicMetadata: role === undefined ? {} : { role },
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue(null)
})

describe("requireStaff (AC-17, AC-25)", () => {
  it("acepta al admin y devuelve userId, nombre y rol", async () => {
    sesion("admin")

    await expect(requireStaff()).resolves.toEqual({
      userId: "user_1",
      nombre: "Ana Perez",
      rol: "admin",
      esAdmin: true,
      cliente: null,
    })
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { clerkUserId: "user_1" } })
  })

  it("acepta a la asistente como staff", async () => {
    sesion("asistente")

    const staff = await requireStaff()
    expect(staff).not.toBeNull()
    expect(staff?.rol).toBe("asistente")
    expect(staff?.esAdmin).toBe(false)
    expect(staff?.userId).toBe("user_1")
  })

  it("conserva el acceso al Cliente vinculado por clerkUserId", async () => {
    sesion("asistente")
    mocks.findUnique.mockResolvedValue(CLIENTE)

    const staff = await requireStaff()
    expect(staff?.cliente).toEqual(CLIENTE)
    expect(staff?.nombre).toBe("Cliente Demo")
  })

  it("rechaza el alias assistant y cualquier rol desconocido", async () => {
    for (const rol of ["assistant", "ADMIN", "user", "", "asistenta"]) {
      sesion(rol)
      await expect(requireStaff()).resolves.toBeNull()
    }
  })

  it("rechaza roles null, ausentes o metadata invalida", async () => {
    sesion(null)
    await expect(requireStaff()).resolves.toBeNull()

    mocks.getUser.mockResolvedValue({ id: "user_1", publicMetadata: {} })
    await expect(requireStaff()).resolves.toBeNull()

    mocks.getUser.mockResolvedValue({ id: "user_1", publicMetadata: undefined })
    await expect(requireStaff()).resolves.toBeNull()
  })

  it("rechaza sin sesion sin consultar Clerk ni Prisma", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    await expect(requireStaff()).resolves.toBeNull()
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})

describe("requireAdmin (AC-17, AC-25)", () => {
  it("acepta al admin y conserva el fallback historico sin Cliente", async () => {
    sesion("admin")

    await expect(requireAdmin()).resolves.toEqual({
      id: "user_1",
      clerkUserId: "user_1",
      nombre: "Admin",
      email: "",
      activo: true,
    })
  })

  it("devuelve el Cliente cuando el admin esta vinculado", async () => {
    sesion("admin")
    mocks.findUnique.mockResolvedValue(CLIENTE)

    await expect(requireAdmin()).resolves.toEqual(CLIENTE)
  })

  it("rechaza a la asistente", async () => {
    sesion("asistente")

    await expect(requireAdmin()).resolves.toBeNull()
  })

  it("rechaza roles desconocidos o sin sesion", async () => {
    sesion("assistant")
    await expect(requireAdmin()).resolves.toBeNull()

    mocks.auth.mockResolvedValue({ userId: null })
    await expect(requireAdmin()).resolves.toBeNull()
  })
})

describe("alcance de secciones y redirect (AC-17)", () => {
  it("define las tres secciones habilitadas para la asistente", () => {
    expect(SECCIONES_ASISTENTE).toEqual([
      "/admin/clientes",
      "/admin/cobros",
      "/admin/pagos",
    ])
  })

  it("permite a la asistente clientes (con detalle), cobros y pagos (con recibo)", () => {
    const permitidas = [
      "/admin/clientes",
      "/admin/clientes/",
      "/admin/clientes/cliente_1",
      "/admin/clientes/cliente_1?tab=pagos",
      "/admin/cobros",
      "/admin/cobros/",
      "/admin/pagos",
      "/admin/pagos/pago_1/recibo",
    ]

    for (const ruta of permitidas) {
      expect(esRutaAdminPermitida("asistente", ruta)).toBe(true)
    }
  })

  it("deja /admin como punto de entrada para que la pagina redirija por rol", () => {
    expect(esRutaAdminPermitida("asistente", "/admin")).toBe(true)
    expect(esRutaAdminPermitida("asistente", "/admin/")).toBe(true)
  })

  it("bloquea a la asistente el resto de las secciones del admin", () => {
    const bloqueadas = [
      "/admin/dashboard",
      "/admin/servicios",
      "/admin/blog",
      "/admin/otra",
      "/admin/clientes-internos",
      "/admin/pagoss",
      "/admin/cobrosx",
    ]

    for (const ruta of bloqueadas) {
      expect(esRutaAdminPermitida("asistente", ruta)).toBe(false)
    }
  })

  it("el admin mantiene acceso a todas las secciones", () => {
    for (const ruta of ["/admin", "/admin/dashboard", "/admin/servicios", "/admin/blog", "/admin/clientes/1"]) {
      expect(esRutaAdminPermitida("admin", ruta)).toBe(true)
    }
  })

  it("redirige al admin al dashboard y a la asistente a cobros", () => {
    expect(rutaInicioRol("admin")).toBe("/admin/dashboard")
    expect(rutaInicioRol("asistente")).toBe("/admin/cobros")
  })

  it("reconoce solo admin y asistente como roles staff", () => {
    expect(esRolStaff("admin")).toBe(true)
    expect(esRolStaff("asistente")).toBe(true)
    expect(esRolStaff("assistant")).toBe(false)
    expect(esRolStaff(null)).toBe(false)
    expect(esRolStaff(undefined)).toBe(false)
    expect(esRolStaff("")).toBe(false)
  })
})
