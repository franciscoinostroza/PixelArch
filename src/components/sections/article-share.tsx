"use client"

import { useState } from "react"
import { Check, Link2 } from "lucide-react"

export function ArticleShare({ url, titulo }: { url: string; titulo: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt("Copiá el link:", url)
    }
  }

  const wa = `https://wa.me/?text=${encodeURIComponent(`${titulo} — ${url}`)}`

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 20 }}>
      <button
        onClick={copyLink}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
          color: "var(--color-text)", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", transition: "0.2s",
        }}
      >
        {copied ? <Check size={14} style={{ color: "#34d399" }} /> : <Link2 size={14} />}
        {copied ? "Link copiado" : "Copiar link"}
      </button>
      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 10,
          border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)",
          color: "#34d399", fontSize: ".85rem", fontWeight: 600, textDecoration: "none", transition: "0.2s",
        }}
      >
        Compartir por WhatsApp
      </a>
    </div>
  )
}