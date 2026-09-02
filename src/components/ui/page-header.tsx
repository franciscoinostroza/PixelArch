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
          fontSize: "clamp(1.5rem, 2.5vw, 2rem)",
          marginBottom: "8px",
        }}
      >
        {title}
      </h2>
      {subtitle && <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>{subtitle}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  )
}
