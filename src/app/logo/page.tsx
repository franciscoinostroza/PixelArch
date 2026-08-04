export default function LogoPage() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#07060c" }}>
      <div style={{
        width: "720px", height: "720px", background: "#07060c",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        borderRadius: "40px", position: "relative",
      }}>
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8b5cf6"/>
              <stop offset="1" stopColor="#22d3ee"/>
            </linearGradient>
          </defs>
          <rect x="30" y="30" width="80" height="80" rx="18" fill="url(#logoGrad)"/>
          <rect x="90" y="90" width="80" height="80" rx="18" fill="url(#logoGrad)" opacity="0.5"/>
        </svg>
        <span style={{
          fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: "68px", color: "#f6f5f8",
          letterSpacing: "-0.5px", marginTop: "20px",
        }}>
          Pixel<span style={{
            background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>Arch</span>
        </span>
        <div style={{ width: "160px", height: "2px", background: "linear-gradient(90deg,transparent,#8b5cf6,#22d3ee,transparent)", marginTop: "16px" }} />
        <p style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "14px", letterSpacing: "0.15em", color: "#645f74", marginTop: "16px" }}>
          SOFTWARE + INFRASTRUCTURE
        </p>
      </div>
    </div>
  )
}
