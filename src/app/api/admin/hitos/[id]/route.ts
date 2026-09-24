import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-hitos:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  const { id } = await params

  let body: { titulo?: string; monto?: unknown; vencimiento?: string | null; estado?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  try {
    const hito = await prisma.hito.findUnique({ where: { id }, select: { id: true, estado: true, proyectoId: true } })
    if (!hito) return NextResponse.json({ error: "Hito no encontrado" }, { status: 404 })

    const data: Record<string, unknown> = {}

    if (body.titulo && body.titulo.trim().length >= 1) data.titulo = body.titulo.trim().slice(0, 80)

    if (body.monto !== undefined) {
      const monto = Math.round(Number(body.monto))
      if (!Number.isFinite(monto) || monto <= 0) {
        return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
      }
      data.monto = monto
    }

    if (body.vencimiento !== undefined) {
      if (body.vencimiento === null || body.vencimiento === "") {
        data.vencimiento = null
      } else {
        const fecha = new Date(body.vencimiento)
        if (Number.isNaN(fecha.getTime())) {
          return NextResponse.json({ error: "Fecha invalida" }, { status: 400 })
        }
        data.vencimiento = fecha
      }
    }

    if (body.estado) {
      if (body.estado !== "PENDIENTE" && body.estado !== "PAGADO") {
        return NextResponse.json({ error: "Estado invalido" }, { status: 400 })
      }
      data.estado = body.estado
      data.pagadoEn = body.estado === "PAGADO" ? new Date() : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    await prisma.hito.update({ where: { id }, data })

    if (data.monto !== undefined) {
      const hitos = await prisma.hito.findMany({ where: { proyectoId: hito.proyectoId }, select: { monto: true } })
      await prisma.proyecto.update({
        where: { id: hito.proyectoId },
        data: { montoTotal: hitos.reduce((acc, h) => acc + h.monto, 0) },
      })
    }

    logger.info("Hito actualizado", { hitoId: id, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error actualizando hito", { error: String(error), hitoId: id })
    return NextResponse.json({ error: "Error al actualizar el hito" }, { status: 500 })
  }
}