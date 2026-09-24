import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const ESTADOS = ["ACTIVO", "ENTREGADO", "CANCELADO"] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-proyectos:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { id } = await params

  let body: { estado?: string; titulo?: string; notas?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  try {
    const proyecto = await prisma.proyecto.findUnique({ where: { id }, select: { id: true } })
    if (!proyecto) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.titulo && body.titulo.trim().length >= 2) data.titulo = body.titulo.trim().slice(0, 120)
    if (typeof body.notas === "string") data.notas = body.notas.trim() || null
    if (body.estado) {
      if (!(ESTADOS as readonly string[]).includes(body.estado)) {
        return NextResponse.json({ error: "Estado invalido" }, { status: 400 })
      }
      data.estado = body.estado
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    await prisma.proyecto.update({ where: { id }, data })
    logger.info("Proyecto actualizado", { proyectoId: id, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error actualizando proyecto", { error: String(error), proyectoId: id })
    return NextResponse.json({ error: "Error al actualizar el proyecto" }, { status: 500 })
  }
}