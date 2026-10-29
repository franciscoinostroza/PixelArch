"use client"

import { ReciboPago } from "@/components/ui/recibo-pago"
import type { ReciboPaypal as ReciboPaypalDatos } from "@/lib/paypal/receipts"

/**
 * Recibo interno de un pago PayPal (T-13, AC-10; spec 002, T-03).
 *
 * Adaptador sobre `ReciboPago`: conserva la API publica, los textos, las
 * clases y el DOM historico del recibo PayPal. Solo recibe datos del pago y
 * del cliente del CRM; no acepta ni renderiza datos del pagador, de la tarjeta
 * o fiscales (el recibo es interno y no reemplaza a una factura).
 */

export interface ReciboPaypalCliente {
  nombre: string
  email?: string | null
}

export interface ReciboPaypalProps {
  recibo: ReciboPaypalDatos
  cliente: ReciboPaypalCliente
  estado: string
}

export function ReciboPaypal({ recibo, cliente, estado }: ReciboPaypalProps) {
  return (
    <ReciboPago
      idTitulo="recibo-paypal-titulo"
      reciboIdClassName="mt-1 font-mono text-sm font-semibold"
      cliente={cliente}
      estado={estado}
      recibo={{
        reciboId: recibo.reciboId,
        concepto: recibo.concepto,
        fecha: recibo.fecha,
        pasarelaLabel: "PayPal",
        referenciaExterna: recibo.referenciaExterna,
        moneda: recibo.moneda,
        monedaLabel: "USD",
        filas: [
          { etiqueta: "Monto acordado", monto: recibo.montoAcordado },
          { etiqueta: "Comisión de PayPal", monto: recibo.comision },
        ],
        total: recibo.total,
        etiquetaTotal: "Total cobrado (USD)",
        caption: "Desglose del pago en dólares estadounidenses",
        notaImportes:
          "El total cobrado incluye la comisión de PayPal. Todos los importes están expresados en dólares estadounidenses (USD).",
      }}
    />
  )
}
