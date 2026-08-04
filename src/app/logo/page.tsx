"use client"

import { useRef, useEffect, useState } from "react"

export default function LogoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const s = 720

    ctx.fillStyle = "#07060c"
    drawRounded(ctx, 0, 0, s, s, 40)
    ctx.fill()

    // Draw squares
    const grad = ctx.createLinearGradient(0, 0, 200, 200)
    grad.addColorStop(0, "#8b5cf6")
    grad.addColorStop(1, "#22d3ee")

    // First square (solid)
    ctx.save()
    function drawRounded(x: number, y: number, w: number, h: number, r: number) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
    }
    drawRounded(220, 200, 100, 100, 22)
    ctx.fillStyle = grad
    ctx.fill()

    // Second square (50% opacity)
    drawRounded(320, 290, 100, 100, 22)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = grad
    ctx.fill()
    ctx.globalAlpha = 1

    // Text
    ctx.font = "700 72px 'Space Grotesk', sans-serif"
    ctx.fillStyle = "#f6f5f8"
    ctx.textAlign = "center"
    ctx.fillText("Pixel", 310, 430)
    ctx.fillStyle = grad
    ctx.fillText("Arch", 475, 430)

    // Line
    ctx.beginPath()
    const lineGrad = ctx.createLinearGradient(180, 0, 540, 0)
    lineGrad.addColorStop(0, "transparent")
    lineGrad.addColorStop(0.3, "#8b5cf6")
    lineGrad.addColorStop(0.7, "#22d3ee")
    lineGrad.addColorStop(1, "transparent")
    ctx.strokeStyle = lineGrad
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(180, 455)
    ctx.lineTo(540, 455)
    ctx.stroke()

    // Subtitle
    ctx.font = "500 14px 'JetBrains Mono', monospace"
    ctx.fillStyle = "#645f74"
    ctx.fillText("SOFTWARE + INFRASTRUCTURE", 360, 485)
  }, [])

  function download() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement("a")
    link.download = "pixelarch-logo.png"
    link.href = canvas.toDataURL("image/png")
    link.click()
    setDownloaded(true)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#07060c", gap: "24px" }}>
      <canvas ref={canvasRef} width={720} height={720} style={{ width: "360px", height: "360px" }} />
      <button
        onClick={download}
        style={{
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px",
          padding: "14px 32px", borderRadius: "10px", border: "none", cursor: "pointer",
          background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c",
        }}
      >
        {downloaded ? "Download again" : "Download PNG"}
      </button>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "#645f74" }}>
        720×720 · Subilo a Google Business Profile
      </p>
    </div>
  )
}
