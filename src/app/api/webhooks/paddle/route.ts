import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { sendPaymentReceipt, sendPaymentFailed, sendSubscriptionCanceled } from "@/lib/notifications"
import { logger } from "@/lib/logger"
const WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET ?? ""

export async function POST(req: Request) {
  try {
    const raw = await req.text()
    const signature = req.headers.get("paddle-signature") ?? ""

    let event
    try {
      event = await paddle().webhooks.unmarshal(raw, WEBHOOK_SECRET, signature)
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const eventType = event.eventType
    const data = event.data as any
    const dataId = (data.id as string) ?? ""
    logger.info("Paddle webhook received", { eventType, dataId })

    switch (eventType) {
      case "transaction.completed": {
        const transactionId = dataId
        const status = data.status as string
        if (status !== "completed") break

        const pricing = (data.details?.lineItems?.[0]?.price?.unitPrice as Record<string, unknown>) ?? {}
        const amount = (pricing.amount as string) ?? "0"
        const currencyCode = (pricing.currencyCode as string) ?? "usd"
        const customerId = (data.customer?.id as string) ?? ""
        const subscriptionId = (data.subscription?.id as string) ?? ""

        const cliente = await prisma.cliente.findFirst({
          where: { paddleCustomerId: customerId },
        })
        if (!cliente) {
          logger.warn("Cliente no encontrado para paddle customer", { customerId })
          break
        }

        const pago = await prisma.pago.create({
          data: {
            clienteId: cliente.id,
            paddleTransactionId: transactionId,
            monto: Math.round(parseFloat(amount) * 100),
            moneda: currencyCode,
            estadoPago: "SUCCEEDED",
          },
        })

        let servicioNombre = "servicio"

        if (subscriptionId) {
          const suscripcion = await prisma.suscripcion.findFirst({
            where: { paddleSubscriptionId: subscriptionId },
            include: { servicio: true },
          })
          if (suscripcion) {
            await prisma.pago.update({
              where: { id: pago.id },
              data: { suscripcionId: suscripcion.id },
            })
            if (suscripcion.estado === "PENDING") {
              await prisma.suscripcion.update({
                where: { id: suscripcion.id },
                data: { estado: "ACTIVE", proximoPago: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
              })
            }
            servicioNombre = suscripcion.servicio.nombre
          } else {
            logger.warn("Suscripcion no encontrada", { paddleSubscriptionId: subscriptionId })
          }
        }

        await sendPaymentReceipt(cliente.email, cliente.nombre, Math.round(parseFloat(amount) * 100), currencyCode, servicioNombre)
        break
      }

      case "transaction.payment_failed": {
        const customerIdFailed = (data.customer?.id as string) ?? ""
        const clienteFail = await prisma.cliente.findFirst({
          where: { paddleCustomerId: customerIdFailed },
        })
        if (!clienteFail) {
          logger.warn("Cliente no encontrado para pago fallido", { customerId: customerIdFailed })
          break
        }

        const subIdFail = (data.subscription?.id as string) ?? ""
        if (subIdFail) {
          const sub = await prisma.suscripcion.findFirst({
            where: { paddleSubscriptionId: subIdFail, clienteId: clienteFail.id },
            include: { servicio: true },
          })
          if (sub) {
            await prisma.suscripcion.update({
              where: { id: sub.id },
              data: { estado: "PAST_DUE", pastDueEn: new Date() },
            })
            await sendPaymentFailed(clienteFail.email, clienteFail.nombre, sub.servicio.nombre)
          }
        }
        break
      }

      case "subscription.created": {
        const paddleSubId = dataId
        const paddleSubCustomerId = (data.customer?.id as string) ?? ""
        const paddlePriceId = (data.items?.[0]?.price?.id as string) ?? ""

        const cliente = await prisma.cliente.findFirst({
          where: { paddleCustomerId: paddleSubCustomerId },
        })
        if (!cliente) {
          logger.warn("Cliente no encontrado para subscription.created", { customerId: paddleSubCustomerId })
          break
        }

        const servicio = await prisma.servicio.findFirst({
          where: {
            OR: [
              { paddlePriceIdUnico: paddlePriceId },
              { paddlePriceIdBasico: paddlePriceId },
              { paddlePriceIdMantenimiento: paddlePriceId },
            ],
          },
        })
        if (!servicio) {
          logger.warn("Servicio no encontrado para priceId", { paddlePriceId })
          break
        }

        let plan: "UNICO" | "BASICO" | "MANTENIMIENTO" = "UNICO"
        if (paddlePriceId === servicio.paddlePriceIdBasico) plan = "BASICO"
        else if (paddlePriceId === servicio.paddlePriceIdMantenimiento) plan = "MANTENIMIENTO"

        await prisma.suscripcion.create({
          data: {
            clienteId: cliente.id,
            servicioId: servicio.id,
            plan,
            estado: "ACTIVE",
            paddleSubscriptionId: paddleSubId,
            proximoPago: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })
        break
      }

      case "subscription.updated": {
        const subIdUpdated = dataId
        const status = data.status as string
        const estado = status === "active" ? "ACTIVE" : status === "paused" ? "PAUSED" : status === "past_due" ? "PAST_DUE" : undefined
        if (estado) {
          await prisma.suscripcion.updateMany({
            where: { paddleSubscriptionId: subIdUpdated },
            data: { estado },
          })
        }
        break
      }

      case "subscription.canceled": {
        const subIdCanceled = dataId
        const sub = await prisma.suscripcion.findFirst({
          where: { paddleSubscriptionId: subIdCanceled },
          include: { cliente: true, servicio: true },
        })
        if (sub) {
          await prisma.suscripcion.update({
            where: { id: sub.id },
            data: { estado: "CANCELED", canceladoEn: new Date() },
          })
          await sendSubscriptionCanceled(sub.cliente.email, sub.cliente.nombre, sub.servicio.nombre)
        }
        break
      }

      case "subscription.paused": {
        const subIdPaused = dataId
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: subIdPaused },
          data: { estado: "PAUSED" },
        })
        break
      }

      case "subscription.resumed": {
        const subIdResumed = dataId
        await prisma.suscripcion.updateMany({
          where: { paddleSubscriptionId: subIdResumed },
          data: { estado: "ACTIVE" },
        })
        break
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error en webhook paddle", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
