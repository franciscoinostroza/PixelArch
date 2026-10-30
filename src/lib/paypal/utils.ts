/**
 * Dominio puro de links y estados de PayPal.
 *
 * - Montos: siempre centavos USD enteros; nunca ARS ni punto flotante.
 * - Links: token opaco de alta entropia y vigencia de 30 dias.
 * - Estados: mapeo explicito desde los estados de PayPal a `EstadoEnlace` y
 *   `EstadoPago`, segun plan.md §2.5.
 *
 * Sin acceso a red, base de datos ni variables de entorno: todo es testeable.
 */

import { randomBytes } from "node:crypto"
import type { EstadoEnlace, EstadoPago } from "@prisma/client"

import { PaypalValidationError, validarMontoUsdCents } from "./fees-core"

export { PaypalValidationError, validarMontoUsdCents } from "./fees-core"

export const PAYPAL_MONEDA = "usd"
export const PAYPAL_LINK_TTL_DAYS = 30
export const PAYPAL_LINK_TTL_MS = PAYPAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
export const PAYPAL_TOKEN_BYTES = 24

export interface MontoUsd {
  montoCents: number
  moneda: typeof PAYPAL_MONEDA
}

export function esMonedaUsd(moneda: unknown): moneda is typeof PAYPAL_MONEDA {
  return typeof moneda === "string" && moneda.trim().toLowerCase() === PAYPAL_MONEDA
}

export function validarMonedaUsd(moneda: unknown): typeof PAYPAL_MONEDA {
  if (!esMonedaUsd(moneda)) {
    throw new PaypalValidationError("moneda", "PayPal solo acepta montos en USD.")
  }
  return PAYPAL_MONEDA
}

/** Valida monto y moneda juntos; normaliza la moneda a "usd". */
export function validarMontoUsd(monto: unknown, moneda: unknown): MontoUsd {
  return {
    montoCents: validarMontoUsdCents(monto),
    moneda: validarMonedaUsd(moneda),
  }
}

/**
 * Concepto al que pertenece un link publico, con las relaciones minimas para
 * saber si sigue siendo cobrable. Lo comparten la ruta `[token]` y la pagina
 * `/estado` para aplicar exactamente la misma regla.
 */
export interface ConceptoEnlacePaypal {
  hitoId: string | null
  suscripcionId: string | null
  hito: { estado: string } | null
  suscripcion: { estado: string; plan: string } | null
}

export type EstadoConceptoEnlace = "pagado" | "invalidado"

/**
 * Solo un hito pendiente o un soporte SOPORTE en ACTIVE/PAST_DUE admite cobro.
 * Un hito ya PAGADO se informa como `pagado` (no se puede cobrar dos veces) y
 * cualquier otro concepto como `invalidado`.
 */
export function evaluarConceptoEnlace(
  enlace: ConceptoEnlacePaypal
): { pendiente: true } | { pendiente: false; estado: EstadoConceptoEnlace } {
  if (enlace.hitoId) {
    if (!enlace.hito) return { pendiente: false, estado: "invalidado" }
    // Un hito pagado no admite un segundo cobro.
    if (enlace.hito.estado === "PAGADO") {
      return { pendiente: false, estado: "pagado" }
    }
    return { pendiente: true }
  }

  if (enlace.suscripcionId) {
    const soporte = enlace.suscripcion
    const elegible =
      soporte?.plan === "SOPORTE" &&
      (soporte.estado === "ACTIVE" || soporte.estado === "PAST_DUE")

    return elegible ? { pendiente: true } : { pendiente: false, estado: "invalidado" }
  }

  return { pendiente: false, estado: "invalidado" }
}

function esHostLocal(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1"
}

/**
 * Base canonica para `returnUrl`/`cancelUrl` de PayPal.
 *
 * Si `NEXT_PUBLIC_URL` (la env equivalente del proyecto) esta definida, se usa
 * y valida; no se cae al origin de la request, porque detras de un proxy ese
 * origin puede no ser el publico. Solo si no hay env se valida el origin de la
 * request. HTTPS es obligatorio fuera de localhost/loopback.
 */
export function resolverBaseUrlPublica(
  configurada: string | null | undefined,
  requestUrl: string
): string | null {
  const candidato = typeof configurada === "string" ? configurada.trim() : ""

  if (candidato.length > 0) {
    try {
      const url = new URL(candidato)
      if (url.protocol !== "https:" && !(url.protocol === "http:" && esHostLocal(url))) {
        return null
      }
      if (url.username || url.password || url.search || url.hash) return null
      const pathname = url.pathname.replace(/\/+$/, "")
      return `${url.origin}${pathname}`
    } catch {
      return null
    }
  }

  try {
    const url = new URL(requestUrl)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && esHostLocal(url))) {
      return null
    }
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/** Token opaco, sin PII ni ids internos: 24 bytes -> 32 caracteres base64url. */
export function generarTokenEnlace(): string {
  return randomBytes(PAYPAL_TOKEN_BYTES).toString("base64url")
}

/** Vencimiento del link estable de PixelArch: 30 dias desde `now`. */
export function calcularExpiracionEnlace(now: Date = new Date()): Date {
  const base = now.getTime()
  if (!Number.isFinite(base)) {
    throw new PaypalValidationError("now", "La fecha base del link no es valida.")
  }
  return new Date(base + PAYPAL_LINK_TTL_MS)
}

function aMilisegundos(fecha: Date | string | null | undefined): number | null {
  if (fecha === null || fecha === undefined) return null
  const date = fecha instanceof Date ? fecha : new Date(fecha)
  const ms = date.getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Un link vence cuando `expiraEn < ahora` (plan.md §2.5). Una fecha ausente o
 * invalida se considera vencida: el link no debe poder usarse.
 */
export function estaVencido(
  expiraEn: Date | string | null | undefined,
  ahora: Date = new Date()
): boolean {
  const expiraMs = aMilisegundos(expiraEn)
  const ahoraMs = aMilisegundos(ahora)
  if (expiraMs === null || ahoraMs === null) return true
  return expiraMs < ahoraMs
}

/**
 * Estado efectivo del link: `VENCIDO` se resuelve de forma perezosa al leer
 * (no hace falta cron). Solo `ACTIVO` puede pasar a `VENCIDO`; los estados
 * terminales se conservan.
 */
export function resolverEstadoEnlace(
  estado: EstadoEnlace,
  expiraEn: Date | string | null | undefined,
  ahora: Date = new Date()
): EstadoEnlace {
  if (estado === "ACTIVO" && estaVencido(expiraEn, ahora)) return "VENCIDO"
  return estado
}

/** Un link es utilizable solo si esta ACTIVO y no vencio. */
export function esEnlaceVigente(
  estado: EstadoEnlace,
  expiraEn: Date | string | null | undefined,
  ahora: Date = new Date()
): boolean {
  return resolverEstadoEnlace(estado, expiraEn, ahora) === "ACTIVO"
}

export type EstadoPublicoPaypal =
  | "pendiente"
  | "pagado"
  | "revision"
  | "vencido"
  | "invalidado"
  | "error"

export interface EnlaceEstadoPublico extends ConceptoEnlacePaypal {
  estado: EstadoEnlace
  expiraEn: Date | string
}

/**
 * Estado que puede mostrarse al comprador en `/pago/paypal/estado`.
 *
 * La base manda: el query string no participa de este mapeo. Un pago asociado
 * en `REVISION` gana siempre sobre el estado del link (que igual queda PAGADO
 * porque el capture ya se cobro), de modo que nunca se afirma "Pago
 * acreditado" mientras el pago siga pendiente de revision. El resto reutiliza
 * las reglas del link y del concepto, sin duplicarlas.
 */
export function resolverEstadoPublicoEnlace(
  enlace: EnlaceEstadoPublico,
  opciones: { pagoEnRevision?: boolean } = {}
): EstadoPublicoPaypal {
  if (opciones.pagoEnRevision === true) return "revision"

  const estado = resolverEstadoEnlace(enlace.estado, enlace.expiraEn)

  switch (estado) {
    case "PAGADO":
      return "pagado"
    case "VENCIDO":
      return "vencido"
    case "INVALIDADO":
      return "invalidado"
    case "FALLIDO":
      return "error"
    case "ACTIVO":
    case "CREANDO": {
      const concepto = evaluarConceptoEnlace(enlace)
      return concepto.pendiente ? "pendiente" : concepto.estado
    }
  }
}

function normalizarEstado(estado: string | null | undefined): string | null {
  if (typeof estado !== "string") return null
  const normalizado = estado.trim().toUpperCase()
  return normalizado.length > 0 ? normalizado : null
}

/**
 * Estados de una orden/intento PayPal -> transicion del `EnlacePago`.
 *
 * El link tiene su propio ciclo de vida (plan.md §2.5) y **no** se deriva del
 * estado de la orden:
 * - vence solo cuando `expiraEn < ahora` (`resolverEstadoEnlace`);
 * - pasa a `PAGADO` solo al confirmar y procesar el capture;
 * - pasa a `INVALIDADO` por otro pago ganador, regeneracion o baja;
 * - pasa a `FALLIDO` solo si PayPal rechaza la creacion del checkout.
 *
 * Por eso esta funcion solo indica que la orden sigue en curso (`ACTIVO`) y
 * devuelve `null` para todo lo demas. `COMPLETED` de una orden no es un pago
 * confirmado (la confirmacion es el capture) y `EXPIRED`/`VOIDED`/`CANCELED`/
 * `DECLINED` de la orden no vencen, invalidan ni fallan el link: son intentos
 * que se registran en `EventoPasarela` (AC-15). Nunca revierte estados
 * terminales del link.
 */
export function mapearEstadoEnlacePaypal(
  estado: string | null | undefined
): EstadoEnlace | null {
  switch (normalizarEstado(estado)) {
    case "CREATED":
    case "SAVED":
    case "APPROVED":
    case "PAYER_ACTION_REQUIRED":
    case "PENDING":
      return "ACTIVO"
    default:
      return null
  }
}

/**
 * Estado de una **captura** PayPal (`PAYMENT.CAPTURE.*`) -> estado del `Pago`.
 *
 * Solo `COMPLETED` de un capture confirma el pago (`SUCCEEDED`). Los estados
 * intermedios se exponen como `PENDING` solo para vistas; no deben persistirse
 * como pagos confirmados. `REVISION` no viene de PayPal: es una decision del
 * dominio cuando el monto no coincide.
 *
 * No se mapean automaticamente:
 * - reembolsos (`REFUNDED`/`PARTIALLY_REFUNDED`) ni contracargos (`REVERSED`):
 *   son manuales (`AjustePago` + `requiereAccion`, AC-22) y conservan el pago
 *   original;
 * - intentos `DECLINED`/`DENIED`/`FAILED`/`VOIDED`/`CANCELED`/`CANCELLED`/
 *   `EXPIRED`: se registran en `EventoPasarela` y nunca crean un `Pago` en
 *   `FAILED` (AC-15).
 *
 * Devuelve `null` para todo lo que no deba persistirse como pago.
 */
export function mapearEstadoPagoPaypal(estado: string | null | undefined): EstadoPago | null {
  switch (normalizarEstado(estado)) {
    case "COMPLETED":
      return "SUCCEEDED"
    case "CREATED":
    case "SAVED":
    case "APPROVED":
    case "PAYER_ACTION_REQUIRED":
    case "PENDING":
      return "PENDING"
    default:
      return null
  }
}
