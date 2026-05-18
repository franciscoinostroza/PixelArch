import { auth } from "@clerk/nextjs/server"
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

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg2">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/portal"
            className="font-display text-lg font-bold text-text"
          >
            PixelArch
          </Link>
          <PortalNav />
          <PortalUserButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
