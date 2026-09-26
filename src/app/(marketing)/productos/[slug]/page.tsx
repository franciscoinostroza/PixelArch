import { sanityFetch } from "@/lib/sanity"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { ProductFaq } from "@/components/ui/product-faq"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"
import { whatsappUrl } from "@/lib/contact"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SERVICIO_QUERY = `*[_type == "servicio" && slug.current == $slug][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  meta_title,
  meta_description,
  "og_image_url": og_image.asset->url,
  icono,
  tags
}`

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = await sanityFetch<{ titulo: string; descripcion: string; meta_title?: string; meta_description?: string; og_image_url?: string } | null>(SERVICIO_QUERY, { slug })
  if (!s) return { title: "Producto no encontrado" }
  return {
    title: s.meta_title ? `${s.meta_title} — PixelArch` : `${s.titulo} — PixelArch`,
    description: s.meta_description || s.descripcion,
    alternates: { canonical: `/productos/${slug}` },
    openGraph: s.og_image_url ? {
      images: [{ url: s.og_image_url }],
    } : undefined,
  }
}

const ICONS: Record<string, string> = {
  "Sitios Web": '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 9l2 2-2 2"/><path d="M13 13h4"/></svg>',
  "Aplicaciones Web": '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  "Apps Móviles": '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>',
  "E-commerce": '<svg viewBox="0 0 24 24" width="40" height="40"><circle cx="9" cy="20" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.3" fill="currentColor" stroke="none"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L22 7H6"/></svg>',
  "Automatización & IA": '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M19 15l1 2.5L22.5 18.5 20 19.5 19 22 18 19.5 15.5 18.5 18 17.5z"/></svg>',
  "Infraestructura & Cloud": '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r=".6" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".6" fill="currentColor" stroke="none"/></svg>',
}

export default async function ProductoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [servicioSanity, servicioDB, rate] = await Promise.all([
    sanityFetch<{ titulo: string; slug: string; descripcion: string; meta_title?: string; meta_description?: string; og_image_url?: string; icono: string; tags: string[] } | null>(SERVICIO_QUERY, { slug }),
    prisma.servicio.findFirst({ where: { OR: [{ slug }, { id: `servicio-${slug}` }] } }).catch(() => null),
    getDolarVentaBancoNacion(),
  ])

  if (!servicioSanity) notFound()

  const price = (cents: number) => {
    if (rate) return formatARS(cents, rate)
    return `$${(cents / 100).toFixed(0)}`
  }

  const priceRef = (cents: number) => (rate && cents > 0 ? `≈ ${formatUSD(cents)}/mes` : null)

  const jsonLd = servicioDB ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: servicioSanity.titulo,
    description: servicioSanity.descripcion,
    image: servicioSanity.og_image_url || undefined,
    offers: [
      ...(servicioDB.precioUnico > 0 ? [{
        "@type": "Offer",
        name: "Implementación",
        price: (servicioDB.precioUnico / 100).toFixed(0),
        priceCurrency: "USD",
        availability: "https://schema.org/OnlineOnly",
      }] : []),
      ...(servicioDB.precioBasico > 0 ? [{
        "@type": "Offer",
        name: "Soporte básico",
        price: (servicioDB.precioBasico / 100).toFixed(0),
        priceCurrency: "USD",
        priceType: "https://schema.org/MonthlyRateSubscription",
      }] : []),
      ...(servicioDB.precioMantenimiento > 0 ? [{
        "@type": "Offer",
        name: "Soporte premium",
        price: (servicioDB.precioMantenimiento / 100).toFixed(0),
        priceCurrency: "USD",
        priceType: "https://schema.org/MonthlyRateSubscription",
      }] : []),
    ],
  } : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <section className="producto-section" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
        <div className="section-divider section-divider--violet" aria-hidden="true" />
        <div className="section-band section-band--violet" aria-hidden="true" />
        <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "10%" }} aria-hidden="true" />
        <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "10%" }} aria-hidden="true" />
        <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
          <a href="/productos" className="producto-back">← Volver a productos</a>

          <div className="producto-header">
            <div className="producto-icon" dangerouslySetInnerHTML={{ __html: ICONS[servicioSanity.titulo] || servicioSanity.icono || "⚡" }} />
            <div>
              <p className="eyebrow">Planes y precios</p>
              <h1>{servicioSanity.titulo}</h1>
              <p className="producto-desc">{servicioSanity.descripcion}</p>
              {servicioSanity.tags?.length > 0 && (
                <div className="producto-tags">
                  {servicioSanity.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {servicioDB && (
            <>
              <div className="planes-grid">
                <article className="plan-card plan-card--featured">
                  <span className="plan-line" aria-hidden="true" />
                  <span className="plan-badge">A medida</span>
                  <div className="plan-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 6 2 12l6 6M16 6l6 6-6 6"/></svg>
                  </div>
                  <p className="plan-label">Implementación</p>
                  {servicioDB.precioUnico > 0 && (
                    <>
                      <span className="plan-from">Desde</span>
                      <span className="plan-price">{formatUSD(servicioDB.precioUnico)}</span>
                      {rate && <span className="plan-ref">≈ {formatARS(servicioDB.precioUnico, rate)}</span>}
                    </>
                  )}
                  <p className="plan-desc">Proyecto cotizado según alcance. Se paga por hitos acordados: anticipo, avances y entrega.</p>
                  <ul className="plan-features">
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Cotización a medida</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Pago por hitos</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Código y activos tuyos</li>
                  </ul>
                  <div className="plan-cta">
                    <a
                      href={whatsappUrl(`Hola! Quiero cotizar una implementación de ${servicioSanity.titulo}.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ variant: "gradient" }), "w-full")}
                    >
                      Cotizar mi implementación
                    </a>
                  </div>
                </article>

                <article className="plan-card">
                  <span className="plan-line" aria-hidden="true" />
                  <div className="plan-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 3 7v5c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V7l-9-5z"/><path d="m9 12 2 2 4-4"/></svg>
                  </div>
                  <p className="plan-label">Soporte básico</p>
                  {servicioDB.precioBasico > 0 && (
                    <>
                      <span className="plan-from">Desde</span>
                      <span className="plan-price">{price(servicioDB.precioBasico)}<small>ARS/mes</small></span>
                      {priceRef(servicioDB.precioBasico) && <span className="plan-ref">{priceRef(servicioDB.precioBasico)}</span>}
                    </>
                  )}
                  <p className="plan-desc">Para que tu proyecto siga online sin sorpresas: hosting, SSL y monitoreo activo.</p>
                  <ul className="plan-features">
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Hosting incluido</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>SSL y monitoreo</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Respuesta en &lt;24hs</li>
                    <li><span className="pf pf-no"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></span>Sin cambios de contenido</li>
                  </ul>
                  <span className="plan-activacion">Se activa cuando arrancamos el proyecto</span>
                </article>

                <article className="plan-card">
                  <span className="plan-line" aria-hidden="true" />
                  <div className="plan-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z"/></svg>
                  </div>
                  <p className="plan-label">Soporte premium</p>
                  {servicioDB.precioMantenimiento > 0 && (
                    <>
                      <span className="plan-from">Desde</span>
                      <span className="plan-price">{price(servicioDB.precioMantenimiento)}<small>ARS/mes</small></span>
                      {priceRef(servicioDB.precioMantenimiento) && <span className="plan-ref">{priceRef(servicioDB.precioMantenimiento)}</span>}
                    </>
                  )}
                  <p className="plan-desc">Todo lo del básico, más evolución continua: cambios mensuales y soporte prioritario.</p>
                  <ul className="plan-features">
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Todo lo del Básico</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Cambios mensuales</li>
                    <li><span className="pf pf-yes"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Soporte prioritario</li>
                  </ul>
                  <span className="plan-activacion">Se activa cuando arrancamos el proyecto</span>
                </article>
              </div>

              <div className="plan-trust">
                <div className="trust-item">
                  <div className="trust-icon"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2 3 7v5c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V7l-9-5z"/><path d="m9 12 2 2 4-4"/></svg></div>
                  <div><b>Pago por hitos</b><span>Anticipo, avances y entrega</span></div>
                </div>
                <div className="trust-item">
                  <div className="trust-icon"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"/></svg></div>
                  <div><b>Hosting y SSL</b><span>Incluidos en el soporte</span></div>
                </div>
                <div className="trust-item">
                  <div className="trust-icon"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 14 4 9l4-4M14 9l5-5-5 4"/><path d="M14 17l5 5M17 20h-3a8 8 0 0 1-8-8"/></svg></div>
                  <div><b>Cancelá el soporte</b><span>Con 7 días de aviso</span></div>
                </div>
                <div className="trust-item">
                  <div className="trust-icon"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.6 0-3.1-.4-4.4-1.2L3 20l1.4-5A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3.2a8.4 8.4 0 0 1 8.5 8.3z"/><path d="m9 10 2 2 4-4"/></svg></div>
                  <div><b>Respuesta &lt;24hs</b><span>En consultas y soporte</span></div>
                </div>
              </div>

              <div className="plan-assure">
                <div className="assure-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2 3 7v5c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V7l-9-5z"/><path d="m9 12 2 2 4-4"/></svg>
                </div>
                <p><b>Trabajamos por hitos.</b> Revisás cada entrega antes de avanzar a la siguiente. Si en la entrega final algo no cumple lo acordado, lo corregimos sin cargo.</p>
              </div>

              <ProductFaq />

              <p className="plan-note">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/></svg>
                {rate ? "Precios en ARS según dólar venta Banco Nación (fuente: ComparaDolar), se actualizan automáticamente. " : ""}
                Los proyectos se cotizan a medida y se pagan por hitos acordados. El soporte mensual es opcional y se cancela con 7 días de aviso. El cobro se realiza en USD (o su equivalente en ARS).
              </p>
            </>
          )}
        </div>
      </section>

      <style>{`
        .producto-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--color-text-dim);
          margin-bottom: 36px;
          transition: color 0.2s;
        }
        .producto-back:hover { color: var(--color-cyan) }
        .producto-header { display: flex; align-items: flex-start; gap: 26px; margin-bottom: 56px }
        .producto-icon {
          width: 72px;
          height: 72px;
          border-radius: 19px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(139,92,246,0.18), rgba(34,211,238,0.12));
          border: 1px solid rgba(139,92,246,0.25);
          color: #b9a6ff;
        }
        .producto-header h1 {
          font-family: var(--font-pixel-display);
          font-weight: 700;
          letter-spacing: 0;
          font-size: clamp(2rem, 4vw, 3.2rem);
          margin-bottom: 14px;
        }
        .producto-desc {
          color: var(--color-text-dim);
          font-size: 1.02rem;
          max-width: 52ch;
          line-height: 1.65;
          margin-bottom: 18px;
        }
        .producto-tags { display: flex; flex-wrap: wrap; gap: 6px 16px }
        .producto-tags span {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          letter-spacing: 0.05em;
          color: rgba(164,156,179,0.6);
        }

        .planes-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; align-items: stretch }
        .plan-card {
          position: relative;
          border-radius: 18px;
          padding: 34px 30px 30px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: linear-gradient(160deg, #171321 0%, #110e1a 60%, #141020 100%);
          border: 1px solid rgba(255,255,255,0.07);
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s cubic-bezier(.19,1,.22,1), box-shadow 0.35s cubic-bezier(.19,1,.22,1);
        }
        .plan-card:hover {
          transform: translateY(-6px);
          border-color: rgba(139,92,246,0.4);
          box-shadow: 0 24px 60px -24px rgba(0,0,0,0.7), 0 0 40px -16px rgba(139,92,246,0.35);
        }
        .plan-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .plan-card--featured {
          background: linear-gradient(160deg, rgba(139,92,246,0.10), #110e1a 45%, #141020 100%);
          border: 1px solid rgba(139,92,246,0.45);
          box-shadow: 0 0 50px -18px rgba(139,92,246,0.45);
        }
        .plan-card--featured:hover { border-color: rgba(139,92,246,0.65) }
        .plan-card--optional { background: rgba(17,14,26,0.55); border-style: dashed; border-color: rgba(255,255,255,0.12) }
        .plan-card--optional:hover { border-color: rgba(34,211,238,0.4) }

        .plan-badge {
          position: absolute;
          top: 16px;
          right: 16px;
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 11px;
          border-radius: 999px;
          font-weight: 600;
          z-index: 1;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
        }
        .plan-badge--optional { background: transparent; border: 1px solid rgba(34,211,238,0.35); color: var(--color-cyan) }

        .plan-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          background: rgba(139,92,246,0.13);
          color: #b9a6ff;
        }
        .plan-icon svg { stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round }
        .planes-grid > .plan-card:nth-child(3) .plan-icon { background: rgba(34,211,238,0.11); color: #7de3f5 }
        .plan-card--optional .plan-icon { background: rgba(255,255,255,0.05); color: var(--color-text-faint) }

        .plan-label {
          font-family: var(--font-mono);
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          margin-bottom: 10px;
        }
        .plan-card--featured .plan-label { color: var(--color-cyan) }
        .plan-from {
          font-family: var(--font-mono);
          font-size: 0.64rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          display: block;
          margin-bottom: 4px;
        }
        .plan-price {
          font-size: 2.3rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.05;
          display: block;
          white-space: nowrap;
        }
        .plan-price small { font-weight: 400; font-size: 0.82rem; color: var(--color-text-dim); margin-left: 3px }
        .plan-ref {
          display: block;
          font-family: var(--font-mono);
          font-size: 0.7rem;
          color: var(--color-text-faint);
          margin-top: 5px;
          font-weight: 500;
        }
        .plan-desc {
          color: var(--color-text-dim);
          font-size: 0.85rem;
          line-height: 1.65;
          margin-top: 18px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .plan-features {
          list-style: none;
          margin: 18px 0 24px;
          display: flex;
          flex-direction: column;
          gap: 11px;
          flex: 1;
        }
        .plan-features li { display: flex; align-items: center; gap: 10px; font-size: 0.84rem; color: var(--color-text-dim) }
        .pf {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .pf svg { width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round }
        .pf-yes { background: rgba(52,211,153,0.12); color: #34d399 }
        .pf-no { background: rgba(239,68,68,0.1); color: #f87171 }
        .plan-cta { margin-top: auto }
        .plan-cta .w-full { width: 100% }
        .plan-activacion {
          margin-top: auto;
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-faint);
          padding-top: 4px;
        }

        .plan-trust { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 34px }
        .trust-item {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          padding: 16px 18px;
          background: rgba(17,14,26,0.6);
        }
        .trust-icon {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(52,211,153,0.1);
          color: #34d399;
        }
        .trust-icon svg { stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round }
        .trust-item b { display: block; font-size: 0.82rem; margin-bottom: 2px }
        .trust-item span { font-family: var(--font-mono); font-size: 0.64rem; color: var(--color-text-faint) }

        .plan-assure {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          border: 1px solid rgba(34,211,238,0.22);
          border-radius: 14px;
          background: linear-gradient(160deg, rgba(34,211,238,0.06), rgba(17,14,26,0.5));
          padding: 20px 22px;
          margin-top: 34px;
        }
        .assure-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(34,211,238,0.12);
          color: var(--color-cyan);
        }
        .assure-icon svg { stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round }
        .plan-assure p { color: var(--color-text-dim); font-size: 0.88rem; line-height: 1.7 }
        .plan-assure b { color: var(--color-text) }

        .plan-note {
          margin-top: 44px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: var(--color-text-faint);
          font-size: 0.78rem;
          line-height: 1.6;
        }
        .plan-note svg {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          stroke: var(--color-text-faint);
          fill: none;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
          margin-top: 2px;
        }

        @media (max-width: 980px) {
          .planes-grid { grid-template-columns: 1fr; max-width: 480px; margin-inline: auto }
          .plan-trust { grid-template-columns: repeat(2, 1fr) }
        }
        @media (max-width: 680px) {
          .plan-trust { grid-template-columns: 1fr }
          .producto-header { flex-direction: column; align-items: flex-start; gap: 18px }
        }
      `}</style>
    </>
  )
}