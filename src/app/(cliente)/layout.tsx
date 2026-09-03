import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PortalNav } from "@/components/ui/portal-nav"
import { PortalUserButton } from "@/components/ui/portal-user-button"
import SpaceCanvas from "@/components/layout/space-canvas"
import "./portal.css"

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  return (
    <div className="relative min-h-screen">
      <SpaceCanvas />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-40 top-[-10%] z-[1] h-[450px] w-[450px] rounded-full blur-[130px]"
        style={{ background: "rgba(139,92,246,0.20)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-40 bottom-[-10%] z-[1] h-[400px] w-[400px] rounded-full blur-[130px]"
        style={{ background: "rgba(34,211,238,0.13)" }}
      />

      <div className="relative z-10 p-shell">
        <header className="p-bar">
          <Link href="/" className="p-logo">
            <span className="p-mark" aria-hidden="true" />
            <span>Pixel<span style={{ color: "#8b5cf6" }}>Arch</span></span>
          </Link>
          <PortalNav />
          <PortalUserButton />
        </header>

        <main className="p-main">{children}</main>
      </div>
    </div>
  )
}
