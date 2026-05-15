import { Webhook } from "svix"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const WH_SECRET = process.env.CLERK_WEBHOOK_SECRET

export async function POST(req: Request) {
  const payload = await req.json()
  const body = JSON.stringify(payload)
  const headerPayload = await headers()

  const svixId = headerPayload.get("svix-id")
  const svixTimestamp = headerPayload.get("svix-timestamp")
  const svixSignature = headerPayload.get("svix-signature")

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Faltan headers svix" }, { status: 400 })
  }

  if (WH_SECRET) {
    try {
      const wh = new Webhook(WH_SECRET)
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      })
    } catch (err) {
      console.error("Webhook signature verification failed:", err)
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 })
    }
  }

  const { type, data } = payload

  try {
    switch (type) {
      case "user.created": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        await prisma.cliente.upsert({
          where: { clerkUserId: id },
          create: { clerkUserId: id, email: email || "", nombre, activo: true },
          update: { email: email || "", nombre },
        })

        console.log("user.created", { id, email, nombre })
        break
      }

      case "user.updated": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        await prisma.cliente.update({
          where: { clerkUserId: id },
          data: { email: email || undefined, nombre: nombre || undefined },
        })

        console.log("user.updated", { id, email, nombre })
        break
      }

      case "user.deleted": {
        const { id } = data

        await prisma.cliente.update({
          where: { clerkUserId: id },
          data: { activo: false },
        })

        console.log("user.deleted", { id })
        break
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Clerk webhook error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
