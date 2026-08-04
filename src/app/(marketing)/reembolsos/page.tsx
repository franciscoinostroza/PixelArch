import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Reembolsos | PixelArch",
  description: "Política de reembolsos de PixelArch",
  alternates: { canonical: "/reembolsos" },
}

const sections = [
  { num: "01", title: "Pagos Únicos", text: "Los pagos únicos por desarrollo de proyectos no son reembolsables una vez que el trabajo ha comenzado, salvo que PixelArch no pueda cumplir con los términos acordados. Si el proyecto no ha iniciado, se puede solicitar un reembolso completo dentro de los 7 días posteriores al pago." },
  { num: "02", title: "Planes Mensuales", text: "Las suscripciones mensuales (Básico y Mantenimiento) se pueden cancelar en cualquier momento. El servicio continúa hasta el final del período facturado. No se realizan reembolsos parciales por tiempo no utilizado del período en curso." },
  { num: "03", title: "Cancelación por parte de PixelArch", text: "En caso de que PixelArch cancele un servicio por incumplimiento de los términos, no se realizará reembolso del período en curso." },
  { num: "04", title: "Proceso de Reembolso", text: "Para solicitar un reembolso, contactanos a través de nuestro formulario de contacto o enviando un correo a hola@pixelarch.dev. Procesaremos tu solicitud dentro de los 10 días hábiles posteriores a su aprobación." },
  { num: "05", title: "Excepciones", text: "Los reembolsos pueden no aplicarse en casos de violación de los términos del servicio, uso indebido de la plataforma, o cuando el servicio haya sido entregado en su totalidad según lo acordado." },
]

export default function ReembolsosPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Reembolsos" }]} />
        <div className="rounded-xl border border-border/50 p-8 md:p-10 relative overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(139,92,246,0.03), transparent)" }}>
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet/30 to-cyan/20" />
          <div className="section-head" style={{ marginBottom: "40px" }}>
            <p className="eyebrow">Legal</p>
            <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "8px" }}>Política de Reembolsos</h2>
            <p style={{ color: "var(--color-text-dim)", fontSize: ".82rem" }}>Última actualización: Junio 2026</p>
          </div>

          <div className="space-y-10">
            {sections.map((s) => (
              <div key={s.num} className="flex gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-mono text-[.7rem] font-semibold text-cyan" style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.15)" }}>{s.num}</div>
                <div className="pt-1.5">
                  <h3 className="font-display text-[.95rem] font-semibold text-text mb-2">{s.title}</h3>
                  <p className="text-text-dim text-[.88rem] leading-relaxed">{s.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-8 border-t border-border/40 text-center">
            <p className="font-mono text-[.7rem] text-text-faint">Contacto: <a href="mailto:hola@pixelarch.dev" className="text-violet hover:underline">hola@pixelarch.dev</a></p>
          </div>
        </div>
      </div>
    </section>
  )
}
