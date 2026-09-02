"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useRef, useState } from "react"
import { whatsappUrl, AUDIT_MESSAGE } from "@/lib/contact"

const DELAY_MS = 20000
const STORAGE_KEY = "pa-audit-seen"

export function AuditModal() {
  const [open, setOpen] = useState(false)
  const accumulated = useRef(0)
  const lastActive = useRef(0)
  const shown = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (sessionStorage.getItem(STORAGE_KEY)) return

    lastActive.current = Date.now()

    const tick = () => {
      if (document.hidden) return
      const now = Date.now()
      accumulated.current += now - lastActive.current
      lastActive.current = now

      if (accumulated.current >= DELAY_MS) {
        tryShow()
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        lastActive.current = Date.now()
      } else {
        lastActive.current = Date.now()
        window.setTimeout(tick, 300)
      }
    }

    const tryShow = () => {
      if (shown.current) return
      shown.current = true
      sessionStorage.setItem(STORAGE_KEY, "1")

      const contacto = document.getElementById("contacto")
      if (contacto) {
        const rect = contacto.getBoundingClientRect()
        if (rect.top < window.innerHeight && rect.bottom > 0) return
      }

      setOpen(true)
    }

    const interval = window.setInterval(tick, 500)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="audit-backdrop"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(7,6,12,0.72)", backdropFilter: "blur(6px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Auditoría gratuita"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.19, 1, 0.22, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.07]"
            style={{
              background: "linear-gradient(160deg, #171321 0%, #110e1a 55%, #141020 100%)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 40px rgba(139,92,246,0.05)",
            }}
          >
            <button
              onClick={close}
              aria-label="Cerrar"
              className="absolute right-5 top-5 z-10 p-1 text-text-faint transition-colors hover:text-text"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>

            <div className="p-8 sm:p-10">
              <div
                className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl text-[#a78bfa]"
                style={{
                  background: "rgba(139,92,246,0.10)",
                }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                  <path d="M8.5 11l1.8 1.8 3.2-3.4" />
                </svg>
              </div>

              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "1.65rem",
                  fontWeight: 600,
                  lineHeight: 1.18,
                  letterSpacing: "-0.02em",
                  marginBottom: "14px",
                  color: "var(--color-text)",
                }}
              >
                ¿Tu web vende lo que debería?
              </h3>
              <p style={{ color: "var(--color-text-dim)", fontSize: ".95rem", lineHeight: 1.7, marginBottom: "28px", maxWidth: "38ch" }}>
                Te regalo una auditoría exprés de tu sitio: velocidad, SEO, conversión y seguridad. Sin cargo y sin compromiso.
              </p>

              <ul className="audit-bullets" style={{ display: "flex", flexDirection: "column", gap: "13px", marginBottom: "30px" }}>
                {["Diagnóstico de velocidad y rendimiento", "SEO técnico y visibilidad", "Embudo de conversión y UX", "Seguridad y buenas prácticas"].map((b) => (
                  <li key={b} style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: ".92rem", color: "var(--color-text-dim)" }}>
                    <span style={{ color: "#a78bfa", display: "flex", flexShrink: 0 }} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {b}
                  </li>
                ))}
              </ul>

              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: "24px" }} aria-hidden="true" />

              <a
                href={whatsappUrl(AUDIT_MESSAGE)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet to-cyan text-sm font-semibold text-bg transition hover:brightness-110"
              >
                Quiero mi auditoría gratis
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>

              <button
                onClick={close}
                className="mx-auto mt-4 block text-xs text-text-faint transition-colors hover:text-text-dim"
              >
                No, gracias
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
