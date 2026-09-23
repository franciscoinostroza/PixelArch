"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

export interface BlogPost {
  _id: string
  titulo: string
  slug: string
  descripcion?: string
  fecha: string
  autor?: string
  tags?: string[]
  portada?: string
  minutes: number
}

export function BlogGrid({ posts }: { posts: BlogPost[] }) {
  const [tag, setTag] = useState<string | null>(null)

  const tags = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const p of posts) {
      for (const t of p.tags || []) {
        if (!seen.has(t)) {
          seen.add(t)
          list.push(t)
        }
      }
    }
    return list
  }, [posts])

  const filtered = tag ? posts.filter((p) => p.tags?.includes(tag)) : posts

  if (posts.length === 0) {
    return (
      <p style={{ color: "var(--color-text-dim)", fontSize: "1rem", textAlign: "center", padding: "40px 0" }}>
        Todavía no hay artículos publicados. ¡Volvé pronto!
      </p>
    )
  }

  return (
    <>
      {tags.length > 1 && (
        <div className="blog-chips" role="tablist" aria-label="Filtrar por tema">
          <button
            type="button"
            className={tag === null ? "on" : ""}
            onClick={() => setTag(null)}
            aria-pressed={tag === null}
          >
            Todos
          </button>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={tag === t ? "on" : ""}
              onClick={() => setTag(tag === t ? null : t)}
              aria-pressed={tag === t}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="blog-grid">
        {filtered.map((a) => (
          <Link key={a._id} href={`/blog/${a.slug}`} className="blog-card">
            <div className="blog-cover">
              {a.portada ? (
                <img src={a.portada} alt={a.titulo} loading="lazy" />
              ) : (
                <span aria-hidden="true" style={{ fontSize: 34 }}>📄</span>
              )}
              <span className="blog-read">{a.minutes} min de lectura</span>
            </div>
            <div className="blog-body">
              <div className="blog-meta">
                {a.fecha && (
                  <span className="blog-date">
                    {new Date(a.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                {a.tags?.slice(0, 2).map((t) => (
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

      {filtered.length === 0 && (
        <p style={{ color: "var(--color-text-dim)", fontSize: "0.95rem", textAlign: "center", padding: "30px 0" }}>
          No hay artículos con ese tema todavía.
        </p>
      )}

      <style>{`
        .blog-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 28px;
        }
        .blog-chips button {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-cyan);
          border: 1px solid rgba(34,211,238,0.3);
          background: rgba(34,211,238,0.07);
          border-radius: 999px;
          padding: 7px 14px;
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .blog-chips button:hover { background: rgba(34,211,238,0.16) }
        .blog-chips button.on {
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          border-color: transparent;
          font-weight: 600;
        }
        .blog-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 22px;
        }
        .blog-card {
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
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
          position: relative;
        }
        .blog-cover img { width: 100%; height: 100%; object-fit: cover }
        .blog-read {
          position: absolute;
          bottom: 10px;
          right: 12px;
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          color: var(--color-text-dim);
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(7,6,12,0.7);
          padding: 3px 10px;
          border-radius: 999px;
        }
        .blog-body { padding: 22px 22px 24px; display: flex; flex-direction: column; flex: 1 }
        .blog-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 10px }
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
        .blog-body h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; line-height: 1.25 }
        .blog-body p { color: var(--color-text-dim); font-size: 0.9rem; line-height: 1.65; margin-bottom: 16px; flex: 1 }
        .blog-more { color: #8b5cf6; font-weight: 600; font-size: 0.85rem }
      `}</style>
    </>
  )
}