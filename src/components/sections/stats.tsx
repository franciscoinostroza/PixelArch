"use client"

import { motion } from "framer-motion"

const paises = [
  { code: "cl", nombre: "Chile" },
  { code: "ar", nombre: "Argentina" },
  { code: "mx", nombre: "México" },
  { code: "pe", nombre: "Perú" },
  { code: "co", nombre: "Colombia" },
  { code: "es", nombre: "España" },
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
              <img src={`https://flagcdn.com/w40/${p.code}.png`} alt={p.nombre} className="h-10 w-auto shadow-lg" style={{ imageRendering: "pixelated", filter: "contrast(1.3) saturate(1.4)" }} loading="lazy" />
              <span className="text-sm text-text font-mono">{p.nombre}</span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  )
}
