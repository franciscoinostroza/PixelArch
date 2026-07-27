import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Privacidad | PixelArch",
  description: "Política de privacidad de PixelArch",
  alternates: { canonical: "/privacidad" },
}

export default function PrivacidadPage() {
  return (
    <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "380px", height: "380px", right: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Privacidad" }]} />
        <div className="rounded-xl border border-border bg-panel p-8 md:p-10">
          <h1 className="text-3xl font-bold text-text font-display md:text-4xl">Política de Privacidad</h1>
          <p className="mt-2 text-xs text-text-dim">Última actualización: Junio 2026</p>

          <div className="mt-10 space-y-6 text-sm text-text/80 leading-relaxed">
            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">1. Información que Recopilamos</h2>
              <p>Recopilamos información que nos proporcionas directamente, como tu nombre, dirección de email, empresa y mensaje a través de nuestro formulario de contacto. También recopilamos información de pago a través de nuestro procesador de pagos.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">2. Uso de la Información</h2>
              <p>Utilizamos tu información para: proveer y mantener nuestros servicios, comunicarnos contigo sobre tu proyecto o consulta, procesar pagos, mejorar nuestros servicios, y cumplir con obligaciones legales.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">3. Protección de Datos</h2>
              <p>Implementamos medidas de seguridad técnicas y organizativas para proteger tu información personal contra acceso no autorizado, alteración, divulgación o destrucción.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">4. Compartición de Datos</h2>
              <p>No vendemos tu información personal a terceros. Compartimos datos solo con proveedores de servicios esenciales (procesamiento de pagos, hosting, envío de emails) que están sujetos a acuerdos de confidencialidad.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">5. Tus Derechos</h2>
              <p>Tienes derecho a acceder, corregir o eliminar tu información personal. Puedes ejercer estos derechos contactándonos a través de nuestro formulario de contacto o email.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">6. Cookies</h2>
              <p>Utilizamos cookies esenciales para el funcionamiento del sitio. No utilizamos cookies de rastreo o publicitarias sin tu consentimiento explícito.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-text font-display">7. Contacto</h2>
              <p>Para consultas sobre esta política de privacidad, contactanos a través de nuestro formulario de contacto o enviando un correo a contacto@pixelarch.dev.</p>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}
