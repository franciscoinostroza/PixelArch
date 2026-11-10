import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { esRolStaff, esRutaAdminPermitida, rutaInicioRol } from "@/lib/roles"

const ROUTES = {
  public: [
    "/",
    "/productos(.*)",
    "/blog(.*)",
    "/nosotros(.*)",
    "/faq(.*)",
    "/precios(.*)",
    "/proyectos(.*)",
    "/estado(.*)",
    "/auditoria(.*)",
    "/calculadora(.*)",
    "/pago",
    "/pago/(.*)",
    "/gate(.*)",
    "/sign-in(.*)",
    "/gracias",
    "/terminos",
    "/privacidad",
    "/reembolsos",
    "/studio(.*)",
    // `/propuesta` (singular) es la pagina publica existente. Se declara exacta
    // para que no abra `/propuestas` (plural), que es el portal admin-only.
    "/propuesta",
    "/propuesta/(.*)",
    "/logo",
    // Unica excepcion publica dentro del portal: la baja por token.
    "/propuestas/baja",
    "/propuestas/baja/(.*)",
    "/api/opt-out",
  ],
  admin: ["/admin(.*)", "/propuestas", "/propuestas/(.*)"],
  apiAdmin: ["/api/propuestas(.*)"],
  portal: ["/propuestas", "/propuestas/(.*)", "/api/propuestas(.*)", "/api/opt-out"],
}

const isPublic = createRouteMatcher(ROUTES.public)
const isAdmin = createRouteMatcher(ROUTES.admin)
const isApiAdmin = createRouteMatcher(ROUTES.apiAdmin)
const isPortal = createRouteMatcher(ROUTES.portal)

function redirect(url: string, req: Request) {
  return NextResponse.redirect(new URL(url, req.url))
}

function conHeadersPortal(req: NextRequest, res: NextResponse): NextResponse {
  if (!isPortal(req)) return res
  res.headers.set("X-Robots-Tag", "noindex, nofollow")
  res.headers.set("Cache-Control", "no-store")
  return res
}

async function obtenerRol(userId: string): Promise<unknown> {
  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  return (user.publicMetadata as { role?: unknown })?.role
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()

  // Orden: public -> apiAdmin -> admin -> next. La baja publica y `/api/opt-out`
  // se evaluan primero, asi que quedan fuera de la proteccion admin.
  if (isPublic(req)) return conHeadersPortal(req, NextResponse.next())

  if (isApiAdmin(req)) {
    // Las APIs del portal no usan el rewrite del gate: responden JSON 401/403.
    if (!userId) {
      return conHeadersPortal(
        req,
        NextResponse.json({ error: "No autorizado" }, { status: 401 }),
      )
    }

    const role = await obtenerRol(userId)
    if (role !== "admin") {
      return conHeadersPortal(
        req,
        NextResponse.json({ error: "Prohibido" }, { status: 403 }),
      )
    }

    return conHeadersPortal(req, NextResponse.next())
  }

  if (isAdmin(req)) {
    if (!userId) {
      const next = encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)
      return conHeadersPortal(
        req,
        NextResponse.rewrite(new URL(`/gate/admin?next=${next}`, req.url)),
      )
    }

    const role = await obtenerRol(userId)
    if (!esRolStaff(role)) return conHeadersPortal(req, redirect("/", req))
    if (!esRutaAdminPermitida(role, req.nextUrl.pathname)) {
      return conHeadersPortal(req, redirect(rutaInicioRol(role), req))
    }
    return conHeadersPortal(req, NextResponse.next())
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!.*\\..*|_next|monitoring|api/webhooks|api/revalidate|api/cron|api/contact|api/health|api/reviews|api/audit|api/newsletter).*)", "/", "/(api/(?!webhooks|revalidate|cron|contact|health|reviews|audit|newsletter)|trpc)(.*)"],
}
