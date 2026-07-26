"use client"

interface ServiceItem {
  titulo: string
  slug: string
  descripcion: string
  icono: string
  tags: string[]
  precioUnico: number
  precioBasico: number
  precioMantenimiento: number
}

interface ServicesProps {
  servicios: ServiceItem[]
}

const ICONS: Record<string, string> = {
  "Sitios Web": '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 9l2 2-2 2"/><path d="M13 13h4"/></svg>',
  "Aplicaciones Web": '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  "Apps Móviles": '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>',
  "E-commerce": '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="9" cy="20" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.3" fill="currentColor" stroke="none"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L22 7H6"/></svg>',
  "Automatización & IA": '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M19 15l1 2.5L22.5 18.5 20 19.5 19 22 18 19.5 15.5 18.5 18 17.5z"/></svg>',
  "Infraestructura & Cloud": '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r=".6" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".6" fill="currentColor" stroke="none"/></svg>',
}

const FALLBACK_TAGS: Record<string, string[]> = {
  "Sitios Web": ["Next.js", "SEO", "Core Web Vitals"],
  "Aplicaciones Web": ["React", "TypeScript", "PostgreSQL"],
  "Apps Móviles": ["React Native", "iOS", "Android"],
  "E-commerce": ["Stripe", "Checkout", "Inventario"],
  "Automatización & IA": ["LangChain", "RAG", "Workflows"],
  "Infraestructura & Cloud": ["Docker", "Linux", "CI/CD"],
}

export function Services({ servicios }: ServicesProps) {
  const displayServicios = servicios.length > 0 ? servicios : Object.keys(ICONS).map((name) => ({
    titulo: name,
    slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    descripcion: "",
    icono: "",
    tags: FALLBACK_TAGS[name] || [],
    precioUnico: 0,
    precioBasico: 0,
    precioMantenimiento: 0,
  }))

  return (
    <section className="productos" id="productos">
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Productos</p>
          <h2>Elegí la pieza que tu negocio necesita</h2>
          <p>Desde un sitio institucional hasta un agente de IA corriendo sobre infraestructura propia.</p>
        </div>

        <div className="products-grid">
          {displayServicios.map((s, i) => (
            <article className="product-card" key={s.slug}>
              <div
                className="product-icon"
                dangerouslySetInnerHTML={{
                  __html: ICONS[s.titulo] || s.icono || "⚡",
                }}
              />
              <h3>{s.titulo}</h3>
              <p>{s.descripcion || "Descubrí cómo este servicio puede potenciar tu negocio."}</p>
              <div className="product-meta">
                {(s.tags?.length ? s.tags : FALLBACK_TAGS[s.titulo] || []).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        .productos {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(7,6,12,0.88);
          backdrop-filter: blur(3px);
        }
        .products-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
        }
        .product-card {
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 32px 28px;
          position: relative;
          overflow: hidden;
          transition: transform 0.4s cubic-bezier(.19,1,.22,1), border-color 0.4s cubic-bezier(.19,1,.22,1), background 0.4s cubic-bezier(.19,1,.22,1);
          cursor: pointer;
        }
        .product-card::before {
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
        .product-card:hover { transform: translateY(-6px); background: var(--color-panel-2) }
        .product-card:hover::before { opacity: 1 }
        .product-icon {
          width: 52px;
          height: 52px;
          border-radius: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139,92,246,0.14);
          color: #8b5cf6;
          margin-bottom: 24px;
          transition: background 0.35s, color 0.35s, transform 0.35s;
        }
        .product-card:nth-child(even) .product-icon { background: rgba(34,211,238,0.14); color: #22d3ee }
        .product-card:hover .product-icon { background: linear-gradient(135deg, #8b5cf6, #22d3ee); color: #07060c; transform: scale(1.06) rotate(-4deg) }
        .product-card h3 { font-size: 1.12rem; margin-bottom: 10px }
        .product-card p { color: var(--color-text-dim); font-size: 0.9rem; margin-bottom: 20px; line-height: 1.65 }
        .product-meta { display: flex; flex-wrap: wrap; gap: 7px }
        .product-meta span {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-faint);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 100px;
          padding: 4px 10px;
        }
        @media (max-width: 980px) { .products-grid { grid-template-columns: repeat(2, 1fr) } }
        @media (max-width: 720px) { .products-grid { grid-template-columns: 1fr } }
      `}</style>
    </section>
  )
}
