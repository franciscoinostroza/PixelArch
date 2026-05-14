import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

// TODO: wire up with Prisma once DB is ready
export async function PATCH(req: Request) {
  const { userId, sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role

  if (role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const { suscripcionId, accion } = await req.json()

    // accion: "pause" | "cancel" | "activate"
    console.log("suscripcion action", { suscripcionId, accion, adminId: userId })

    // TODO: Integrate with Stripe API + update Prisma

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
