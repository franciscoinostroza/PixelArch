/**
 * Aritmetica pura de tarifas y gross-up de PayPal (T-20).
 *
 * Modulo **client-safe**: no importa `node:crypto`, Prisma, variables de
 * entorno ni ningun otro modulo del servidor. El modal de UI importa desde
 * aqui para previsualizar comision/total sin arrastrar dependencias de Node al
 * bundle del navegador.
 *
 *   totalCents    = ceil((montoAcordadoCents + feeFixedCents) * 10000 / (10000 - feeBps))
 *   comisionCents = totalCents - montoAcordadoCents
 */

export interface PaypalFee {
  /** Porcentaje de comision en puntos basicos (540 = 5,40%). */
  bps: number
  /** Comision fija en centavos USD (30 = US$0,30). */
  fixedCents: number
}

export const PAYPAL_DEFAULT_FEE_BPS = 540
export const PAYPAL_DEFAULT_FEE_FIXED_CENTS = 30

export const PAYPAL_DEFAULT_FEE: PaypalFee = {
  bps: PAYPAL_DEFAULT_FEE_BPS,
  fixedCents: PAYPAL_DEFAULT_FEE_FIXED_CENTS,
}

const BPS_DENOMINADOR = 10_000
const MAX_BASE_SEGURA = Math.floor(Number.MAX_SAFE_INTEGER / BPS_DENOMINADOR)

export class PaypalValidationError extends Error {
  readonly campo: string

  constructor(campo: string, mensaje: string) {
    super(mensaje)
    this.name = "PaypalValidationError"
    this.campo = campo
  }
}

/** Valida un monto en centavos: entero positivo y seguro. */
export function validarMontoUsdCents(monto: unknown): number {
  if (typeof monto !== "number" || !Number.isSafeInteger(monto) || monto <= 0) {
    throw new PaypalValidationError(
      "montoCents",
      "El monto debe ser un entero positivo en centavos."
    )
  }
  return monto
}

export interface PaypalFeeSnapshot {
  feeBps: number
  feeFixedCents: number
}

export interface GrossUpResult extends PaypalFeeSnapshot {
  montoAcordadoCents: number
  comisionCents: number
  totalCents: number
}

/** Valida una tarifa: bps 0..9999 y fijo >= 0, ambos enteros seguros. */
export function validarTarifa(fee: PaypalFee): PaypalFee {
  if (!fee || typeof fee !== "object") {
    throw new PaypalValidationError("fee", "La tarifa de PayPal es obligatoria.")
  }

  const { bps, fixedCents } = fee
  if (
    typeof bps !== "number" ||
    !Number.isSafeInteger(bps) ||
    bps < 0 ||
    bps >= BPS_DENOMINADOR
  ) {
    throw new PaypalValidationError(
      "feeBps",
      "La comision porcentual debe ser un entero entre 0 y 9999 puntos basicos."
    )
  }

  if (
    typeof fixedCents !== "number" ||
    !Number.isSafeInteger(fixedCents) ||
    fixedCents < 0
  ) {
    throw new PaypalValidationError(
      "feeFixedCents",
      "La comision fija debe ser un entero mayor o igual a 0 centavos."
    )
  }

  return { bps, fixedCents }
}

/** Campos de snapshot que se guardan en `EnlacePago` y `Pago`. */
export function snapshotTarifa(fee: PaypalFee): PaypalFeeSnapshot {
  const validada = validarTarifa(fee)
  return { feeBps: validada.bps, feeFixedCents: validada.fixedCents }
}

/**
 * Calcula el total a cobrar (monto acordado + comision) con la tarifa indicada.
 * Por defecto usa la tarifa default del modulo (540 bps + 30c); el caller puede
 * pasar `paypalConfig().fee` para respetar un override por entorno.
 */
export function calcularGrossUp(
  montoAcordadoCents: number,
  fee: PaypalFee = PAYPAL_DEFAULT_FEE
): GrossUpResult {
  const monto = validarMontoUsdCents(montoAcordadoCents)
  const tarifa = validarTarifa(fee)

  const base = monto + tarifa.fixedCents
  if (!Number.isSafeInteger(base) || base > MAX_BASE_SEGURA) {
    throw new PaypalValidationError(
      "montoCents",
      "El monto excede el rango seguro para calcular la comision."
    )
  }

  const numerador = base * BPS_DENOMINADOR
  if (!Number.isSafeInteger(numerador)) {
    throw new PaypalValidationError(
      "montoCents",
      "El monto excede el rango seguro para calcular la comision."
    )
  }

  const totalCents = Math.ceil(numerador / (BPS_DENOMINADOR - tarifa.bps))
  const comisionCents = totalCents - monto

  return {
    montoAcordadoCents: monto,
    comisionCents,
    totalCents,
    feeBps: tarifa.bps,
    feeFixedCents: tarifa.fixedCents,
  }
}
