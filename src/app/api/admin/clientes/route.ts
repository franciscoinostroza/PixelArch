import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { clienteSchema } from "@/lib/validations"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-clientes:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: unknown
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
    const existente = await prisma.cliente.findUnique({ where: { email: emailLower } })
    if (existente) {
      return NextResponse.json({ error: "Ya existe un cliente con ese email" }, { status: 409 })
    }

    const cliente = await prisma.cliente.create({
      data: {
        nombre,
        email: emailLower,
        empresa: empresa || null,
        telefono: telefono || null,
        notas: notas || null,
      },
      select: { id: true },
    })

    logger.info("Cliente creado manualmente", { clienteId: cliente.id, adminId: admin.id })
    return NextResponse.json({ ok: true, id: cliente.id })
  } catch (error) {
    logger.error("Error creando cliente", { error: String(error) })
    return NextResponse.json({ error: "Error al crear el cliente" }, { status: 500 })
  }
}