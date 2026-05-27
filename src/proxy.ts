import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const isPublicRoute = createRouteMatcher([
  "/",
  "/servicios(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/gracias",
  "/studio(.*)",
])

const isAdminRoute = createRouteMatcher(["/admin(.*)"])
const isClientRoute = createRouteMatcher(["/portal(.*)"])

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()

  if (isPublicRoute(req)) return NextResponse.next()
  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url)
    return NextResponse.redirect(signInUrl)
  }

  if (isAdminRoute(req)) {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const role = (user.publicMetadata as { role?: string })?.role
    if (role !== "admin") {
      const portalUrl = new URL("/portal", req.url)
      return NextResponse.redirect(portalUrl)
    }
    return NextResponse.next()
  }

  if (isClientRoute(req)) return NextResponse.next()

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!.*\\..*|_next|api/webhooks|api/revalidate|api/cron|api/portal|api/contact|api/payments|api/health).*)", "/", "/(api/(?!webhooks|revalidate|cron|portal|contact|payments|health)|trpc)(.*)"],
}
