import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const CLERK_ENABLED =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "" &&
  !!process.env.CLERK_SECRET_KEY &&
  process.env.CLERK_SECRET_KEY !== ""

async function getClerkHandler() {
  const { clerkMiddleware, createRouteMatcher } = await import(
    "@clerk/nextjs/server"
  )

  const isAdminRoute = createRouteMatcher(["/admin(.*)"])
  const isClientRoute = createRouteMatcher(["/portal(.*)"])
  const isPublicRoute = createRouteMatcher([
    "/",
    "/servicios(.*)",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/gracias",
    "/studio(.*)",
  ])

  return clerkMiddleware(async (auth, req) => {
    const { userId } = await auth()

    if (isPublicRoute(req)) return NextResponse.next()
    if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url"))
    if (isAdminRoute(req)) return NextResponse.next()
    if (isClientRoute(req)) return NextResponse.next()

    return NextResponse.next()
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clerkHandler: any = null
let clerkLoading = false

export default async function middleware(req: NextRequest) {
  if (!CLERK_ENABLED) return NextResponse.next()

  if (!clerkHandler && !clerkLoading) {
    clerkLoading = true
    clerkHandler = await getClerkHandler()
    clerkLoading = false
  }

  if (clerkHandler) return clerkHandler(req)
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*|_next|api/webhooks|api/revalidate|api/cron|api/portal|api/contact|api/payments).*)", "/", "/(api/(?!webhooks|revalidate|cron|portal|contact|payments)|trpc)(.*)"],
}
