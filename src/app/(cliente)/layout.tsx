import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PortalNav } from "@/components/ui/portal-nav"
import { PortalUserButton } from "@/components/ui/portal-user-button"
import SpaceCanvas from "@/components/layout/space-canvas"

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

      <div className="relative z-10">
        <header className="sticky top-4 z-40">
          <div className="mx-auto max-w-5xl px-4">
            <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] px-5 py-3 backdrop-blur-xl sm:px-6" style={{ background: "rgba(7,6,12,0.6)" }}>
              <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "9px" }}>
                <span className="block h-[20px] w-[20px] rounded-[6px]" style={{ background: "linear-gradient(135deg,#8b5cf6,#22d3ee)" }} aria-hidden="true" />
                <span className="font-display text-lg font-bold text-text">
                  Pixel<span className="text-violet">Arch</span>
                </span>
              </Link>
              <PortalNav />
              <PortalUserButton />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">{children}</main>
      </div>
    </div>
  )
}
