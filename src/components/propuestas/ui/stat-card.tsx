import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatAccent = "violet" | "cyan" | "mint" | "amber" | "red"

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  accent?: StatAccent
  className?: string
}

/**
 * Tarjeta de metrica: etiqueta mono, valor destacado, hint opcional e icono.
 * El acento es decorativo; el dato siempre se lee por el texto.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "violet",
  className,
}: StatCardProps) {
  return (
    <div className={cn("p-stat", `p-stat--${accent}`, className)}>
      {icon !== undefined ? (
        <span className="p-stat-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="p-stat-copy">
        <p className="p-stat-label">{label}</p>
        <p className="p-stat-value">{value}</p>
        {hint !== undefined ? <p className="p-stat-hint">{hint}</p> : null}
      </div>
    </div>
  )
}
