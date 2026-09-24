import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-soporte:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: { clienteId?: string; servicioId?: string; montoUsdCents?: unknown; proximoPago?: string; notas?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const { clienteId, servicioId, proximoPago } = body
  const montoUsdCents = Math.round(Number(body.montoUsdCents))

  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })
  if (!servicioId) return NextResponse.json({ error: "servicioId requerido" }, { status: 400 })
  if (!Number.isFinite(montoUsdCents) || montoUsdCents <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }
  if (!proximoPago) return NextResponse.json({ error: "Fecha de primer vencimiento requerida" }, { status: 400 })

  const fecha = new Date(proximoPago)
  if (Number.isNaN(fecha.getTime())) {
    return NextResponse.json({ error: "Fecha invalida" }, { status: 400 })
  }

  try {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } })
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const servicio = await prisma.servicio.findUnique({ where: { id: servicioId }, select: { id: true, nombre: true } })
    if (!servicio) return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })

    const activo = await prisma.suscripcion.findFirst({
      where: { clienteId, servicioId, plan: "SOPORTE", estado: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true },
    })
    if (activo) {
      return NextResponse.json({ error: `El cliente ya tiene un soporte activo de ${servicio.nombre}` }, { status: 409 })
    }

    const suscripcion = await prisma.suscripcion.create({
      data: {
        clienteId,
        servicioId,
        plan: "SOPORTE",
        estado: "ACTIVE",
        precioCustom: montoUsdCents,
        proximoPago: fecha,
      },
      select: { id: true },
    })

    logger.info("Soporte activado", { suscripcionId: suscripcion.id, clienteId, servicioId, adminId: admin.id })
    return NextResponse.json({ ok: true, id: suscripcion.id })
  } catch (error) {
    logger.error("Error activando soporte", { error: String(error), clienteId })
    return NextResponse.json({ error: "Error al activar el soporte" }, { status: 500 })
  }
}