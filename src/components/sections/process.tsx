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
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
}

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
          className="relative mt-16 pl-10"
        >
          <div className="absolute left-[19px] top-2 bottom-2 w-px bg-accent/20" />

          {pasos.map((p, i) => (
            <motion.div key={i} variants={item} className="relative pb-10 last:pb-0">
              <div className="absolute left-[-26px] top-0 flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 z-10">
                <span className="text-xs font-bold text-accent font-display">{i + 1}</span>
              </div>
              <h3 className="font-display text-lg font-bold text-text">{p.titulo}</h3>
              <p className="mt-1 text-sm text-muted font-mono leading-relaxed max-w-xl">{p.descripcion}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
