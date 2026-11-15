import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  /** Indicador compacto junto al titulo (estado, pill, etc.). */
  status?: ReactNode
  /** Acciones principales de la pagina. */
  actions?: ReactNode
  className?: string
}

/**
 * Cabecera comun del portal de propuestas.
 *
 * Solo presentacion: no decide permisos ni ejecuta acciones. El titulo es el
 * `h1` de la pagina y los slots de estado/acciones se alinean a la derecha en
 * pantallas anchas.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
  className,
}: PageHeaderProps) {
  const tieneSlot = status !== undefined || actions !== undefined

  return (
    <header className={cn("p-page-head", className)}>
      <div className="p-page-head-main">
        {eyebrow ? <p className="p-eyebrow">{eyebrow}</p> : null}
        <h1 className="p-title">{title}</h1>
        {description ? <div className="p-description">{description}</div> : null}
      </div>
      {tieneSlot ? (
        <div className="p-page-head-slots">
          {status !== undefined ? (
            <div className="p-page-head-status">{status}</div>
          ) : null}
          {actions !== undefined ? (
            <div className="p-page-head-actions">{actions}</div>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
