import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"

interface EstadoVacioProps {
  titulo: string
  descripcion: string
}

export function EstadoVacio({ titulo, descripcion }: EstadoVacioProps) {
  return (
    <section
      aria-label={titulo}
      className="rounded-xl border border-border bg-panel p-8"
    >
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
        Portal de propuestas
      </p>
      <h2 className="mt-3 font-display text-2xl font-semibold text-text">
        {titulo}
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm leading-6 text-text-dim">
        {descripcion}
      </p>
    </section>
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
    <section
      role="alert"
      aria-label={titulo}
      data-estado={codigo}
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-8"
    >
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber-300">
        {codigo}
      </p>
      <h2 className="mt-3 font-display text-2xl font-semibold text-text">
        {titulo}
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm leading-6 text-text-dim">
        {descripcion}
      </p>
      {fecha && (
        <p className="mt-4 font-mono text-xs text-text-faint">
          Comprobado:{" "}
          <time dateTime={fecha.toISOString()}>
            {formatearFechaHoraPortal(fecha)}
          </time>
        </p>
      )}
    </section>
  )
}
