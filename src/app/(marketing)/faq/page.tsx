import type { Metadata } from "next"
import { FaqAccordion, type FaqCategory } from "@/components/ui/faq-accordion"
import { whatsappUrl } from "@/lib/contact"

export const metadata: Metadata = {
  title: "Preguntas frecuentes — PixelArch",
  description: "Pagos, planes, plazos, soporte y cancelación: todo lo que necesitás saber antes de contratar un servicio de PixelArch.",
  alternates: { canonical: "/faq" },
}

const CATEGORIES: FaqCategory[] = [
  {
    titulo: "Pagos",
    items: [
      {
        q: "¿En qué moneda me cobran?",
        a: "En USD a través de nuestra pasarela de pagos, con tarjeta internacional. En la web ves el equivalente en ARS según el dólar del día, que se actualiza automáticamente.",
      },
      {
        q: "¿Emiten factura o comprobante?",
        a: "Sí. Cada pago genera un comprobante automático que recibís por email. Desde tu portal de cliente podés descargar todo el historial de pagos cuando quieras.",
      },
      {
        q: "¿Qué pasa si falla el pago?",
        a: "El sistema reintenta automáticamente. Te avisamos por email y tenés 30 días para regularizar antes de que el servicio se pause. Nunca se corta de un día para el otro.",
      },
    ],
  },
  {
    titulo: "Planes y plazos",
    items: [
      {
        q: "¿Cuánto tarda un proyecto?",
        a: "Depende del alcance: una landing page entre 1 y 2 semanas, un sitio web completo entre 3 y 6 semanas, y un agente de IA entre 4 y 8 semanas. Al arrancar te damos un cronograma con fechas concretas.",
      },
      {
        q: "¿Qué incluye el plan mensual?",
        a: "Hosting, certificado SSL, monitoreo activo y soporte continuo. Es lo que mantiene tu servicio online y actualizado mes a mes.",
      },
      {
        q: "¿Qué pasa si no estoy conforme con el resultado?",
        a: "Trabajamos por hitos: revisás cada entrega antes de avanzar a la siguiente. Si en la entrega final algo no cumple lo acordado, lo corregimos sin cargo.",
      },
    ],
  },
  {
    titulo: "Soporte",
    items: [
      {
        q: "¿Cómo los contacto si tengo un problema?",
        a: "WhatsApp directo para urgencias y email para todo lo demás. Respondemos en menos de 24hs; las caídas de servicio se detectan por monitoreo y se atienden al instante.",
      },
      {
        q: "¿Hacen cambios después de entregar?",
        a: "Con el plan Mantenimiento tenés cambios mensuales incluidos. Con Básico, los cambios se cotizan aparte. Siempre te decimos el costo antes de hacerlos.",
      },
    ],
  },
  {
    titulo: "Cancelación",
    items: [
      {
        q: "¿Cómo cancelo la suscripción?",
        a: "Desde tu portal de cliente, con 7 días de aviso. Sin permanencia ni penalidades.",
      },
      {
        q: "¿Qué pasa con mi web si cancelo?",
        a: "Podés comprar el código fuente y llevarte todo. Sin un plan mensual el servicio deja de estar online, pero tu código y tus datos son tuyos.",
      },
    ],
  },
  {
    titulo: "Técnico",
    items: [
      {
        q: "¿Con qué tecnología trabajan?",
        a: "Next.js, React, TypeScript y PostgreSQL en desarrollo; Docker, CI/CD y monitoreo en infraestructura. Elegimos según el proyecto, no por moda.",
      },
      {
        q: "¿Puedo usar mi hosting actual?",
        a: "Se puede evaluar. Si tu hosting no cumple con los estándares de seguridad y monitoreo, te lo decimos con datos y proponemos alternativas.",
      },
    ],
  },
]

export default function FaqPage() {
  return (
    <section className="faq-page" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "5%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "640px", marginBottom: "46px" }}>
          <p className="eyebrow">Preguntas frecuentes</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)", marginBottom: "14px" }}>
            Todo lo que preguntan antes de contratar
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.7 }}>
            Pagos, plazos, soporte y cancelación — sin letra chica. Si tu duda no está acá, escribinos y la agregamos.
          </p>
        </div>

        <div style={{ maxWidth: "820px" }}>
          <FaqAccordion categories={CATEGORIES} />
        </div>

        <div className="faq-cta">
          <div>
            <h3>¿No encontraste tu respuesta?</h3>
            <p>Contanos tu caso y te respondemos en menos de 24hs.</p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Escribinos por WhatsApp <span className="btn-arrow" aria-hidden="true">→</span>
            </a>
            <a href="/#contacto" className="btn btn-ghost">Ir al formulario</a>
          </div>
        </div>
      </div>

      <style>{`
        .faq-cta {
          margin-top: 54px;
          max-width: 820px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          border: 1px solid rgba(139,92,246,0.3);
          border-radius: 16px;
          background: linear-gradient(160deg, rgba(139,92,246,0.09), rgba(34,211,238,0.05));
          padding: 26px 30px;
        }
        .faq-cta h3 { font-size: 1.1rem; margin-bottom: 6px }
        .faq-cta p { color: var(--color-text-dim); font-size: 0.88rem }
      `}</style>
    </section>
  )
}