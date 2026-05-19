import { sanityFetch } from "@/lib/sanity"
import { Badge } from "@/components/ui/badge"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Shield, Wrench } from "lucide-react"
import { CheckoutButton } from "@/components/ui/checkout-button"
import { prisma } from "@/lib/prisma"

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
  if (!s) return { title: "Servicio no encontrado" }
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

export default async function ServicioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [servicioSanity, servicioDB] = await Promise.all([
    sanityFetch<{ titulo: string; slug: string; descripcion: string; icono: string; tags: string[] } | null>(SERVICIO_QUERY, { slug }),
    prisma.servicio.findUnique({ where: { id: SLUG_TO_ID[slug] ?? "" } }),
  ])

  if (!servicioSanity) notFound()

  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`

  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <Link href="/servicios" className="inline-flex items-center gap-2 text-sm text-muted font-mono hover:text-text transition-colors mb-8">
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
        <div className="mt-16 space-y-8">
          <div className="rounded-xl border-2 border-accent/30 bg-bg2 p-8 text-center">
            <p className="text-xs uppercase tracking-[0.12em] text-[#4a5568] font-mono mb-3">1. Contrata el desarrollo</p>
            <p className="font-display text-4xl font-extrabold tracking-[-0.04em]">{price(servicioDB.precioUnico)}</p>
            <p className="text-sm text-muted mt-2 mb-6">Pago unico — incluye la entrega completa del proyecto</p>
            {servicioDB.paddlePriceIdUnico && (
              <CheckoutButton paddlePriceId={servicioDB.paddlePriceIdUnico} servicioNombre={servicioSanity.titulo} label={`Contratar ${servicioSanity.titulo}`} />
            )}
          </div>

          <div>
            <p className="text-center text-sm text-muted font-mono mb-5">Despues de la entrega, mantenelo activo con uno de estos planes mensuales:</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 bg-bg2 p-6 text-center border-t-2 border-t-muted">
                <Shield size={22} className="mx-auto mb-2 text-muted" />
                <p className="text-xs uppercase tracking-[0.1em] text-[#4a5568] font-mono mb-2">Plan Basico</p>
                <p className="font-display text-xl font-extrabold tracking-[-0.03em]">{price(servicioDB.precioBasico)}<span className="text-xs font-normal text-muted">/mes</span></p>
                <p className="text-xs text-muted mt-1 mb-4">Servicio activo sin cambios ni soporte</p>
                {servicioDB.paddlePriceIdBasico && (
                  <CheckoutButton paddlePriceId={servicioDB.paddlePriceIdBasico} servicioNombre={servicioSanity.titulo} label={`Basico ${price(servicioDB.precioBasico)}/mes`} />
                )}
              </div>
              <div className="rounded-xl border-2 border-accent/30 bg-bg2 p-6 text-center">
                <Wrench size={22} className="mx-auto mb-2 text-accent" />
                <p className="text-xs uppercase tracking-[0.1em] text-[#4a5568] font-mono mb-2">Plan Mantenimiento</p>
                <p className="font-display text-xl font-extrabold tracking-[-0.03em]">{price(servicioDB.precioMantenimiento)}<span className="text-xs font-normal text-muted">/mes</span></p>
                <p className="text-xs text-muted mt-1 mb-4">Cambios ilimitados + soporte prioritario</p>
                {servicioDB.paddlePriceIdMantenimiento && (
                  <CheckoutButton paddlePriceId={servicioDB.paddlePriceIdMantenimiento} servicioNombre={servicioSanity.titulo} label={`Mantenimiento ${price(servicioDB.precioMantenimiento)}/mes`} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
