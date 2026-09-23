import { NextResponse } from "next/server"
import tls from "node:tls"
import { rateLimit } from "@/lib/rate-limit"
import { normalizeUrl, isBlockedHost, computeScores, buildFindings, type AuditData } from "@/lib/audit"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function certDaysLeft(hostname: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const socket = tls.connect(
        { host: hostname, port: 443, servername: hostname, timeout: 6000 },
        () => {
          try {
            const cert = socket.getPeerCertificate()
            socket.end()
            if (cert && cert.valid_to) {
              const days = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000)
              resolve(days)
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        }
      )
      socket.on("error", () => resolve(null))
      socket.on("timeout", () => {
        socket.destroy()
        resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
}

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

    const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 120) || null : null

    const metaDesc =
      text.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      text.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)
    const metaDescription = metaDesc ? metaDesc[1].trim().slice(0, 200) || null : null

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(text)
    const h1Count = (text.match(/<h1[\s>]/gi) || []).length
    const langMatch = text.match(/<html[^>]+lang=["']([^"']+)["']/i)
    const lang = langMatch ? langMatch[1] : null
    const imgTags = text.match(/<img[\s>][^>]*>/gi) || []
    const imgCount = imgTags.length
    const imgNoAlt = imgTags.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length

    const headers = {
      hsts: res.headers.has("strict-transport-security"),
      csp: res.headers.has("content-security-policy"),
      xfo: res.headers.has("x-frame-options"),
      xcto: res.headers.has("x-content-type-options"),
      referrer: res.headers.has("referrer-policy"),
    }

    const cert = https ? await certDaysLeft(new URL(finalUrl).hostname) : null

    const data: AuditData = {
      finalUrl,
      status: res.status,
      redirects: res.redirected,
      ttfbMs,
      totalMs,
      htmlKb: Math.round(Buffer.byteLength(text, "utf8") / 1024),
      title,
      metaDescription,
      hasViewport,
      h1Count,
      lang,
      imgCount,
      imgNoAlt,
      https,
      certDaysLeft: cert,
      headers,
    }

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