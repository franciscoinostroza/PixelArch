import { NextResponse } from "next/server"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { resend } from "@/lib/resend"

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: string })?.role
  if (role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { suscripcionId } = await req.json()

  const suscripcion = await prisma.suscripcion.update({
    where: { id: suscripcionId },
    data: { estado: "READY", entregadoEn: new Date() },
    include: { cliente: true, servicio: true },
  })

  try {
    const r = resend()
    if (r) {
      await r.emails.send({
        from: `PixelArch <${process.env.CONTACT_EMAIL || "noreply@pixelarch.com"}>`,
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
    }
  } catch (e) {
    console.error("Error sending project ready email:", e)
  }

  return NextResponse.json({ ok: true })
}
