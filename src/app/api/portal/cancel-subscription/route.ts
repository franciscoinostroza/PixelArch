import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`cancel-sub:${ip}`, 3, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  let userId: string | null = null
  try {
    const session = await auth()
    userId = session.userId
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { suscripcionId } = await req.json()
  if (!suscripcionId) return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })

  const cliente = await prisma.cliente.findUnique({ where: { clerkUserId: userId } })
  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { id: suscripcionId, clienteId: cliente.id },
  })
  if (!suscripcion?.paddleSubscriptionId) {
    return NextResponse.json({ error: "Esta suscripcion no se puede cancelar por API" }, { status: 400 })
  }

  const subId = suscripcion.paddleSubscriptionId

  try {
    await paddle().subscriptions.cancel(subId)
    await prisma.suscripcion.update({
      where: { id: suscripcionId },
      data: { estado: "CANCELED", canceladoEn: new Date() },
    })
    logger.info("Subscription canceled by client", { suscripcionId, userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error cancelando suscripcion", { error: String(error), suscripcionId })
    return NextResponse.json({ error: "Error cancelando suscripcion" }, { status: 500 })
  }
}
