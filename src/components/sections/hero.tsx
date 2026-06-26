"use client"

import { motion } from "framer-motion"
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
  ctaSecundario = "Ver productos",
}: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-32 md:pt-44">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(127,90,240,0.1),transparent_60%)]" />
      <div className="relative mx-auto max-w-4xl text-center">
        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-gradient-to-r from-accent via-[#a78bfa] to-[#f472b6] bg-[length:200%_auto] bg-clip-text text-transparent animate-gradient text-4xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl font-display"
        >
          {titulo}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted font-mono leading-relaxed"
        >
          {subtitulo}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link
            href="/#contacto"
            className={cn(buttonVariants({ size: "lg" }), "relative overflow-hidden group")}
          >
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            {ctaPrimario} <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/productos"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            {ctaSecundario}
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
