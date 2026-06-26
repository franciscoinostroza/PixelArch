"use client"

import { motion } from "framer-motion"

export function Presencia() {
  return (
    <section className="border-y border-border bg-bg2 px-6 py-16">
      <div className="mx-auto max-w-4xl text-center">
        <motion.p
          initial={{ opacity: 0, x: -100 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="text-xs uppercase tracking-[0.12em] text-muted font-mono mb-2"
        >
          Presencia
        </motion.p>
        <motion.p
          initial={{ opacity: 0, scale: 0.5, rotate: -6 }}
          whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
          className="text-sm text-text font-mono leading-relaxed"
        >
          Chile <span className="text-accent">·</span> Argentina{" "}
          <span className="text-accent">·</span> México{" "}
          <span className="text-accent">·</span> Perú{" "}
          <span className="text-accent">·</span> Colombia{" "}
          <span className="text-accent">·</span> España
        </motion.p>
        <motion.p
          initial={{ opacity: 0, x: 100 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          className="mt-4 text-xs text-muted font-mono"
        >
          Trabajamos con clientes en LATAM y Europa
        </motion.p>
      </div>
    </section>
  )
}
