import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * AC-17: /admin y la pagina de redirect de auth eligen el destino segun rol.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  auth: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: vi.fn(async () => ({ users: { getUser: mocks.getUser } })),
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

import AdminIndexPage from "@/app/(admin)/admin/page"
import AuthRedirectPage from "@/app/(auth)/redirect/page"

async function esperarRedirect(promesa: Promise<unknown>, destino: string) {
  await expect(promesa).rejects.toThrow(`REDIRECT:${destino}`)
  expect(mocks.redirect).toHaveBeenCalledWith(destino)
}

function sesionClerk(role?: unknown) {
  mocks.auth.mockResolvedValue({ userId: "user_1" })
  mocks.getUser.mockResolvedValue({
    id: "user_1",
    publicMetadata: role === undefined ? {} : { role },
  })
}

describe("/admin redirige segun rol (AC-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("manda al admin al dashboard", async () => {
    mocks.requireStaff.mockResolvedValue({
      userId: "user_1",
      nombre: "Admin",
      rol: "admin",
      esAdmin: true,
      cliente: null,
    })

    await esperarRedirect(AdminIndexPage(), "/admin/dashboard")
  })

  it("manda a la asistente a cobros (nunca al dashboard)", async () => {
    mocks.requireStaff.mockResolvedValue({
      userId: "user_1",
      nombre: "Asistente",
      rol: "asistente",
      esAdmin: false,
      cliente: null,
    })

    await esperarRedirect(AdminIndexPage(), "/admin/cobros")
  })

  it("rechaza sin sesion staff", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await esperarRedirect(AdminIndexPage(), "/")
  })
})

describe("pagina de redirect de auth segun rol (AC-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("manda a sign-in sin sesion", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    await esperarRedirect(AuthRedirectPage(), "/sign-in")
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("manda al admin al dashboard", async () => {
    sesionClerk("admin")

    await esperarRedirect(AuthRedirectPage(), "/admin/dashboard")
  })

  it("manda a la asistente a cobros", async () => {
    sesionClerk("asistente")

    await esperarRedirect(AuthRedirectPage(), "/admin/cobros")
  })

  it("manda al sitio publico si el rol no es staff o falta", async () => {
    sesionClerk("assistant")
    await esperarRedirect(AuthRedirectPage(), "/")

    sesionClerk(undefined)
    await esperarRedirect(AuthRedirectPage(), "/")
  })
})
