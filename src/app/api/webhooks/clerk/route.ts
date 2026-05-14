import { NextResponse } from "next/server"

// Clerk webhook: sync user data to our Cliente table
// TODO: wire up with Prisma once DATABASE_URL is set

export async function POST(req: Request) {
  const body = await req.json()
  const { type, data } = body

  try {
    switch (type) {
      case "user.created": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        // TODO: await prisma.cliente.create({
        //   data: { clerkUserId: id, email, nombre, activo: true },
        // })

        console.log("user.created", { id, email, nombre })
        break
      }

      case "user.updated": {
        const { id, email_addresses, first_name, last_name } = data
        const email = email_addresses?.[0]?.email_address
        const nombre = `${first_name || ""} ${last_name || ""}`.trim()

        // TODO: await prisma.cliente.update({
        //   where: { clerkUserId: id },
        //   data: { email, nombre },
        // })

        console.log("user.updated", { id, email, nombre })
        break
      }

      case "user.deleted": {
        const { id } = data
        // Soft delete
        // TODO: await prisma.cliente.update({
        //   where: { clerkUserId: id },
        //   data: { activo: false },
        // })

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
