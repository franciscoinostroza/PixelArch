import { sanityFetch } from "@/lib/sanity"
import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Blog — PixelArch",
  description: "Artículos sobre desarrollo web, chatbots, agentes de IA, automatizaciones y más.",
  alternates: { canonical: "/blog" },
}

const ARTICULOS_QUERY = `*[_type == "articulo" && activo == true] | order(fecha desc) {
  _id,
  titulo,
  "slug": slug.current,
  descripcion,
  fecha,
  autor,
  tags,
  "portada": portada.asset->url
}`

export default async function BlogPage() {
  const articulos = await sanityFetch<
    { _id: string; titulo: string; slug: string; descripcion?: string; fecha: string; autor?: string; tags?: string[]; portada?: string }[]
  >(ARTICULOS_QUERY)

  const lista = articulos || []

  return (
    <section
      className="blog"
      style={{
        position: "relative",
        zIndex: 1,
        overflow: "hidden",
        background: "rgba(7,6,12,0.88)",
        backdropFilter: "blur(3px)",
        padding: "clamp(88px, 10vw, 132px) 0",
      }}
    >
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ marginBottom: "44px" }}>
          <p className="eyebrow">Blog</p>
          <h2>Ideas, guías y consejos técnicos</h2>
          <p>Artículos sobre desarrollo web, chatbots, agentes de IA y automatizaciones que usamos en PixelArch.</p>
        </div>

        {lista.length === 0 ? (
          <p style={{ color: "var(--color-text-dim)", fontSize: "1rem", textAlign: "center", padding: "40px 0" }}>
            Todavía no hay artículos publicados. ¡Volvé pronto!
          </p>
        ) : (
          <div className="blog-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 22 }}>
            {lista.map((a) => (
              <Link key={a._id} href={`/blog/${a.slug}`} className="blog-card" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="blog-cover">
                  {a.portada ? (
                    <img src={a.portada} alt={a.titulo} loading="lazy" />
                  ) : (
                    <span aria-hidden="true" style={{ fontSize: 34 }}>📄</span>
                  )}
                </div>
                <div className="blog-body">
                  <div className="blog-meta" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    {a.fecha && (
                      <span className="blog-date">
                        {new Date(a.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                    {a.tags?.slice(0, 3).map((t) => (
                      <span key={t} className="blog-tag">{t}</span>
                    ))}
                  </div>
                  <h3>{a.titulo}</h3>
                  <p>{a.descripcion || "Leé el artículo completo en el blog de PixelArch."}</p>
                  <span className="blog-more">Leer artículo →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .blog-card {
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          transition: transform 0.4s cubic-bezier(.19,1,.22,1), border-color 0.4s cubic-bezier(.19,1,.22,1), background 0.4s cubic-bezier(.19,1,.22,1);
        }
        .blog-card::before {
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
        .blog-card:hover { transform: translateY(-6px); background: var(--color-panel-2) }
        .blog-card:hover::before { opacity: 1 }
        .blog-cover {
          height: 170px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(139,92,246,0.12), rgba(34,211,238,0.08));
          overflow: hidden;
        }
        .blog-cover img { width: 100%; height: 100%; object-fit: cover }
        .blog-body { padding: 22px 22px 24px }
        .blog-date {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          white-space: nowrap;
        }
        .blog-tag {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: #22d3ee;
          white-space: nowrap;
        }
        .blog-body h3 {
          font-size: 1.1rem;
          font-weight: 700;
          margin-bottom: 8px;
          line-height: 1.25;
        }
        .blog-body p { color: var(--color-text-dim); font-size: 0.9rem; line-height: 1.65; margin-bottom: 16px }
        .blog-more { color: #8b5cf6; font-weight: 600; font-size: 0.85rem }
      `}</style>
    </section>
  )
}