import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "PixelArch — Propuesta de Servicios",
  description: "Desarrollo web, chatbots inteligentes y agentes de IA. Metodología y precisión técnica.",
  robots: { index: false },
}

const steps = [
  { num: "01", title: "Consultoría inicial", desc: "Analizamos tu negocio y definimos la solución ideal. Sin costo. Nos adentramos en tus objetivos comerciales para determinar qué tecnologías (automatizaciones, IA, o desarrollo web) tendrán el mayor impacto." },
  { num: "02", title: "Diseño y propuesta", desc: "Entregamos un plan detallado con el alcance del proyecto, el stack tecnológico seleccionado (React, Next.js, bases de datos), cronograma de tiempos y presupuesto transparente." },
  { num: "03", title: "Desarrollo", desc: "Construimos tu solución con código limpio y escalable. Implementamos pruebas rigurosas e integración continua (CI/CD) para asegurar una base sólida y libre de fallos." },
  { num: "04", title: "Revisión y ajustes", desc: "Probamos cada flujo y funcionalidad, ajustando el diseño responsive, la velocidad de carga (WPO) y la experiencia de usuario (UX) hasta que el producto quede absolutamente perfecto." },
  { num: "05", title: "Lanzamiento y soporte", desc: "Realizamos el paso a producción de forma segura. Brindamos soporte continuo para asegurar que tu plataforma o automatización crezca y se adapte a las nuevas necesidades del mercado." },
]

const servicios = [
  { title: "Sitios Web", desc: "Plataformas de alta conversión, optimizadas para SEO y velocidad.", tags: ["Next.js", "SEO", "Core Web Vitals"], icon: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 9l2 2-2 2"/><path d="M13 13h4"/></svg>' },
  { title: "Automatización & IA", desc: "Agentes inteligentes que eliminan tareas repetitivas y escalan tu negocio.", tags: ["LangChain", "RAG", "Workflows"], icon: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M19 15l1 2.5L22.5 18.5 20 19.5 19 22 18 19.5 15.5 18.5 18 17.5z"/></svg>' },
  { title: "Apps y E-commerce", desc: "Aplicaciones a medida y tiendas online con pasarela de pagos.", tags: ["React Native", "Stripe", "Inventario"], icon: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>' },
]

export default function PropuestaPage() {
  return (
    <div style={{ minHeight: "100svh", position: "relative", overflow: "hidden", paddingBottom: "60px" }}>
      {/* Ambient glows */}
      <div style={{ position: "absolute", width: "500px", height: "500px", left: "-150px", top: "-5%", borderRadius: "50%", filter: "blur(140px)", background: "rgba(139,92,246,0.18)", pointerEvents: "none", zIndex: 0 }} aria-hidden="true" />
      <div style={{ position: "absolute", width: "400px", height: "400px", right: "-100px", top: "30%", borderRadius: "50%", filter: "blur(140px)", background: "rgba(34,211,238,0.12)", pointerEvents: "none", zIndex: 0 }} aria-hidden="true" />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "900px", marginInline: "auto", paddingInline: "clamp(28px, 6vw, 56px)", paddingTop: "clamp(50px, 8vw, 90px)", textAlign: "center" }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "28px" }}>
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#propGrad)"/>
            <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#propGrad)" opacity=".5"/>
            <defs>
              <linearGradient id="propGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8b5cf6"/>
                <stop offset="1" stopColor="#22d3ee"/>
              </linearGradient>
            </defs>
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.4rem", position: "relative", display: "inline-block", paddingBottom: "4px", overflow: "hidden" }}>
            Pixel<span style={{ background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Arch</span>
            <span aria-hidden="true" style={{ position: "absolute", left: "-45%", bottom: 0, width: "45%", height: "2px", background: "linear-gradient(90deg,transparent,#22d3ee,#8b5cf6,transparent)", animation: "logo-scan 3.2s ease-in-out infinite", pointerEvents: "none" }} />
          </span>
        </div>

        {/* Tagline */}
        <p className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: "9px", marginBottom: "18px" }}>
          Desarrollo Web · Chatbots · Agentes IA
        </p>

        {/* Divider */}
        <div style={{ height: "2px", background: "linear-gradient(90deg,transparent,rgba(139,92,246,0.05),#8b5cf6,rgba(139,92,246,0.05),transparent)", boxShadow: "0 0 20px 1px rgba(139,92,246,0.45)", marginBottom: "40px" }} />

        {/* Title */}
        <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(2rem, 3.5vw, 2.8rem)", lineHeight: 1.2, marginBottom: "28px" }}>
          Metodología y{" "}
          <span style={{ background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Precisión Técnica</span>
        </h1>

        {/* Description */}
        <p style={{ color: "var(--color-text-dim)", fontSize: "1.05rem", lineHeight: 1.75, marginBottom: "52px", maxWidth: "65ch", marginInline: "auto", textAlign: "justify" }}>
          Con más de <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>10 años de experiencia</strong> en el ecosistema tecnológico, mi enfoque fusiona la arquitectura de software de alto rendimiento con una comprensión profunda del lenguaje, los datos y la interacción humana. Esto me permite crear ecosistemas digitales —desde plataformas web de alta conversión hasta agentes autónomos de IA— que no solo son robustos a nivel de código, sino que se comunican estratégicamente con tus usuarios. Integrando el <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>análisis de Big Data</strong> y técnicas avanzadas de <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>Prompt Engineering</strong>, garantizo que cada desarrollo esté diseñado para escalar la rentabilidad de tu negocio.
        </p>

        {/* Services */}
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "28px" }}>Nuestros Servicios</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", marginBottom: "52px", textAlign: "left" }}>
          {servicios.map((s, i) => (
            <div key={i} style={{
              background: "var(--color-panel)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px",
              padding: "28px 24px", position: "relative", overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px",
                background: i === 0 ? "linear-gradient(90deg,#8b5cf6,#22d3ee)" : i === 1 ? "linear-gradient(90deg,#22d3ee,#8b5cf6)" : "linear-gradient(90deg,#8b5cf6,#34d399)"
              }} />
              <div style={{
                width: "48px", height: "48px", borderRadius: "12px",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: i % 2 === 0 ? "rgba(139,92,246,0.14)" : "rgba(34,211,238,0.14)",
                color: i % 2 === 0 ? "#8b5cf6" : "#22d3ee",
                marginBottom: "20px", marginInline: "auto",
              }} dangerouslySetInnerHTML={{ __html: s.icon }} />
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1rem", fontWeight: 600, marginBottom: "8px", textAlign: "center" }}>{s.title}</h3>
              <p style={{ color: "var(--color-text-dim)", fontSize: ".85rem", lineHeight: 1.6, marginBottom: "16px", textAlign: "center" }}>{s.desc}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
                {s.tags.map((tag) => (
                  <span key={tag} style={{ fontFamily: "var(--font-mono)", fontSize: ".65rem", color: "var(--color-text-faint)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "100px", padding: "3px 9px" }}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Process */}
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "28px" }}>
          Nuestro Proceso
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "28px", marginBottom: "48px", textAlign: "left" }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: "24px", alignItems: "flex-start", maxWidth: "600px", marginInline: "auto", width: "100%" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0,
                border: "1.5px solid rgba(255,255,255,0.08)", background: "var(--color-bg-soft)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-mono)", fontSize: ".7rem", color: "var(--color-cyan)", fontWeight: 600,
              }}>
                {i + 1}
              </div>
              <div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: ".68rem", color: "var(--color-cyan)", display: "block", marginBottom: "4px", letterSpacing: ".08em" }}>
                  {step.num} · {step.title}
                </span>
                <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem", lineHeight: 1.65 }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ paddingTop: "32px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", fontWeight: 600, marginBottom: "12px" }}>
            Conocé más en{" "}
            <a href="https://pixelarch.dev" target="_blank" rel="noopener" style={{ background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textDecoration: "underline", textDecorationColor: "#8b5cf6", textUnderlineOffset: "4px" }}>
              pixelarch.dev
            </a>
          </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: ".7rem", color: "var(--color-text-faint)", letterSpacing: ".08em", marginBottom: "24px" }}>
            Visitá nuestras reseñas y conocé la experiencia de clientes reales
          </p>
          <a href="https://pixelarch.dev/#resenas" target="_blank" rel="noopener" style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
            color: "#07060c", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: ".88rem",
            padding: "14px 30px", borderRadius: "10px", textDecoration: "none",
          }}>
            Ver reseñas →
          </a>
        </div>

        {/* Footer */}
        <div style={{ marginTop: "48px", paddingTop: "24px", borderTop: "1px solid rgba(255,255,255,0.06)", fontFamily: "var(--font-mono)", fontSize: ".7rem", color: "var(--color-text-faint)" }}>
          © 2026 PixelArch. Todos los derechos reservados.
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          div[style*="grid-template-columns: repeat(3, 1fr)"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
