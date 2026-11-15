import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface FieldProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label: ReactNode
  /** Id del control asociado; el consumidor mantiene el control real. */
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

/**
 * Envoltorio de campo para formularios del portal: label, control, hint y
 * error. No genera ids ni estados: el formulario sigue siendo responsable de
 * `aria-invalid`/`aria-describedby`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldProps) {
  return (
    <div className={cn("p-field", className)} {...rest}>
      <label className="p-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p className="p-field-hint">{hint}</p>
      ) : null}
      {error !== undefined ? <p className="p-field-error">{error}</p> : null}
    </div>
  )
}
