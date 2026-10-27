export type Moneda = "usd" | "ars"

export const METODOS_PAGO = ["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO", "OTRO"] as const
export type MetodoPagoValue = (typeof METODOS_PAGO)[number] | "PAYPAL"

export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  TRANSFERENCIA: "Transferencia",
  MERCADOPAGO: "Mercado Pago",
  PAYPAL: "PayPal",
  EFECTIVO: "Efectivo",
  OTRO: "Otro",
}

export function normalizeMoneda(value: string | undefined | null): Moneda {
  return value === "ars" ? "ars" : "usd"
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  if (d.getDate() < day) {
    d.setDate(0)
  }
  return d
}

export function siguienteVencimiento(actual: Date | null | undefined, ahora: Date = new Date()): Date {
  const base = actual && actual.getTime() > ahora.getTime() ? new Date(actual) : new Date(ahora)
  return addMonths(base, 1)
}

export function convertirArsAUsd(montoArsCents: number, rate: number): number {
  if (!rate || rate <= 0) return 0
  return Math.round(montoArsCents / rate)
}

export function convertirUsdAArs(montoUsdCents: number, rate: number): number {
  if (!rate || rate <= 0) return 0
  return Math.round(montoUsdCents * rate)
}

export function equivalenteUsd(
  monto: number,
  moneda: string,
  cotizacion: number | null | undefined,
  rateActual: number | null
): number | null {
  if (moneda === "usd") return monto
  const usedRate = cotizacion && cotizacion > 0 ? cotizacion : rateActual
  if (!usedRate) return null
  return convertirArsAUsd(monto, usedRate)
}

export type LocaleMonto = "es-AR" | "en-US"

/**
 * Formatea un monto en centavos.
 *
 * El default es es-AR (`US$100,50`, `US$1.000,50`) para UI/CRM/recibos.
 * La unica excepcion documentada son las plantillas EN (T-05), que piden
 * `en-US` explicitamente (`US$100.50`). ARS mantiene su formato.
 */
export function formatearMonto(
  montoCents: number,
  moneda: string,
  locale: LocaleMonto = "es-AR"
): string {
  if (moneda === "ars") {
    const entero = Math.round(montoCents / 100)
    return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(entero)} ARS`
  }

  const decimales = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(montoCents / 100)
  return `US$${decimales}`
}

export function precioDePlan(
  plan: string,
  precios: { precioUnico: number; precioBasico: number; precioMantenimiento: number },
  precioCustom?: number | null
): number {
  if (precioCustom && precioCustom > 0) return precioCustom
  if (plan === "SOPORTE") return precios.precioMantenimiento
  if (plan === "BASICO") return precios.precioBasico
  if (plan === "MANTENIMIENTO") return precios.precioMantenimiento
  return precios.precioUnico
}