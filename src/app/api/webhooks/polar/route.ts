import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPaymentFailed, sendSubscriptionCanceled } from "@/lib/notifications"
import { logger } from "@/lib/logger"

async function verifyPolarWebhook(
  body: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  secret: string,
): Promise<boolean> {
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  )

  const expectedSig = await crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(Buffer.from(webhookSignature, "base64")),
    encoder.encode(signedContent),
  )

  return expectedSig
}

export async function POST(req: Request) {
  try {
    const body = await req.text()
    const webhookId = req.headers.get("webhook-id") ?? ""
    const webhookTimestamp = req.headers.get("webhook-timestamp") ?? ""
    const webhookSignature = req.headers.get("webhook-signature") ?? ""
    const secret = process.env.POLAR_WEBHOOK_SECRET ?? ""

    const isValid = await verifyPolarWebhook(body, webhookId, webhookTimestamp, webhookSignature, secret)
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const event = JSON.parse(body)
    const eventType = event.type as string
    const data = event.data ?? event
    logger.info("Polar webhook received", { eventType })

    function extractPlan(productName: string): "UNICO" | "BASICO" | "MANTENIMIENTO" {
      if (productName.includes("Básico") || productName.includes("Basico")) return "BASICO"
      if (productName.includes("Mantenimiento")) return "MANTENIMIENTO"
      return "UNICO"
    }

    const handlers: Record<string, (data: any) => Promise<void>> = {
      "order.paid": async (order: any) => {
        const customerId = order.customer?.id ?? ""
        const amount = order.amount ?? 0
        const currency = order.currency ?? "usd"
        const subscriptionId = order.subscription?.id ?? ""
        const productId = order.product?.id ?? ""
        const productName = order.product?.name ?? ""

        const cliente = await prisma.cliente.findFirst({
          where: { polarCustomerId: customerId },
        })
        if (!cliente) {
          logger.warn("Cliente no encontrado para polar customer", { customerId })
          return
        }

        const pago = await prisma.pago.create({
          data: {
            clienteId: cliente.id,
            polarTransactionId: order.id,
            monto: Math.round(parseFloat(String(amount)) * 100),
            moneda: currency,
            estadoPago: "SUCCEEDED",
          },
        })

        const servicio = await prisma.servicio.findFirst({
          where: {
            OR: [
              { polarProductIdUnico: productId },
              { polarProductIdBasico: productId },
              { polarProductIdMantenimiento: productId },
            ],
          },
        })
        if (!servicio) {
          logger.warn("Servicio no encontrado para productId", { productId })
          return
        }

        if (subscriptionId) {
          let suscripcion = await prisma.suscripcion.findFirst({
            where: { polarSubscriptionId: subscriptionId },
          })

          if (suscripcion) {
            await prisma.pago.update({
              where: { id: pago.id },
              data: { suscripcionId: suscripcion.id },
            })
            const updates: Record<string, unknown> = { proximoPago: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
            if (suscripcion.estado === "PENDING" || suscripcion.estado === "READY") updates.estado = "ACTIVE"
            if (suscripcion.estado === "PAST_DUE") {
              updates.estado = "ACTIVE"
              updates.pastDueEn = null
            }
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: updates,
            })
          } else {
            const existing = await prisma.suscripcion.findFirst({
              where: { clienteId: cliente.id, servicioId: servicio.id, plan: "UNICO", estado: "READY" },
            })
            if (existing) {
              await prisma.suscripcion.update({
                where: { id: existing.id },
                data: {
                  plan: "MANTENIMIENTO",
                  estado: "ACTIVE",
                  polarSubscriptionId: subscriptionId,
                  proximoPago: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
              })
              await prisma.pago.update({
                where: { id: pago.id },
                data: { suscripcionId: existing.id },
              })
            } else {
              const nueva = await prisma.suscripcion.create({
                data: {
                  clienteId: cliente.id,
                  servicioId: servicio.id,
                  plan: extractPlan(productName),
                  estado: "ACTIVE",
                  polarSubscriptionId: subscriptionId,
                  proximoPago: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
              })
              await prisma.pago.update({
                where: { id: pago.id },
                data: { suscripcionId: nueva.id },
              })
            }
          }
        } else {
          let sub = await prisma.suscripcion.findFirst({
            where: { clienteId: cliente.id, servicioId: servicio.id, plan: "UNICO" },
          })
          if (!sub) {
            sub = await prisma.suscripcion.create({
              data: {
                clienteId: cliente.id,
                servicioId: servicio.id,
                plan: "UNICO",
                estado: "READY",
              },
            })
          }
          await prisma.pago.update({
            where: { id: pago.id },
            data: { suscripcionId: sub.id },
          })
        }
      },

      "subscription.active": async (sub: any) => {
        const subId = sub.id ?? ""
        await prisma.suscripcion.updateMany({
          where: { polarSubscriptionId: subId },
          data: { estado: "ACTIVE" },
        })
      },

      "subscription.past_due": async (sub: any) => {
        const subId = sub.id ?? ""
        const customerId = sub.customer?.id ?? ""
        const cliente = await prisma.cliente.findFirst({ where: { polarCustomerId: customerId } })
        if (!cliente) return

        const suscripcion = await prisma.suscripcion.findFirst({
          where: { polarSubscriptionId: subId, clienteId: cliente.id },
          include: { servicio: true },
        })
        if (suscripcion) {
          await prisma.suscripcion.update({
            where: { id: suscripcion.id },
            data: { estado: "PAST_DUE", pastDueEn: new Date() },
          })
          await sendPaymentFailed(cliente.email, cliente.nombre, suscripcion.servicio.nombre)
        }
      },

      "subscription.revoked": async (sub: any) => {
        const subId = sub.id ?? ""
        const subDb = await prisma.suscripcion.findFirst({
          where: { polarSubscriptionId: subId },
          include: { cliente: true, servicio: true },
        })
        if (subDb) {
          await prisma.suscripcion.update({
            where: { id: subDb.id },
            data: { estado: "CANCELED", canceladoEn: new Date() },
          })
        }
      },

      "subscription.canceled": async (sub: any) => {
        const subId = sub.id ?? ""
        const subDb = await prisma.suscripcion.findFirst({
          where: { polarSubscriptionId: subId },
          include: { cliente: true, servicio: true },
        })
        if (subDb) {
          await prisma.suscripcion.update({
            where: { id: subDb.id },
            data: { estado: "CANCELED", canceladoEn: new Date() },
          })
          await sendSubscriptionCanceled(subDb.cliente.email, subDb.cliente.nombre, subDb.servicio.nombre)
        }
      },

      "subscription.updated": async (sub: any) => {
        const subId = sub.id ?? ""
        const status = sub.status ?? ""
        const estado = status === "active" ? "ACTIVE" : status === "past_due" ? "PAST_DUE" : undefined
        if (estado) {
          await prisma.suscripcion.updateMany({
            where: { polarSubscriptionId: subId },
            data: { estado },
          })
        }
      },
    }

    const handler = handlers[eventType]
    if (handler) {
      await handler(data)
    } else {
      logger.info("Evento no manejado", { eventType })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error en webhook polar", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
