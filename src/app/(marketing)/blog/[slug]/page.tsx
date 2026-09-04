import { sanityFetch } from "@/lib/sanity"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { PortableText, type PortableTextBlock } from "@portabletext/react"
import { whatsappUrl, AUDIT_MESSAGE } from "@/lib/contact"
import { ArticleShare } from "@/components/sections/article-share"

const ARTICULO_QUERY = `*[_type == "articulo" && slug.current == $slug && activo == true][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  "portada": portada.asset->url,
  fecha,
  autor,
  tags,
  contenido,
  meta_title,
  meta_description,
  "og_image": og_image.asset->url
}`

const LISTA_QUERY = `*[_type == "articulo" && activo == true] | order(fecha desc){ "slug": slug.current, titulo }`

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const a = await sanityFetch<{ titulo: string; descripcion?: string; meta_title?: string; meta_description?: string; og_image?: string } | null>(
    `*[_type == "articulo" && slug.current == $slug && activo == true][0]{ titulo, descripcion, meta_title, meta_description, "og_image": og_image.asset->url }`,
    { slug }
  )
  if (!a) return { title: "Artículo no encontrado" }
  return {
    title: a.meta_title ? `${a.meta_title} — PixelArch` : `${a.titulo} — PixelArch`,
    description: a.meta_description || a.descripcion,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: a.og_image ? { images: [{ url: a.og_image }] } : undefined,
  }
}

const ptComponents = {
  block: {
    h2: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
    normal: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote>{children}</blockquote>,
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>,
    number: ({ children }: { children?: React.ReactNode }) => <ol>{children}</ol>,
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
    number: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    code: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
    link: ({ children, value }: { children?: React.ReactNode; value?: { href?: string } }) => (
      <a href={value?.href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
  },
  types: {
    image: ({ value }: { value?: { asset?: { url?: string }; alt?: string } }) =>
      value?.asset?.url ? <img src={value.asset.url} alt={value.alt || ""} loading="lazy" /> : null,
  },
}

export default async function ArticuloPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = await sanityFetch<{
    titulo: string
    descripcion?: string
    portada?: string
    fecha?: string
    autor?: string
    tags?: string[]
    contenido?: unknown[]
  } | null>(ARTICULO_QUERY, { slug })

  if (!a) notFound()

  const lista = (await sanityFetch<{ slug: string; titulo: string }[]>(LISTA_QUERY)) || []
  const idx = lista.findIndex((x) => x.slug === slug)
  const anterior = idx > 0 ? lista[idx - 1] : null
  const siguiente = idx >= 0 && idx < lista.length - 1 ? lista[idx + 1] : null

  const fecha = a.fecha
    ? new Date(a.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : null

  const url = `${process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"}/blog/${slug}`

  return (
    <section
      className="articulo"
      style={{
        position: "relative",
        zIndex: 1,
        overflow: "hidden",
        background: "rgba(7,6,12,0.88)",
        backdropFilter: "blur(3px)",
        padding: "clamp(88px, 10vw, 132px) 0 96px",
      }}
    >
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "460px", height: "460px", left: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "320px", height: "320px", right: "-100px", bottom: "10%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: 820, marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Link href="/blog" className="art-back">← Volver al blog</Link>

        {/* Hero editorial */}
        <header className="art-hero">
          <div className="art-meta">
            {fecha && <span className="art-date">{fecha}</span>}
            {a.autor && <span className="art-dot">·</span>}
            {a.autor && <span>{a.autor}</span>}
          </div>
          <h1>{a.titulo}</h1>
          {a.descripcion && <p className="art-lead">{a.descripcion}</p>}
          {a.tags && a.tags.length > 0 && (
            <div className="art-tags">
              {a.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </header>

        {/* Portada */}
        {a.portada && (
          <div className="art-cover">
            <img src={a.portada} alt={a.titulo} />
          </div>
        )}

        {/* Contenido */}
        <div className="art-body">
          {a.contenido ? <PortableText value={a.contenido as PortableTextBlock[]} components={ptComponents} /> : <p className="art-empty">Contenido próximo.</p>}
        </div>

        {/* Autor + compartir */}
        <footer className="art-footer">
          <div className="art-author">
            <span className="art-author-mark" aria-hidden="true" />
            <div>
              <p className="art-author-label">Escrito por</p>
              <p className="art-author-name">{a.autor || "PixelArch"}</p>
            </div>
          </div>
          <ArticleShare url={url} titulo={a.titulo} />
        </footer>

        {/* Prev / Next */}
        {(anterior || siguiente) && (
          <nav className="art-nav">
            {anterior ? (
              <Link href={`/blog/${anterior.slug}`} className="art-nav-card">
                <span className="art-nav-dir">← Artículo anterior</span>
                <span className="art-nav-title">{anterior.titulo}</span>
              </Link>
            ) : <span />}
            {siguiente ? (
              <Link href={`/blog/${siguiente.slug}`} className="art-nav-card" style={{ textAlign: "right" }}>
                <span className="art-nav-dir">Siguiente artículo →</span>
                <span className="art-nav-title">{siguiente.titulo}</span>
              </Link>
            ) : <span />}
          </nav>
        )}

        {/* CTA auditoría */}
        <div className="art-cta">
          <div>
            <p className="art-cta-title">¿Querés aplicar esto a tu negocio?</p>
            <p className="art-cta-text">Te regalo una auditoría gratuita de tu web: velocidad, SEO, conversión y seguridad.</p>
          </div>
          <a href={whatsappUrl(AUDIT_MESSAGE)} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            Quiero mi auditoría gratis →
          </a>
        </div>
      </div>

      <style>{`
        .art-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: .75rem;
          color: var(--color-text-dim);
          margin-bottom: 44px;
          transition: color 0.2s;
        }
        .art-back:hover { color: var(--color-text) }
        .art-hero { text-align: center; margin-bottom: 40px }
        .art-meta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-family: var(--font-mono);
          font-size: .75rem;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          margin-bottom: 18px;
        }
        .art-dot { color: #8b5cf6 }
        .art-hero h1 {
          font-family: var(--font-pixel-display);
          font-weight: 700;
          letter-spacing: 0;
          font-size: clamp(1.9rem, 4.6vw, 3rem);
          line-height: 1.15;
          margin-bottom: 18px;
        }
        .art-lead {
          color: var(--color-text-dim);
          font-size: 1.15rem;
          line-height: 1.65;
          max-width: 60ch;
          margin-inline: auto;
        }
        .art-tags {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 14px;
          margin-top: 18px;
        }
        .art-tags span {
          font-family: var(--font-mono);
          font-size: .75rem;
          color: #22d3ee;
        }
        .art-cover {
          padding: 1px;
          border-radius: 22px;
          background: linear-gradient(135deg, rgba(139,92,246,.5), rgba(34,211,238,.35), transparent);
          margin-bottom: 48px;
        }
        .art-cover img {
          width: 100%;
          max-height: 460px;
          object-fit: cover;
          border-radius: 21px;
          display: block;
        }
        .art-body { font-size: 1.05rem }
        .art-body p {
          color: var(--color-text-dim);
          font-size: 1.05rem;
          line-height: 1.85;
          margin: 0 0 22px;
          max-width: 72ch;
        }
        .art-body strong { color: var(--color-text); font-weight: 600 }
        .art-body h2 {
          font-family: var(--font-display);
          font-size: 1.55rem;
          font-weight: 700;
          margin: 48px 0 16px;
          line-height: 1.25;
          position: relative;
          padding-left: 18px;
        }
        .art-body h2::before {
          content: "";
          position: absolute;
          left: 0;
          top: 8px;
          bottom: 8px;
          width: 3px;
          border-radius: 2px;
          background: linear-gradient(180deg, #8b5cf6, #22d3ee);
        }
        .art-body h3 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          font-weight: 700;
          margin: 32px 0 10px;
          line-height: 1.3;
        }
        .art-body ul, .art-body ol {
          margin: 0 0 22px;
          padding-left: 0;
          display: flex;
          flex-direction: column;
          gap: 9px;
          list-style: none;
        }
        .art-body ul li, .art-body ol li {
          position: relative;
          padding-left: 24px;
          color: var(--color-text-dim);
          font-size: 1.02rem;
          line-height: 1.75;
        }
        .art-body ul li::before {
          content: "";
          position: absolute;
          left: 4px;
          top: 10px;
          width: 7px;
          height: 7px;
          border-radius: 2px;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
        }
        .art-body ol { counter-reset: artnum }
        .art-body ol li { counter-increment: artnum }
        .art-body ol li::before {
          content: counter(artnum);
          position: absolute;
          left: 0;
          top: 2px;
          font-family: var(--font-mono);
          font-size: .8rem;
          color: #22d3ee;
        }
        .art-body blockquote {
          border-left: 3px solid #8b5cf6;
          background: rgba(139,92,246,0.06);
          padding: 16px 22px;
          margin: 26px 0;
          border-radius: 0 12px 12px 0;
          color: #d9d0f2;
          font-style: italic;
          font-size: 1.05rem;
          line-height: 1.7;
        }
        .art-body a { color: #8b5cf6; text-decoration: underline; text-underline-offset: 3px }
        .art-body code {
          font-family: var(--font-mono);
          font-size: .85em;
          background: rgba(139,92,246,0.1);
          padding: 2px 7px;
          border-radius: 6px;
          color: #c4b0ff;
        }
        .art-body img {
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          margin: 26px 0;
        }
        .art-empty { text-align: center; color: var(--color-text-dim); padding: 40px 0 }

        .art-footer {
          margin-top: 56px;
          padding-top: 32px;
          border-top: 1px solid rgba(255,255,255,0.07);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .art-author { display: flex; align-items: center; gap: 12px }
        .art-author-mark {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
        }
        .art-author-label { font-family: var(--font-mono); font-size: .68rem; letter-spacing: .12em; text-transform: uppercase; color: var(--color-text-faint) }
        .art-author-name { font-family: var(--font-display); font-weight: 700; font-size: .95rem }

        .art-nav {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 40px;
        }
        .art-nav-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 18px 20px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.07);
          background: linear-gradient(170deg, rgba(17,14,26,0.85), rgba(17,14,26,0.6));
          text-decoration: none;
          color: inherit;
          transition: border-color 0.25s, transform 0.25s;
        }
        .art-nav-card:hover { border-color: rgba(139,92,246,0.4); transform: translateY(-2px) }
        .art-nav-dir { font-family: var(--font-mono); font-size: .7rem; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-faint) }
        .art-nav-title { font-family: var(--font-display); font-weight: 600; font-size: .92rem; line-height: 1.4 }

        .art-cta {
          margin-top: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 22px;
          flex-wrap: wrap;
          padding: 26px 28px;
          border-radius: 18px;
          position: relative;
          background: linear-gradient(170deg, rgba(17,14,26,0.9), rgba(17,14,26,0.7));
          border: 1px solid rgba(139,92,246,0.2);
        }
        .art-cta::before {
          content: "";
          position: absolute;
          top: 0;
          left: 24px;
          right: 24px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .art-cta-title { font-family: var(--font-display); font-weight: 700; font-size: 1.08rem; margin-bottom: 6px }
        .art-cta-text { color: var(--color-text-dim); font-size: .92rem; line-height: 1.6; max-width: 46ch }

        @media (max-width: 640px) {
          .art-nav { grid-template-columns: 1fr }
          .art-cta { flex-direction: column; align-items: flex-start }
        }
      `}</style>
    </section>
  )
}