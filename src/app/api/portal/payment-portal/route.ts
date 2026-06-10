import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { logger } from "@/lib/logger"

export async function POST() {
  let userId: string | null = null
  try {
    const session = await auth()
    userId = session.userId
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const cliente = await prisma.cliente.findUnique({ where: { clerkUserId: userId } })
  if (!cliente?.paddleCustomerId) {
    return NextResponse.json({ error: "Sin cliente en Paddle" }, { status: 400 })
  }

  try {
    const session = await paddle().customerPortalSessions.create(
      cliente.paddleCustomerId,
      [],
    )
    logger.info("Payment portal session created", { clienteId: cliente.id })
    return NextResponse.json({ url: session.urls.general.overview })
  } catch (error) {
    logger.error("Error creando portal session", { error: String(error) })
    return NextResponse.json({ error: "Error creando portal" }, { status: 500 })
  }
}
