import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"

export async function POST(req: Request) {
  const { userId } = await auth()
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
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Error cancelando suscripcion" }, { status: 500 })
  }
}
