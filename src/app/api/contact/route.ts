import { NextResponse } from "next/server"
import { contactSchema } from "@/lib/validations"
import { resend } from "@/lib/resend"

export async function POST(req: Request) {
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
        from: `PixelArch <${process.env.CONTACT_EMAIL || "onboarding@resend.dev"}>`,
        to: process.env.CONTACT_EMAIL || "",
        replyTo: email,
        subject: `Nuevo mensaje de ${nombre}`,
        text: `Nombre: ${nombre}\nEmail: ${email}\n\nMensaje:\n${mensaje}`,
      })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
