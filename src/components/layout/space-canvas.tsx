"use client"

import { useEffect, useRef } from "react"

const STAR_COLORS = ["#f6f5f8", "#f6f5f8", "#f6f5f8", "#cdd8ff", "#ffe9c7"]

const LAYERS = [
  { drift: 2.2, sizeMin: 0.6, sizeMax: 1.1, aMin: 0.18, aMax: 0.4, parallax: 6, density: 1 },
  { drift: 4.4, sizeMin: 0.9, sizeMax: 1.5, aMin: 0.28, aMax: 0.55, parallax: 13, density: 0.65 },
  { drift: 7.2, sizeMin: 1.2, sizeMax: 1.9, aMin: 0.4, aMax: 0.8, parallax: 22, density: 0.32 },
]

export default function SpaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let width = 0, height = 0
    let rafId = 0, running = true, t = 0
    const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0 }
    const shootingStars: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number }[] = []
    let nextShootTime = 3 + Math.random() * 4
    const layerStars: { x: number; y: number; size: number; baseAlpha: number; color: string; phase: number; freq: number }[][] = [[], [], []]

    function buildStars() {
      const area = width * height
      for (let l = 0; l < LAYERS.length; l++) {
        const cfg = LAYERS[l]
        const count = Math.max(60, Math.round((area / 4600) * cfg.density))
        const arr: typeof layerStars[0] = []
        for (let i = 0; i < count; i++) {
          arr.push({
            x: Math.random() * width,
            y: Math.random() * height,
            size: cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin),
            baseAlpha: cfg.aMin + Math.random() * (cfg.aMax - cfg.aMin),
            color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
            phase: Math.random() * Math.PI * 2,
            freq: 0.3 + Math.random() * 0.6,
          })
        }
        layerStars[l] = arr
      }
    }

    function resize() {
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = Math.round(width * dpr)
      canvas!.height = Math.round(height * dpr)
      canvas!.style.width = width + "px"
      canvas!.style.height = height + "px"
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildStars()
    }

    function onPointerMove(e: PointerEvent) {
      const cx = width / 2, cy = height / 2
      pointer.x = (e.clientX - cx) / cx
      pointer.y = (e.clientY - cy) / cy
    }

    function maybeSpawnShootingStar(dt: number) {
      nextShootTime -= dt
      if (nextShootTime <= 0) {
        nextShootTime = 6 + Math.random() * 7
        const startX = Math.random() * width * 0.7
        const startY = Math.random() * height * 0.3
        const ang = Math.PI * 0.2 + Math.random() * 0.25
        shootingStars.push({ x: startX, y: startY, vx: Math.cos(ang) * 10, vy: Math.sin(ang) * 10, life: 0, maxLife: 0.7 + Math.random() * 0.25 })
      }
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i]
        s.x += s.vx; s.y += s.vy; s.life += dt
        if (s.life > s.maxLife) shootingStars.splice(i, 1)
      }
    }

    function draw(dt: number) {
      ctx!.clearRect(0, 0, width, height)
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.04
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.04

      for (let l = 0; l < LAYERS.length; l++) {
        const cfg = LAYERS[l]
        const arr = layerStars[l]
        const driftX = reduceMotion ? 0 : t * cfg.drift * 0.6
        const driftY = reduceMotion ? 0 : t * cfg.drift * 0.15
        const ox = pointer.smoothX * cfg.parallax
        const oy = pointer.smoothY * cfg.parallax * 0.6
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i]
          const x = ((s.x + driftX + ox) % (width + 20) + (width + 20)) % (width + 20) - 10
          const y = ((s.y + driftY + oy) % (height + 20) + (height + 20)) % (height + 20) - 10
          const tw = reduceMotion ? 1 : 1 + Math.sin(t * s.freq + s.phase) * 0.4
          ctx!.globalAlpha = Math.max(0, Math.min(1, s.baseAlpha * tw))
          ctx!.fillStyle = s.color
          ctx!.fillRect(Math.round(x), Math.round(y), s.size, s.size)
        }
      }
      ctx!.globalAlpha = 1

      if (!reduceMotion) {
        maybeSpawnShootingStar(dt)
        for (const sh of shootingStars) {
          const fade = 1 - sh.life / sh.maxLife
          ctx!.strokeStyle = `rgba(255,255,255,${fade * 0.8})`
          ctx!.lineWidth = 1.3
          ctx!.beginPath()
          ctx!.moveTo(sh.x, sh.y)
          ctx!.lineTo(sh.x - sh.vx * 5, sh.y - sh.vy * 5)
          ctx!.stroke()
        }
      }
    }

    function loop() {
      if (!running) return
      t += 1 / 60
      draw(1 / 60)
      rafId = requestAnimationFrame(loop)
    }

    resize()
    draw(0)
    if (!reduceMotion) {
      rafId = requestAnimationFrame(loop)
      window.addEventListener("pointermove", onPointerMove, { passive: true })
    }
    window.addEventListener("resize", () => { resize(); if (reduceMotion) draw(0) })
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { running = false; cancelAnimationFrame(rafId) }
      else if (!reduceMotion) { running = true; rafId = requestAnimationFrame(loop) }
    })

    return () => {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener("pointermove", onPointerMove)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="space-canvas"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        background: "var(--color-bg)",
      }}
    />
  )
}
