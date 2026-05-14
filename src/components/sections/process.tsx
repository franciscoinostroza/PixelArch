import { SectionLabel } from "@/components/ui/section-label"

interface PasoItem {
  titulo: string
  descripcion: string
}

interface ProcessProps {
  pasos: PasoItem[]
}

export function Process({ pasos }: ProcessProps) {
  if (!pasos?.length) return null

  return (
    <section className="border-t border-border bg-bg2 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <SectionLabel>Proceso</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
            Cómo trabajamos
          </h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {pasos.map((p, i) => (
            <div key={i} className="relative text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-lg font-bold text-accent font-display">
                {i + 1}
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-text">
                {p.titulo}
              </h3>
              <p className="mt-2 text-sm text-muted font-mono">{p.descripcion}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
