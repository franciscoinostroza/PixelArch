import type { Metadata } from "next"
import { whatsappUrl } from "@/lib/contact"

export const metadata: Metadata = {
  title: "Proyectos — PixelArch",
  description: "Resultados, no promesas: cómo construimos pixelarch.dev con Next.js, PostgreSQL e infraestructura monitoreada. Proyectos internos y método de trabajo.",
  alternates: { canonical: "/proyectos" },
}

const METRICAS = [
  { label: "Build", valor: "~78s", delta: "36 rutas · 0 errores TS" },
  { label: "Deploys", valor: "Auto", delta: "push → producción" },
  { label: "Modelos de datos", valor: "4", delta: "clientes, servicios, suscripciones, pagos" },
  { label: "Artículos", valor: "9", delta: "blog con SEO y RSS" },
]

const PROYECTOS = [
  {
    icono: "🏗️",
    titulo: "pixelarch.dev",
    meta: "Plataforma completa · 2026",
    desc: "Landing, catálogo de servicios, checkout, portal de clientes, panel de administración y blog — todo en un solo sistema.",
  },
  {
    icono: "🤖",
    titulo: "PixelBot — demo",
    meta: "Atención automatizada · 2026",
    desc: "El bot de atención que vive en este sitio: responde consultas frecuentes y deriva a WhatsApp. Demo funcional de lo que vendemos.",
  },
  {
    icono: "🔐",
    titulo: "Sistema de suscripciones",
    meta: "Cobros y facturación · 2026",
    desc: "Cobros recurrentes, historial de pagos, cortes automáticos por mora, emails transaccionales y portal de autogestión.",
  },
]

const STACK = ["Next.js 16", "React", "TypeScript", "PostgreSQL", "Prisma", "Tailwind v4", "Clerk", "Polar", "Sanity", "Docker", "Railway", "Sentry"]

export default function ProyectosPage() {
  return (
    <section className="proyectos" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "6%" }} aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "14%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "680px", marginBottom: "50px" }}>
          <p className="eyebrow">Proyectos</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            Resultados, no promesas
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.75 }}>
            Mientras sumamos casos de clientes, acá está el nuestro: esta misma plataforma es el primer proyecto que construimos con esta metodología — y el más exigente.
          </p>
        </div>

        <div className="case">
          <span className="case-line" aria-hidden="true" />
          <div className="case-head">
            <div>
              <span className="case-badge">Caso destacado</span>
              <h2>Cómo construimos pixelarch.dev</h2>
              <p className="case-sub">Una plataforma que vende, cobra, gestiona suscripciones, publica contenido y se monitorea sola — sin depender de un equipo grande.</p>
            </div>
          </div>

          <div className="case-metrics">
            {METRICAS.map((m) => (
              <div key={m.label} className="case-metric">
                <span className="case-metric-label">{m.label}</span>
                <span className="case-metric-value">{m.valor}</span>
                <span className="case-metric-delta">{m.delta}</span>
              </div>
            ))}
          </div>

          <div className="case-grid">
            <div className="case-block">
              <h3>El desafío</h3>
              <p>Vender servicios con suscripciones, gestionar clientes, cobrar en distintas monedas, publicar contenido con SEO y mantener la infraestructura monitoreada — todo operable por una persona, sin perder calidad.</p>
            </div>
            <div className="case-block">
              <h3>La solución</h3>
              <p>Next.js 16 + PostgreSQL + Clerk + Polar + Sanity, con Docker y deploys automáticos desde GitHub. Cada pieza integrada con webhooks, emails transaccionales, cron de mantenimiento y health checks.</p>
            </div>
          </div>

          <div className="case-stack">
            {STACK.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>

        <h2 className="proyectos-sub">Proyectos internos</h2>
        <div className="proyectos-grid">
          {PROYECTOS.map((p) => (
            <article key={p.titulo} className="proyecto-card">
              <span className="proyecto-line" aria-hidden="true" />
              <div className="proyecto-icon" aria-hidden="true">{p.icono}</div>
              <span className="proyecto-meta">{p.meta}</span>
              <h3>{p.titulo}</h3>
              <p>{p.desc}</p>
            </article>
          ))}
        </div>

        <div className="proyectos-cta">
          <div>
            <h3>¿Querés algo así para tu negocio?</h3>
            <p>Contanos tu proyecto y te respondemos en menos de 24hs con un plan concreto.</p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a href="/#contacto" className="btn btn-primary">Hablemos de tu proyecto <span className="btn-arrow" aria-hidden="true">→</span></a>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">WhatsApp directo</a>
          </div>
        </div>
      </div>

      <style>{`
        .case {
          position: relative;
          background: linear-gradient(160deg, rgba(139,92,246,0.08), #110e1a 45%, #141020 100%);
          border: 1px solid rgba(139,92,246,0.35);
          border-radius: 20px;
          padding: 38px 40px 34px;
          overflow: hidden;
        }
        .case-line {
          position: absolute;
          top: 0;
          left: 26px;
          right: 26px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .case-badge {
          display: inline-block;
          font-family: var(--font-mono);
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-weight: 600;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          padding: 4px 12px;
          border-radius: 999px;
          margin-bottom: 16px;
        }
        .case-head h2 { font-size: clamp(1.4rem, 2.6vw, 1.9rem); margin-bottom: 12px }
        .case-sub { color: var(--color-text-dim); font-size: 0.98rem; line-height: 1.7; max-width: 62ch }
        .case-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin: 30px 0;
        }
        .case-metric {
          background: rgba(7,6,12,0.5);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          padding: 18px;
        }
        .case-metric-label {
          font-family: var(--font-mono);
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          display: block;
          margin-bottom: 8px;
        }
        .case-metric-value { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; display: block }
        .case-metric-delta { font-family: var(--font-mono); font-size: 0.64rem; color: var(--color-cyan); display: block; margin-top: 5px; line-height: 1.5 }
        .case-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 26px }
        .case-block {
          background: rgba(7,6,12,0.4);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          padding: 22px;
        }
        .case-block h3 { font-size: 1rem; margin-bottom: 10px }
        .case-block p { color: var(--color-text-dim); font-size: 0.88rem; line-height: 1.75 }
        .case-stack { display: flex; flex-wrap: wrap; gap: 9px }
        .case-stack span {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-dim);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          padding: 6px 13px;
        }

        .proyectos-sub {
          font-family: var(--font-pixel-display);
          font-size: 1.4rem;
          font-weight: 700;
          margin: 56px 0 20px;
        }
        .proyectos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px }
        .proyecto-card {
          position: relative;
          background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 18px;
          padding: 26px;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s, box-shadow 0.35s;
        }
        .proyecto-card:hover {
          transform: translateY(-5px);
          border-color: rgba(139,92,246,0.4);
          box-shadow: 0 24px 60px -24px rgba(0,0,0,0.7), 0 0 40px -16px rgba(139,92,246,0.3);
        }
        .proyecto-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .proyecto-icon {
          width: 52px;
          height: 52px;
          border-radius: 15px;
          background: rgba(139,92,246,0.13);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          margin-bottom: 16px;
        }
        .proyecto-meta {
          font-family: var(--font-mono);
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          display: block;
          margin-bottom: 8px;
        }
        .proyecto-card h3 { font-size: 1.05rem; margin-bottom: 10px }
        .proyecto-card p { color: var(--color-text-dim); font-size: 0.87rem; line-height: 1.7 }

        .proyectos-cta {
          margin-top: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          border: 1px solid rgba(139,92,246,0.3);
          border-radius: 16px;
          background: linear-gradient(160deg, rgba(139,92,246,0.09), rgba(34,211,238,0.05));
          padding: 28px 32px;
        }
        .proyectos-cta h3 { font-size: 1.15rem; margin-bottom: 6px }
        .proyectos-cta p { color: var(--color-text-dim); font-size: 0.88rem }

        @media (max-width: 980px) {
          .case { padding: 30px 26px 28px }
          .case-metrics { grid-template-columns: repeat(2, 1fr) }
          .case-grid { grid-template-columns: 1fr }
          .proyectos-grid { grid-template-columns: 1fr }
        }
      `}</style>
    </section>
  )
}