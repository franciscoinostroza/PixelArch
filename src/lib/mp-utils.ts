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

/* -------------------------------------------------------------------------- */
/* Recibo interno de Mercado Pago (spec 002, D-1a / D-3)                      */
/* -------------------------------------------------------------------------- */

/**
 * Estados de `Pago` que admiten recibo interno de Mercado Pago (D-3).
 * `FAILED`, `PENDING` y cualquier estado desconocido no llevan recibo.
 */
export const ESTADOS_RECIBO_MERCADOPAGO = [
  "SUCCEEDED",
  "REVISION",
  "REFUNDED",
  "CONTRACARGO",
] as const

export type EstadoReciboMercadoPago =
  (typeof ESTADOS_RECIBO_MERCADOPAGO)[number]

/** `Pago.externalId` (payment id de Mercado Pago) se guarda y muestra completo. */
export const RECIBO_MP_REFERENCIA_MAX = 128
export const RECIBO_MP_CONCEPTO_MAX = 200

/**
 * Error de validacion del recibo de Mercado Pago. Se define en este modulo
 * browser-safe para que la elegibilidad del historial y el dominio server-only
 * compartan el mismo tipo sin arrastrar `node:crypto` al cliente.
 */
export class ReciboMpValidationError extends Error {
  readonly campo: string

  constructor(campo: string, mensaje: string) {
    super(mensaje)
    this.name = "ReciboMpValidationError"
    this.campo = campo
  }
}

/**
 * `true` solo para los estados con recibo. Se normaliza (trim + mayusculas)
 * para tolerar datos historicos escritos en minusculas.
 */
export function esEstadoReciboMercadoPago(
  estado: string | null | undefined
): boolean {
  if (typeof estado !== "string") return false
  const normalizado = estado.trim().toUpperCase()
  return ESTADOS_RECIBO_MERCADOPAGO.some((valor) => valor === normalizado)
}

function centavosReciboMp(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new ReciboMpValidationError(
      campo,
      "El monto del recibo debe ser un entero mayor o igual a 0 centavos."
    )
  }
  return valor
}

export interface MontosReciboMp {
  montoAcordado: number
  comision: number
  total: number
}

/**
 * Valida el desglose de dinero del recibo:
 * - `monto` es el total cobrado (`Pago.monto`) y debe ser un entero >= 0;
 * - si falta `montoAcordado`, se usa el monto cobrado (RF-13);
 * - si falta `comision`, se usa 0;
 * - se exige `montoAcordado + comision === total`; no se recalcula nada.
 *
 * Si falta `montoAcordado` y la comision registrada es mayor que 0, el desglose
 * no reconcilia y se rechaza (AC-25).
 */
export function validarMontosReciboMp(input: {
  monto: number
  montoAcordado?: number | null
  comision?: number | null
}): MontosReciboMp {
  const total = centavosReciboMp(input.monto, "total")

  const montoAcordado =
    input.montoAcordado === null || input.montoAcordado === undefined
      ? total
      : centavosReciboMp(input.montoAcordado, "montoAcordado")

  const comision =
    input.comision === null || input.comision === undefined
      ? 0
      : centavosReciboMp(input.comision, "comision")

  const suma = montoAcordado + comision
  if (!Number.isSafeInteger(suma) || suma !== total) {
    throw new ReciboMpValidationError(
      "total",
      "El total del recibo debe ser igual al monto acordado mas la comision."
    )
  }

  return { montoAcordado, comision, total }
}

/**
 * Moneda del recibo: solo `ars` o `usd` (case-insensitive). Cualquier otra
 * moneda devuelve `null`: no se convierte ni se mezcla (D-7).
 */
export function monedaReciboMp(
  valor: string | null | undefined
): "ars" | "usd" | null {
  if (typeof valor !== "string") return null
  const normalizado = valor.trim().toLowerCase()
  if (normalizado === "ars") return "ars"
  if (normalizado === "usd") return "usd"
  return null
}

function fechaReciboMp(valor: Date | string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null
  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor)
  return Number.isFinite(fecha.getTime()) ? fecha : null
}

/**
 * Fecha del recibo: `reciboEmitidoEn` si existe; si no, `creadoEn` (RF-10,
 * RF-19). Si la fecha elegida no es valida, devuelve `null` en lugar de caer a
 * la otra: la misma fecha alimenta el identificador y el documento.
 */
export function resolverFechaReciboMp(
  fechaEmision: Date | string | null | undefined,
  fechaPago: Date | string | null | undefined
): Date | null {
  if (fechaEmision !== null && fechaEmision !== undefined) {
    return fechaReciboMp(fechaEmision)
  }
  return fechaReciboMp(fechaPago)
}

/**
 * Datos normalizados del recibo interno de Mercado Pago. No incluye PII,
 * identificadores internos (`clienteId`, `hitoId`, etc.) ni datos del pagador.
 */
export interface ReciboMercadoPago {
  reciboId: string
  concepto: string
  montoAcordado: number
  comision: number
  total: number
  moneda: "ars" | "usd"
  fecha: Date
  pasarela: "MERCADOPAGO"
  referenciaExterna: string
}