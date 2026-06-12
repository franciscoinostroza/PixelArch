import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { polar } from "@/lib/polar"
import { rateLimit } from "@/lib/rate-limit"
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

  const ip = "portal-session"
  if (!rateLimit(`portal-session:${userId}`, 5, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const cliente = await prisma.cliente.findUnique({ where: { clerkUserId: userId } })
  if (!cliente?.polarCustomerId) {
    return NextResponse.json({ error: "Sin cliente en Polar" }, { status: 400 })
  }

  try {
    const session = await polar().customerSessions.create({
      customerId: cliente.polarCustomerId,
    })
    logger.info("Customer portal session created", { clienteId: cliente.id })
    return NextResponse.json({ url: session.customerPortalUrl })
  } catch (error) {
    logger.error("Error creando portal session", { error: String(error) })
    return NextResponse.json({ error: "Error creando portal" }, { status: 500 })
  }
}
