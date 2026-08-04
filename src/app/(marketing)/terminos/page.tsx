import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Términos del Servicio | PixelArch",
  description: "Términos y condiciones del servicio de PixelArch",
  alternates: { canonical: "/terminos" },
}

const sections = [
  { num: "01", title: "Aceptación de los Términos", text: "Al acceder y utilizar los servicios de PixelArch, usted acepta estar sujeto a estos Términos del Servicio. Si no está de acuerdo con alguna parte, no debe utilizar nuestros servicios." },
  { num: "02", title: "Descripción del Servicio", text: "PixelArch ofrece servicios de desarrollo web, chatbots inteligentes, agentes de IA, landing pages, automatizaciones e integraciones. Los servicios se prestan de acuerdo con el plan contratado y las especificaciones acordadas al momento de la compra." },
  { num: "03", title: "Planes Mensuales y Hosting", text: "Los planes mensuales (Básico y Mantenimiento) incluyen el hosting del servicio como parte del valor. El plan Básico mantiene el servicio online y funcionando, sin cambios ni soporte. El plan Mantenimiento incluye además cambios mensuales y soporte prioritario. Si el cliente no renueva su plan mensual, el servicio se dará de baja a los 7 días posteriores al vencimiento del pago." },
  { num: "04", title: "Facturación y Pagos", text: "Los precios se especifican en cada plan y pueden ser de pago único o recurrente mensual. Los pagos recurrentes se facturarán al inicio de cada período. El cliente es responsable de mantener actualizada su información de pago." },
  { num: "05", title: "Responsabilidades del Cliente", text: "El cliente se compromete a proporcionar información precisa y actualizada, cumplir con todas las leyes aplicables, y no utilizar los servicios para actividades ilegales o no autorizadas." },
  { num: "06", title: "Cancelaciones y Reembolsos", text: "Las cancelaciones de suscripciones mensuales se procesan de inmediato y el servicio continúa hasta el final del período facturado. No se realizan reembolsos parciales por tiempo no utilizado, excepto cuando corresponda según nuestra Política de Reembolsos." },
  { num: "07", title: "Propiedad Intelectual", text: "El código y los activos desarrollados por PixelArch para proyectos de pago único se transfieren al cliente. PixelArch conserva el derecho de mostrar el trabajo en su portafolio, salvo acuerdo en contrario." },
  { num: "08", title: "Limitación de Responsabilidad", text: "PixelArch no será responsable por daños indirectos, incidentales o consecuentes derivados del uso o la imposibilidad de usar los servicios. La responsabilidad total se limita al monto pagado por el servicio en los últimos 12 meses." },
  { num: "09", title: "Modificaciones", text: "Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios serán notificados a través de nuestro sitio web. El uso continuado de los servicios después de las modificaciones constituye la aceptación de los nuevos términos." },
  { num: "10", title: "Contacto", text: "Para consultas sobre estos términos, puede contactarnos a través de nuestro formulario de contacto o enviando un correo a hola@pixelarch.dev." },
]

export default function TerminosPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Términos del Servicio" }]} />
        <div className="rounded-xl border border-border/50 p-8 md:p-10 relative overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(139,92,246,0.03), transparent)" }}>
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet/30 to-cyan/20" />
          <div className="section-head" style={{ marginBottom: "40px" }}>
            <p className="eyebrow">Legal</p>
            <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "8px" }}>Términos del Servicio</h2>
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
