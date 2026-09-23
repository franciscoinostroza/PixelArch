import type { Metadata } from "next"
import { RoiCalculator } from "@/components/sections/roi-calculator"

export const metadata: Metadata = {
  title: "Calculadora de ahorro — PixelArch",
  description: "Calculá cuántas horas y cuánto dinero perdés por mes en tareas repetitivas, y cuánto recuperarías automatizándolas.",
  alternates: { canonical: "/calculadora" },
}

export default function CalculadoraPage() {
  return (
    <section className="calculadora" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "8%" }} aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "10%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "660px", marginBottom: "44px" }}>
          <p className="eyebrow">Calculadora</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            ¿Cuánto te cuestan las tareas repetitivas?
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.75 }}>
            Movés los controles y ves en el momento cuánto tiempo y dinero recuperarías automatizando. Sin registro, sin email.
          </p>
        </div>

        <RoiCalculator />

        <div className="calc-cards">
          <article className="calc-card">
            <span className="calc-line" aria-hidden="true" />
            <h3>¿De dónde sale el 70%?</h3>
            <p>Es la proporción de tareas repetitivas que típicamente se pueden automatizar sin perder control del negocio. Cada caso se mide en la auditoría.</p>
          </article>
          <article className="calc-card">
            <span className="calc-line" aria-hidden="true" />
            <h3>¿Cuánto cuesta automatizar?</h3>
            <p>Depende del alcance: cada automatización se cotiza por proyecto. Con el ahorro estimado, la inversión típica se recupera en 1 a 3 meses.</p>
          </article>
          <article className="calc-card">
            <span className="calc-line" aria-hidden="true" />
            <h3>¿Por dónde empiezo?</h3>
            <p>Con una sola tarea. Te ayudamos a elegir la que más horas devuelve por menos esfuerzo en una consulta sin cargo.</p>
          </article>
        </div>
      </div>

      <style>{`
        .calc-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 44px;
        }
        .calc-card {
          position: relative;
          background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 18px;
          padding: 24px 26px;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s;
        }
        .calc-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.4) }
        .calc-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .calc-card h3 { font-size: 0.98rem; margin-bottom: 9px }
        .calc-card p { color: var(--color-text-dim); font-size: 0.86rem; line-height: 1.7 }
        @media (max-width: 980px) { .calc-cards { grid-template-columns: 1fr } }
      `}</style>
    </section>
  )
}