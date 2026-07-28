import { sanityFetch } from "@/lib/sanity"
import { Badge } from "@/components/ui/badge"
import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { CheckoutButton } from "@/components/ui/checkout-button"

const SERVICIO_QUERY = `*[_type == "servicio" && slug.current == $slug][0]{
  titulo,
  "slug": slug.current,
  descripcion,
  meta_title,
  meta_description,
  "og_image_url": og_image.asset->url,
  icono,
  tags
}`

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = await sanityFetch<{ titulo: string; descripcion: string; meta_title?: string; meta_description?: string; og_image_url?: string } | null>(SERVICIO_QUERY, { slug })
  if (!s) return { title: "Producto no encontrado" }
  return {
    title: s.meta_title ? `${s.meta_title} — PixelArch` : `${s.titulo} — PixelArch`,
    description: s.meta_description || s.descripcion,
    alternates: { canonical: `/productos/${slug}` },
    openGraph: s.og_image_url ? {
      images: [{ url: s.og_image_url }],
    } : undefined,
  }
}

export default async function ProductoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [servicioSanity, servicioDB] = await Promise.all([
    sanityFetch<{ titulo: string; slug: string; descripcion: string; meta_title?: string; meta_description?: string; og_image_url?: string; icono: string; tags: string[] } | null>(SERVICIO_QUERY, { slug }),
    prisma.servicio.findFirst({ where: { OR: [{ slug }, { id: `servicio-${slug}` }] } }).catch(() => null),
  ])

  if (!servicioSanity) notFound()

  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`

  const jsonLd = servicioDB ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: servicioSanity.titulo,
    description: servicioSanity.descripcion,
    image: servicioSanity.og_image_url || undefined,
    offers: [
      ...(servicioDB.polarProductIdUnico ? [{
        "@type": "Offer",
        name: "Pago Único",
        price: (servicioDB.precioUnico / 100).toFixed(0),
        priceCurrency: "USD",
        availability: "https://schema.org/OnlineOnly",
      }] : []),
      ...(servicioDB.polarProductIdBasico ? [{
        "@type": "Offer",
        name: "Plan Básico",
        price: (servicioDB.precioBasico / 100).toFixed(0),
        priceCurrency: "USD",
        priceType: "https://schema.org/MonthlyRateSubscription",
      }] : []),
      ...(servicioDB.polarProductIdMantenimiento ? [{
        "@type": "Offer",
        name: "Plan Mantenimiento",
        price: (servicioDB.precioMantenimiento / 100).toFixed(0),
        priceCurrency: "USD",
        priceType: "https://schema.org/MonthlyRateSubscription",
      }] : []),
    ],
  } : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <section style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0" }}>
        <div className="section-divider section-divider--violet" aria-hidden="true" />
        <div className="section-band section-band--violet" aria-hidden="true" />
        <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
        <div className="mx-auto max-w-4xl px-6">
          <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Productos", href: "/productos" }, { name: servicioSanity.titulo }]} />

          <div className="mt-8">
            <p className="eyebrow">{servicioSanity.titulo}</p>
            <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(2rem, 4vw, 3.2rem)", maxWidth: "16ch", marginBottom: "20px" }}>{servicioSanity.titulo}</h1>
            <p className="text-lg text-text-dim font-mono leading-relaxed">{servicioSanity.descripcion}</p>
          </div>

          {servicioSanity.tags?.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {servicioSanity.tags.map((tag) => <Badge key={tag} variant="accent">{tag}</Badge>)}
            </div>
          )}

          {servicioDB && (
            <div className="mt-16 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border/50 bg-panel p-6 text-center relative overflow-hidden">
                <p className="text-xs uppercase tracking-wider text-text-dim font-mono mb-2">Pago Unico</p>
                <p className="font-display text-3xl font-extrabold">{price(servicioDB.precioUnico)}</p>
                <p className="text-xs text-text-dim mt-2 mb-4">Desarrollo y entrega del proyecto</p>
                <div className="text-[11px] text-left space-y-1.5 border-t border-border/50 pt-3 mb-5">
                  <p>✅ Codigo y activos incluidos</p>
                  <p>❌ Sin hosting incluido</p>
                  <p>❌ Sin soporte continuo</p>
                </div>
                {servicioDB.polarProductIdUnico && (
                  <CheckoutButton polarProductId={servicioDB.polarProductIdUnico} servicioNombre={servicioSanity.titulo} tipo="UNICO" label={`Contratar ${servicioSanity.titulo}`} size="sm" className="w-full" />
                )}
              </div>

              <div className="rounded-xl border-2 border-violet/30 bg-panel p-6 text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-violet/5 to-transparent pointer-events-none" />
                <p className="text-xs uppercase tracking-wider text-violet font-mono mb-2 relative">Plan Basico</p>
                <p className="font-display text-3xl font-extrabold relative">{price(servicioDB.precioBasico)}<span className="text-sm font-normal text-text-dim">/mes</span></p>
                <p className="text-xs text-text-dim mt-2 mb-4 relative">Servicio online, hosting incluido</p>
                <div className="text-[11px] text-left space-y-1.5 border-t border-border/50 pt-3 mb-5 relative">
                  <p>✅ Hosting incluido</p>
                  <p>✅ SSL y monitoreo</p>
                  <p>❌ Sin cambios ni soporte</p>
                </div>
                {servicioDB.polarProductIdBasico && (
                  <CheckoutButton polarProductId={servicioDB.polarProductIdBasico} servicioNombre={servicioSanity.titulo} tipo="BASICO" label={`Activar Basico`} size="sm" className="w-full relative" />
                )}
              </div>

              <div className="rounded-xl border border-border/50 bg-panel p-6 text-center relative overflow-hidden">
                <p className="text-xs uppercase tracking-wider text-text-dim font-mono mb-2">Plan Mantenimiento</p>
                <p className="font-display text-3xl font-extrabold">{price(servicioDB.precioMantenimiento)}<span className="text-sm font-normal text-text-dim">/mes</span></p>
                <p className="text-xs text-text-dim mt-2 mb-4">Hosting + cambios + soporte</p>
                <div className="text-[11px] text-left space-y-1.5 border-t border-border/50 pt-3 mb-5">
                  <p>✅ Todo lo del Basico</p>
                  <p>✅ Cambios mensuales</p>
                  <p>✅ Soporte prioritario</p>
                </div>
                {servicioDB.polarProductIdMantenimiento && (
                  <CheckoutButton polarProductId={servicioDB.polarProductIdMantenimiento} servicioNombre={servicioSanity.titulo} tipo="MANTENIMIENTO" label={`Activar Mantenimiento`} size="sm" className="w-full" />
                )}
              </div>

              <p className="md:col-span-3 text-[13px] text-text-dim text-center border-t border-border/50 pt-4">
                Sin un plan mensual, el servicio deja de estar online. Cancelacion con 7 dias de aviso.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
