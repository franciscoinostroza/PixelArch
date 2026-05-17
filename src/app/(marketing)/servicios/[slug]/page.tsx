import { sanityFetch } from "@/lib/sanity"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CheckoutButton } from "@/components/ui/checkout-button"

const SERVICIO_QUERY = `*[_type == "servicio" && slug.current == $slug][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  icono,
  tags,
  precio,
  intervalo,
  paddlePriceId
}`

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const servicio = await sanityFetch<{ titulo: string; descripcion: string } | null>(
    SERVICIO_QUERY,
    { slug }
  )
  if (!servicio) return { title: "Servicio no encontrado" }
  return {
    title: `${servicio.titulo} — PixelArch`,
    description: servicio.descripcion,
  }
}

function formatPrice(precio: number, intervalo: string) {
  if (!precio) return null
  const label = intervalo === "ANUAL" ? "/ano" : "/mes"
  return `$${(precio / 100).toFixed(0)}${label}`
}

export default async function ServicioPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const servicio = await sanityFetch<{
    titulo: string
    slug: string
    descripcion: string
    icono: string
    tags: string[]
    precio: number
    intervalo: string
    paddlePriceId: string
  } | null>(SERVICIO_QUERY, { slug })

  if (!servicio) notFound()

  const priceLabel = formatPrice(servicio.precio, servicio.intervalo)

  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <Link
        href="/servicios"
        className="inline-flex items-center gap-2 text-sm text-muted font-mono hover:text-text transition-colors mb-8"
      >
        <ArrowLeft size={16} /> Volver
      </Link>

      <span className="text-5xl">{servicio.icono || "⚡"}</span>
      <div className="flex items-center gap-4 mt-4">
        <h1 className="text-4xl font-bold text-text font-display md:text-5xl">
          {servicio.titulo}
        </h1>
        {priceLabel && (
          <Badge variant="accent2" className="text-lg px-3 py-1">
            {priceLabel}
          </Badge>
        )}
      </div>
      <p className="mt-6 text-lg text-muted font-mono leading-relaxed">
        {servicio.descripcion}
      </p>

      {servicio.tags?.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {servicio.tags.map((tag) => (
            <Badge key={tag} variant="accent">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-12 flex items-center gap-4">
        {servicio.paddlePriceId ? (
          <CheckoutButton
            paddlePriceId={servicio.paddlePriceId}
            servicioNombre={servicio.titulo}
          />
        ) : (
          <Link
            href="/#contacto"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            Solicitar informacion
          </Link>
        )}
      </div>
    </div>
  )
}
