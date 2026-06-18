import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { polar } from "@/lib/polar"
import { getCurrentCliente } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`checkout:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  try {
    const { servicioId, polarProductId, tipo } = await req.json()

    let productId = polarProductId as string | undefined
    let plan: "UNICO" | "BASICO" | "MANTENIMIENTO" = "UNICO"

    if (servicioId && !productId) {
      const servicio = await prisma.servicio.findUnique({ where: { id: servicioId } })
      if (!servicio?.activo) {
        return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 })
      }
      const tipoLookup =
        tipo === "MANTENIMIENTO" ? servicio.polarProductIdMantenimiento
        : tipo === "BASICO" ? servicio.polarProductIdBasico
        : servicio.polarProductIdUnico
      if (!tipoLookup) {
        return NextResponse.json({ error: "Producto no configurado" }, { status: 500 })
      }
      productId = tipoLookup
    }

    if (tipo === "MANTENIMIENTO") plan = "MANTENIMIENTO"
    else if (tipo === "BASICO") plan = "BASICO"

    if (!productId) {
      return NextResponse.json({ error: "polarProductId requerido" }, { status: 400 })
    }

    let cliente
    try {
      cliente = await getCurrentCliente()
    } catch {
      cliente = null
    }

    let customerId: string | undefined
    let customerEmail: string | undefined
    let customerName: string | undefined

    if (cliente) {
      customerEmail = cliente.email
      customerName = cliente.nombre ?? undefined

      if (cliente.polarCustomerId) {
        customerId = cliente.polarCustomerId
      } else {
        try {
          const c = await polar().customers.create({
            email: cliente.email,
            name: cliente.nombre ?? undefined,
          })
          await prisma.cliente.update({
            where: { id: cliente.id },
            data: { polarCustomerId: c.id },
          })
          customerId = c.id
        } catch {
          // Polar might create customer on checkout
        }
      }
    }

    const checkout = await polar().checkouts.create({
      products: [productId],
      allowDiscountCodes: true,
      successUrl: `${process.env.NEXT_PUBLIC_URL}/portal?success=true`,
      ...(customerEmail ? { customerEmail, customerName } : {}),
      ...(customerId ? { customerId } : {}),
      metadata: { plan },
    })

    logger.info("Checkout session created", { checkoutId: checkout.id, productId })
    return NextResponse.json({ url: checkout.url })
  } catch (error) {
    logger.error("Error creando checkout", { error: String(error) })
    return NextResponse.json({ error: "Error creando checkout" }, { status: 500 })
  }
}
