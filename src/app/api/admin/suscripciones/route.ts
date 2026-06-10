import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function PATCH(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-susc:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  try {
    const { suscripcionId, accion, deploymentId, deploymentPlatform } = await req.json()

    if (!suscripcionId) {
      return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
    }

    if (accion === "update-deploy") {
      await prisma.suscripcion.update({
        where: { id: suscripcionId },
        data: { deploymentId: deploymentId ?? null, deploymentPlatform: deploymentPlatform ?? null },
      })
      return NextResponse.json({ ok: true })
    }

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      select: { paddleSubscriptionId: true },
    })

    if (!suscripcion?.paddleSubscriptionId) {
      return NextResponse.json({ error: "Esta suscripcion no tiene plan mensual" }, { status: 400 })
    }

    const subId = suscripcion.paddleSubscriptionId

    switch (accion) {
      case "pause": {
        await paddle().subscriptions.pause(subId, { effectiveFrom: "immediately" })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "PAUSED" },
        })
        break
      }
      case "resume": {
        await paddle().subscriptions.resume(subId, { effectiveFrom: "immediately" })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "ACTIVE" },
        })
        break
      }
      case "cancel": {
        await paddle().subscriptions.cancel(subId)
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "CANCELED", canceladoEn: new Date() },
        })
        break
      }
      default:
        return NextResponse.json({ error: "Accion no valida" }, { status: 400 })
    }

    logger.info("Subscription action performed", { suscripcionId, accion, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("suscripcion action error", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
