import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { crearLinkDePago } from "@/lib/mercadopago"
import { normalizarMeses, tituloLink } from "@/lib/mp-utils"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-mp-link:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: { suscripcionId?: string; meses?: unknown; montoArsCents?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const { suscripcionId } = body
  const meses = normalizarMeses(body.meses)
  const montoArsCents = Math.round(Number(body.montoArsCents))

  if (!suscripcionId) {
    return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
  }
  if (!Number.isFinite(montoArsCents) || montoArsCents <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }

  try {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      include: { servicio: { select: { nombre: true } } },
    })
    if (!suscripcion) {
      return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
    }

    const link = await crearLinkDePago({
      suscripcionId,
      titulo: tituloLink(suscripcion.servicio.nombre, meses),
      montoArsCents,
      meses,
    })

    if (!link) {
      return NextResponse.json(
        { error: "Mercado Pago no está configurado (falta MP_ACCESS_TOKEN)" },
        { status: 503 }
      )
    }

    logger.info("Link de pago MP generado", {
      suscripcionId,
      meses,
      montoArsCents,
      preferenceId: link.preferenceId,
      adminId: admin.id,
    })

    return NextResponse.json({ ok: true, url: link.url })
  } catch (error) {
    logger.error("Error generando link MP", { error: String(error), suscripcionId })
    return NextResponse.json({ error: "Error al generar el link de pago" }, { status: 500 })
  }
}