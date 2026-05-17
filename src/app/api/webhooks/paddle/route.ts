import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { paddle } from "@/lib/payments"
import { prisma } from "@/lib/prisma"
import {
  EventName,
  TransactionCompletedEvent,
  TransactionPaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionUpdatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPausedEvent,
} from "@paddle/paddle-node-sdk"

const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET ?? ""

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get("paddle-signature") ?? ""

  try {
    const eventData = await paddle().webhooks.unmarshal(body, webhookSecret, signature)

    switch (eventData.eventType) {
      case EventName.TransactionCompleted: {
        const event = eventData as TransactionCompletedEvent
        const { data } = event
        const subscriptionId = data.subscriptionId
        const customerId = data.customerId

        if (!subscriptionId) break

        const cliente = await prisma.cliente.findUnique({
          where: { paddleCustomerId: customerId ?? undefined },
        })
        if (!cliente) break

        const items = data.items ?? []
        const item = items[0]
        const servicio = item
          ? await prisma.servicio.findUnique({
              where: { paddlePriceId: item.price?.id },
            })
          : null

        if (servicio) {
          await prisma.suscripcion.upsert({
            where: { paddleSubscriptionId: subscriptionId },
            create: {
              paddleSubscriptionId: subscriptionId,
              clienteId: cliente.id,
              servicioId: servicio.id,
              estado: "ACTIVE",
            },
            update: { estado: "ACTIVE" },
          })
        }

        await prisma.pago.upsert({
          where: { paddleTransactionId: data.id },
          create: {
            paddleTransactionId: data.id,
            clienteId: cliente.id,
            monto: parseInt(items[0]?.price?.unitPrice?.amount ?? "0"),
            moneda: data.currencyCode ?? "usd",
            estadoPago: "SUCCEEDED",
          },
          update: { estadoPago: "SUCCEEDED" },
        })
        break
      }

      case EventName.SubscriptionCreated: {
        const event = eventData as SubscriptionCreatedEvent
        const { data } = event
        const subscriptionId = data.id
        const customerId = data.customerId
        const status = mapPaddleStatus(data.status)

        const cliente = await prisma.cliente.findUnique({
          where: { paddleCustomerId: customerId ?? undefined },
        })
        if (!cliente) break

        const items = data.items ?? []
        const item = items[0]
        const servicio = item
          ? await prisma.servicio.findUnique({
              where: { paddlePriceId: item.price?.id },
            })
          : null

        if (servicio) {
          await prisma.suscripcion.upsert({
            where: { paddleSubscriptionId: subscriptionId },
            create: {
              paddleSubscriptionId: subscriptionId,
              clienteId: cliente.id,
              servicioId: servicio.id,
              estado: status,
              proximoPago: data.nextBilledAt ? new Date(data.nextBilledAt) : null,
            },
            update: {
              estado: status,
              proximoPago: data.nextBilledAt ? new Date(data.nextBilledAt) : null,
            },
          })
        }
        break
      }

      case EventName.SubscriptionUpdated: {
        const event = eventData as SubscriptionUpdatedEvent
        const { data } = event
        const status = mapPaddleStatus(data.status)

        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: data.id },
          data: {
            estado: status,
            proximoPago: data.nextBilledAt ? new Date(data.nextBilledAt) : null,
            canceladoEn: data.canceledAt ? new Date(data.canceledAt) : null,
          },
        })
        break
      }

      case EventName.SubscriptionCanceled: {
        const event = eventData as SubscriptionCanceledEvent
        const { data } = event
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: data.id },
          data: {
            estado: "CANCELED",
            canceladoEn: data.canceledAt ? new Date(data.canceledAt) : new Date(),
          },
        })
        break
      }

      case EventName.SubscriptionPaused: {
        const event = eventData as SubscriptionPausedEvent
        const { data } = event
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: data.id },
          data: { estado: "PAUSED" },
        })
        break
      }

      case EventName.TransactionPaymentFailed: {
        const event = eventData as TransactionPaymentFailedEvent
        const { data } = event
        const subscriptionId = data.subscriptionId

        if (subscriptionId) {
          await prisma.suscripcion.updateMany({
            where: { paddleSubscriptionId: subscriptionId },
            data: { estado: "PAST_DUE" },
          })
        }

        const cliente = await prisma.cliente.findUnique({
          where: { paddleCustomerId: data.customerId ?? undefined },
        })
        await prisma.pago.upsert({
          where: { paddleTransactionId: data.id },
          create: {
            paddleTransactionId: data.id,
            clienteId: cliente?.id ?? "",
            monto: parseInt(data.items?.[0]?.price?.unitPrice?.amount ?? "0"),
            moneda: data.currencyCode ?? "usd",
            estadoPago: "FAILED",
          },
          update: { estadoPago: "FAILED" },
        })
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

function mapPaddleStatus(paddleStatus: string): "ACTIVE" | "PAST_DUE" | "CANCELED" | "PAUSED" | "TRIALING" {
  switch (paddleStatus) {
    case "active": return "ACTIVE"
    case "past_due": return "PAST_DUE"
    case "canceled": return "CANCELED"
    case "paused": return "PAUSED"
    case "trialing": return "TRIALING"
    default: return "ACTIVE"
  }
}
