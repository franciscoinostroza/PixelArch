import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * AC-17: el layout del admin valida staff y expone el rol al sidebar para que
 * la UI filtre las secciones permitidas.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  countSuscripcion: vi.fn(),
  countHito: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    suscripcion: { count: mocks.countSuscripcion },
    hito: { count: mocks.countHito },
  },
}))

vi.mock("@/components/layout/static-ambience", () => ({
  default: () => null,
}))

vi.mock("@/components/layout/admin-sidebar", () => ({
  AdminSidebar: ({ rol }: { rol: string; alertasActivas?: number }) => (
    <div data-testid="admin-sidebar" data-rol={rol} />
  ),
}))

import AdminLayout from "@/app/(admin)/layout"

function staff(rol: "admin" | "asistente") {
  return {
    userId: "user_1",
    nombre: rol === "admin" ? "Admin" : "Asistente",
    rol,
    esAdmin: rol === "admin",
    cliente: null,
  }
}

describe("AdminLayout: staff y rol (AC-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.countSuscripcion.mockResolvedValue(0)
    mocks.countHito.mockResolvedValue(0)
  })

  it("pasa el rol admin al sidebar", async () => {
    mocks.requireStaff.mockResolvedValue(staff("admin"))

    render(await AdminLayout({ children: <div>contenido</div> }))

    expect(screen.getByTestId("admin-sidebar")).toHaveAttribute("data-rol", "admin")
    expect(screen.getByText("contenido")).toBeInTheDocument()
  })

  it("pasa el rol asistente al sidebar", async () => {
    mocks.requireStaff.mockResolvedValue(staff("asistente"))

    render(await AdminLayout({ children: <div>contenido</div> }))

    expect(screen.getByTestId("admin-sidebar")).toHaveAttribute("data-rol", "asistente")
  })

  it("redirige si no hay staff", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(AdminLayout({ children: <div>contenido</div> })).rejects.toThrow(
      "REDIRECT:/admin",
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")
  })
})
