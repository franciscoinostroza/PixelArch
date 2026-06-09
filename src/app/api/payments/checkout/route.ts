import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { getCurrentCliente } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`checkout:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  try {
    const { servicioId, paddlePriceId, successUrl } = await req.json()

    let priceId = paddlePriceId as string | undefined

    if (servicioId && !priceId) {
      const servicio = await prisma.servicio.findUnique({
        where: { id: servicioId },
      })
      if (!servicio?.activo) {
        return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
      }
      priceId = servicio.paddlePriceIdUnico
    }

    if (!priceId) {
      return NextResponse.json({ error: "paddlePriceId requerido" }, { status: 400 })
    }

    let cliente
    try {
      cliente = await getCurrentCliente()
    } catch {
      cliente = null
    }

    let customerId: string | undefined

    if (cliente) {
      if (cliente.paddleCustomerId) {
        customerId = cliente.paddleCustomerId
      } else {
        const paddleCustomer = await paddle().customers.create({
          email: cliente.email,
          name: cliente.nombre ?? undefined,
        })
        await prisma.cliente.update({
          where: { id: cliente.id },
          data: { paddleCustomerId: paddleCustomer.id },
        })
        customerId = paddleCustomer.id
      }
    }

    logger.info("Checkout data generated", { priceId, customerId: !!customerId })

    return NextResponse.json({
      paddlePriceId: priceId,
      customerId,
      successUrl: successUrl ?? `${process.env.NEXT_PUBLIC_URL}/portal?success=true`,
    })
  } catch (error) {
    logger.error("Error creando checkout", { error: String(error) })
    return NextResponse.json({ error: "Error creando checkout" }, { status: 500 })
  }
}
