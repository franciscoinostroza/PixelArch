import { NextResponse } from "next/server"
import { contactSchema } from "@/lib/validations"
import { resend } from "@/lib/resend"
import { sendTelegramMessage } from "@/lib/telegram"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = contactSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { nombre, email, mensaje } = parsed.data

    await Promise.allSettled([
      resend().emails.send({
        from: `PixelArch <${process.env.CONTACT_EMAIL || "onboarding@resend.dev"}>`,
        to: process.env.CONTACT_EMAIL || "",
        replyTo: email,
        subject: `Nuevo mensaje de ${nombre}`,
        text: `Nombre: ${nombre}\nEmail: ${email}\n\nMensaje:\n${mensaje}`,
      }),
      sendTelegramMessage(
        `📬 *Nuevo mensaje de contacto*\n\n*Nombre:* ${nombre}\n*Email:* ${email}\n\n*Mensaje:*\n${mensaje}`
      ),
    ])

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
