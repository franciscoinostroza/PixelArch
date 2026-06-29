"use client"

import { motion } from "framer-motion"
import { SectionLabel } from "@/components/ui/section-label"
import { Check } from "lucide-react"

interface PasoItem {
  titulo: string
  descripcion: string
}

interface ProcessProps {
  pasos: PasoItem[]
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
}

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.2 },
  },
}

export function Process({ pasos }: ProcessProps) {
  if (!pasos?.length) return null

  return (
    <section className="border-t border-border bg-bg2 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <SectionLabel>Proceso</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
            Cómo trabajamos
          </h2>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-50px" }}
          className="relative mt-16"
        >
          {/* Línea conectora */}
          <div className="absolute left-[23px] top-0 bottom-0 w-px bg-accent/20 hidden md:block" />

          <div className="flex flex-col gap-8 md:gap-0 md:grid md:grid-cols-3">
            {pasos.map((p, i) => (
              <motion.div key={i} variants={item} className="relative flex gap-4 md:flex-col md:items-center md:text-center md:gap-3">
                {/* Número / Círculo */}
                <div className="relative z-10 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-accent/10 md:mx-auto">
                  <span className="text-sm font-bold text-accent font-display">{i + 1}</span>
                </div>

                {/* Conector horizontal en desktop */}
                {i < pasos.length - 1 && (
                  <div className="hidden md:block absolute top-[23px] left-[calc(50%+23px)] w-[calc(100%-46px)] h-px bg-accent/20" />
                )}

                <div className="md:mt-2">
                  <h3 className="font-display text-base font-bold text-text">{p.titulo}</h3>
                  <p className="mt-1 text-sm text-muted font-mono leading-relaxed">{p.descripcion}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
