import { sanityFetch } from "@/lib/sanity"
import Link from "next/link"
import { SectionLabel } from "@/components/ui/section-label"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Productos — PixelArch",
  description: "Conoce todos nuestros productos: desarrollo web, chatbots, agentes de IA y mas.",
}

const SERVICIOS_QUERY = `*[_type == "servicio" && activo == true] | order(orden asc) {
  titulo,
  "slug": slug.current,
  descripcion,
  icono,
  tags,
  precioUnico,
  precioBasico,
  precioMantenimiento
}`

function formatPrice(precio: number) {
  if (!precio) return null
  return `$${(precio / 100).toFixed(0)}`
}

function priceLabel(s: { precioUnico: number; precioBasico: number }) {
  if (!s.precioBasico) return null
  return `Desde ${formatPrice(s.precioBasico)}/mes`
}

export default async function ProductosPage() {
  const servicios = await sanityFetch<
    { titulo: string; slug: string; descripcion: string; icono: string; tags: string[]; precioUnico: number; precioBasico: number; precioMantenimiento: number }[]
  >(SERVICIOS_QUERY)

  return (
    <div className="mx-auto max-w-7xl px-6 py-24">
      <div className="text-center">
        <SectionLabel>Productos</SectionLabel>
        <h1 className="mt-4 text-4xl font-bold text-text font-display md:text-6xl">
          Soluciones a medida
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted font-mono">
          Elegi el producto que mejor se adapte a tu negocio. Todos incluyen
          soporte y mantenimiento.
        </p>
      </div>

      <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {servicios?.map((s) => (
          <Link key={s.slug} href={`/productos/${s.slug}`}>
            <Card className="h-full transition-colors hover:border-accent/30">
              <CardHeader>
                <span className="text-3xl">{s.icono || "⚡"}</span>
                <div className="flex items-center justify-between">
                  <CardTitle className="mt-3">{s.titulo}</CardTitle>
                  {s.precioBasico > 0 && (
                    <Badge variant="accent2" className="text-xs shrink-0">
                      {priceLabel(s)}
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
        {(!servicios || servicios.length === 0) && (
          <div className="col-span-full py-12 text-center text-muted font-mono text-sm">
            No hay servicios disponibles en este momento.
          </div>
        )}
      </div>
    </div>
  )
}
