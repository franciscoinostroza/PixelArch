import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"

/**
 * T-02 (AC-1, AC-2, AC-3; RF-1, RF-2, RF-4): layout del portal.
 * Sin sesion va al gate; la asistente vuelve a cobros; el admin ve el shell
 * propio sin navegacion del CRM.
 */

const mocks = vi.hoisted(() => ({
  resolverAdminPropuestas: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  pathname: "/propuestas",
}))

vi.mock("@/lib/propuestas/auth", () => ({
  resolverAdminPropuestas: mocks.resolverAdminPropuestas,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => mocks.pathname,
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import PropuestasLayout, {
  metadata,
} from "@/app/(propuestas)/layout"

async function esperarRedirect(promesa: Promise<unknown>, destino: string) {
  await expect(promesa).rejects.toThrow(`REDIRECT:${destino}`)
  expect(mocks.redirect).toHaveBeenCalledWith(destino)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/propuestas"
})

describe("PropuestasLayout (AC-1, AC-2, AC-3)", () => {
  it("sin sesion manda al gate de Clerk con next=/propuestas (AC-1)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: false,
      motivo: "SIN_SESION",
      esAsistente: false,
    })

    await esperarRedirect(
      PropuestasLayout({ children: <div>contenido</div> }),
      "/gate/admin?next=/propuestas",
    )
  })

  it("a la asistente la devuelve a /admin/cobros (AC-2)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: false,
      motivo: "NO_ADMIN",
      esAsistente: true,
    })

    await esperarRedirect(
      PropuestasLayout({ children: <div>contenido</div> }),
      "/admin/cobros",
    )
  })

  it("a cualquier otro rol lo manda al sitio publico (AC-2)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: false,
      motivo: "NO_ADMIN",
      esAsistente: false,
    })

    await esperarRedirect(
      PropuestasLayout({ children: <div>contenido</div> }),
      "/",
    )
  })

  it("el admin ve el shell propio con su identidad (AC-3)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: true,
      admin: { userId: "user_1", nombre: "Ana Perez" },
    })

    render(
      await PropuestasLayout({ children: <div>contenido</div> }),
    )

    expect(screen.getByText("contenido")).toBeInTheDocument()
    expect(screen.getByText("Ana Perez")).toBeInTheDocument()
    expect(
      screen.getByRole("navigation", { name: /secciones del portal/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /volver al crm/i }),
    ).toHaveAttribute("href", "/admin/dashboard")
  })

  it("no renderiza navegacion de clientes, cobros, pagos, servicios ni blog (AC-3)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: true,
      admin: { userId: "user_1", nombre: "Ana Perez" },
    })

    render(
      await PropuestasLayout({ children: <div>contenido</div> }),
    )

    for (const nombre of [
      /clientes/i,
      /cobros/i,
      /pagos/i,
      /servicios/i,
      /productos/i,
      /blog/i,
    ]) {
      expect(screen.queryByRole("link", { name: nombre })).not.toBeInTheDocument()
    }

    for (const href of [
      "/admin/clientes",
      "/admin/cobros",
      "/admin/pagos",
      "/admin/servicios",
      "/admin/blog",
    ]) {
      expect(
        document.querySelector(`a[href="${href}"]`),
        href,
      ).toBeNull()
    }
  })

  it("marca la seccion activa con aria-current (AC-3, RNF-7)", async () => {
    mocks.resolverAdminPropuestas.mockResolvedValue({
      ok: true,
      admin: { userId: "user_1", nombre: "Ana Perez" },
    })

    render(
      await PropuestasLayout({ children: <div>contenido</div> }),
    )

    expect(screen.getByRole("link", { name: "Panel" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("publica metadata noindex/nofollow en el layout (AC-5)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
