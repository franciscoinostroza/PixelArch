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
        <header className="sticky top-0 z-40 border-b border-white/[0.06] backdrop-blur-xl" style={{ background: "rgba(7,6,12,0.6)" }}>
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "9px" }}>
              <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
                <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#portalLogoGrad)"/>
                <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#portalLogoGrad)" opacity=".5"/>
                <defs>
                  <linearGradient id="portalLogoGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#8b5cf6"/>
                    <stop offset="1" stopColor="#22d3ee"/>
                  </linearGradient>
                </defs>
              </svg>
              <span className="font-display text-lg font-bold text-text" style={{ position: "relative", display: "inline-block", paddingBottom: "2px", overflow: "hidden" }}>
                Pixel<span className="text-violet">Arch</span>
                <span aria-hidden="true" style={{
                  position: "absolute", left: "-45%", bottom: 0, width: "45%", height: "2px",
                  background: "linear-gradient(90deg,transparent,#22d3ee,#8b5cf6,transparent)",
                  animation: "logo-scan 3.2s ease-in-out infinite",
                  pointerEvents: "none",
                }} />
              </span>
            </Link>
            <PortalNav />
            <PortalUserButton />
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
      </div>
    </div>
  )
}
