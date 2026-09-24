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
  monto?: number
  moneda?: string
  metodo?: string
  nota?: string
  enviarRecibo?: boolean
  avanzarVencimiento?: boolean
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

  const { suscripcionId, monto, metodo, nota, enviarRecibo, avanzarVencimiento } = body
  const moneda = normalizeMoneda(body.moneda)

  if (!suscripcionId) {
    return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
  }
  if (!monto || !Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }

  const metodoValido = metodo && (METODOS_PAGO as readonly string[]).includes(metodo)
    ? (metodo as MetodoPagoValue)
    : null

  try {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      include: { cliente: true, servicio: true },
    })
    if (!suscripcion) {
      return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
    }

    let cotizacion: number | null = null
    if (moneda === "ars") {
      cotizacion = await getDolarVentaBancoNacion()
    }

    const pago = await prisma.pago.create({
      data: {
        clienteId: suscripcion.clienteId,
        suscripcionId: suscripcion.id,
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

    if (avanzarVencimiento !== false) {
      await prisma.suscripcion.update({
        where: { id: suscripcion.id },
        data: {
          estado: "ACTIVE",
          proximoPago: siguienteVencimiento(suscripcion.proximoPago),
          canceladoEn: null,
          pastDueEn: null,
        },
      })
    }

    if (enviarRecibo !== false) {
      await sendPaymentReceipt(
        suscripcion.cliente.email,
        suscripcion.cliente.nombre,
        Math.round(monto),
        moneda,
        suscripcion.servicio.nombre
      )
    }

    logger.info("Pago registrado manualmente", {
      pagoId: pago.id,
      suscripcionId: suscripcion.id,
      monto: Math.round(monto),
      moneda,
      adminId: admin.id,
    })

    return NextResponse.json({ ok: true, pagoId: pago.id })
  } catch (error) {
    logger.error("Error registrando pago", { error: String(error), suscripcionId })
    return NextResponse.json({ error: "Error al registrar el pago" }, { status: 500 })
  }
}
