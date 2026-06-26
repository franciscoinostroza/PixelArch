import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resend } from "@/lib/resend"
import { logger } from "@/lib/logger"
import { polar } from "@/lib/polar"
import { pauseDeploy } from "@/lib/deploy"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const results: string[] = []
  const now = new Date()

  try {
    const morosos = await prisma.suscripcion.findMany({
      where: { estado: "PAST_DUE", polarSubscriptionId: { not: null } },
      include: { cliente: true, servicio: true },
    })

    for (const sub of morosos) {
      const daysSincePastDue = sub.pastDueEn
        ? Math.floor((now.getTime() - sub.pastDueEn.getTime()) / (1000 * 60 * 60 * 24))
        : 0

      if (daysSincePastDue >= 30) {
        await polar().subscriptions.revoke({ id: sub.polarSubscriptionId! })
        await prisma.suscripcion.update({
          where: { id: sub.id },
          data: { estado: "CANCELED", canceladoEn: now },
        })
        if (sub.deploymentPlatform && sub.platformServiceId) {
          await pauseDeploy(sub.deploymentPlatform, sub.platformServiceId)
        }

        const r = resend()
        if (r) {
          await r.emails.send({
            from: "PixelArch <hola@pixelarch.dev>",
            to: sub.cliente.email,
            subject: `Suscripcion cancelada — ${sub.servicio.nombre}`,
            text: `Hola ${sub.cliente.nombre},\n\nTu suscripcion a ${sub.servicio.nombre} fue cancelada por falta de pago. El servicio ya no esta online.\n\nSi queres recuperarlo, podes contratarlo nuevamente desde nuestro catalogo.\n\n${process.env.NEXT_PUBLIC_URL}/productos\n\nEquipo PixelArch`,
          })
        }

        results.push(`Cancelada: ${sub.id} (${daysSincePastDue} dias PAST_DUE)`)
        logger.info("Suscripcion cancelada por corte", { suscripcionId: sub.id, daysSincePastDue })
      } else if (daysSincePastDue >= 23) {
        const r = resend()
        if (r) {
          await r.emails.send({
            from: "PixelArch <hola@pixelarch.dev>",
            to: sub.cliente.email,
            subject: `Ultimo aviso — ${sub.servicio.nombre}`,
            text: `Hola ${sub.cliente.nombre},\n\nTu suscripcion a ${sub.servicio.nombre} tiene un pago pendiente. Si no actualizas tu metodo de pago en los proximos 7 dias, el servicio sera cancelado y dejara de estar online.\n\nActualiza tu metodo: ${process.env.NEXT_PUBLIC_URL}/portal/facturacion\n\nEquipo PixelArch`,
          })
        }

        results.push(`Ultimo aviso: ${sub.id} (${daysSincePastDue} dias, quedan ${30 - daysSincePastDue})`)
      } else if (daysSincePastDue >= 7) {
        const r = resend()
        if (r) {
          await r.emails.send({
            from: "PixelArch <hola@pixelarch.dev>",
            to: sub.cliente.email,
            subject: `Aviso de vencimiento — ${sub.servicio.nombre}`,
            text: `Hola ${sub.cliente.nombre},\n\nTu suscripcion a ${sub.servicio.nombre} tiene un pago pendiente. Actualiza tu metodo de pago para evitar la suspension del servicio.\n\nActualiza tu metodo: ${process.env.NEXT_PUBLIC_URL}/portal/facturacion\n\nEquipo PixelArch`,
          })
        }

        results.push(`Aviso: ${sub.id} (${daysSincePastDue} dias vencido)`)
      }
    }

    logger.info("Corte de servicios ejecutado", { total: morosos.length })
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    logger.error("Error en corte de servicios", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
