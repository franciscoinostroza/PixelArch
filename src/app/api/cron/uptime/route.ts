import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { decidirAlertas, type CheckUptime } from "@/lib/uptime-alerts"
import { sendUptimeAlert, sendUptimeRecovery } from "@/lib/notifications"

export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"
const RETENTION_DAYS = 120

interface CheckTarget {
  servicio: string
  url: string
  expect?: "api" | "db"
}

const TARGETS: CheckTarget[] = [
  { servicio: "Sitio web", url: `${BASE}/` },
  { servicio: "Blog", url: `${BASE}/blog` },
  { servicio: "API", url: `${BASE}/api/health`, expect: "api" },
  { servicio: "Base de datos", url: `${BASE}/api/health`, expect: "db" },
]

async function check(target: CheckTarget) {
  const start = Date.now()
  try {
    const res = await fetch(target.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "PixelArch-Uptime/1.0" },
      cache: "no-store",
    })
    const latenciaMs = Date.now() - start
    let ok = res.status < 500

    if (target.expect) {
      try {
        const data = await res.json()
        ok = target.expect === "api" ? res.ok && data.status === "ok" : data.db === "ok"
      } catch {
        ok = false
      }
    }

    return { servicio: target.servicio, ok, statusCode: res.status, latenciaMs }
  } catch {
    return { servicio: target.servicio, ok: false, statusCode: null, latenciaMs: Date.now() - start }
  }
}

async function procesarAlertas(resultados: CheckUptime[]) {
  try {
    const historiales = await Promise.all(
      resultados.map((r) =>
        prisma.uptimeCheck.findMany({
          where: { servicio: r.servicio },
          orderBy: { creadoEn: "desc" },
          take: 3,
          select: { servicio: true, ok: true, statusCode: true, latenciaMs: true },
        })
      )
    )

    const acciones = decidirAlertas(historiales)

    for (const accion of acciones) {
      if (accion.tipo === "caida") {
        await sendUptimeAlert(accion.servicio, accion.statusCode, accion.latenciaMs)
      } else {
        await sendUptimeRecovery(accion.servicio)
      }
    }

    if (acciones.length > 0) {
      logger.warn("Uptime: alertas enviadas", {
        acciones: acciones.map((a) => `${a.tipo}:${a.servicio}`),
      })
    }

    return acciones
  } catch (error) {
    logger.error("Error procesando alertas de uptime", { error: String(error) })
    return []
  }
}

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const results = await Promise.all(TARGETS.map(check))

    await prisma.uptimeCheck.createMany({ data: results })

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await prisma.uptimeCheck.deleteMany({ where: { creadoEn: { lt: cutoff } } })

    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      logger.warn("Uptime: servicios con falla", { failed })
    } else {
      logger.info("Uptime: todos los servicios OK", { total: results.length })
    }

    const alertas = await procesarAlertas(results)

    return NextResponse.json({ ok: true, results, alertas })
  } catch (error) {
    Sentry.captureException(error)
    logger.error("Error en monitoreo de uptime", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}