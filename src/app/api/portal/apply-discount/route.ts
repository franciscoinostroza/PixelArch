import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { polar } from "@/lib/polar"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`apply-discount:${ip}`, 5, 60_000)) {
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

  let codigo: string | undefined
  let suscripcionId: string | undefined
  try {
    const body = await req.json()
    codigo = body.codigo
    suscripcionId = body.suscripcionId
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  if (!codigo || !suscripcionId) {
    return NextResponse.json({ error: "codigo y suscripcionId requeridos" }, { status: 400 })
  }

  const cliente = await prisma.cliente.findUnique({ where: { clerkUserId: userId } })
  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { id: suscripcionId, clienteId: cliente.id },
  })
  if (!suscripcion?.polarSubscriptionId) {
    return NextResponse.json({ error: "Suscripcion no encontrada o sin plan recurrente" }, { status: 400 })
  }

  try {
    const page = await polar().discounts.list({ limit: 100 })
    const items = page.result?.items as Array<Record<string, unknown>> | undefined
    const discount = items?.find((d) => d.code === codigo)
    if (!discount) {
      return NextResponse.json({ error: "Codigo de descuento invalido" }, { status: 400 })
    }

    const now = new Date()
    if (discount.startsAt && new Date(discount.startsAt as string) > now) {
      return NextResponse.json({ error: "Este codigo aun no esta disponible" }, { status: 400 })
    }
    if (discount.endsAt && new Date(discount.endsAt as string) < now) {
      return NextResponse.json({ error: "Este codigo ha expirado" }, { status: 400 })
    }

    await polar().subscriptions.update({
      id: suscripcion.polarSubscriptionId,
      subscriptionUpdate: { discountId: discount.id as string },
    })

    await prisma.suscripcion.update({
      where: { id: suscripcionId },
      data: { polarDiscountId: discount.id as string },
    })

    const tipo = discount.type as string
    const descText =
      tipo === "percentage"
        ? `${(discount.basisPoints as number / 100)}% OFF`
        : `$${((discount.amount as number) / 100).toFixed(0)} OFF`

    logger.info("Discount applied to subscription", { suscripcionId, codigo, discountId: discount.id })
    return NextResponse.json({ ok: true, descripcion: `${descText} aplicado desde el proximo ciclo` })
  } catch (error) {
    logger.error("Error applying discount", { error: String(error), suscripcionId, codigo })
    return NextResponse.json({ error: "Error al aplicar codigo de descuento" }, { status: 500 })
  }
}
