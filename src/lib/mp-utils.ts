import { addMonths } from "@/lib/pagos"

/**
 * Motivo persistido en `EnlacePago.motivoInvalido` cuando otro pago gano el
 * cobro (plan §4.5 / AC-13). Lo comparten la invalidacion desde PayPal y desde
 * Mercado Pago para que ambos caminos dejen la misma trazabilidad.
 */
export const MOTIVO_INVALIDACION_OTRO_PAGO = "OTRO_PAGO_GANO"

/** Identificador estable del cobro de un hito (sobrevive regeneraciones). */
export function grupoCobroDeHito(hitoId: string): string {
  return `hito:${hitoId}`
}

/** Identificador estable del cobro de un soporte (sobrevive regeneraciones). */
export function grupoCobroDeSuscripcion(suscripcionId: string): string {
  return `soporte:${suscripcionId}`
}

export function normalizarMeses(input: unknown): number {
  const n = Math.round(Number(input))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(12, n)
}

export function mapearEstadoPagoMp(status: string | undefined | null): "SUCCEEDED" | "FAILED" | null {
  switch (status) {
    case "approved":
      return "SUCCEEDED"
    case "rejected":
    case "cancelled":
      return "FAILED"
    default:
      return null
  }
}

export function vencimientoConMeses(
  actual: Date | null | undefined,
  meses: number,
  ahora: Date = new Date()
): Date | null {
  if (meses <= 0) return actual ?? null
  const base = actual && actual.getTime() > ahora.getTime() ? new Date(actual) : new Date(ahora)
  return addMonths(base, meses)
}

export function tituloLink(servicio: string, meses: number): string {
  if (meses <= 0) return `${servicio} — pago`
  return `${servicio} — ${meses} ${meses === 1 ? "mes" : "meses"}`
}