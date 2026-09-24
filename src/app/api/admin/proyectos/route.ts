import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

interface HitoInput {
  titulo?: string
  monto?: unknown
  vencimiento?: string | null
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-proyectos:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: { clienteId?: string; servicioId?: string | null; titulo?: string; notas?: string; hitos?: HitoInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const { clienteId, servicioId, titulo, notas, hitos } = body

  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })
  if (!titulo || titulo.trim().length < 2) return NextResponse.json({ error: "Título invalido" }, { status: 400 })
  if (!Array.isArray(hitos) || hitos.length < 1 || hitos.length > 12) {
    return NextResponse.json({ error: "Se necesitan entre 1 y 12 hitos" }, { status: 400 })
  }

  const hitosLimpios = hitos.map((h, i) => {
    const monto = Math.round(Number(h.monto))
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error(`Monto invalido en el hito ${i + 1}`)
    }
    return {
      orden: i + 1,
      titulo: (h.titulo || `Hito ${i + 1}`).trim().slice(0, 80),
      monto,
      vencimiento: h.vencimiento ? new Date(h.vencimiento) : null,
    }
  })

  const montoTotal = hitosLimpios.reduce((acc, h) => acc + h.monto, 0)

  try {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } })
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    if (servicioId) {
      const servicio = await prisma.servicio.findUnique({ where: { id: servicioId }, select: { id: true } })
      if (!servicio) return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
    }

    const proyecto = await prisma.proyecto.create({
      data: {
        clienteId,
        servicioId: servicioId || null,
        titulo: titulo.trim().slice(0, 120),
        montoTotal,
        notas: notas?.trim() || null,
        hitos: { create: hitosLimpios },
      },
      select: { id: true },
    })

    logger.info("Proyecto creado", { proyectoId: proyecto.id, clienteId, hitos: hitosLimpios.length, adminId: admin.id })
    return NextResponse.json({ ok: true, id: proyecto.id })
  } catch (error) {
    const msg = String(error)
    logger.error("Error creando proyecto", { error: msg, clienteId })
    if (msg.includes("Monto invalido")) {
      return NextResponse.json({ error: msg.split(":").slice(-1)[0].trim() }, { status: 400 })
    }
    return NextResponse.json({ error: "Error al crear el proyecto" }, { status: 500 })
  }
}