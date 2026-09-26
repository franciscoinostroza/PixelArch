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
        a: "El cobro se realiza en USD. Si pagás en pesos (Mercado Pago o transferencia), se toma el dólar venta del día y en la web ves el equivalente estimado en ARS.",
      },
      {
        q: "¿Cómo se paga un proyecto?",
        a: "Los proyectos se cotizan a medida y se pagan por hitos acordados: anticipo, avances y entrega. Cada hito se puede pagar con link de Mercado Pago o transferencia.",
      },
      {
        q: "¿Emiten comprobante?",
        a: "Sí. Cada pago genera un recibo automático que te llega por email, con el detalle del hito o del mes de soporte.",
      },
    ],
  },
  {
    titulo: "Proyectos y plazos",
    items: [
      {
        q: "¿Cuánto tarda un proyecto?",
        a: "Depende del alcance: una landing page entre 1 y 2 semanas, un sitio web completo entre 3 y 6 semanas, y un agente de IA entre 4 y 8 semanas. Al arrancar te damos un cronograma con fechas concretas.",
      },
      {
        q: "¿Cómo se cotiza?",
        a: "Según el alcance. Nos contás el objetivo y armamos una propuesta con los hitos y sus montos. La cotización es sin cargo y sin compromiso.",
      },
      {
        q: "¿Qué incluye la entrega?",
        a: "El proyecto funcionando y el código fuente con todos los activos: tuyos. Además, documentación de lo que construimos para que no dependas de nadie.",
      },
    ],
  },
  {
    titulo: "Soporte",
    items: [
      {
        q: "¿Qué incluye el soporte básico?",
        a: "Hosting, certificado SSL, monitoreo activo y respuesta en menos de 24hs. Sin cambios de contenido.",
      },
      {
        q: "¿Qué agrega el soporte premium?",
        a: "Todo lo del básico, más cambios mensuales de contenido y soporte prioritario. Para que tu proyecto evolucione sin fricción.",
      },
      {
        q: "¿Cuándo se activa el soporte?",
        a: "Cuando arrancamos el proyecto. Es opcional: sin un soporte activo, el servicio hospedado puede darse de baja.",
      },
    ],
  },
  {
    titulo: "Cancelación",
    items: [
      {
        q: "¿Cómo cancelo el soporte?",
        a: "Cuando quieras, con 7 días de aviso. Sin permanencia ni penalidades.",
      },
      {
        q: "¿Qué pasa con mi proyecto si cancelo el soporte?",
        a: "El código y los activos son tuyos. El servicio hospedado deja de estar online; si querés, te ayudamos a migrarlo a tu propia infraestructura.",
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