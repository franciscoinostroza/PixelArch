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
    <div className="min-h-screen bg-bg" style={{ position: "relative" }}>
      <section className="section--compact" style={{ position: "relative", zIndex: 1, overflow: "hidden", minHeight: "100svh" }}>
        <div className="section-divider section-divider--violet" aria-hidden="true" />
        <div className="section-band section-band--violet" aria-hidden="true" />
        <div className="section-glow section-glow--violet" style={{ width: "450px", height: "450px", left: "-100px", top: "-5%" }} aria-hidden="true" />
      <header className="border-b border-border bg-panel" style={{ position: "relative", zIndex: 2 }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border/20 bg-panel px-3 py-1">
              <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-violet/20 font-display text-[11px] font-bold text-violet">
                {iniciales}
              </div>
              <span className="text-xs text-text">{nombre}</span>
            </div>
            <PortalUserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10" style={{ position: "relative", zIndex: 1 }}>{children}</main>
      </section>
    </div>
  )
}
