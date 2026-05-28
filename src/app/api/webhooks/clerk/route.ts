import { Webhook } from "svix"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendWelcomeEmail } from "@/lib/notifications"

const WH_SECRET = process.env.CLERK_WEBHOOK_SECRET

export async function POST(req: Request) {
  const rawBody = await req.text()
  const payload = JSON.parse(rawBody)
  const headerPayload = await headers()

  const svixId = headerPayload.get("svix-id")
  const svixTimestamp = headerPayload.get("svix-timestamp")
  const svixSignature = headerPayload.get("svix-signature")

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Faltan headers svix" }, { status: 400 })
  }

  if (!WH_SECRET) {
    return NextResponse.json({ error: "Webhook secret no configurado" }, { status: 500 })
  }

  try {
    const wh = new Webhook(WH_SECRET)
    wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    })
  } catch {
    return NextResponse.json({ error: "Firma invalida" }, { status: 401 })
  }

  const { type, data } = payload

  try {
    switch (type) {
      case "user.created": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address ?? ""
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        await prisma.cliente.upsert({
          where: { clerkUserId: id },
          create: { clerkUserId: id, email, nombre, activo: true },
          update: { email, nombre, activo: true },
        })

        sendWelcomeEmail(email, nombre).catch((e) =>
          console.error("Welcome email error:", e)
        )
        break
      }

      case "user.updated": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        await prisma.cliente.upsert({
          where: { clerkUserId: id },
          create: { clerkUserId: id, email: email ?? "", nombre, activo: true },
          update: { email: email ?? undefined, nombre: nombre || undefined },
        })
        break
      }

      case "user.deleted": {
        const { id } = data

        await prisma.cliente.upsert({
          where: { clerkUserId: id },
          create: { clerkUserId: id, email: "", nombre: "", activo: false },
          update: { activo: false },
        })
        break
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Clerk webhook error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
