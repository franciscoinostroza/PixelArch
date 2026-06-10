import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resend } from "@/lib/resend"
import { requireAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { suscripcionId } = await req.json()

  let suscripcion
  try {
    suscripcion = await prisma.suscripcion.update({
      where: { id: suscripcionId },
      data: { estado: "READY", entregadoEn: new Date() },
      include: { cliente: true, servicio: true },
    })
  } catch (e) {
    logger.error("Error entregando servicio", { error: String(e), suscripcionId })
    return NextResponse.json({ error: "Error al entregar servicio" }, { status: 500 })
  }

  try {
    const r = resend()
    if (r) {
      await r.emails.send({
        from: "PixelArch <hola@pixelarch.dev>",
        to: suscripcion.cliente.email,
        subject: `Tu ${suscripcion.servicio.nombre} esta listo — PixelArch`,
        text: [
          "¡Tu proyecto esta entregado!",
          "",
          `Tu ${suscripcion.servicio.nombre} esta listo.`,
          "Para mantenerlo activo, elegi un plan de mantenimiento desde tu portal:",
          `${process.env.NEXT_PUBLIC_URL}/portal`,
          "",
          `Plan Basico: $${(suscripcion.servicio.precioBasico / 100).toFixed(0)}/mes — servicio activo sin cambios`,
          `Plan Mantenimiento: $${(suscripcion.servicio.precioMantenimiento / 100).toFixed(0)}/mes — cambios + soporte incluido`,
        ].join("\n"),
      })
      logger.info("Project ready email sent", { suscripcionId })
    }
  } catch (e) {
    logger.error("Error sending project ready email", { error: String(e) })
  }

  return NextResponse.json({ ok: true })
}
