import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import SpaceCanvas from "@/components/layout/space-canvas"
import SiteInteractivity from "@/components/layout/site-interactivity"
import { WhatsappButton } from "@/components/leads/whatsapp-button"
import { AuditModal } from "@/components/leads/audit-modal"

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SpaceCanvas />
      <div className="scroll-progress" id="scrollProgress" aria-hidden="true" />
      <div className="cursor-glow" id="cursorGlow" aria-hidden="true" />
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
      <SiteInteractivity />
      <WhatsappButton />
      <AuditModal />
    </>
  )
}
