import Link from "next/link"

export function Footer() {
  return (
    <footer className="site-footer" style={{
      position: "relative",
      zIndex: 1,
      borderTop: "1px solid rgba(255,255,255,0.08)",
      padding: "36px 0",
      background: "rgba(7,6,12,0.85)",
    }}>
      <div
        className="wrap footer-inner"
        style={{
          maxWidth: "var(--maxw, 1180px)",
          marginInline: "auto",
          paddingInline: "clamp(20px, 5vw, 56px)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "20px",
          flexWrap: "wrap",
          fontSize: ".85rem",
          color: "var(--color-text-faint)",
        }}
      >
        <a href="#inicio" className="footer-logo" style={{ opacity: 0.6, transition: "opacity 0.25s", display: "flex" }}>
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#logoGrad)"/>
            <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#logoGrad)" opacity=".5"/>
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8b5cf6"/>
                <stop offset="1" stopColor="#22d3ee"/>
              </linearGradient>
            </defs>
          </svg>
        </a>
        <p>© {new Date().getFullYear()} PixelArch. Todos los derechos reservados.</p>
        <div className="footer-status" style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontFamily: "var(--font-mono)",
          fontSize: ".75rem",
        }}>
          <span style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: "#34d399",
            boxShadow: "0 0 8px rgba(52,211,153,0.7)",
            flexShrink: 0,
          }} aria-hidden="true" />
          Disponible para nuevos proyectos
        </div>
        <div className="footer-links" style={{ display: "flex", gap: "22px" }}>
          <Link href="/terminos" style={{ color: "var(--color-text-faint)", transition: "color 0.2s" }}>Términos</Link>
          <Link href="/privacidad" style={{ color: "var(--color-text-faint)", transition: "color 0.2s" }}>Privacidad</Link>
        </div>
      </div>
    </footer>
  )
}
