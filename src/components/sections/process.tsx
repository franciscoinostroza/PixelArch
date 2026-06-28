"use client"

import { motion } from "framer-motion"
import { SectionLabel } from "@/components/ui/section-label"

interface PasoItem {
  titulo: string
  descripcion: string
}

interface ProcessProps {
  pasos: PasoItem[]
}

const variants = [
  { hidden: { opacity: 0, x: -100, rotate: -8 }, show: { opacity: 1, x: 0, rotate: 0, transition: { duration: 0.6, ease: "easeOut" as const } } },
  { hidden: { opacity: 0, y: 80, scale: 0.7 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: "easeOut" as const } } },
  { hidden: { opacity: 0, x: 100, rotate: 8 }, show: { opacity: 1, x: 0, rotate: 0, transition: { duration: 0.6, ease: "easeOut" as const } } },
]

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.15 },
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
          className="mt-16 grid gap-8 md:grid-cols-3"
        >
          {pasos.map((p, i) => (
            <motion.div key={i} variants={variants[i]} className="relative text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-lg font-bold text-accent font-display">
                {i + 1}
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-text">{p.titulo}</h3>
              <p className="mt-2 text-sm text-muted font-mono">{p.descripcion}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
