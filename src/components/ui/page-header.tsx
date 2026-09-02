export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div style={{ maxWidth: "640px", marginBottom: "36px" }}>
      <h2
        style={{
          fontFamily: "var(--font-pixel-display)",
          fontWeight: 700,
          letterSpacing: 0,
          fontSize: "clamp(1.6rem, 3vw, 2.4rem)",
          lineHeight: 1.15,
          marginBottom: "10px",
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p style={{ color: "var(--color-text-dim)", fontSize: ".95rem", maxWidth: "60ch", lineHeight: 1.6 }}>
          {subtitle}
        </p>
      )}
      {children && <div className="mt-5 flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  )
}
