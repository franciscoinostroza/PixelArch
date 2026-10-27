/**
 * Reglas puras de elegibilidad para el ajuste manual de un pago PayPal
 * (T-26). Las usan las paginas server y el modal cliente para no ofrecer un
 * reembolso/contracargo que la API rechazaria.
 *
 * Debe coincidir con `lib/paypal/adjustments.ts`:
 * - solo pagos PayPal;
 * - `SUCCEEDED` o `REVISION` con `revisionEstado = RECHAZADO`;
 * - queda monto disponible despues de los ajustes previos.
 */

export interface PagoAjustableView {
  monto?: number | null
  montoAjustado?: number | null
  estadoPago?: string | null
  revisionEstado?: string | null
  pasarela?: string | null
}

function textoMayusculas(valor: string | null | undefined): string {
  return typeof valor === "string" ? valor.trim().toUpperCase() : ""
}

function montoValido(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor > 0
    ? valor
    : 0
}

/** Monto del pago que aun no fue consumido por ajustes previos. */
export function montoDisponibleAjuste(pago: PagoAjustableView): number {
  const total = montoValido(pago.monto)
  const ajustado = Math.max(0, montoValido(pago.montoAjustado))
  return Math.max(0, total - ajustado)
}

/** `true` si la API aceptaria un ajuste para este pago. */
export function esPagoAjustablePaypal(pago: PagoAjustableView): boolean {
  if (textoMayusculas(pago.pasarela) !== "PAYPAL") return false
  if (montoDisponibleAjuste(pago) <= 0) return false

  const estado = textoMayusculas(pago.estadoPago)
  if (estado === "SUCCEEDED") return true

  return (
    estado === "REVISION" &&
    textoMayusculas(pago.revisionEstado) === "RECHAZADO"
  )
}
