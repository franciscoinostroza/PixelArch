import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const isAdminRoute = createRouteMatcher(["/admin(.*)"])
const isClientRoute = createRouteMatcher(["/portal(.*)"])
const isPublicRoute = createRouteMatcher([
  "/",
  "/servicios(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/gracias",
])

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role

  if (isPublicRoute(req)) return NextResponse.next()
  if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url))
  if (isAdminRoute(req) && role !== "admin")
    return NextResponse.redirect(new URL("/portal", req.url))
  if (isClientRoute(req)) return NextResponse.next()

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
}
