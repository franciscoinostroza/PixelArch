import { sanityFetch } from "@/lib/sanity"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { PortableText, type PortableTextBlock } from "@portabletext/react"
import { whatsappUrl, AUDIT_MESSAGE } from "@/lib/contact"

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
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, margin: "40px 0 14px", lineHeight: 1.25 }}>{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", fontWeight: 700, margin: "32px 0 10px", lineHeight: 1.3 }}>{children}</h3>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.8, margin: "0 0 18px", maxWidth: "70ch" }}>{children}</p>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote style={{ borderLeft: "3px solid #8b5cf6", padding: "12px 20px", margin: "24px 0", background: "rgba(139,92,246,0.06)", borderRadius: "0 12px 12px 0", color: "var(--color-text)" }}>{children}</blockquote>
    ),
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => <ul style={{ margin: "0 0 18px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>{children}</ul>,
    number: ({ children }: { children?: React.ReactNode }) => <ol style={{ margin: "0 0 18px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>{children}</ol>,
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => <li style={{ color: "var(--color-text-dim)", fontSize: "1rem", lineHeight: 1.7 }}>{children}</li>,
    number: ({ children }: { children?: React.ReactNode }) => <li style={{ color: "var(--color-text-dim)", fontSize: "1rem", lineHeight: 1.7 }}>{children}</li>,
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    code: ({ children }: { children?: React.ReactNode }) => (
      <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em", background: "rgba(139,92,246,0.1)", padding: "2px 6px", borderRadius: 6, color: "#c4b0ff" }}>{children}</code>
    ),
    link: ({ children, value }: { children?: React.ReactNode; value?: { href?: string } }) => (
      <a href={value?.href} target="_blank" rel="noopener noreferrer" style={{ color: "#8b5cf6", textDecoration: "underline" }}>{children}</a>
    ),
  },
  types: {
    image: ({ value }: { value?: { asset?: { url?: string }; alt?: string } }) =>
      value?.asset?.url ? (
        <img src={value.asset.url} alt={value.alt || ""} style={{ width: "100%", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", margin: "24px 0" }} />
      ) : null,
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

  const fecha = a.fecha
    ? new Date(a.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : null

  return (
    <section
      className="articulo"
      style={{
        position: "relative",
        zIndex: 1,
        overflow: "hidden",
        background: "rgba(7,6,12,0.88)",
        backdropFilter: "blur(3px)",
        padding: "clamp(88px, 10vw, 132px) 0",
      }}
    >
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "420px", height: "420px", left: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: 860, marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Link href="/blog" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: ".75rem", color: "var(--color-text-dim)", marginBottom: 32, transition: "color 0.2s" }}>← Volver al blog</Link>

        <div className="articulo-head" style={{ marginBottom: 36 }}>
          <div className="articulo-meta" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            {fecha && <span style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-text-faint)" }}>{fecha}</span>}
            {a.autor && <span style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem", color: "var(--color-text-faint)" }}>· {a.autor}</span>}
            {a.tags?.map((t) => (
              <span key={t} style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem", color: "#22d3ee" }}>#{t}</span>
            ))}
          </div>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1.15, marginBottom: 16 }}>{a.titulo}</h1>
          {a.descripcion && <p style={{ color: "var(--color-text-dim)", fontSize: "1.1rem", lineHeight: 1.6, maxWidth: "60ch" }}>{a.descripcion}</p>}
        </div>

        {a.portada && (
          <img src={a.portada} alt={a.titulo} style={{ width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 40 }} />
        )}

        <div className="articulo-body">{a.contenido ? <PortableText value={a.contenido as PortableTextBlock[]} components={ptComponents} /> : <p style={{ color: "var(--color-text-dim)" }}>Contenido próximo.</p>}</div>

        <div
          className="articulo-cta"
          style={{
            marginTop: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
            border: "1px dashed rgba(139,92,246,0.4)",
            borderRadius: 16,
            padding: "24px 26px",
            background: "rgba(139,92,246,0.04)",
          }}
        >
          <div style={{ minWidth: 240, flex: 1 }}>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>¿Querés aplicar esto a tu negocio?</p>
            <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem", lineHeight: 1.6 }}>
              Te regalo una auditoría gratuita de tu web: velocidad, SEO, conversión y seguridad.
            </p>
          </div>
          <a
            href={whatsappUrl(AUDIT_MESSAGE)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
          >
            Quiero mi auditoría gratis →
          </a>
        </div>
      </div>
    </section>
  )
}