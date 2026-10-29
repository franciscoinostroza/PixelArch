"use client"

import { ReciboPago, type ReciboPagoFila } from "@/components/ui/recibo-pago"
import type { ReciboMercadoPago as ReciboMercadoPagoDatos } from "@/lib/mp-utils"

/**
 * Recibo interno de un pago de Mercado Pago (spec 002, T-04).
 *
 * Adaptador sobre `ReciboPago`: solo recibe datos del pago y del cliente del
 * CRM y no acepta ni renderiza datos del pagador, de la tarjeta o fiscales.
 * El tipo `ReciboMercadoPago` se importa como `import type` desde el modulo
 * browser-safe `mp-utils.ts`; este componente nunca importa `mp-recibo.ts`
 * (server-only, `node:crypto`).
 */

export interface ReciboMercadoPagoCliente {
  nombre: string
  email?: string | null
}

export interface ReciboMercadoPagoProps {
  recibo: ReciboMercadoPagoDatos
  cliente: ReciboMercadoPagoCliente
  estado: string
}

export function ReciboMercadoPago({ recibo, cliente, estado }: ReciboMercadoPagoProps) {
  const esArs = recibo.moneda === "ars"
  const monedaLabel = esArs ? "ARS" : "USD"
  const monedaTexto = esArs ? "pesos argentinos" : "dólares estadounidenses"
  const conComision = recibo.comision > 0

  // RF-13: la comision registrada es 0 en el flujo actual de Mercado Pago; la
  // fila solo aparece si hay una comision real, sin inventar un desglose.
  const filas: ReciboPagoFila[] = [
    { etiqueta: "Monto acordado", monto: recibo.montoAcordado },
  ]
  if (conComision) {
    filas.push({ etiqueta: "Comisión de Mercado Pago", monto: recibo.comision })
  }

  const notaImportes = conComision
    ? `El total cobrado incluye la comisión de Mercado Pago. Todos los importes están expresados en ${monedaTexto} (${monedaLabel}).`
    : `El total cobrado coincide con el monto acordado. Todos los importes están expresados en ${monedaTexto} (${monedaLabel}).`

  return (
    <ReciboPago
      idTitulo="recibo-mercadopago-titulo"
      cliente={cliente}
      estado={estado}
      recibo={{
        reciboId: recibo.reciboId,
        concepto: recibo.concepto,
        fecha: recibo.fecha,
        pasarelaLabel: "Mercado Pago",
        referenciaExterna: recibo.referenciaExterna,
        moneda: recibo.moneda,
        monedaLabel,
        filas,
        total: recibo.total,
        etiquetaTotal: `Total cobrado (${monedaLabel})`,
        caption: esArs
          ? "Desglose del pago en pesos argentinos"
          : "Desglose del pago en dólares estadounidenses",
        notaImportes,
      }}
    />
  )
}
