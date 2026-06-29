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

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
}

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12 },
  },
}

export function Process({ pasos }: ProcessProps) {
  if (!pasos?.length) return null

  return (
    <section className="border-t border-border bg-bg2 px-6 py-24">
      <div className="mx-auto max-w-3xl">
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
          className="mt-16 space-y-8"
        >
          {pasos.map((p, i) => (
            <motion.div key={i} variants={item} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent font-display">
                {i + 1}
              </span>
              <div className="pt-0.5">
                <h3 className="font-display text-base font-bold text-text">{p.titulo}</h3>
                <p className="mt-1 text-sm text-muted font-mono leading-relaxed">{p.descripcion}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
