import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ReciboPaypal } from "@/components/ui/recibo-paypal"
import { requireStaff } from "@/lib/auth"
import { tituloLink } from "@/lib/mp-utils"
import { prisma } from "@/lib/prisma"
import {
  construirReciboPaypal,
  type ReciboPaypal as ReciboPaypalDatos,
} from "@/lib/paypal/receipts"

/**
 * Recibo interno imprimible de un pago PayPal (T-13, AC-10).
 *
 * - Solo staff (admin y asistente); el acceso a `/admin/pagos` ya esta
 *   contemplado para la asistente en T-02.
 * - Exige un pago de PayPal con recibo emitido y referencia externa.
 * - Usa el snapshot del pago y los datos del cliente del CRM. No consulta ni
 *   muestra datos del pagador, de tarjetas o fiscales.
 */
export default async function ReciboPaypalPage({
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

  if (!pago || pago.pasarela !== "PAYPAL" || !pago.reciboId) notFound()

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
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 print:hidden">
        <Link href="/admin/pagos" className="a-btn ghost">
          ← Volver a pagos
        </Link>
      </div>
      <ReciboPaypal
        recibo={recibo}
        cliente={{ nombre: pago.cliente.nombre, email: pago.cliente.email }}
        estado={pago.estadoPago}
      />
    </div>
  )
}
