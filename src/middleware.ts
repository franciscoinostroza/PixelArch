import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const ROUTES = {
  public: ["/", "/productos(.*)", "/blog(.*)", "/nosotros(.*)", "/faq(.*)", "/precios(.*)", "/proyectos(.*)", "/estado(.*)", "/auditoria(.*)", "/calculadora(.*)", "/gate(.*)", "/sign-in(.*)", "/gracias", "/terminos", "/privacidad", "/reembolsos", "/studio(.*)", "/propuesta(.*)", "/logo"],
  admin: ["/admin(.*)"],
}

const isPublic = createRouteMatcher(ROUTES.public)
const isAdmin = createRouteMatcher(ROUTES.admin)

function redirect(url: string, req: Request) {
  return NextResponse.redirect(new URL(url, req.url))
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()

  if (isPublic(req)) return NextResponse.next()

  if (isAdmin(req)) {
    if (!userId) {
      const next = encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)
      return NextResponse.rewrite(new URL(`/gate/admin?next=${next}`, req.url))
    }

    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const role = (user.publicMetadata as { role?: string })?.role
    if (role !== "admin") return redirect("/", req)
    return NextResponse.next()
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!.*\\..*|_next|api/webhooks|api/revalidate|api/cron|api/contact|api/health|api/reviews|api/audit|api/newsletter).*)", "/", "/(api/(?!webhooks|revalidate|cron|contact|health|reviews|audit|newsletter)|trpc)(.*)"],
}