"use client"

import { motion } from "framer-motion"

export function Presencia() {
  return (
    <section className="border-y border-border bg-bg2 px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mx-auto max-w-4xl text-center"
      >
        <p className="text-xs uppercase tracking-[0.12em] text-muted font-mono mb-2">
          Presencia
        </p>
        <p className="text-sm text-text font-mono leading-relaxed">
          Chile <span className="text-accent">·</span> Argentina{" "}
          <span className="text-accent">·</span> México{" "}
          <span className="text-accent">·</span> Perú{" "}
          <span className="text-accent">·</span> Colombia{" "}
          <span className="text-accent">·</span> España
        </p>
        <p className="mt-4 text-xs text-muted font-mono">
          Trabajamos con clientes en LATAM y Europa
        </p>
      </motion.div>
    </section>
  )
}
