import { sanityFetch } from "@/lib/sanity"
import Link from "next/link"
import type { Metadata } from "next"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"
import { whatsappUrl } from "@/lib/contact"

export const metadata: Metadata = {
  title: "Precios — PixelArch",
  description: "Precios de referencia de PixelArch: implementaciones a medida (pagaderas por hitos) y soporte mensual básico o premium. En ARS y USD.",
  alternates: { canonical: "/precios" },
}

const SERVICIOS_QUERY = `*[_type == "servicio" && activo == true] | order(orden asc) {
  titulo,
  "slug": slug.current,
  descripcion,
  icono,
  tags,
  precioUnico,
  precioBasico,
  precioMantenimiento
}`

interface ServicioItem {
  titulo: string
  slug: string
  descripcion: string
  icono: string
  tags: string[]
  precioUnico: number
  precioBasico: number
  precioMantenimiento: number
}

function ars(cents: number, rate: number | null): string {
  if (!cents) return "—"
  if (rate) return formatARS(cents, rate)
  return formatUSD(cents)
}

function usdRef(cents: number, rate: number | null): string | null {
  if (!cents || !rate) return null
  return `≈ ${formatUSD(cents)}/mes`
}

export default async function PreciosPage() {
  const [servicios, rate] = await Promise.all([
    sanityFetch<ServicioItem[]>(SERVICIOS_QUERY),
    getDolarVentaBancoNacion(),
  ])

  const lista = servicios || []

  return (
    <section className="precios" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "320px", height: "320px", left: "-110px", bottom: "12%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "660px", marginBottom: "46px" }}>
          <p className="eyebrow">Precios</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            Precios de referencia, sin letra chica
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.7 }}>
            Cada implementación se cotiza a medida según su alcance y se paga por hitos acordados. El soporte mensual es opcional — incluye hosting, SSL y monitoreo.
          </p>
        </div>

        {lista.length === 0 ? (
          <p style={{ color: "var(--color-text-dim)", fontSize: "1rem", textAlign: "center", padding: "40px 0" }}>
            Los precios estarán disponibles en breve.
          </p>
        ) : (
          <>
            <div className="ptable-wrap">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="hl">Implementación <span className="th-sub">desde</span></th>
                    <th>Soporte básico <span className="th-sub">/mes</span></th>
                    <th>Soporte premium <span className="th-sub">/mes</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <tr key={s.slug}>
                      <td className="prod">
                        <Link href={`/productos/${s.slug}`}>
                          <span className="prod-ico" aria-hidden="true">{s.icono || "⚡"}</span>
                          {s.titulo}
                        </Link>
                      </td>
                      <td className="price price-hl">
                        {s.precioUnico > 0 ? formatUSD(s.precioUnico) : "—"}
                        {s.precioUnico > 0 && <span className="usd">a medida · se paga por hitos</span>}
                      </td>
                      <td className="price">
                        {ars(s.precioBasico, rate)}
                        {usdRef(s.precioBasico, rate) && <span className="usd">{usdRef(s.precioBasico, rate)}</span>}
                      </td>
                      <td className="price">
                        {ars(s.precioMantenimiento, rate)}
                        {usdRef(s.precioMantenimiento, rate) && <span className="usd">{usdRef(s.precioMantenimiento, rate)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="ptable-note">
              {rate ? "Precios en ARS según dólar venta Banco Nación (fuente: ComparaDolar), se actualizan automáticamente. " : ""}
              Los proyectos se cotizan a medida y se pagan por hitos acordados (anticipo, avances y entrega), con link de Mercado Pago o transferencia. El soporte mensual es opcional y se cancela con 7 días de aviso.
            </p>
          </>
        )}

        <div className="precios-cards">
          <article className="precio-card">
            <span className="precio-line" aria-hidden="true" />
            <h3>¿Cómo se paga un proyecto?</h3>
            <p>Se cotiza a medida según el alcance y se paga por hitos: anticipo, avances y entrega. Cada hito se paga con link de Mercado Pago o transferencia.</p>
          </article>
          <article className="precio-card">
            <span className="precio-line" aria-hidden="true" />
            <h3>¿Qué incluye el soporte?</h3>
            <p>Hosting, SSL, monitoreo activo y respuesta en menos de 24hs. El premium agrega cambios mensuales de contenido y soporte prioritario.</p>
          </article>
          <article className="precio-card">
            <span className="precio-line" aria-hidden="true" />
            <h3>¿Puedo cancelar el soporte?</h3>
            <p>Sí, cuando quieras con 7 días de aviso. Sin permanencia ni penalidades — tu proyecto y tu código son tuyos.</p>
          </article>
        </div>

        <div className="precios-cta">
          <div>
            <h3>¿Querés una cotización?</h3>
            <p>Contanos tu proyecto y te armamos una propuesta con hitos — sin compromiso.</p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Consultar por WhatsApp <span className="btn-arrow" aria-hidden="true">→</span>
            </a>
            <a href="/#contacto" className="btn btn-ghost">Ir al formulario</a>
          </div>
        </div>
      </div>

      <style>{`
        .ptable-wrap {
          overflow-x: auto;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(17,14,26,0.6);
          -webkit-overflow-scrolling: touch;
        }
        .ptable {
          width: 100%;
          min-width: 720px;
          border-collapse: separate;
          border-spacing: 0;
        }
        .ptable th {
          font-family: var(--font-mono);
          font-size: 0.66rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          text-align: left;
          padding: 16px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.02);
          white-space: nowrap;
        }
        .ptable th.hl { color: var(--color-cyan) }
        .th-sub { opacity: 0.7 }
        .ptable td {
          padding: 15px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          font-size: 0.88rem;
          vertical-align: middle;
        }
        .ptable tr:last-child td { border-bottom: none }
        .ptable tbody tr { transition: background 0.2s }
        .ptable tbody tr:hover { background: rgba(139,92,246,0.06) }
        .ptable .prod a {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          transition: color 0.2s;
        }
        .ptable .prod a:hover { color: var(--color-cyan) }
        .prod-ico {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: rgba(139,92,246,0.13);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }
        .ptable .price {
          font-weight: 700;
          white-space: nowrap;
          letter-spacing: -0.01em;
        }
        .ptable .price-hl { color: var(--color-cyan) }
        .ptable .usd {
          display: block;
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: var(--color-text-faint);
          font-weight: 400;
          margin-top: 3px;
        }
        .ptable-note {
          font-family: var(--font-mono);
          font-size: 0.66rem;
          color: var(--color-text-faint);
          line-height: 1.7;
          margin-top: 14px;
          max-width: 90ch;
        }
        .precios-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 46px;
        }
        .precio-card {
          position: relative;
          background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 18px;
          padding: 24px 26px;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s;
        }
        .precio-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.4) }
        .precio-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .precio-card h3 { font-size: 0.98rem; margin-bottom: 9px }
        .precio-card p { color: var(--color-text-dim); font-size: 0.86rem; line-height: 1.7 }
        .precios-cta {
          margin-top: 46px;
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
        .precios-cta h3 { font-size: 1.15rem; margin-bottom: 6px }
        .precios-cta p { color: var(--color-text-dim); font-size: 0.88rem }
        @media (max-width: 980px) {
          .precios-cards { grid-template-columns: 1fr }
        }
      `}</style>
    </section>
  )
}