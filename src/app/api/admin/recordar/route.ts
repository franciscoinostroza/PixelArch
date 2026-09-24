import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { sendPaymentReminder } from "@/lib/notifications"
import { formatearMonto, precioDePlan } from "@/lib/pagos"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-recordar:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let suscripcionId: string | undefined
  try {
    const body = await req.json()
    suscripcionId = body.suscripcionId
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  if (!suscripcionId) {
    return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
  }

  try {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      include: { cliente: true, servicio: true },
    })
    if (!suscripcion) {
      return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
    }

    const precio = precioDePlan(suscripcion.plan, suscripcion.servicio, suscripcion.precioCustom)
    const montoTexto = formatearMonto(precio, "usd")
    const fechaTexto = suscripcion.proximoPago
      ? `el ${new Date(suscripcion.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}`
      : "a la brevedad"

    await sendPaymentReminder(
      suscripcion.cliente.email,
      suscripcion.cliente.nombre,
      suscripcion.servicio.nombre,
      montoTexto,
      fechaTexto
    )

    await prisma.suscripcion.update({
      where: { id: suscripcionId },
      data: { ultimoRecordatorioEn: new Date() },
    })

    logger.info("Recordatorio de pago enviado", { suscripcionId, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error enviando recordatorio", { error: String(error), suscripcionId })
    return NextResponse.json({ error: "Error al enviar el recordatorio" }, { status: 500 })
  }
}