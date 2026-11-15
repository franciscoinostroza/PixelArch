import type { ReactNode } from "react"
import { Inbox } from "lucide-react"
import { EmptyState } from "@/components/propuestas/ui/empty-state"
import { Panel } from "@/components/propuestas/ui/panel"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"

interface EstadoVacioProps {
  titulo: string
  descripcion: string
  /** Accion opcional (por ejemplo, el CTA para crear la primera campaña). */
  accion?: ReactNode
}

export function EstadoVacio({
  titulo,
  descripcion,
  accion,
}: EstadoVacioProps) {
  return (
    <EmptyState
      aria-label={titulo}
      data-variante="vacio"
      icon={<Inbox size={20} aria-hidden="true" />}
      eyebrow="Portal de propuestas"
      title={titulo}
      description={descripcion}
      action={accion}
    />
  )
}

interface EstadoOperativoProps {
  codigo: string
  titulo: string
  descripcion: string
  fecha?: Date
}

export function EstadoOperativo({
  codigo,
  titulo,
  descripcion,
  fecha,
}: EstadoOperativoProps) {
  return (
    <Panel
      role="alert"
      aria-label={titulo}
      data-estado={codigo}
      data-variante="operativo"
      tone="warn"
      eyebrow={codigo}
      title={titulo}
      description={descripcion}
    >
      {fecha ? (
        <p className="p-panel-meta">
          Comprobado:{" "}
          <time dateTime={fecha.toISOString()}>
            {formatearFechaHoraPortal(fecha)}
          </time>
        </p>
      ) : null}
    </Panel>
  )
}
