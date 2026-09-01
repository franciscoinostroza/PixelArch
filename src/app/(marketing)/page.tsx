import { sanityFetch } from "@/lib/sanity"
import { Hero } from "@/components/sections/hero"
import { Reviews } from "@/components/sections/reviews"
import { Services } from "@/components/sections/services"
import { Process } from "@/components/sections/process"
import { About } from "@/components/sections/about"
import { ContactForm } from "@/components/sections/contact-form"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import type { LandingFields } from "@/types/sanity"

const LANDING_QUERY = `*[_type == "landing"][0]{
  hero_titulo,
  hero_subtitulo,
  hero_cta_primario,
  hero_cta_secundario,
  stats,
  proceso_pasos
}`

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

export default async function LandingPage() {
  const [landing, servicios, rate] = await Promise.all([
    sanityFetch<LandingFields | null>(LANDING_QUERY),
    sanityFetch<
      { titulo: string; slug: string; descripcion: string; icono: string; tags: string[]; precioUnico: number; precioBasico: number; precioMantenimiento: number }[]
    >(SERVICIOS_QUERY),
    getDolarVentaBancoNacion(),
  ])

  return (
    <>
      <Hero
        titulo={landing?.hero_titulo}
        subtitulo={landing?.hero_subtitulo}
        ctaPrimario={landing?.hero_cta_primario}
        ctaSecundario={landing?.hero_cta_secundario}
      />
      <Reviews />
      <Services servicios={servicios || []} rate={rate} />
      <Process pasos={landing?.proceso_pasos || []} />
      <About />
      <ContactForm />
    </>
  )
}
