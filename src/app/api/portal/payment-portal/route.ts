import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const cliente = await prisma.cliente.findUnique({ where: { clerkUserId: userId } })
  if (!cliente?.paddleCustomerId) {
    return NextResponse.json({ error: "Cliente sin cuenta de pago" }, { status: 404 })
  }

  const suscripciones = await prisma.suscripcion.findMany({
    where: { clienteId: cliente.id, estado: { in: ["ACTIVE", "PAST_DUE", "TRIALING"] } },
    select: { paddleSubscriptionId: true },
  })

  try {
    const session = await paddle().customerPortalSessions.create(
      cliente.paddleCustomerId,
      suscripciones.map((s) => s.paddleSubscriptionId)
    )
    return NextResponse.json({ url: session.urls.general })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Error creando sesion" }, { status: 500 })
  }
}
