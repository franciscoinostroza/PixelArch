import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"
import { ReciboMercadoPago } from "@/components/ui/recibo-mercadopago"
import { ReciboPaypal } from "@/components/ui/recibo-paypal"
import { requireStaff } from "@/lib/auth"
import { RECIBO_MP_CONCEPTO_MAX, tituloLink } from "@/lib/mp-utils"
import { evaluarDatosReciboMercadoPago } from "@/lib/mp-recibo"
import { prisma } from "@/lib/prisma"
import {
  construirReciboPaypal,
  type ReciboPaypal as ReciboPaypalDatos,
} from "@/lib/paypal/receipts"
import { pasarelaEfectivaPago } from "@/lib/paypal/view"

/**
 * Recibo interno imprimible de un pago (spec 002, T-05).
 *
 * - Solo staff (admin y asistente), verificado antes de consultar el pago.
 * - Una sola consulta al pago con cliente, hito/proyecto, soporte y enlace.
 * - La pasarela efectiva decide el camino: PayPal (regla historica),
 *   Mercado Pago (identificador derivado, D-1a) o manual (sin recibo).
 * - Solo datos del cliente del CRM y del pago. No consulta la API de Mercado
 *   Pago, no envia emails y no modifica el pago, el hito ni el soporte.
 */

function MarcoRecibo({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 print:hidden">
        <Link href="/admin/pagos" className="a-btn ghost">
          ← Volver a pagos
        </Link>
      </div>
      {children}
    </div>
  )
}

export default async function ReciboPagoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const staff = await requireStaff()
  if (!staff) redirect("/admin")

  const { id } = await params

  const pago = await prisma.pago.findUnique({
    where: { id },
    include: {
      cliente: { select: { nombre: true, email: true } },
      hito: { select: { titulo: true, proyecto: { select: { titulo: true } } } },
      suscripcion: { select: { servicio: { select: { nombre: true } } } },
      enlacePago: { select: { concepto: true } },
    },
  })

  if (!pago || !pago.cliente) notFound()

  const pasarela = pasarelaEfectivaPago(pago)
  // El estado se muestra como texto; normalizarlo evita que un dato historico
  // en minusculas caiga en la etiqueta cruda de `estadoUI`.
  const estado = pago.estadoPago.trim().toUpperCase()
  const cliente = { nombre: pago.cliente.nombre, email: pago.cliente.email }

  if (pasarela === "MERCADOPAGO") {
    const conceptoEnlace = pago.enlacePago?.concepto?.trim()
    const conceptoBase =
      conceptoEnlace ||
      (pago.hito
        ? `${pago.hito.proyecto.titulo} — ${pago.hito.titulo}`
        : pago.suscripcion
          ? tituloLink(pago.suscripcion.servicio.nombre, pago.meses ?? 0)
          : "Pago Mercado Pago")
    // RF-9/Review T-02: un concepto por encima del maximo se recorta para no
    // dejar un enlace "Ver recibo" que termine en `notFound`.
    const concepto = conceptoBase.slice(0, RECIBO_MP_CONCEPTO_MAX)

    const evaluacion = evaluarDatosReciboMercadoPago({
      estadoPago: pago.estadoPago,
      referenciaExterna: pago.externalId,
      monto: pago.monto,
      montoAcordado: pago.montoAcordado,
      comision: pago.comision,
      moneda: pago.moneda,
      concepto,
      fechaEmision: pago.reciboEmitidoEn,
      fechaPago: pago.creadoEn,
    })
    if (!evaluacion.ok) notFound()

    return (
      <MarcoRecibo>
        <ReciboMercadoPago
          recibo={evaluacion.recibo}
          cliente={cliente}
          estado={estado}
        />
      </MarcoRecibo>
    )
  }

  if (pasarela === "PAYPAL") {
    if (!pago.reciboId) notFound()

    const referenciaExterna = pago.externalId ?? pago.paypalOrderId
    if (!referenciaExterna) notFound()

    const concepto =
      pago.enlacePago?.concepto ??
      (pago.hito
        ? `${pago.hito.proyecto.titulo} — ${pago.hito.titulo}`
        : pago.suscripcion
          ? tituloLink(pago.suscripcion.servicio.nombre, pago.meses ?? 0)
          : "Pago PayPal")

    let recibo: ReciboPaypalDatos
    try {
      recibo = construirReciboPaypal({
        reciboId: pago.reciboId,
        concepto,
        montoAcordado: pago.montoAcordado ?? pago.monto,
        comision: pago.comision,
        total: pago.monto,
        moneda: pago.moneda,
        fecha: pago.reciboEmitidoEn ?? pago.creadoEn,
        referenciaExterna,
      })
    } catch {
      // Un pago con datos de recibo inconsistentes no se muestra a medias.
      notFound()
    }

    return (
      <MarcoRecibo>
        <ReciboPaypal recibo={recibo} cliente={cliente} estado={estado} />
      </MarcoRecibo>
    )
  }

  // `MANUAL` (o una pasarela desconocida) no tiene recibo interno.
  notFound()
}
