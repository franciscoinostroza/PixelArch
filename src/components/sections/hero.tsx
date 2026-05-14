import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ArrowRight } from "lucide-react"

interface HeroProps {
  titulo?: string
  subtitulo?: string
  ctaPrimario?: string
  ctaSecundario?: string
}

export function Hero({
  titulo = "Impulsa tu negocio con tecnología inteligente",
  subtitulo = "Desarrollamos sitios web, chatbots, agentes de IA y automatizaciones que transforman tu empresa.",
  ctaPrimario = "Comenzar ahora",
  ctaSecundario = "Ver servicios",
}: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-32 md:pt-44">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(127,90,240,0.1),transparent_60%)]" />
      <div className="relative mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-text md:text-6xl lg:text-7xl font-display">
          {titulo}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted font-mono leading-relaxed">
          {subtitulo}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/#contacto"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            {ctaPrimario} <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/servicios"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            {ctaSecundario}
          </Link>
        </div>
      </div>
    </section>
  )
}
