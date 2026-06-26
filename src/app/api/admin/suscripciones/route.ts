import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { polar } from "@/lib/polar"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { pauseDeploy, resumeDeploy } from "@/lib/deploy"
import { logger } from "@/lib/logger"

export async function PATCH(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-susc:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  try {
    const body = await req.json()
    const { suscripcionId, accion } = body

    if (!suscripcionId) {
      return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
    }

    if (accion === "update-deploy") {
      const { deploymentId, deploymentPlatform, platformServiceId } = body
      await prisma.suscripcion.update({
        where: { id: suscripcionId },
        data: { deploymentId: deploymentId || null, deploymentPlatform: deploymentPlatform || null, platformServiceId: platformServiceId || null },
      })
      logger.info("Deploy config actualizada", { suscripcionId, adminId: admin.id })
      return NextResponse.json({ ok: true })
    }

    if (accion === "pause-deploy") {
      const sub = await prisma.suscripcion.findUnique({
        where: { id: suscripcionId },
        select: { deploymentPlatform: true, platformServiceId: true },
      })
      if (sub?.deploymentPlatform && sub?.platformServiceId) {
        await pauseDeploy(sub.deploymentPlatform, sub.platformServiceId)
      }
      logger.info("Deploy pausado manualmente", { suscripcionId, adminId: admin.id })
      return NextResponse.json({ ok: true })
    }

    if (accion === "resume-deploy") {
      const sub = await prisma.suscripcion.findUnique({
        where: { id: suscripcionId },
        select: { deploymentPlatform: true, platformServiceId: true },
      })
      if (sub?.deploymentPlatform && sub?.platformServiceId) {
        await resumeDeploy(sub.deploymentPlatform, sub.platformServiceId)
      }
      logger.info("Deploy reanudado manualmente", { suscripcionId, adminId: admin.id })
      return NextResponse.json({ ok: true })
    }

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      select: { polarSubscriptionId: true },
    })

    if (!suscripcion?.polarSubscriptionId) {
      return NextResponse.json({ error: "Esta suscripcion no tiene plan mensual" }, { status: 400 })
    }

    const subId = suscripcion.polarSubscriptionId

    switch (accion) {
      case "cancel": {
        await polar().subscriptions.update({
          id: subId,
          subscriptionUpdate: { cancelAtPeriodEnd: true },
        })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { cancelAtPeriodEnd: true },
        })
        break
      }
      case "uncancel": {
        await polar().subscriptions.update({
          id: subId,
          subscriptionUpdate: { cancelAtPeriodEnd: false },
        })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { cancelAtPeriodEnd: false },
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
