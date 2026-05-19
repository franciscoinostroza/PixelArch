import { auth, clerkClient } from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PortalNav } from "@/components/ui/portal-nav"
import { PortalUserButton } from "@/components/ui/portal-user-button"

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const nombre = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.emailAddresses[0]?.emailAddress
  const iniciales = nombre
    ? nombre.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "??"

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg2">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="font-display text-lg font-bold text-text"
          >
            Pixel<span className="text-accent">Arch</span>
          </Link>
          <PortalNav />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border/20 bg-card-bg px-3 py-1">
              <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent/20 font-display text-[11px] font-bold text-accent">
                {iniciales}
              </div>
              <span className="text-xs text-text">{nombre}</span>
            </div>
            <PortalUserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  )
}
