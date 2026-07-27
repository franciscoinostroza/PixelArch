import { sanityFetch } from "@/lib/sanity"
import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Productos — PixelArch",
  description: "Conoce todos nuestros productos: desarrollo web, chatbots, agentes de IA y mas.",
  alternates: { canonical: "/productos" },
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
    <section className="productos-page" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "0%" }} aria-hidden="true" />
      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Productos" }]} />
        <div className="section-head" style={{ maxWidth: "600px", marginBottom: "52px" }}>
          <p className="eyebrow">Productos</p>
          <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.7rem, 3.2vw, 2.5rem)", marginBottom: "14px" }}>Elegí la pieza que tu negocio necesita</h2>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem" }}>Desde un sitio institucional hasta un agente de IA corriendo sobre infraestructura propia.</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {servicios?.map((s) => (
            <Link key={s.slug} href={`/productos/${s.slug}`}>
              <Card className="h-full transition-colors hover:border-violet/30">
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
                      className="rounded-full border border-border bg-panel px-2 py-0.5 text-[10px] text-text-dim font-mono"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
          {(!servicios || servicios.length === 0) && (
            <div className="col-span-full py-12 text-center text-text-dim font-mono text-sm">
              No hay servicios disponibles en este momento.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
