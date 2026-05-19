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
import { sendPaymentReceipt, sendPaymentFailed, sendSubscriptionCanceled } from "@/lib/notifications"
import { sendWelcomeEmail } from "@/lib/notifications"

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
        const customData = (data as unknown as { customData?: { tipo?: string } }).customData
        const tipo = customData?.tipo

        if (subscriptionId) {
          const cliente = await prisma.cliente.findUnique({ where: { paddleCustomerId: customerId ?? undefined } })
          if (!cliente) break

          const items = data.items ?? []
          const item = items[0]
          const servicio = item ? await prisma.servicio.findUnique({ where: { paddlePriceIdBasico: item.price?.id } }) : null
          if (!servicio) break

          await prisma.suscripcion.upsert({
            where: { paddleSubscriptionId: subscriptionId },
            create: {
              paddleSubscriptionId: subscriptionId,
              clienteId: cliente.id,
              servicioId: servicio.id,
              plan: tipo === "MANTENIMIENTO" ? "MANTENIMIENTO" : "BASICO",
              estado: "ACTIVE",
            },
            update: { estado: "ACTIVE" },
          })

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

          sendPaymentReceipt(cliente.email, cliente.nombre, parseInt(items[0]?.price?.unitPrice?.amount ?? "0"), data.currencyCode ?? "usd", servicio.nombre)
        } else {
          // Pago unico — crear suscripcion PENDING
          const cliente = await prisma.cliente.findUnique({ where: { paddleCustomerId: customerId ?? undefined } })
          if (!cliente) break

          const items = data.items ?? []
          const item = items[0]
          const servicio = item ? await prisma.servicio.findUnique({ where: { paddlePriceIdUnico: item.price?.id } }) : null
          if (!servicio) break

          const suscripcion = await prisma.suscripcion.create({
            data: {
              clienteId: cliente.id,
              servicioId: servicio.id,
              plan: "UNICO",
              estado: "PENDING",
              paddleTransactionId: data.id,
            },
          })

          await prisma.pago.upsert({
            where: { paddleTransactionId: data.id },
            create: {
              paddleTransactionId: data.id,
              clienteId: cliente.id,
              suscripcionId: suscripcion.id,
              monto: parseInt(items[0]?.price?.unitPrice?.amount ?? "0"),
              moneda: data.currencyCode ?? "usd",
              estadoPago: "SUCCEEDED",
            },
            update: { estadoPago: "SUCCEEDED" },
          })

          sendWelcomeEmail(cliente.email, cliente.nombre)
        }
        break
      }

      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated: {
        const status = (eventData as SubscriptionCreatedEvent | SubscriptionUpdatedEvent).data.status
        const subId = (eventData as SubscriptionCreatedEvent | SubscriptionUpdatedEvent).data.id
        // Don't override PENDING/READY with subscription webhooks
        const paddleStatus = mapPaddleStatus(status)
        if (paddleStatus !== "PENDING" && paddleStatus !== "READY") {
          await prisma.suscripcion.updateMany({
            where: { paddleSubscriptionId: subId, estado: { notIn: ["PENDING", "READY", "CANCELED"] } },
            data: {
              estado: paddleStatus,
              proximoPago: (eventData as SubscriptionUpdatedEvent).data.nextBilledAt ? new Date((eventData as SubscriptionUpdatedEvent).data.nextBilledAt!) : undefined,
            },
          })
        }
        break
      }

      case EventName.SubscriptionCanceled: {
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: (eventData as SubscriptionCanceledEvent).data.id },
          data: { estado: "CANCELED", canceladoEn: new Date() },
        })
        break
      }

      case EventName.SubscriptionPaused: {
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: (eventData as SubscriptionPausedEvent).data.id },
          data: { estado: "PAUSED" },
        })
        break
      }

      case EventName.TransactionPaymentFailed: {
        const { data } = eventData as TransactionPaymentFailedEvent
        const subscriptionId = data.subscriptionId
        if (subscriptionId) {
          await prisma.suscripcion.updateMany({
            where: { paddleSubscriptionId: subscriptionId, estado: { notIn: ["PENDING", "READY"] } },
            data: { estado: "PAST_DUE" },
          })
        }
        const cliente = await prisma.cliente.findUnique({ where: { paddleCustomerId: data.customerId ?? undefined } })
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
        if (cliente && subscriptionId) {
          const sub = await prisma.suscripcion.findUnique({
            where: { paddleSubscriptionId: subscriptionId },
            include: { servicio: { select: { nombre: true } } },
          })
          if (sub) sendPaymentFailed(cliente.email, cliente.nombre, sub.servicio.nombre)
        }
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

function mapPaddleStatus(paddleStatus: string): "ACTIVE" | "PAST_DUE" | "CANCELED" | "PAUSED" | "PENDING" | "READY" {
  switch (paddleStatus) {
    case "active": return "ACTIVE"
    case "past_due": return "PAST_DUE"
    case "canceled": return "CANCELED"
    case "paused": return "PAUSED"
    case "trialing": return "ACTIVE"
    default: return "ACTIVE"
  }
}
