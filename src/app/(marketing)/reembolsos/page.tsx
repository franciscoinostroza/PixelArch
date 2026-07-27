import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Reembolsos | PixelArch",
  description: "Política de reembolsos de PixelArch",
  alternates: { canonical: "/reembolsos" },
}

export default function ReembolsosPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Reembolsos" }]} />
        <div className="rounded-xl border border-border bg-panel p-8 md:p-10">
          <h1 className="text-3xl font-bold text-text font-display md:text-4xl">Política de Reembolsos</h1>
          <p className="mt-2 text-xs text-text-dim">Última actualización: Junio 2026</p>

          <div className="mt-10 space-y-6 text-sm text-text/80 leading-relaxed">
            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">1. Pagos Únicos</h2>
              <p>Los pagos únicos por desarrollo de proyectos no son reembolsables una vez que el trabajo ha comenzado, salvo que PixelArch no pueda cumplir con los términos acordados. Si el proyecto no ha iniciado, se puede solicitar un reembolso completo dentro de los 7 días posteriores al pago.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">2. Planes Mensuales</h2>
              <p>Las suscripciones mensuales (Básico y Mantenimiento) se pueden cancelar en cualquier momento. El servicio continúa hasta el final del período facturado. No se realizan reembolsos parciales por tiempo no utilizado del período en curso.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">3. Cancelación por parte de PixelArch</h2>
              <p>En caso de que PixelArch cancele un servicio por incumplimiento de los términos, no se realizará reembolso del período en curso.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">4. Proceso de Reembolso</h2>
              <p>Para solicitar un reembolso, contactanos a través de nuestro formulario de contacto o enviando un correo a contacto@pixelarch.dev. Procesaremos tu solicitud dentro de los 10 días hábiles posteriores a su aprobación.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">5. Excepciones</h2>
              <p>Los reembolsos pueden no aplicarse en casos de violación de los términos del servicio, uso indebido de la plataforma, o cuando el servicio haya sido entregado en su totalidad según lo acordado.</p>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}
