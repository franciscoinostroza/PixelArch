import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * AC-17 / plan §5.1: el middleware es la primera barrera de autorizacion.
 * La asistente solo puede entrar a clientes, cobros y pagos; /admin es el
 * punto de entrada y el resto de las secciones redirige a su inicio por rol.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

function patronARegExp(patron: string): RegExp {
  if (patron.endsWith("(.*)")) {
    const base = patron.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`^${base}(.*)$`)
  }
  return new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
}

vi.mock("@clerk/nextjs/server", () => ({
  // El handler real queda envuelto por clerkMiddleware; en el test lo exponemos
  // directamente para poder invocarlo con un auth stub.
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (routes: string[]) => {
    const patterns = routes.map(patronARegExp)
    return (req: { nextUrl: URL }) =>
      patterns.some((pattern) => pattern.test(req.nextUrl.pathname))
  },
  clerkClient: vi.fn(async () => ({ users: { getUser: mocks.getUser } })),
}))

import middleware from "@/middleware"

type AuthResult = { userId: string | null }
type MiddlewareHandler = (
  auth: () => Promise<AuthResult>,
  req: NextRequest,
) => Promise<Response>

const handler = middleware as unknown as MiddlewareHandler

function request(path: string): NextRequest {
  const url = new URL(path, "https://pixelarch.dev")
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest
}

function sesion(userId: string | null) {
  return async () => ({ userId })
}

function locationDe(res: Response): string | null {
  return res.headers.get("location")
}

describe("middleware de roles (AC-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deja pasar las rutas publicas sin consultar Clerk", async () => {
    const res = await handler(sesion(null), request("/blog/articulo"))

    expect(locationDe(res)).toBeNull()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("manda al gate cuando no hay sesion en /admin", async () => {
    const res = await handler(sesion(null), request("/admin/dashboard"))
    const rewrite = res.headers.get("x-middleware-rewrite")

    expect(rewrite).not.toBeNull()
    expect(rewrite).toContain("/gate/admin")
    expect(rewrite).toContain("next=%2Fadmin%2Fdashboard")
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("rechaza a un usuario sin rol staff", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_1",
      publicMetadata: { role: "user" },
    })

    const res = await handler(sesion("user_1"), request("/admin/dashboard"))

    expect(res.status).toBe(307)
    expect(locationDe(res)).toBe("https://pixelarch.dev/")
  })

  it("rechaza el alias assistant", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_1",
      publicMetadata: { role: "assistant" },
    })

    const res = await handler(sesion("user_1"), request("/admin/clientes"))

    expect(res.status).toBe(307)
    expect(locationDe(res)).toBe("https://pixelarch.dev/")
  })

  it("permite a la asistente clientes (con detalle), cobros y pagos (con recibo)", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_1",
      publicMetadata: { role: "asistente" },
    })

    const permitidas = [
      "/admin",
      "/admin/clientes",
      "/admin/clientes/cliente_1",
      "/admin/cobros",
      "/admin/pagos",
      "/admin/pagos/pago_1/recibo",
    ]

    for (const ruta of permitidas) {
      const res = await handler(sesion("user_1"), request(ruta))
      expect(locationDe(res), ruta).toBeNull()
    }
  })

  it("redirige a la asistente a cobros si intenta dashboard, servicios o blog", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_1",
      publicMetadata: { role: "asistente" },
    })

    for (const ruta of ["/admin/dashboard", "/admin/servicios", "/admin/blog"]) {
      const res = await handler(sesion("user_1"), request(ruta))
      expect(res.status, ruta).toBe(307)
      expect(locationDe(res), ruta).toBe("https://pixelarch.dev/admin/cobros")
    }
  })

  it("mantiene el acceso del admin a todas las secciones", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_1",
      publicMetadata: { role: "admin" },
    })

    for (const ruta of [
      "/admin",
      "/admin/dashboard",
      "/admin/servicios",
      "/admin/blog",
      "/admin/clientes/cliente_1",
    ]) {
      const res = await handler(sesion("user_1"), request(ruta))
      expect(locationDe(res), ruta).toBeNull()
    }
  })
})
