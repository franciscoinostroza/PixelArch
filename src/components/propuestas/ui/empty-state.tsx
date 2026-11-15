import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  icon?: ReactNode
  eyebrow?: string
  title: string
  description: ReactNode
  action?: ReactNode
  children?: ReactNode
}

/**
 * Estado vacio comun: icono, eyebrow opcional, titulo, descripcion y accion
 * opcional. El `title` se mantiene como `h2` para conservar la jerarquia de
 * encabezados de las paginas.
 */
export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  action,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <section className={cn("p-empty", className)} {...rest}>
      {icon !== undefined ? (
        <span className="p-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {eyebrow ? <p className="p-empty-eyebrow">{eyebrow}</p> : null}
      <h2 className="p-empty-title">{title}</h2>
      <div className="p-empty-description">{description}</div>
      {children}
      {action !== undefined ? (
        <div className="p-empty-action">{action}</div>
      ) : null}
    </section>
  )
}
