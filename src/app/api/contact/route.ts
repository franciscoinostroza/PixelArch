import { NextResponse } from "next/server"
import { contactSchema } from "@/lib/validations"
import { resend } from "@/lib/resend"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`contact:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  try {
    const body = await req.json()
    const parsed = contactSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { nombre, email, mensaje } = parsed.data

    const resendClient = resend()
    if (resendClient) {
      await resendClient.emails.send({
        from: "PixelArch <contacto@pixelarch.dev>",
        to: process.env.CONTACT_EMAIL || "",
        replyTo: email,
        subject: `Nuevo mensaje de ${nombre}`,
        text: `Nombre: ${nombre}\nEmail: ${email}\n\nMensaje:\n${mensaje}`,
      })
      logger.info("Contact email sent", { nombre, email })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    logger.error("Error sending contact email", { error: String(e) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
