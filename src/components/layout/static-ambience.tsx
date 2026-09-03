"use client"

import { useEffect, useRef } from "react"

export default function StaticAmbience() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const frag = document.createDocumentFragment()
    for (let i = 0; i < 90; i++) {
      const d = document.createElement("i")
      d.style.left = Math.random() * 100 + "%"
      d.style.top = Math.random() * 100 + "%"
      d.style.opacity = (Math.random() * 0.35 + 0.15).toFixed(2)
      d.style.transform = "scale(" + (Math.random() * 1.6 + 0.4).toFixed(2) + ")"
      frag.appendChild(d)
    }
    el.appendChild(frag)
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background: "radial-gradient(ellipse at 50% -20%, #150f24 0%, #07060c 55%), #07060c",
      }}
    >
      <div ref={ref} className="amb-stars absolute inset-0" />
    </div>
  )
}
