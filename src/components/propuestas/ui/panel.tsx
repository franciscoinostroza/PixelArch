import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PanelTone = "default" | "warn" | "danger"

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tone?: PanelTone
  children?: ReactNode
}

/**
 * Panel base del portal: header opcional (eyebrow, titulo, descripcion y
 * acciones) y body opcional. El tono solo cambia el borde/fondo; no transmite
 * estado por color sin texto.
 */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  tone = "default",
  className,
  children,
  ...rest
}: PanelProps) {
  const tieneHeader =
    eyebrow !== undefined ||
    title !== undefined ||
    description !== undefined ||
    actions !== undefined
  const tieneBody = children !== undefined && children !== null

  return (
    <section
      className={cn(
        "p-panel",
        tone !== "default" && `p-panel--${tone}`,
        className,
      )}
      {...rest}
    >
      {tieneHeader ? (
        <div className="p-panel-head">
          <div className="p-panel-heading">
            {eyebrow !== undefined ? (
              <p className="p-panel-eyebrow">{eyebrow}</p>
            ) : null}
            {title !== undefined ? (
              <h2 className="p-panel-title">{title}</h2>
            ) : null}
            {description !== undefined ? (
              <div className="p-panel-description">{description}</div>
            ) : null}
          </div>
          {actions !== undefined ? (
            <div className="p-panel-actions">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {tieneBody ? <div className="p-panel-body">{children}</div> : null}
    </section>
  )
}
