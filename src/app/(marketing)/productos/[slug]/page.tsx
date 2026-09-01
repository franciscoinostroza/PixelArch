import { sanityFetch } from "@/lib/sanity"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { CheckoutButton } from "@/components/ui/checkout-button"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"

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
    if (rate) return `${formatARS(cents, rate)}`
    return `$${(cents / 100).toFixed(0)}`
  }

  const period = (monthly: boolean) => {
    if (!monthly) return rate ? "ARS" : ""
    return rate ? "ARS/mes" : "/mes"
  }

  const priceRef = (cents: number) => (rate && cents > 0 ? `≈ ${formatUSD(cents)}` : null)

  const jsonLd = servicioDB ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: servicioSanity.titulo,
    description: servicioSanity.descripcion,
    image: servicioSanity.og_image_url || undefined,
    offers: [
      ...(servicioDB.polarProductIdUnico ? [{
        "@type": "Offer",
        name: "Pago Único",
        price: (servicioDB.precioUnico / 100).toFixed(0),
        priceCurrency: "USD",
        availability: "https://schema.org/OnlineOnly",
      }] : []),
      ...(servicioDB.polarProductIdBasico ? [{
        "@type": "Offer",
        name: "Plan Básico",
        price: (servicioDB.precioBasico / 100).toFixed(0),
        priceCurrency: "USD",
        priceType: "https://schema.org/MonthlyRateSubscription",
      }] : []),
      ...(servicioDB.polarProductIdMantenimiento ? [{
        "@type": "Offer",
        name: "Plan Mantenimiento",
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
      <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
        <div className="section-divider section-divider--violet" aria-hidden="true" />
        <div className="section-band section-band--violet" aria-hidden="true" />
        <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "10%" }} aria-hidden="true" />
        <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "10%" }} aria-hidden="true" />
        <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
          <a href="/productos" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-mono)", fontSize: ".75rem", color: "var(--color-text-dim)", marginBottom: "32px", transition: "color 0.2s" }}>← Volver a productos</a>

          <div className="producto-header" style={{ display: "flex", alignItems: "flex-start", gap: "28px", marginBottom: "48px" }}>
            <div className="producto-icon" style={{
              width: "72px", height: "72px", borderRadius: "18px", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(139,92,246,0.14)", color: "#8b5cf6",
            }} dangerouslySetInnerHTML={{ __html: ICONS[servicioSanity.titulo] || servicioSanity.icono || "⚡" }} />
            <div>
              <p className="eyebrow" style={{ marginBottom: "10px" }}>Planes y precios</p>
              <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(2rem, 4vw, 3.2rem)", marginBottom: "14px" }}>{servicioSanity.titulo}</h1>
              <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", maxWidth: "50ch", lineHeight: 1.65 }}>{servicioSanity.descripcion}</p>
              {servicioSanity.tags?.length > 0 && (
                <div className="producto-tags" style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginTop: "20px" }}>
                  {servicioSanity.tags.map((tag) => (
                    <span key={tag} style={{
                      fontFamily: "var(--font-mono)", fontSize: ".68rem",
                      color: "var(--color-text-faint)", border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "100px", padding: "4px 10px",
                    }}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {servicioDB && (
            <div className="planes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "22px", marginTop: "24px" }}>
              <article className="plan-card">
                <div className="plan-card-content">
                  <div className="plan-icon"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
                  <p className="plan-label">Pago Único</p>
                  <p className="plan-price">{price(servicioDB.precioUnico)}<span className="plan-period">{period(false)}</span></p>
                  {priceRef(servicioDB.precioUnico) && <p className="plan-price-ref">{priceRef(servicioDB.precioUnico)}</p>}
                  <p className="plan-desc">Desarrollo y entrega del proyecto completo.</p>
                  <ul className="plan-features">
                    <li>✅ Código y activos incluidos</li>
                    <li>❌ Sin hosting incluido</li>
                    <li>❌ Sin soporte continuo</li>
                  </ul>
                  {servicioDB.polarProductIdUnico && (
                    <div className="plan-cta">
                      <CheckoutButton polarProductId={servicioDB.polarProductIdUnico} servicioNombre={servicioSanity.titulo} tipo="UNICO" label={`Contratar ${servicioSanity.titulo}`} size="default" className="w-full" />
                    </div>
                  )}
                </div>
              </article>

              <article className="plan-card plan-card--featured">
                <div className="plan-badge">Recomendado</div>
                <div className="plan-card-content">
                  <div className="plan-icon"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/></svg></div>
                  <p className="plan-label">Plan Básico</p>
                  <p className="plan-price">{price(servicioDB.precioBasico)}<span className="plan-period">{period(true)}</span></p>
                  {priceRef(servicioDB.precioBasico) && <p className="plan-price-ref">{priceRef(servicioDB.precioBasico)}/mes</p>}
                  <p className="plan-desc">Servicio online, hosting incluido, sin cambios.</p>
                  <ul className="plan-features">
                    <li>✅ Hosting incluido</li>
                    <li>✅ SSL y monitoreo</li>
                    <li>❌ Sin cambios ni soporte</li>
                  </ul>
                  {servicioDB.polarProductIdBasico && (
                    <div className="plan-cta">
                      <CheckoutButton polarProductId={servicioDB.polarProductIdBasico} servicioNombre={servicioSanity.titulo} tipo="BASICO" label="Activar Básico" size="default" variant="gradient" className="w-full" />
                    </div>
                  )}
                </div>
              </article>

              <article className="plan-card">
                <div className="plan-card-content">
                  <div className="plan-icon"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9"/><path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"/></svg></div>
                  <p className="plan-label">Plan Mantenimiento</p>
                  <p className="plan-price">{price(servicioDB.precioMantenimiento)}<span className="plan-period">{period(true)}</span></p>
                  {priceRef(servicioDB.precioMantenimiento) && <p className="plan-price-ref">{priceRef(servicioDB.precioMantenimiento)}/mes</p>}
                  <p className="plan-desc">Hosting + cambios + soporte prioritario.</p>
                  <ul className="plan-features">
                    <li>✅ Todo lo del Básico</li>
                    <li>✅ Cambios mensuales</li>
                    <li>✅ Soporte prioritario</li>
                  </ul>
                  {servicioDB.polarProductIdMantenimiento && (
                    <div className="plan-cta">
                      <CheckoutButton polarProductId={servicioDB.polarProductIdMantenimiento} servicioNombre={servicioSanity.titulo} tipo="MANTENIMIENTO" label="Activar Mantenimiento" size="default" className="w-full" />
                    </div>
                  )}
                </div>
              </article>
            </div>
          )}

          <p style={{ textAlign: "center", fontSize: ".85rem", color: "var(--color-text-faint)", marginTop: "36px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "28px" }}>
            {rate ? "Precios en ARS según dólar venta Banco Nación (fuente: ComparaDolar), se actualizan automáticamente. " : ""}
            El cobro se realiza en USD. Sin un plan mensual, el servicio deja de estar online. Cancelación con 7 días de aviso.
          </p>
        </div>
      </section>

      <style>{`
        .planes-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
        .plan-card {
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: transform 0.4s cubic-bezier(.19,1,.22,1), border-color 0.4s cubic-bezier(.19,1,.22,1), background 0.4s cubic-bezier(.19,1,.22,1);
        }
        .plan-card::before {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          opacity: 0;
          transition: opacity 0.4s cubic-bezier(.19,1,.22,1);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
        .plan-card:hover { transform: translateY(-6px); background: var(--color-panel-2) }
        .plan-card:hover::before { opacity: 1 }

        .plan-card--featured {
          border: 1.5px solid rgba(139,92,246,0.35);
          background: linear-gradient(180deg, rgba(139,92,246,0.06), var(--color-panel));
          transform: translateY(-8px);
        }
        .plan-card--featured:hover { transform: translateY(-14px) }
        .plan-card--featured::before { opacity: 1 }

        .plan-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          font-family: var(--font-mono);
          font-size: .6rem;
          letter-spacing: .08em;
          text-transform: uppercase;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          padding: 3px 10px;
          border-radius: 100px;
          font-weight: 600;
        }
        .plan-card-content { padding: 32px 28px; position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; }
        .plan-cta { margin-top: auto; }
        .plan-icon {
          width: 44px; height: 44px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(139,92,246,0.14); color: #8b5cf6;
          margin-bottom: 20px;
        }
        .plan-card:nth-child(3) .plan-icon { background: rgba(34,211,238,0.14); color: #22d3ee }
        .plan-label {
          font-family: var(--font-mono);
          font-size: .7rem;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          margin-bottom: 8px;
        }
        .plan-price {
          font-family: var(--font-display);
          font-size: 2.2rem;
          font-weight: 700;
          margin-bottom: 12px;
          white-space: nowrap;
        }
        .plan-period {
          font-size: .9rem;
          font-weight: 400;
          color: var(--color-text-dim);
        }
        .plan-price-ref {
          font-family: var(--font-mono);
          font-size: .72rem;
          color: var(--color-text-faint);
          margin: -6px 0 12px;
        }
        .plan-desc {
          color: var(--color-text-dim);
          font-size: .85rem;
          line-height: 1.65;
          margin-bottom: 20px;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .plan-features {
          list-style: none;
          margin-bottom: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .plan-features li {
          font-size: .82rem;
          color: var(--color-text-dim);
        }

        @media (max-width: 980px) { .planes-grid { grid-template-columns: repeat(2, 1fr) } }
        @media (max-width: 720px) {
          .planes-grid { grid-template-columns: 1fr }
          .plan-card--featured { transform: translateY(0) }
          .plan-card--featured:hover { transform: translateY(-6px) }
          .producto-header { flex-direction: column; align-items: center; text-align: center }
        }
      `}</style>
    </>
  )
}
