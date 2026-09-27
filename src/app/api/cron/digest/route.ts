import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { resend } from "@/lib/resend"
import { armarDigest, type DigestData } from "@/lib/digest"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const ahora = new Date()
    const en7dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000)
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000)

    const [hitos, soportes, pagos] = await Promise.all([
      prisma.hito.findMany({
        where: { estado: "PENDIENTE", proyecto: { estado: "ACTIVO" } },
        include: { proyecto: { include: { cliente: { select: { nombre: true } } } } },
        orderBy: { vencimiento: "asc" },
      }),
      prisma.suscripcion.findMany({
        where: { plan: "SOPORTE", estado: { in: ["ACTIVE", "PAST_DUE"] } },
        include: {
          cliente: { select: { nombre: true } },
          servicio: { select: { nombre: true, precioMantenimiento: true } },
        },
        orderBy: { proximoPago: "asc" },
      }),
      prisma.pago.findMany({
        where: { estadoPago: "SUCCEEDED", creadoEn: { gte: hace24h } },
        include: {
          cliente: { select: { nombre: true } },
          hito: { select: { titulo: true } },
          suscripcion: { select: { servicio: { select: { nombre: true } } } },
        },
        orderBy: { creadoEn: "desc" },
      }),
    ])

    const mapHito = (h: (typeof hitos)[number]) => ({
      cliente: h.proyecto.cliente.nombre,
      proyecto: h.proyecto.titulo,
      titulo: h.titulo,
      monto: h.monto,
      vencimiento: h.vencimiento,
    })

    const mapSoporte = (s: (typeof soportes)[number]) => ({
      cliente: s.cliente.nombre,
      servicio: s.servicio.nombre,
      monto: s.precioCustom && s.precioCustom > 0 ? s.precioCustom : s.servicio.precioMantenimiento,
      proximoPago: s.proximoPago,
    })

    const data: DigestData = {
      hitosVencidos: hitos.filter((h) => h.vencimiento && h.vencimiento < ahora).map(mapHito),
      hitosPorVencer: hitos
        .filter((h) => h.vencimiento && h.vencimiento >= ahora && h.vencimiento <= en7dias)
        .map(mapHito),
      hitosSinFecha: hitos.filter((h) => !h.vencimiento).map(mapHito),
      soportesVencidos: soportes.filter((s) => s.proximoPago && s.proximoPago < ahora).map(mapSoporte),
      soportesPorVencer: soportes
        .filter((s) => s.proximoPago && s.proximoPago >= ahora && s.proximoPago <= en7dias)
        .map(mapSoporte),
      pagos24h: pagos.map((p) => ({
        cliente: p.cliente.nombre,
        monto: p.monto,
        moneda: p.moneda,
        descripcion: p.hito?.titulo || p.suscripcion?.servicio.nombre || "Pago",
      })),
    }

    const { subject, text } = armarDigest(data)

    const to = process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL
    const r = resend()
    let enviado = false
    if (r && to) {
      await r.emails.send({ from: "PixelArch <noreply@pixelarch.dev>", to, subject, text })
      enviado = true
    }

    const resumen = {
      vencidos: data.hitosVencidos.length + data.soportesVencidos.length,
      porVencer: data.hitosPorVencer.length + data.soportesPorVencer.length,
      sinFecha: data.hitosSinFecha.length,
      pagos24h: data.pagos24h.length,
    }

    logger.info("Digest diario procesado", { enviado, ...resumen })

    return NextResponse.json({ ok: true, enviado, resumen })
  } catch (error) {
    Sentry.captureException(error)
    logger.error("Error en digest diario", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
