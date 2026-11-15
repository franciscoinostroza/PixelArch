import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatusTone =
  | "neutral"
  | "violet"
  | "cyan"
  | "mint"
  | "amber"
  | "red"

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
  children: ReactNode
}

/**
 * Pill compacta para estados y etiquetas. Acepta `children` para poder incluir
 * un icono (aria-hidden) junto al texto sin perder el nombre accesible.
 */
export function StatusPill({
  tone = "neutral",
  className,
  children,
  ...rest
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "p-pill",
        tone !== "neutral" && `p-pill--${tone}`,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
