import type { Metadata } from "next"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CheckCircle } from "lucide-react"

export const metadata: Metadata = {
  title: "Gracias por contactarnos — PixelArch",
  description: "Hemos recibido tu mensaje. Te responderemos en las próximas 24 horas.",
  robots: { index: false },
  alternates: { canonical: "/gracias" },
}

export default function GraciasPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-6">
        <div className="rounded-xl border border-border bg-panel p-12 text-center" style={{ width: "100%" }}>
          <div className="flex items-center justify-center">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-text font-display md:text-4xl">
            Gracias por contactarnos
          </h1>
          <p className="mt-4 text-text-dim font-mono">
            Hemos recibido tu mensaje. Te responderemos en las próximas 24 horas.
          </p>
          <Link href="/" className={cn(buttonVariants(), "mt-8")}>
            Volver al inicio
          </Link>
        </div>
      </div>
    </section>
  )
}
