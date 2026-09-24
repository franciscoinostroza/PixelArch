import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { clienteSchema } from "@/lib/validations"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-clientes:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { id } = await params

  let body: { activo?: boolean } & Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const parsed = clienteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Datos invalidos" }, { status: 400 })
  }

  const { nombre, email, empresa, telefono, notas } = parsed.data
  const emailLower = email.toLowerCase()

  try {
    const cliente = await prisma.cliente.findUnique({ where: { id }, select: { id: true } })
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const emailEnUso = await prisma.cliente.findFirst({
      where: { email: emailLower, id: { not: id } },
      select: { id: true },
    })
    if (emailEnUso) {
      return NextResponse.json({ error: "Ese email ya está en uso por otro cliente" }, { status: 409 })
    }

    await prisma.cliente.update({
      where: { id },
      data: {
        nombre,
        email: emailLower,
        empresa: empresa || null,
        telefono: telefono || null,
        notas: notas || null,
        ...(typeof body.activo === "boolean" ? { activo: body.activo } : {}),
      },
    })

    logger.info("Cliente actualizado", { clienteId: id, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error actualizando cliente", { error: String(error), clienteId: id })
    return NextResponse.json({ error: "Error al actualizar el cliente" }, { status: 500 })
  }
}