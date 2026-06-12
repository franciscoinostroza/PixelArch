import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resend } from "@/lib/resend"
import { logger } from "@/lib/logger"
import { paddle } from "@/lib/payments"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const results: string[] = []
  const now = new Date()

  try {
    const morosos = await prisma.suscripcion.findMany({
      where: { estado: "PAST_DUE", paddleSubscriptionId: { not: null } },
      include: { cliente: true, servicio: true },
    })

    for (const sub of morosos) {
      const daysSincePastDue = sub.pastDueEn
        ? Math.floor((now.getTime() - sub.pastDueEn.getTime()) / (1000 * 60 * 60 * 24))
        : 0

      if (daysSincePastDue >= 30) {
        await paddle().subscriptions.cancel(sub.paddleSubscriptionId!)
        await prisma.suscripcion.update({
          where: { id: sub.id },
          data: { estado: "CANCELED", canceladoEn: now },
        })

        const r = resend()
        if (r) {
          await r.emails.send({
            from: "PixelArch <hola@pixelarch.dev>",
            to: sub.cliente.email,
            subject: `Suscripcion cancelada por falta de pago — ${sub.servicio.nombre}`,
            text: `Hola ${sub.cliente.nombre},\n\nTu suscripcion a ${sub.servicio.nombre} fue cancelada por falta de pago despues de 30 dias. Si queres recuperarla, podes contratarla nuevamente desde nuestro catalogo.\n\n${process.env.NEXT_PUBLIC_URL}/productos\n\nEquipo PixelArch`,
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
            subject: `Tu suscripcion esta por cancelarse — ${sub.servicio.nombre}`,
            text: `Hola ${sub.cliente.nombre},\n\nTu suscripcion a ${sub.servicio.nombre} tiene un pago pendiente. Si no actualizas tu metodo de pago en los proximos 7 dias, el servicio sera cancelado.\n\nActualiza tu metodo: ${process.env.NEXT_PUBLIC_URL}/portal/facturacion\n\nEquipo PixelArch`,
          })
        }

        results.push(`Aviso: ${sub.id} (${daysSincePastDue} dias, quedan ${30 - daysSincePastDue})`)
      }
    }

    logger.info("Corte de servicios ejecutado", { total: morosos.length })
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    logger.error("Error en corte de servicios", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
