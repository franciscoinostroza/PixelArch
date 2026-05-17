import Link from "next/link"
import { SectionLabel } from "@/components/ui/section-label"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ServiceItem {
  titulo: string
  slug: string
  descripcion: string
  icono: string
  tags: string[]
  precio: number
  intervalo: string
  paddlePriceId: string
}

interface ServicesProps {
  servicios: ServiceItem[]
}

function formatPrice(precio: number, intervalo: string) {
  const label = intervalo === "ANUAL" ? "/ano" : "/mes"
  return `$${(precio / 100).toFixed(0)}${label}`
}

export function Services({ servicios }: ServicesProps) {
  return (
    <section id="servicios" className="mx-auto max-w-7xl px-6 py-24">
      <div className="text-center">
        <SectionLabel>Servicios</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
          Soluciones a medida
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted font-mono">
          Desde una landing page hasta un agente de IA autonomo. Elegi lo que tu
          negocio necesita.
        </p>
      </div>

      <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {servicios.map((s) => (
          <Link key={s.slug} href={`/servicios/${s.slug}`}>
            <Card className="h-full transition-colors hover:border-accent/30">
              <CardHeader>
                <span className="text-3xl">{s.icono || "⚡"}</span>
                <div className="flex items-center justify-between">
                  <CardTitle className="mt-3">{s.titulo}</CardTitle>
                  {s.precio > 0 && (
                    <Badge variant="accent2" className="text-xs">
                      {formatPrice(s.precio, s.intervalo)}
                    </Badge>
                  )}
                </div>
                <CardDescription>{s.descripcion}</CardDescription>
              </CardHeader>
              <div className="flex flex-wrap gap-2 mt-2">
                {s.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-bg2 px-2 py-0.5 text-[10px] text-muted font-mono"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}
