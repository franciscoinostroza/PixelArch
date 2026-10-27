"use client"

import type { ReactNode } from "react"
import { estadoUI } from "@/lib/estados"
import { formatearMonto } from "@/lib/pagos"
import type { ReciboPaypal as ReciboPaypalDatos } from "@/lib/paypal/receipts"

/**
 * Recibo interno de un pago PayPal (T-13, AC-10).
 *
 * Solo recibe datos del pago y del cliente del CRM. No acepta ni renderiza
 * datos del pagador, de la tarjeta o fiscales: el recibo es interno y no
 * reemplaza a una factura.
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

const FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  // El recibo se renderiza en servidor y se hidrata en el navegador; fijar
  // UTC evita diferencias de fecha entre ambos entornos.
  timeZone: "UTC",
})

function Dato({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "mt-1 break-words font-mono text-sm text-neutral-900"
            : "mt-1 break-words text-sm text-neutral-900"
        }
      >
        {value}
      </dd>
    </div>
  )
}

export function ReciboPaypal({ recibo, cliente, estado }: ReciboPaypalProps) {
  const estadoLabel = estadoUI(estado).label

  return (
    <div className="w-full">
      <div className="mb-4 flex justify-end print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-violet px-5 text-sm font-semibold text-white transition-colors hover:bg-violet/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan print:hidden"
        >
          Imprimir recibo
        </button>
      </div>

      <article
        aria-labelledby="recibo-paypal-titulo"
        className="rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-neutral-900 pb-6">
          <div>
            <p className="text-2xl font-bold tracking-tight">
              Pixel<span className="text-violet-600">Arch</span>
            </p>
            <h1
              id="recibo-paypal-titulo"
              className="mt-1 text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500"
            >
              Recibo interno de pago
            </h1>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              Recibo
            </p>
            <p className="mt-1 font-mono text-sm font-semibold">{recibo.reciboId}</p>
            <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              Estado
            </p>
            <p className="mt-1 inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">
              {estadoLabel}
            </p>
          </div>
        </header>

        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Dato
            label="Cliente"
            value={
              <>
                <span className="font-semibold">{cliente.nombre}</span>
                {cliente.email ? (
                  <span className="mt-0.5 block text-neutral-500">{cliente.email}</span>
                ) : null}
              </>
            }
          />
          <Dato label="Concepto" value={recibo.concepto} />
          <Dato label="Fecha" value={FECHA_LARGA.format(recibo.fecha)} mono />
          <Dato label="Pasarela" value="PayPal" />
          <Dato label="Referencia externa" value={recibo.referenciaExterna} mono />
          <Dato label="Moneda" value="USD" mono />
        </dl>

        <div className="mt-8 overflow-hidden rounded-xl border border-neutral-200 print:rounded-none">
          <table className="w-full border-collapse text-sm" aria-label="Desglose del pago">
            <caption className="sr-only">Desglose del pago en dólares estadounidenses</caption>
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500"
                >
                  Concepto del cobro
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500"
                >
                  Importe
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <th scope="row" className="px-4 py-3 text-left font-normal text-neutral-600">
                  Monto acordado
                </th>
                <td className="px-4 py-3 text-right font-mono">
                  {formatearMonto(recibo.montoAcordado, recibo.moneda)}
                </td>
              </tr>
              <tr className="border-b border-neutral-200">
                <th scope="row" className="px-4 py-3 text-left font-normal text-neutral-600">
                  Comisión de PayPal
                </th>
                <td className="px-4 py-3 text-right font-mono">
                  {formatearMonto(recibo.comision, recibo.moneda)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-neutral-50">
                <th scope="row" className="px-4 py-4 text-left text-sm font-semibold">
                  Total cobrado (USD)
                </th>
                <td className="px-4 py-4 text-right font-mono text-base font-semibold">
                  {formatearMonto(recibo.total, recibo.moneda)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          El total cobrado incluye la comisión de PayPal. Todos los importes están
          expresados en dólares estadounidenses (USD).
        </p>

        <footer className="mt-8 border-t border-neutral-200 pt-5 text-xs leading-relaxed text-neutral-500">
          <p>Recibo interno emitido por PixelArch. No reemplaza a una factura fiscal.</p>
          <p className="mt-1">Documento generado desde pixelarch.dev</p>
        </footer>
      </article>
    </div>
  )
}
