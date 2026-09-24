import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { siguienteVencimiento, normalizeMoneda, METODOS_PAGO, type MetodoPagoValue } from "@/lib/pagos"
import { sendPaymentReceipt } from "@/lib/notifications"

interface PagoBody {
  suscripcionId?: string
  hitoId?: string
  monto?: number
  moneda?: string
  metodo?: string
  nota?: string
  enviarRecibo?: boolean
  avanzarVencimiento?: boolean
  marcarHitoPagado?: boolean
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-pagos:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: PagoBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const { suscripcionId, hitoId, monto, metodo, nota, enviarRecibo } = body
  const moneda = normalizeMoneda(body.moneda)

  if (!suscripcionId && !hitoId) {
    return NextResponse.json({ error: "suscripcionId o hitoId requerido" }, { status: 400 })
  }
  if (!monto || !Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }

  const metodoValido = metodo && (METODOS_PAGO as readonly string[]).includes(metodo)
    ? (metodo as MetodoPagoValue)
    : null

  try {
    let clienteId: string
    let clienteEmail: string
    let clienteNombre: string
    let descripcionRecibo: string

    if (hitoId) {
      const hito = await prisma.hito.findUnique({
        where: { id: hitoId },
        include: { proyecto: { include: { cliente: true, servicio: { select: { nombre: true } } } } },
      })
      if (!hito) {
        return NextResponse.json({ error: "Hito no encontrado" }, { status: 404 })
      }
      clienteId = hito.proyecto.clienteId
      clienteEmail = hito.proyecto.cliente.email
      clienteNombre = hito.proyecto.cliente.nombre
      descripcionRecibo = `${hito.proyecto.titulo} — ${hito.titulo}`
    } else {
      const suscripcion = await prisma.suscripcion.findUnique({
        where: { id: suscripcionId },
        include: { cliente: true, servicio: true },
      })
      if (!suscripcion) {
        return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
      }
      clienteId = suscripcion.clienteId
      clienteEmail = suscripcion.cliente.email
      clienteNombre = suscripcion.cliente.nombre
      descripcionRecibo = suscripcion.servicio.nombre
    }

    let cotizacion: number | null = null
    if (moneda === "ars") {
      cotizacion = await getDolarVentaBancoNacion()
    }

    const pago = await prisma.pago.create({
      data: {
        clienteId,
        suscripcionId: suscripcionId || null,
        hitoId: hitoId || null,
        monto: Math.round(monto),
        moneda,
        cotizacion,
        metodo: metodoValido ?? undefined,
        nota: nota?.trim() || null,
        registradoPor: admin.nombre || "Admin",
        estadoPago: "SUCCEEDED",
      },
      select: { id: true },
    })

    if (hitoId) {
      if (body.marcarHitoPagado !== false) {
        await prisma.hito.update({
          where: { id: hitoId },
          data: { estado: "PAGADO", pagadoEn: new Date() },
        })
      }
    } else if (suscripcionId && body.avanzarVencimiento !== false) {
      const suscripcion = await prisma.suscripcion.findUnique({
        where: { id: suscripcionId },
        select: { proximoPago: true },
      })
      await prisma.suscripcion.update({
        where: { id: suscripcionId },
        data: {
          estado: "ACTIVE",
          proximoPago: siguienteVencimiento(suscripcion?.proximoPago ?? null),
          canceladoEn: null,
          pastDueEn: null,
        },
      })
    }

    if (enviarRecibo !== false) {
      await sendPaymentReceipt(
        clienteEmail,
        clienteNombre,
        Math.round(monto),
        moneda,
        descripcionRecibo
      )
    }

    logger.info("Pago registrado manualmente", {
      pagoId: pago.id,
      suscripcionId: suscripcionId || null,
      hitoId: hitoId || null,
      monto: Math.round(monto),
      moneda,
      adminId: admin.id,
    })

    return NextResponse.json({ ok: true, pagoId: pago.id })
  } catch (error) {
    logger.error("Error registrando pago", { error: String(error), suscripcionId, hitoId })
    return NextResponse.json({ error: "Error al registrar el pago" }, { status: 500 })
  }
}