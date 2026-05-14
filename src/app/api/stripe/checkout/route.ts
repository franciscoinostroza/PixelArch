import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"

export async function POST(req: Request) {
  try {
    const { servicioId } = await req.json()

    if (!servicioId) {
      return NextResponse.json({ error: "servicioId requerido" }, { status: 400 })
    }

    // TODO: Get clerk user from auth(), look up Cliente in DB
    // For now, placeholder

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: "price_placeholder", // TODO: get from Servicio.stripePriceId
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_URL}/portal?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/portal?canceled=true`,
      metadata: {
        // clienteId: cliente.id,
        servicioId,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Error creando checkout" }, { status: 500 })
  }
}
