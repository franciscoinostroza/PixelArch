import { afterAll, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"

/**
 * AC-17: el nav publico solo muestra el acceso Admin a usuarios staff y lo
 * apunta al inicio permitido para su rol.
 */

// `hasClerkKey` se evalua al importar el modulo; hay que definirlo antes.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_test"
})

const mocks = vi.hoisted(() => ({
  useUser: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useUser: mocks.useUser,
  Show: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserButton: () => <div>cuenta</div>,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

import { Nav } from "@/components/layout/nav"

async function renderNav(user: unknown) {
  mocks.useUser.mockReturnValue({ user })
  render(<Nav />)
  // El nav publico siempre renderiza estos links; esperamos a que monte.
  expect(await screen.findByRole("link", { name: /productos/i })).toBeInTheDocument()
}

describe("Nav: acceso Admin por rol (AC-17)", () => {
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  })

  it("la asistente ve el acceso Admin apuntando a cobros", async () => {
    await renderNav({ publicMetadata: { role: "asistente" } })

    const admin = await screen.findByRole("link", { name: "Admin" })
    expect(admin).toHaveAttribute("href", "/admin/cobros")
  })

  it("el admin ve el acceso Admin apuntando al dashboard", async () => {
    await renderNav({ publicMetadata: { role: "admin" } })

    const admin = await screen.findByRole("link", { name: "Admin" })
    expect(admin).toHaveAttribute("href", "/admin/dashboard")
  })

  it("no muestra acceso Admin al alias assistant", async () => {
    await renderNav({ publicMetadata: { role: "assistant" } })

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument()
  })

  it("no muestra acceso Admin sin sesion", async () => {
    await renderNav(null)

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument()
  })
})
