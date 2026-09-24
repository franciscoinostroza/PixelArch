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
  let hitoId: string | undefined
  try {
    const body = await req.json()
    suscripcionId = body.suscripcionId
    hitoId = body.hitoId
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  if (!suscripcionId && !hitoId) {
    return NextResponse.json({ error: "suscripcionId o hitoId requerido" }, { status: 400 })
  }

  try {
    if (hitoId) {
      const hito = await prisma.hito.findUnique({
        where: { id: hitoId },
        include: { proyecto: { include: { cliente: true } } },
      })
      if (!hito) return NextResponse.json({ error: "Hito no encontrado" }, { status: 404 })

      const montoTexto = formatearMonto(hito.monto, "usd")
      const fechaTexto = hito.vencimiento
        ? `el ${new Date(hito.vencimiento).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}`
        : "a la brevedad"

      await sendPaymentReminder(
        hito.proyecto.cliente.email,
        hito.proyecto.cliente.nombre,
        `${hito.proyecto.titulo} (${hito.titulo})`,
        montoTexto,
        fechaTexto
      )

      logger.info("Recordatorio de hito enviado", { hitoId, adminId: admin.id })
      return NextResponse.json({ ok: true })
    }

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
    logger.error("Error enviando recordatorio", { error: String(error), suscripcionId, hitoId })
    return NextResponse.json({ error: "Error al enviar el recordatorio" }, { status: 500 })
  }
}