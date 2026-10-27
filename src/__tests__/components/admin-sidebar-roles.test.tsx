import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"

/**
 * AC-17 / plan §5.1: el sidebar solo muestra las secciones permitidas para el rol.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/cobros",
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@/components/layout/admin-user-button", () => ({
  AdminUserButton: () => <div>cuenta</div>,
}))

import { AdminSidebar } from "@/components/layout/admin-sidebar"

describe("AdminSidebar por rol (AC-17)", () => {
  it("la asistente solo ve clientes, cobros y pagos", () => {
    render(<AdminSidebar rol="asistente" alertasActivas={2} />)

    expect(screen.getByRole("link", { name: /clientes/i })).toHaveAttribute(
      "href",
      "/admin/clientes",
    )
    expect(screen.getByRole("link", { name: /cobros/i })).toHaveAttribute(
      "href",
      "/admin/cobros",
    )
    expect(screen.getByRole("link", { name: /pagos/i })).toHaveAttribute(
      "href",
      "/admin/pagos",
    )

    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /productos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /blog/i })).not.toBeInTheDocument()
  })

  it("el logo de la asistente lleva a cobros", () => {
    render(<AdminSidebar rol="asistente" />)

    expect(screen.getByRole("link", { name: /pixelarch/i })).toHaveAttribute(
      "href",
      "/admin/cobros",
    )
  })

  it("el admin ve todas las secciones y su logo lleva al dashboard", () => {
    render(<AdminSidebar rol="admin" />)

    for (const nombre of [/dashboard/i, /clientes/i, /cobros/i, /productos/i, /pagos/i, /blog/i]) {
      expect(screen.getByRole("link", { name: nombre })).toBeInTheDocument()
    }

    expect(screen.getByRole("link", { name: /pixelarch/i })).toHaveAttribute(
      "href",
      "/admin/dashboard",
    )
  })

  it("mantiene el badge de cobros para el rol permitido", () => {
    render(<AdminSidebar rol="asistente" alertasActivas={4} />)

    expect(screen.getByRole("link", { name: /cobros/i })).toHaveTextContent("4")
  })
})
