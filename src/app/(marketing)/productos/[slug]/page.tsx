import { sanityFetch } from "@/lib/sanity"
import { Badge } from "@/components/ui/badge"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { CheckoutButton } from "@/components/ui/checkout-button"

const SERVICIO_QUERY = `*[_type == "servicio" && slug.current == $slug][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  icono,
  tags
}`

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = await sanityFetch<{ titulo: string; descripcion: string } | null>(SERVICIO_QUERY, { slug })
  if (!s) return { title: "Producto no encontrado" }
  return { title: `${s.titulo} — PixelArch`, description: s.descripcion }
}

const SLUG_TO_ID: Record<string, string> = {
  "desarrollo-web": "servicio-desarrollo-web",
  "chatbot": "servicio-chatbot",
  "agentes-ia": "servicio-agentes-ia",
  "landing-pages": "servicio-landing-pages",
  "automatizaciones": "servicio-automatizaciones",
  "integraciones": "servicio-integraciones",
}

export default async function ProductoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [servicioSanity, servicioDB] = await Promise.all([
    sanityFetch<{ titulo: string; slug: string; descripcion: string; icono: string; tags: string[] } | null>(SERVICIO_QUERY, { slug }),
    prisma.servicio.findUnique({ where: { id: SLUG_TO_ID[slug] ?? "" } }),
  ])

  if (!servicioSanity) notFound()

  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`

  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <Link href="/productos" className="inline-flex items-center gap-2 text-sm text-muted font-mono hover:text-text transition-colors mb-8">
        <ArrowLeft size={16} /> Volver
      </Link>

      <span className="text-5xl">{servicioSanity.icono || "⚡"}</span>
      <h1 className="mt-4 text-4xl font-bold text-text font-display md:text-5xl">{servicioSanity.titulo}</h1>
      <p className="mt-6 text-lg text-muted font-mono leading-relaxed">{servicioSanity.descripcion}</p>

      {servicioSanity.tags?.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {servicioSanity.tags.map((tag) => <Badge key={tag} variant="accent">{tag}</Badge>)}
        </div>
      )}

      {servicioDB && (
        <div className="mt-16">
          <div className="rounded-xl border-2 border-accent/30 bg-bg2 p-8 text-center">
            <p className="text-xs uppercase tracking-[0.12em] text-[#4a5568] font-mono mb-3">Pago unico</p>
            <p className="font-display text-4xl font-extrabold tracking-[-0.04em]">{price(servicioDB.precioUnico)}</p>
            <p className="text-sm text-muted mt-2 mb-6">Incluye la entrega completa del proyecto</p>
            {servicioDB.polarProductIdUnico && (
              <CheckoutButton polarProductId={servicioDB.polarProductIdUnico} servicioNombre={servicioSanity.titulo} tipo="UNICO" label={`Contratar ${servicioSanity.titulo}`} />
            )}
          </div>

          <div className="mt-4 rounded-xl border border-border/50 bg-bg2/50 p-5 text-[13px] text-muted leading-relaxed">
            <span className="text-accent font-semibold">ℹ️ Después de la entrega</span>
            <br />
            El proyecto se entrega completo con el pago único. Para mantenerlo activo mes a mes con cambios, soporte y actualizaciones, podés activar el plan de mantenimiento desde tu portal. Sin mantenimiento, el servicio no recibe soporte después del primer mes.
          </div>
        </div>
      )}
    </div>
  )
}
