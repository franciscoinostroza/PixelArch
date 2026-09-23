import type { Metadata } from "next"
import { AuditTool } from "@/components/sections/audit-tool"

export const metadata: Metadata = {
  title: "Auditoría web gratis — PixelArch",
  description: "Auditá tu sitio en segundos: velocidad, SSL, SEO y seguridad. Diagnóstico real, sin registro. Después, si querés, te lo ampliamos sin cargo.",
  alternates: { canonical: "/auditoria" },
}

export default function AuditoriaPage() {
  return (
    <section className="auditoria" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "4%" }} aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "320px", height: "320px", left: "-110px", bottom: "12%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "660px", marginBottom: "44px" }}>
          <p className="eyebrow">Auditoría web gratis</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            ¿Cómo está tu web, de verdad?
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.75 }}>
            Pegá la URL y en segundos vas a ver la velocidad, el SSL, el SEO y la seguridad de tu sitio — chequeos reales, sin registro.
          </p>
        </div>

        <AuditTool />

        <div className="audit-cards">
          <article className="audit-card">
            <span className="audit-line" aria-hidden="true" />
            <h3>Demo de lo que hacemos</h3>
            <p>Esta herramienta hace lo mismo que nuestra auditoría gratis: muestra con datos, no promete. Lo que ves acá es la primera capa.</p>
          </article>
          <article className="audit-card">
            <span className="audit-line" aria-hidden="true" />
            <h3>La auditoría completa</h3>
            <p>Después del diagnóstico automático, revisamos a mano conversión, contenido, accesibilidad y arquitectura — y te damos un plan de mejoras priorizado.</p>
          </article>
          <article className="audit-card">
            <span className="audit-line" aria-hidden="true" />
            <h3>Sin cargo y sin compromiso</h3>
            <p>La auditoría exprés es gratis. Si después querés que implementemos las mejoras, te pasamos un presupuesto claro. Si no, te quedás con el diagnóstico.</p>
          </article>
        </div>

        <p className="audit-note">
          Límite: hasta 8 auditorías por hora por visitante. Solo auditamos sitios públicos — no direcciones internas ni privadas.
        </p>
      </div>

      <style>{`
        .audit-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 34px;
        }
        .audit-card {
          position: relative;
          background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 18px;
          padding: 24px 26px;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s;
        }
        .audit-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.4) }
        .audit-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .audit-card h3 { font-size: 0.98rem; margin-bottom: 9px }
        .audit-card p { color: var(--color-text-dim); font-size: 0.86rem; line-height: 1.7 }
        .audit-note {
          margin-top: 28px;
          font-family: var(--font-mono);
          font-size: 0.66rem;
          color: var(--color-text-faint);
          line-height: 1.7;
        }
        @media (max-width: 980px) { .audit-cards { grid-template-columns: 1fr } }
      `}</style>
    </section>
  )
}