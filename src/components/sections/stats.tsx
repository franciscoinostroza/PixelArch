"use client"

import { motion } from "framer-motion"

const paises = [
  { flag: "🇨🇱", nombre: "Chile" },
  { flag: "🇦🇷", nombre: "Argentina" },
  { flag: "🇲🇽", nombre: "México" },
  { flag: "🇵🇪", nombre: "Perú" },
  { flag: "🇨🇴", nombre: "Colombia" },
  { flag: "🇪🇸", nombre: "España" },
]

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12 },
  },
}

const item = {
  hidden: { opacity: 0, scale: 0 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: "easeOut" as const } },
}

export function Presencia() {
  return (
    <section className="border-y border-border bg-bg2 px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-4xl text-center"
      >
        <p className="text-xs uppercase tracking-[0.12em] text-muted font-mono mb-6">
          Presencia en Latinoamérica y Europa
        </p>
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="flex flex-wrap items-center justify-center gap-6 md:gap-10"
        >
          {paises.map((p) => (
            <motion.div
              key={p.nombre}
              variants={item}
              whileHover={{ scale: 1.15, transition: { duration: 0.2 } }}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="text-3xl md:text-4xl" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' }}>{p.flag}</span>
              <span className="text-sm text-text font-mono">{p.nombre}</span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  )
}
