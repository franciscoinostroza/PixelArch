import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  try {
    const { clienteId, servicioId } = await req.json()

    if (!clienteId || !servicioId) {
      return NextResponse.json({ error: "clienteId y servicioId requeridos" }, { status: 400 })
    }

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } })
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const servicio = await prisma.servicio.findUnique({ where: { id: servicioId, activo: true } })
    if (!servicio) {
      return NextResponse.json({ error: "Servicio no encontrado o inactivo" }, { status: 404 })
    }

    const yaAsignado = await prisma.suscripcion.findFirst({
      where: { clienteId, servicioId, estado: { notIn: ["CANCELED"] } },
    })
    if (yaAsignado) {
      return NextResponse.json({ error: "El cliente ya tiene este servicio activo o pendiente" }, { status: 409 })
    }

    await prisma.suscripcion.create({
      data: {
        clienteId,
        servicioId,
        plan: "UNICO",
        estado: "READY",
      },
    })

    logger.info("Producto asignado manualmente", { clienteId, servicioId, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error asignando producto", { error: String(error) })
    return NextResponse.json({ error: "Error al asignar producto" }, { status: 500 })
  }
}
