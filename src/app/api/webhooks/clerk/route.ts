import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendWelcomeEmail } from "@/lib/notifications"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  try {
    const svixId = req.headers.get("svix-id")
    const svixTimestamp = req.headers.get("svix-timestamp")
    const svixSignature = req.headers.get("svix-signature")

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: "Error de verificacion" }, { status: 401 })
    }

    const raw = await req.text()
    const Webhook = require("svix").Webhook
    const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!)

    let evt: { type: string; data: Record<string, unknown> }
    try {
      evt = wh.verify(raw, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as { type: string; data: Record<string, unknown> }
    } catch {
      return NextResponse.json({ error: "Error de verificacion" }, { status: 401 })
    }

    const { type, data } = evt
    logger.info("Clerk webhook received", { type, clerkUserId: data.id as string })

    switch (type) {
      case "user.created": {
        const clerkId = data.id as string
        const email = ((data.email_addresses as Array<{ email_address: string }>)?.[0]?.email_address) ?? ""
        const nombre = `${(data.first_name as string) ?? ""} ${(data.last_name as string) ?? ""}`.trim() || email

        try {
          await prisma.cliente.create({
            data: { clerkUserId: clerkId, email, nombre },
          })
          await sendWelcomeEmail(email, nombre)
          logger.info("Cliente creado y welcome email enviado", { clerkUserId: clerkId, email })
        } catch (e) {
          logger.error("Error creando cliente desde webhook", { error: String(e), clerkUserId: clerkId })
        }
        break
      }

      case "user.updated": {
        const clerkId = data.id as string
        const updatedEmail = ((data.email_addresses as Array<{ email_address: string }>)?.[0]?.email_address) ?? ""
        const updatedNombre = `${(data.first_name as string) ?? ""} ${(data.last_name as string) ?? ""}`.trim() || updatedEmail

        try {
          await prisma.cliente.update({
            where: { clerkUserId: clerkId },
            data: { email: updatedEmail, nombre: updatedNombre },
          })
        } catch (e) {
          logger.error("Error actualizando cliente", { error: String(e), clerkUserId: clerkId })
        }
        break
      }

      case "user.deleted": {
        const clerkId = data.id as string
        try {
          await prisma.cliente.update({
            where: { clerkUserId: clerkId },
            data: { activo: false },
          })
          logger.info("Cliente desactivado", { clerkUserId: clerkId })
        } catch (e) {
          logger.error("Error desactivando cliente", { error: String(e), clerkUserId: clerkId })
        }
        break
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error en webhook clerk", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
