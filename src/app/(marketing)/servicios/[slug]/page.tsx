import { sanityFetch } from "@/lib/sanity"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

const SERVICIO_QUERY = `*[_type == "servicio" && slug.current == $slug][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  icono,
  tags
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
  } | null>(SERVICIO_QUERY, { slug })

  if (!servicio) notFound()

  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <Link
        href="/servicios"
        className="inline-flex items-center gap-2 text-sm text-muted font-mono hover:text-text transition-colors mb-8"
      >
        <ArrowLeft size={16} /> Volver
      </Link>

      <span className="text-5xl">{servicio.icono || "⚡"}</span>
      <h1 className="mt-4 text-4xl font-bold text-text font-display md:text-5xl">
        {servicio.titulo}
      </h1>
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

      <div className="mt-12">
        <Link
          href="/#contacto"
          className={cn(buttonVariants({ size: "lg" }))}
        >
          Solicitar información
        </Link>
      </div>
    </div>
  )
}
