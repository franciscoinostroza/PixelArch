import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface TableShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Caption accesible/visible de la tabla. */
  caption?: ReactNode
  children: ReactNode
}

/**
 * Wrapper de tablas del portal: scroll horizontal contenido y `caption`
 * opcional. El consumidor aporta `thead`/`tbody` como children.
 */
export function TableShell({
  caption,
  className,
  children,
  ...rest
}: TableShellProps) {
  return (
    <div className={cn("p-table-wrap", className)} {...rest}>
      <table className="p-table">
        {caption !== undefined ? (
          <caption className="p-table-caption">{caption}</caption>
        ) : null}
        {children}
      </table>
    </div>
  )
}
