import { sanityFetch } from "@/lib/sanity"
import type { Metadata } from "next"
import { BlogGrid, type BlogPost } from "@/components/sections/blog-grid"
import { estimateReadingMinutes } from "@/lib/reading-time"

export const metadata: Metadata = {
  title: "Blog — PixelArch",
  description: "Artículos sobre desarrollo web, chatbots, agentes de IA, automatizaciones y más.",
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": "/rss.xml" },
  },
}

const ARTICULOS_QUERY = `*[_type == "articulo" && activo == true] | order(fecha desc) {
  _id,
  titulo,
  "slug": slug.current,
  descripcion,
  fecha,
  autor,
  tags,
  contenido,
  "portada": portada.asset->url
}`

export default async function BlogPage() {
  const articulos = await sanityFetch<
    { _id: string; titulo: string; slug: string; descripcion?: string; fecha: string; autor?: string; tags?: string[]; contenido?: unknown[]; portada?: string }[]
  >(ARTICULOS_QUERY)

  const posts: BlogPost[] = (articulos || []).map((a) => ({
    _id: a._id,
    titulo: a.titulo,
    slug: a.slug,
    descripcion: a.descripcion,
    fecha: a.fecha,
    autor: a.autor,
    tags: a.tags,
    portada: a.portada,
    minutes: estimateReadingMinutes(a.contenido),
  }))

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
        <div className="section-head" style={{ marginBottom: "40px" }}>
          <p className="eyebrow">Blog</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            Ideas, guías y consejos técnicos
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.7 }}>
            Artículos sobre desarrollo web, chatbots, agentes de IA y automatizaciones que usamos en PixelArch.
          </p>
        </div>

        <BlogGrid posts={posts} />
      </div>
    </section>
  )
}