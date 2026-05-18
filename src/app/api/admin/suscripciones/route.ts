import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"

export async function PATCH(req: Request) {
  const { userId, sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role

  if (role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const { suscripcionId, accion } = await req.json()

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      select: { paddleSubscriptionId: true },
    })

    if (!suscripcion?.paddleSubscriptionId) {
      return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
    }

    switch (accion) {
      case "pause": {
        await paddle().subscriptions.pause(suscripcion.paddleSubscriptionId, {
          effectiveFrom: "immediately",
        })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "PAUSED" },
        })
        break
      }
      case "resume": {
        await paddle().subscriptions.resume(suscripcion.paddleSubscriptionId, {
          effectiveFrom: "immediately",
        })
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "ACTIVE" },
        })
        break
      }
      case "cancel": {
        await paddle().subscriptions.cancel(suscripcion.paddleSubscriptionId)
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: {
            estado: "CANCELED",
            canceladoEn: new Date(),
          },
        })
        break
      }
      case "update-deploy": {
        const { deploymentId, deploymentPlatform } = await req.json()
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { deploymentId, deploymentPlatform },
        })
        break
      }
      default:
        return NextResponse.json({ error: "Accion no valida" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("suscripcion action error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
