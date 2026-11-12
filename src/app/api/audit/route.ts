import { NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { normalizeUrl, isBlockedHost, computeScores, buildFindings } from "@/lib/audit"
import {
  analizarHtmlAudit,
  auditHeadersDesdeHeaders,
  certDaysLeft,
} from "@/lib/audit-server"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (!rateLimit(`audit:${ip}`, 8, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Alcanzaste el límite de auditorías por hora. Probá de nuevo más tarde." },
      { status: 429 }
    )
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  }

  const url = normalizeUrl(body.url || "")
  if (!url) {
    return NextResponse.json({ error: "URL inválida. Ejemplo: https://tu-sitio.com" }, { status: 400 })
  }

  const parsed = new URL(url)
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json({ error: "Ese host no está permitido para auditorías." }, { status: 400 })
  }

  try {
    const t0 = Date.now()
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PixelArchAudit/1.0; +https://pixelarch.dev/auditoria)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    })
    const ttfbMs = Date.now() - t0
    const text = await res.text()
    const totalMs = Date.now() - t0

    const finalUrl = res.url || url
    const https = finalUrl.startsWith("https://")

    const cert = https ? await certDaysLeft(new URL(finalUrl).hostname) : null

    const data = analizarHtmlAudit({
      html: text,
      finalUrl,
      status: res.status,
      redirects: res.redirected,
      ttfbMs,
      totalMs,
      https,
      headers: auditHeadersDesdeHeaders(res.headers),
      certDaysLeft: cert,
    })

    return NextResponse.json({
      ok: true,
      data,
      scores: computeScores(data),
      findings: buildFindings(data),
    })
  } catch (e) {
    logger.warn("Auditoría fallida", { url, error: String(e) })
    const isTimeout = String(e).toLowerCase().includes("timeout")
    return NextResponse.json(
      {
        error: isTimeout
          ? "El sitio tardó demasiado en responder (más de 12 segundos)."
          : "No pudimos conectar con el sitio. Verificá la URL e intentá de nuevo.",
      },
      { status: 502 }
    )
  }
}
