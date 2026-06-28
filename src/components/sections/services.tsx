"use client"

import { useRef, useCallback } from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { SectionLabel } from "@/components/ui/section-label"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ServiceItem {
  titulo: string
  slug: string
  descripcion: string
  icono: string
  tags: string[]
  precioUnico: number
  precioBasico: number
  precioMantenimiento: number
}

interface ServicesProps {
  servicios: ServiceItem[]
}

const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
}

function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const isTilting = useRef(false)

  const handleMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    el.style.transform = `perspective(1000px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg) scale3d(1.02,1.02,1.02)`
  }, [])

  const handleLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)"
  }, [])

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="transition-transform duration-200 ease-out"
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  )
}

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
}

export function Services({ servicios }: ServicesProps) {
  return (
    <section id="productos" className="mx-auto max-w-7xl px-6 py-24">
      <div className="text-center">
        <SectionLabel>Productos</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
          Soluciones a medida
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted font-mono">
          Desde una landing page hasta un agente de IA autonomo. Elegi lo que tu negocio necesita.
        </p>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-100px" }}
        className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {servicios.map((s) => (
          <motion.div key={s.slug} variants={item}>
            <TiltCard>
            <Link href={`/productos/${s.slug}`}>
              <Card className="group h-full flex flex-col border-border/50 bg-bg2/50 backdrop-blur-sm hover:border-accent/40 hover:shadow-[0_0_30px_rgba(127,90,240,0.1)]">
                <div className="flex-1">
                  <span className="text-3xl">{s.icono || "⚡"}</span>
                  <div className="flex items-center justify-between mt-3">
                    <p className="font-display text-lg font-bold text-text">{s.titulo}</p>
                    {s.precioBasico > 0 && (
                      <Badge variant="accent2" className="text-xs shrink-0 ml-2">
                        ${(s.precioBasico / 100).toFixed(0)}/mes
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted font-mono leading-relaxed line-clamp-2">{s.descripcion}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-border/30">
                  {s.tags?.map((tag) => (
                    <span key={tag} className="rounded-full border border-border bg-bg2 px-2 py-0.5 text-[10px] text-muted font-mono">
                      {tag}
                    </span>
                  ))}
                </div>
              </Card>
            </Link>
            </TiltCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
