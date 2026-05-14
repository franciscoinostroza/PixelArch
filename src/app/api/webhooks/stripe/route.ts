import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import Stripe from "stripe"

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get("stripe-signature") || ""

  let event: Stripe.Event

  try {
    event = stripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const { clienteId, servicioId } = session.metadata || {}
        const subscriptionId = session.subscription as string

        // TODO: Crear Suscripcion en BD con estado ACTIVE
        // await prisma.suscripcion.create({...})
        console.log("checkout.completed", { clienteId, servicioId, subscriptionId })
        break
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object
        const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string

        // TODO: Actualizar Suscripcion estado ACTIVE, crear Pago SUCCEEDED
        console.log("invoice.payment_succeeded", { subscriptionId, amount: invoice.amount_paid })
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object
        const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string

        // TODO: Actualizar Suscripcion estado PAST_DUE, crear Pago FAILED
        console.log("invoice.payment_failed", { subscriptionId })
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription

        // TODO: Actualizar Suscripcion estado CANCELED, setear canceladoEn
        console.log("subscription.deleted", { subscriptionId: subscription.id })
        break
      }

      case "customer.subscription.paused": {
        const subscription = event.data.object as Stripe.Subscription

        // TODO: Actualizar Suscripcion estado PAUSED
        console.log("subscription.paused", { subscriptionId: subscription.id })
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
