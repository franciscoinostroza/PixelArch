export default function LogoPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#07060c", gap: "28px" }}>
      {/* Logo container 720x720 */}
      <div style={{
        width: "720px", height: "720px", maxWidth: "90vw", maxHeight: "90vw",
        background: "#07060c", borderRadius: "40px",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        {/* Squares */}
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8b5cf6"/>
              <stop offset="1" stopColor="#22d3ee"/>
            </linearGradient>
          </defs>
          <rect x="30" y="30" width="80" height="80" rx="20" fill="url(#g)"/>
          <rect x="90" y="90" width="80" height="80" rx="20" fill="url(#g)" opacity="0.5"/>
        </svg>

        {/* Text */}
        <span style={{
          fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: "68px",
          color: "#f6f5f8", letterSpacing: "-0.5px", marginTop: "16px",
        }}>
          Pixel<span style={{
            background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>Arch</span>
        </span>

        {/* Accent line */}
        <div style={{
          width: "160px", height: "2px",
          background: "linear-gradient(90deg,transparent,#8b5cf6,#22d3ee,transparent)",
          marginTop: "16px",
        }} />

        {/* Subtitle */}
        <p style={{
          fontFamily: '"JetBrains Mono", monospace', fontSize: "14px",
          color: "#645f74", marginTop: "16px",
        }}>
          SOFTWARE + INFRASTRUCTURE
        </p>
      </div>

      {/* Download link */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <a
          href="/logo-google.svg"
          download="pixelarch-logo.svg"
          style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px",
            padding: "14px 32px", borderRadius: "10px", textDecoration: "none",
            background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c",
            display: "inline-block",
          }}
        >
          Download SVG
        </a>
        <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "#645f74" }}>
          720×720 · Subilo a Google Business Profile · O usa print-screen
        </p>
      </div>
    </div>
  )
}
