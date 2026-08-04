import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Privacidad | PixelArch",
  description: "Política de privacidad de PixelArch",
  alternates: { canonical: "/privacidad" },
}

const sections = [
  { num: "01", title: "Información que Recopilamos", text: "Recopilamos información que nos proporcionas directamente, como tu nombre, dirección de email, empresa y mensaje a través de nuestro formulario de contacto. También recopilamos información de pago a través de nuestro procesador de pagos." },
  { num: "02", title: "Uso de la Información", text: "Utilizamos tu información para: proveer y mantener nuestros servicios, comunicarnos contigo sobre tu proyecto o consulta, procesar pagos, mejorar nuestros servicios, y cumplir con obligaciones legales." },
  { num: "03", title: "Protección de Datos", text: "Implementamos medidas de seguridad técnicas y organizativas para proteger tu información personal contra acceso no autorizado, alteración, divulgación o destrucción." },
  { num: "04", title: "Compartición de Datos", text: "No vendemos tu información personal a terceros. Compartimos datos solo con proveedores de servicios esenciales (procesamiento de pagos, hosting, envío de emails) que están sujetos a acuerdos de confidencialidad." },
  { num: "05", title: "Tus Derechos", text: "Tienes derecho a acceder, corregir o eliminar tu información personal. Puedes ejercer estos derechos contactándonos a través de nuestro formulario de contacto o email." },
  { num: "06", title: "Cookies", text: "Utilizamos cookies esenciales para el funcionamiento del sitio. No utilizamos cookies de rastreo o publicitarias sin tu consentimiento explícito." },
  { num: "07", title: "Contacto", text: "Para consultas sobre esta política de privacidad, contactanos a través de nuestro formulario de contacto o enviando un correo a hola@pixelarch.dev." },
]

export default function PrivacidadPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "380px", height: "380px", right: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Privacidad" }]} />
        <div className="rounded-xl border border-border/50 p-8 md:p-10 relative overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(34,211,238,0.03), transparent)" }}>
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan/30 to-violet/20" />
          <div className="section-head" style={{ marginBottom: "40px" }}>
            <p className="eyebrow">Legal</p>
            <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "8px" }}>Política de Privacidad</h2>
            <p style={{ color: "var(--color-text-dim)", fontSize: ".82rem" }}>Última actualización: Junio 2026</p>
          </div>

          <div className="space-y-10">
            {sections.map((s) => (
              <div key={s.num} className="flex gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-mono text-[.7rem] font-semibold text-cyan" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.15)" }}>{s.num}</div>
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
