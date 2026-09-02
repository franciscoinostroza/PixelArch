"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Reveal({
  children,
  className,
  delay = 0,
  stagger = false,
}: {
  children: ReactNode
  className?: string
  delay?: number
  stagger?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true)
      return
    }
    const reveal = () => {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        requestAnimationFrame(() => setVisible(true))
        return true
      }
      return false
    }
    if (!reveal()) {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true)
            io.disconnect()
          }
        },
        { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
      )
      io.observe(el)
      return () => io.disconnect()
    }
  }, [])

  const base = stagger
    ? visible
      ? "reveal-stagger is-visible"
      : "reveal-stagger"
    : visible
      ? "reveal is-visible"
      : "reveal"

  return (
    <div ref={ref} className={cn(base, className)} style={{ transitionDelay: delay ? `${delay}ms` : undefined }}>
      {children}
    </div>
  )
}
