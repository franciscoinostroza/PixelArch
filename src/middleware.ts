import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const ROUTES = {
  public: ["/", "/productos(.*)", "/sign-in(.*)", "/sign-up(.*)", "/gracias", "/terminos", "/privacidad", "/reembolsos", "/studio(.*)", "/propuesta(.*)"],
  admin: ["/admin(.*)"],
  client: ["/portal(.*)"],
}

const isPublic = createRouteMatcher(ROUTES.public)
const isAdmin = createRouteMatcher(ROUTES.admin)
const isClient = createRouteMatcher(ROUTES.client)

async function redirect(url: string, req: Request) {
  return NextResponse.redirect(new URL(url, req.url))
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()

  if (isPublic(req)) return NextResponse.next()
  if (!userId) return redirect("/sign-in", req)

  if (isAdmin(req)) {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const role = (user.publicMetadata as { role?: string })?.role
    if (role !== "admin") return redirect("/portal", req)
    return NextResponse.next()
  }

  if (isClient(req)) return NextResponse.next()
  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!.*\\..*|_next|api/webhooks|api/revalidate|api/cron|api/portal|api/contact|api/payments|api/health).*)", "/", "/(api/(?!webhooks|revalidate|cron|portal|contact|payments|health)|trpc)(.*)"],
}
