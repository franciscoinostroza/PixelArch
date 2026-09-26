import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-hitos:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { id: proyectoId } = await params

  let body: { titulo?: string; monto?: unknown; vencimiento?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const monto = Math.round(Number(body.monto))
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }

  try {
    const proyecto = await prisma.proyecto.findUnique({ where: { id: proyectoId }, select: { id: true } })
    if (!proyecto) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 })

    const hitos = await prisma.hito.findMany({
      where: { proyectoId },
      select: { orden: true },
      orderBy: { orden: "desc" },
      take: 1,
    })

    const orden = (hitos[0]?.orden ?? 0) + 1

    let vencimiento: Date | null = null
    if (body.vencimiento) {
      const fecha = new Date(body.vencimiento)
      if (Number.isNaN(fecha.getTime())) {
        return NextResponse.json({ error: "Fecha invalida" }, { status: 400 })
      }
      vencimiento = fecha
    }

    const hito = await prisma.hito.create({
      data: {
        proyectoId,
        orden,
        titulo: (body.titulo || `Hito ${orden}`).trim().slice(0, 80),
        monto,
        vencimiento,
      },
      select: { id: true },
    })

    const todos = await prisma.hito.findMany({ where: { proyectoId }, select: { monto: true } })
    await prisma.proyecto.update({
      where: { id: proyectoId },
      data: { montoTotal: todos.reduce((acc, h) => acc + h.monto, 0) },
    })

    logger.info("Hito agregado", { hitoId: hito.id, proyectoId, adminId: admin.id })
    return NextResponse.json({ ok: true, id: hito.id })
  } catch (error) {
    logger.error("Error agregando hito", { error: String(error), proyectoId })
    return NextResponse.json({ error: "Error al agregar el hito" }, { status: 500 })
  }
}