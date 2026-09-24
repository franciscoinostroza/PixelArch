export type Moneda = "usd" | "ars"

export const METODOS_PAGO = ["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO", "OTRO"] as const
export type MetodoPagoValue = (typeof METODOS_PAGO)[number]

export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  TRANSFERENCIA: "Transferencia",
  MERCADOPAGO: "Mercado Pago",
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

export function formatearMonto(montoCents: number, moneda: string): string {
  if (moneda === "ars") {
    return `$${Math.round(montoCents / 100).toLocaleString("es-AR")} ARS`
  }
  return `US$${(montoCents / 100).toFixed(2)}`
}

export function precioDePlan(
  plan: string,
  precios: { precioUnico: number; precioBasico: number; precioMantenimiento: number },
  precioCustom?: number | null
): number {
  if (precioCustom && precioCustom > 0) return precioCustom
  if (plan === "BASICO") return precios.precioBasico
  if (plan === "MANTENIMIENTO") return precios.precioMantenimiento
  return precios.precioUnico
}