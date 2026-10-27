/**
 * Gross-up de PayPal en aritmetica entera (plan.md §3.2).
 *
 * La implementacion pura vive en `fees-core.ts` (client-safe, sin imports de
 * Node). Este modulo la reexporta para los consumidores de servidor/tests que
 * ya importaban desde `fees.ts`.
 */

export {
  PAYPAL_DEFAULT_FEE,
  PAYPAL_DEFAULT_FEE_BPS,
  PAYPAL_DEFAULT_FEE_FIXED_CENTS,
  PaypalValidationError,
  calcularGrossUp,
  snapshotTarifa,
  validarMontoUsdCents,
  validarTarifa,
  type GrossUpResult,
  type PaypalFee,
  type PaypalFeeSnapshot,
} from "./fees-core"
