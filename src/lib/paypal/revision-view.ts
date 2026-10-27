/**
 * Reglas puras de la revision de un pago PayPal por diferencia de monto
 * (T-27). Modulo **client-safe**: no importa Prisma, Node ni React, para que la
 * tabla de `/admin/pagos` y el modal compartan exactamente las mismas
 * condiciones que valida `lib/paypal/review.ts`.
 *
 * - Solo se ofrece resolver un pago PayPal `REVISION` con
 *   `revisionEstado = PENDIENTE`.
 * - `ACEPTAR` solo es posible en USD, cuando la revision no fue originada por
 *   una captura en otra moneda y cuando hay una referencia externa de PayPal
 *   (`externalId` o `paypalOrderId`) para emitir el recibo.
 * - La diferencia visible es `monto capturado - montoEsperado`, en centavos y
 *   sin floats.
 */

const PATRON_MONEDA_REVISION = /^moneda(?:\s+capturada\b|\s*:)/i

function texto(valor: string | null | undefined): string {
  return typeof valor === "string" ? valor.trim() : ""
}

function textoMayusculas(valor: string | null | undefined): string {
  return texto(valor).toUpperCase()
}

/**
 * `revisionNota` con el formato estructural que T-10/T-11 escriben cuando la
 * captura o el link no estaban en USD. Se detecta por el prefijo estable
 * ("Moneda capturada ..." / "MONEDA: ..."), sin exigir un ISO de tres letras:
 * "Moneda capturada desconocida" tambien cuenta.
 */
export function esRevisionPorMoneda(
  revisionNota: string | null | undefined
): boolean {
  if (typeof revisionNota !== "string") return false
  return PATRON_MONEDA_REVISION.test(revisionNota.trim())
}

export interface PagoRevisableView {
  pasarela?: string | null
  estadoPago?: string | null
  revisionEstado?: string | null
  moneda?: string | null
  revisionNota?: string | null
  externalId?: string | null
  paypalOrderId?: string | null
  monto?: number | null
  montoEsperado?: number | null
}

/** `true` si el pago esta pendiente de resolucion por el admin. */
export function esPagoRevisablePaypal(pago: PagoRevisableView): boolean {
  return (
    textoMayusculas(pago.pasarela) === "PAYPAL" &&
    textoMayusculas(pago.estadoPago) === "REVISION" &&
    textoMayusculas(pago.revisionEstado) === "PENDIENTE"
  )
}

/**
 * Motivo por el que `ACEPTAR` no esta disponible, o `null` si si lo esta.
 * Replica las validaciones de `review.ts` que se conocen sin base de datos.
 */
export type MotivoNoAceptaRevision =
  | "NO_REVISABLE"
  | "MONEDA"
  | "SIN_REFERENCIA"

export function motivoNoAceptaRevision(
  pago: PagoRevisableView
): MotivoNoAceptaRevision | null {
  if (!esPagoRevisablePaypal(pago)) return "NO_REVISABLE"

  if (
    textoMayusculas(pago.moneda) !== "USD" ||
    esRevisionPorMoneda(pago.revisionNota)
  ) {
    return "MONEDA"
  }

  const referencia = texto(pago.externalId) || texto(pago.paypalOrderId)
  return referencia.length > 0 ? null : "SIN_REFERENCIA"
}

export function puedeAceptarRevisionPaypal(pago: PagoRevisableView): boolean {
  return motivoNoAceptaRevision(pago) === null
}

/**
 * Diferencia en centavos (`monto - montoEsperado`). Devuelve `null` si falta
 * alguno de los dos montos o no son enteros no negativos.
 */
export function diferenciaRevisionPaypal(
  pago: Pick<PagoRevisableView, "monto" | "montoEsperado">
): number | null {
  const monto = pago.monto
  const esperado = pago.montoEsperado

  if (
    typeof monto !== "number" ||
    !Number.isSafeInteger(monto) ||
    monto < 0 ||
    typeof esperado !== "number" ||
    !Number.isSafeInteger(esperado) ||
    esperado < 0
  ) {
    return null
  }

  return monto - esperado
}
