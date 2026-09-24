import { NextResponse } from "next/server"
import { WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { obtenerPagoMp } from "@/lib/mercadopago"
import { normalizarMeses, mapearEstadoPagoMp, vencimientoConMeses } from "@/lib/mp-utils"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { sendPaymentReceipt } from "@/lib/notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = process.env.MP_WEBHOOK_SECRET

    let body: { type?: string; action?: string; data?: { id?: string } } = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
    }

    const dataId = url.searchParams.get("data.id") || body?.data?.id || ""

    if (secret) {
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.headers.get("x-signature") || "",
          xRequestId: req.headers.get("x-request-id") || "",
          dataId,
          secret,
        })
      } catch (e) {
        if (e instanceof InvalidWebhookSignatureError) {
          logger.warn("Webhook MP con firma invalida", { dataId })
          return NextResponse.json({ error: "Firma invalida" }, { status: 401 })
        }
        throw e
      }
    } else {
      logger.warn("MP_WEBHOOK_SECRET no configurada: webhook sin validacion de firma")
    }

    if (body.type !== "payment" || !dataId) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const pagoMp = await obtenerPagoMp(dataId)
    if (!pagoMp) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const estado = mapearEstadoPagoMp(pagoMp.status)
    if (!estado) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const yaRegistrado = await prisma.pago.findUnique({ where: { externalId: pagoMp.id } })
    if (yaRegistrado) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    if (!pagoMp.externalReference) {
      logger.warn("Webhook MP sin external_reference", { paymentId: pagoMp.id })
      return NextResponse.json({ ok: true, ignored: true })
    }

    const montoArsCents = Math.round((pagoMp.transactionAmount ?? 0) * 100)
    const cotizacion = await getDolarVentaBancoNacion()

    if (pagoMp.tipo === "hito") {
      const hito = await prisma.hito.findUnique({
        where: { id: pagoMp.externalReference },
        include: { proyecto: { include: { cliente: true } } },
      })
      if (!hito) {
        logger.warn("Webhook MP hito no encontrado", { paymentId: pagoMp.id, hitoId: pagoMp.externalReference })
        return NextResponse.json({ ok: true, ignored: true })
      }

      await prisma.pago.create({
        data: {
          clienteId: hito.proyecto.clienteId,
          hitoId: hito.id,
          externalId: pagoMp.id,
          monto: montoArsCents,
          moneda: "ars",
          cotizacion,
          metodo: "MERCADOPAGO",
          nota: `Link MP · ${hito.titulo}`,
          registradoPor: "Mercado Pago",
          estadoPago: estado,
        },
      })

      if (estado === "SUCCEEDED") {
        await prisma.hito.update({
          where: { id: hito.id },
          data: { estado: "PAGADO", pagadoEn: new Date() },
        })
        await sendPaymentReceipt(
          hito.proyecto.cliente.email,
          hito.proyecto.cliente.nombre,
          montoArsCents,
          "ars",
          `${hito.proyecto.titulo} — ${hito.titulo}`
        )
      }

      logger.info("Webhook MP de hito procesado", {
        paymentId: pagoMp.id,
        hitoId: hito.id,
        estado,
        montoArsCents,
      })

      return NextResponse.json({ ok: true })
    }

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: pagoMp.externalReference },
      include: { cliente: true, servicio: true },
    })
    if (!suscripcion) {
      logger.warn("Webhook MP sin suscripcion asociada", { paymentId: pagoMp.id, externalReference: pagoMp.externalReference })
      return NextResponse.json({ ok: true, ignored: true })
    }

    const meses = normalizarMeses(pagoMp.meses)
    const nota = meses > 0 ? `Link MP · ${meses} ${meses === 1 ? "mes" : "meses"}` : "Link MP · solo registro"

    await prisma.pago.create({
      data: {
        clienteId: suscripcion.clienteId,
        suscripcionId: suscripcion.id,
        externalId: pagoMp.id,
        monto: montoArsCents,
        moneda: "ars",
        cotizacion,
        metodo: "MERCADOPAGO",
        nota,
        registradoPor: "Mercado Pago",
        estadoPago: estado,
      },
    })

    if (estado === "SUCCEEDED" && meses > 0) {
      await prisma.suscripcion.update({
        where: { id: suscripcion.id },
        data: {
          estado: "ACTIVE",
          proximoPago: vencimientoConMeses(suscripcion.proximoPago, meses),
          pastDueEn: null,
          canceladoEn: null,
        },
      })
    }

    if (estado === "SUCCEEDED") {
      await sendPaymentReceipt(
        suscripcion.cliente.email,
        suscripcion.cliente.nombre,
        montoArsCents,
        "ars",
        suscripcion.servicio.nombre
      )
    }

    logger.info("Webhook MP procesado", {
      paymentId: pagoMp.id,
      status: pagoMp.status,
      suscripcionId: suscripcion.id,
      meses,
      estado,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error en webhook MP", { error: String(error) })
    return NextResponse.json({ ok: true })
  }
}