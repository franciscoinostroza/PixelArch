import type { Metadata } from "next"
import { whatsappUrl } from "@/lib/contact"

export const metadata: Metadata = {
  title: "Nosotros — PixelArch",
  description: "Desarrollo full-stack e ingeniería de redes en un mismo lugar. Conocé cómo trabajamos, nuestros principios y el stack que usamos.",
  alternates: { canonical: "/nosotros" },
}

const PRINCIPIOS = [
  {
    titulo: "Código + red, juntos",
    text: "Pensamos el software y la infraestructura como una sola cosa. Sin traspasar el problema a otro proveedor cuando algo se cae.",
  },
  {
    titulo: "Sin vueltas",
    text: "Te explicamos todo en tu idioma: precios claros, plazos reales, sin letra chica. Si algo no hace falta, lo decimos.",
  },
  {
    titulo: "Acompañamiento real",
    text: "No desaparecemos al entregar: monitoreo, cambios y soporte continuo. Si algo falla, nos enteramos antes que vos.",
  },
]

const PASOS = [
  { num: "01", text: "Auditamos antes de proponer: entendemos el negocio, no solo el pedido." },
  { num: "02", text: "Entregamos por hitos, con fechas y precio claros desde el día uno." },
  { num: "03", text: "Monitoreamos lo que entregamos con alertas automáticas." },
  { num: "04", text: "Documentamos todo: tu código y tu infraestructura quedan entendibles." },
]

const STACK = [
  "Next.js", "React", "TypeScript", "PostgreSQL", "Tailwind", "Prisma",
  "Docker", "CI/CD", "Linux", "Sanity", "Polar", "Clerk", "Resend", "Sentry",
]

export default function NosotrosPage() {
  return (
    <>
      <section className="nosotros-page" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
        <div className="section-divider section-divider--violet" aria-hidden="true" />
        <div className="section-band section-band--violet" aria-hidden="true" />
        <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "8%" }} aria-hidden="true" />
        <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "12%" }} aria-hidden="true" />

        <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
          <div className="section-head" style={{ maxWidth: "680px", marginBottom: "52px" }}>
            <p className="eyebrow">Quiénes somos</p>
            <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.9rem)", marginBottom: "16px" }}>
              Un equipo, dos disciplinas
            </h1>
            <p style={{ color: "var(--color-text-dim)", fontSize: "1.05rem", lineHeight: 1.75 }}>
              PixelArch nació de una combinación poco común: desarrollo full-stack e ingeniería de redes en el mismo lugar.
            </p>
          </div>

          <div className="nosotros-page-grid">
            <div className="nosotros-page-copy">
              <p>La mayoría de los estudios te entregan una aplicación y te desean suerte con el resto. Nosotros diseñamos también el terreno donde esa aplicación va a vivir: servidores, red, despliegues, monitoreo y seguridad.</p>
              <p>Trabajamos remoto, con clientes en Chile, Argentina, México, Perú, Colombia, Brasil, España y otros países de Europa. Cada proyecto se trata como un producto: se mide, se monitorea y se mejora después de la entrega.</p>
              <p>No vendemos horas: resolvemos problemas. Si algo no hace falta, lo decimos — incluso si eso significa vender menos.</p>
            </div>

            <div className="nosotros-panel">
              <div className="nosotros-panel-head">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>
                Cómo trabajamos
              </div>
              {PASOS.map((p) => (
                <div key={p.num} className="nosotros-paso">
                  <span className="nosotros-paso-num">{p.num}</span>
                  <span className="nosotros-paso-text">{p.text}</span>
                </div>
              ))}
            </div>
          </div>

          <h2 className="nosotros-sub">Lo que nos hace distintos</h2>
          <div className="nosotros-principios">
            {PRINCIPIOS.map((p) => (
              <article key={p.titulo} className="principio-card">
                <span className="principio-line" aria-hidden="true" />
                <h3>{p.titulo}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>

          <h2 className="nosotros-sub">Stack</h2>
          <div className="nosotros-stack">
            {STACK.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <div className="nosotros-cta">
            <div>
              <h3>¿Trabajamos juntos?</h3>
              <p>Contanos tu proyecto y te respondemos en menos de 24hs.</p>
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <a href="/#contacto" className="btn btn-primary">Hablemos de tu proyecto <span className="btn-arrow" aria-hidden="true">→</span></a>
              <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">WhatsApp directo</a>
            </div>
          </div>
        </div>

        <style>{`
          .nosotros-page-grid {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 54px;
            align-items: start;
          }
          .nosotros-page-copy p {
            color: var(--color-text-dim);
            font-size: 1rem;
            line-height: 1.85;
            margin-bottom: 18px;
            max-width: 56ch;
          }
          .nosotros-panel {
            background: linear-gradient(160deg, #171321, #110e1a);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 18px;
            padding: 28px;
            position: relative;
            overflow: hidden;
          }
          .nosotros-panel::before {
            content: "";
            position: absolute;
            top: 0;
            left: 22px;
            right: 22px;
            height: 2px;
            border-radius: 0 0 4px 4px;
            background: linear-gradient(90deg, #8b5cf6, #22d3ee);
          }
          .nosotros-panel-head {
            display: flex;
            align-items: center;
            gap: 9px;
            font-family: var(--font-mono);
            font-size: 0.68rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--color-text-faint);
            margin-bottom: 20px;
          }
          .nosotros-panel-head svg { stroke: var(--color-cyan); fill: none; stroke-width: 1.7; stroke-linecap: round }
          .nosotros-paso {
            display: flex;
            gap: 14px;
            align-items: flex-start;
            padding: 13px 0;
            border-bottom: 1px solid rgba(255,255,255,0.06);
          }
          .nosotros-paso:last-child { border-bottom: none }
          .nosotros-paso-num {
            font-family: var(--font-mono);
            font-size: 0.68rem;
            color: var(--color-cyan);
            border: 1px solid rgba(34,211,238,0.3);
            border-radius: 999px;
            padding: 3px 9px;
            flex-shrink: 0;
          }
          .nosotros-paso-text { font-size: 0.86rem; color: var(--color-text-dim); line-height: 1.6 }

          .nosotros-sub {
            font-family: var(--font-pixel-display);
            font-size: 1.4rem;
            font-weight: 700;
            margin: 56px 0 20px;
          }
          .nosotros-principios {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
          .principio-card {
            position: relative;
            background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 18px;
            padding: 26px;
            overflow: hidden;
            transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s;
          }
          .principio-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.4) }
          .principio-line {
            position: absolute;
            top: 0;
            left: 22px;
            right: 22px;
            height: 2px;
            border-radius: 0 0 4px 4px;
            background: linear-gradient(90deg, #8b5cf6, #22d3ee);
          }
          .principio-card h3 { font-size: 1rem; margin-bottom: 10px }
          .principio-card p { color: var(--color-text-dim); font-size: 0.87rem; line-height: 1.7 }

          .nosotros-stack { display: flex; flex-wrap: wrap; gap: 10px }
          .nosotros-stack span {
            font-family: var(--font-mono);
            font-size: 0.72rem;
            color: var(--color-text-dim);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 999px;
            padding: 7px 14px;
            transition: border-color 0.2s, color 0.2s;
          }
          .nosotros-stack span:hover { border-color: rgba(34,211,238,0.4); color: var(--color-cyan) }

          .nosotros-cta {
            margin-top: 56px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            flex-wrap: wrap;
            border: 1px solid rgba(139,92,246,0.3);
            border-radius: 16px;
            background: linear-gradient(160deg, rgba(139,92,246,0.09), rgba(34,211,238,0.05));
            padding: 30px 34px;
          }
          .nosotros-cta h3 { font-size: 1.2rem; margin-bottom: 6px }
          .nosotros-cta p { color: var(--color-text-dim); font-size: 0.9rem }

          @media (max-width: 980px) {
            .nosotros-page-grid { grid-template-columns: 1fr; gap: 40px }
            .nosotros-principios { grid-template-columns: 1fr }
          }
        `}</style>
      </section>
    </>
  )
}