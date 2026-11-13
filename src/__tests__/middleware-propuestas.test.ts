import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { crearTokenBaja, hashEmail } from "@/lib/propuestas/supresion"

/**
 * T-01 (AC-1, AC-4, AC-5; RF-3): el middleware es la primera barrera del portal
 * `/propuestas`. Cubre la colision `/propuesta` (singular, publica) vs
 * `/propuestas` (plural, admin-only), la baja publica y las APIs internas.
 *
 * T-19 (AC-33, AC-34): el token real de baja contiene puntos y el matcher
 * generico excluye rutas con extension. Se verifica que el matcher explicito de
 * la baja cubra el token real y que los headers de `next.config.ts` no se
 * cacheen ni filtren el referrer.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  routePatterns: [] as string[][],
}))

// `next.config.ts` se envuelve con Sentry al importarse; en el test se usa la
// configuracion tal cual, sin inicializar el SDK ni tocar la red.
vi.mock("@sentry/nextjs/config", () => ({
  withSentryConfig: (config: unknown) => config,
}))

function patronARegExp(patron: string): RegExp {
  if (patron.endsWith("(.*)")) {
    const base = patron.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`^${base}(.*)$`)
  }
  return new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
}

/**
 * Emula lo justo de path-to-regexp que usa Next en `config.matcher`:
 * `:param*` cubre cero o mas segmentos. El resto del patron se toma literal.
 */
function matcherARegExp(patron: string): RegExp {
  const marca = "__PARAM_RESTO__"
  // `/:path*` incluye la barra: el segmento completo es opcional.
  const conMarca = patron.replace("/:path*", marca)
  const escapado = conMarca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const fuente = escapado.replace(marca, "(?:/.*)?")
  return new RegExp(`^${fuente}$`)
}

// Token real (mismo formato que produce T-19): `v1.<id>.<hmac email>.<firma>`.
// Los tres puntos son justamente lo que el matcher generico excluia.
const SECRETO_BAJA_T19 = "secreto-de-pruebas-t19-middleware-0123456789"
const HASH_BAJA_T19 = hashEmail("info@consultora-ejemplo.com", SECRETO_BAJA_T19)
const TOKEN_BAJA_T19 = crearTokenBaja(
  "pros_baja_1",
  HASH_BAJA_T19,
  SECRETO_BAJA_T19,
)

vi.mock("@clerk/nextjs/server", () => ({
  // El handler real queda envuelto por clerkMiddleware; en el test lo exponemos
  // directamente para poder invocarlo con un auth stub.
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (routes: string[]) => {
    mocks.routePatterns.push(routes)
    const patterns = routes.map(patronARegExp)
    return (req: { nextUrl: URL }) =>
      patterns.some((pattern) => pattern.test(req.nextUrl.pathname))
  },
  clerkClient: vi.fn(async () => ({ users: { getUser: mocks.getUser } })),
}))

import middleware, { config as middlewareConfig } from "@/middleware"
import nextConfig from "../../next.config"

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

function conRol(role: string) {
  mocks.getUser.mockResolvedValue({
    id: "user_1",
    publicMetadata: { role },
  })
}

function patronesDe(...incluye: string[]): string[] {
  return (
    mocks.routePatterns.find((rutas) =>
      incluye.every((patron) => rutas.includes(patron)),
    ) ?? []
  )
}

describe("middleware del portal /propuestas (T-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("declara /propuesta exacto y no matchea /propuestas (AC-4)", () => {
    const publicas = patronesDe("/propuesta", "/propuesta/(.*)")

    expect(publicas).not.toContain("/propuesta(.*)")
    expect(publicas).toEqual(
      expect.arrayContaining([
        "/propuesta",
        "/propuesta/(.*)",
        "/propuestas/baja",
        "/propuestas/baja/(.*)",
        "/api/opt-out",
      ]),
    )

    const coincide = (ruta: string) =>
      publicas.some((patron) => patronARegExp(patron).test(ruta))

    expect(coincide("/propuesta")).toBe(true)
    expect(coincide("/propuesta/servicios")).toBe(true)
    expect(coincide("/propuestax")).toBe(false)
    expect(coincide("/propuestas")).toBe(false)
    expect(coincide("/propuestas/buscar")).toBe(false)
  })

  it("protege /propuestas y /api/propuestas en el matcher admin (AC-1)", () => {
    expect(patronesDe("/propuestas", "/propuestas/(.*)")).toEqual(
      expect.arrayContaining([
        "/admin(.*)",
        "/propuestas",
        "/propuestas/(.*)",
      ]),
    )
    expect(patronesDe("/api/propuestas(.*)")).toContain("/api/propuestas(.*)")
  })

  it("mantiene /propuesta y sus subrutas publicas sin consultar Clerk (AC-4)", async () => {
    for (const ruta of ["/propuesta", "/propuesta/servicios"]) {
      const res = await handler(sesion(null), request(ruta))

      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("manda /propuestas y sus subrutas al gate sin sesion (AC-1, AC-4)", async () => {
    for (const ruta of [
      "/propuestas",
      "/propuestas/buscar",
      "/propuestas/campanas/campana_1",
    ]) {
      const res = await handler(sesion(null), request(ruta))
      const rewrite = res.headers.get("x-middleware-rewrite")

      expect(rewrite, ruta).toContain("/gate/admin")
      expect(rewrite, ruta).toContain("next=%2Fpropuestas")
      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("redirige a la asistente fuera del portal (AC-2)", async () => {
    conRol("asistente")

    for (const ruta of ["/propuestas", "/propuestas/bandeja"]) {
      const res = await handler(sesion("user_asistente"), request(ruta))

      expect(res.status, ruta).toBe(307)
      expect(locationDe(res), ruta).toBe(
        "https://pixelarch.dev/admin/cobros",
      )
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }
  })

  it("permite el portal al admin con headers noindex/no-store (AC-1, AC-5)", async () => {
    conRol("admin")

    for (const ruta of ["/propuestas", "/propuestas/buscar"]) {
      const res = await handler(sesion("user_admin"), request(ruta))

      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }
  })

  it("deja publica la baja por token aunque /propuestas sea admin (AC-33)", async () => {
    for (const ruta of ["/propuestas/baja", "/propuestas/baja/token_opaco"]) {
      const res = await handler(sesion(null), request(ruta))

      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("cubre la baja con token real (con puntos) sin gate y con noindex/no-store (T-19, AC-33, AC-34)", async () => {
    // El fixture tiene el formato real; si dejara de tener puntos, el test no
    // probaria el caso que rompia el matcher generico.
    expect(TOKEN_BAJA_T19).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/,
    )
    expect(TOKEN_BAJA_T19.split(".")).toHaveLength(4)

    // La ruta entra por el matcher explicito de T-19 (el generico excluye
    // cualquier ruta con un punto, como el token).
    expect(middlewareConfig.matcher).toContain("/propuestas/baja/:path*")
    const ruta = `/propuestas/baja/${TOKEN_BAJA_T19}`
    expect(matcherARegExp("/propuestas/baja/:path*").test(ruta)).toBe(true)

    const res = await handler(sesion(null), request(ruta))

    expect(locationDe(res)).toBeNull()
    expect(res.headers.get("x-middleware-rewrite")).toBeNull()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("deja publico /api/opt-out con y sin token real en query, sin Clerk (AC-34, T-19)", async () => {
    for (const ruta of [
      "/api/opt-out",
      `/api/opt-out?token=${TOKEN_BAJA_T19}`,
    ]) {
      const res = await handler(sesion(null), request(ruta))

      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("responde 401 JSON en /api/propuestas sin sesion (AC-1, AC-5)", async () => {
    // La raiz del prefijo tambien queda protegida, no solo las subrutas.
    for (const ruta of ["/api/propuestas", "/api/propuestas/campanas"]) {
      const res = await handler(sesion(null), request(ruta))

      expect(res.status, ruta).toBe(401)
      expect(await res.json(), ruta).toEqual({ error: "No autorizado" })
      expect(locationDe(res), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
      expect(res.headers.get("x-robots-tag"), ruta).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control"), ruta).toBe("no-store")
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("responde 403 JSON en /api/propuestas para la asistente (AC-2)", async () => {
    conRol("asistente")

    const res = await handler(
      sesion("user_asistente"),
      request("/api/propuestas/campanas"),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Prohibido" })
    expect(locationDe(res)).toBeNull()
    expect(res.headers.get("x-middleware-rewrite")).toBeNull()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("redirige a un usuario autenticado sin rol staff fuera del portal (AC-2)", async () => {
    conRol("user")

    const res = await handler(sesion("user_sin_rol"), request("/propuestas"))

    expect(res.status).toBe(307)
    expect(locationDe(res)).toBe("https://pixelarch.dev/")
    expect(res.headers.get("x-middleware-rewrite")).toBeNull()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("deja pasar al admin por /api/propuestas con headers (AC-1, AC-5)", async () => {
    conRol("admin")

    const res = await handler(
      sesion("user_admin"),
      request("/api/propuestas/campanas"),
    )

    expect(res.status).toBe(200)
    expect(locationDe(res)).toBeNull()
    expect(res.headers.get("x-middleware-rewrite")).toBeNull()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})

/* ------------------------------------------------------------------ */
/* T-19 (AC-33, AC-34): headers de la baja publica en next.config      */
/* ------------------------------------------------------------------ */

describe("next.config: headers de la baja publica (T-19, AC-33, AC-34)", () => {
  it("fuerza no-referrer, noindex y no-store despues de la entrada global", async () => {
    const headers = nextConfig.headers
    if (!headers) throw new Error("next.config.ts no define headers()")

    const entradas = await headers()
    const indiceGlobal = entradas.findIndex(
      (entrada) => entrada.source === "/(.*)",
    )
    expect(indiceGlobal).toBeGreaterThanOrEqual(0)

    const global = new Map(
      entradas[indiceGlobal].headers.map((header) => [
        header.key.toLowerCase(),
        header.value,
      ]),
    )
    // La entrada global es la que se debe pisar; si dejara de existir, el test
    // de orden perderia sentido.
    expect(global.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    )

    for (const fuente of ["/propuestas/baja/:path*", "/api/opt-out"]) {
      const indice = entradas.findIndex((entrada) => entrada.source === fuente)
      expect(indice, fuente).toBeGreaterThan(indiceGlobal)

      const especificos = new Map(
        entradas[indice].headers.map((header) => [
          header.key.toLowerCase(),
          header.value,
        ]),
      )
      expect(especificos.get("referrer-policy"), fuente).toBe("no-referrer")
      expect(especificos.get("x-robots-tag"), fuente).toBe(
        "noindex, nofollow",
      )
      expect(especificos.get("cache-control"), fuente).toBe("no-store")
    }
  })

  it("el source de la baja cubre el token real con puntos", () => {
    const baja = matcherARegExp("/propuestas/baja/:path*")

    expect(baja.test("/propuestas/baja")).toBe(true)
    expect(baja.test(`/propuestas/baja/${TOKEN_BAJA_T19}`)).toBe(true)
    expect(baja.test("/propuestas/baja/v1.incompleto")).toBe(true)
    expect(baja.test("/propuestas/buscar")).toBe(false)
  })
})
