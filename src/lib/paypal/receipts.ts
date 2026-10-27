/**
 * Recibo interno de PayPal (T-10).
 *
 * - `generarReciboId` produce un identificador unico y opaco (fecha UTC +
 *   aleatorio), sin PII ni ids internos. La unicidad final la garantiza
 *   `Pago.reciboId @unique`.
 * - `construirReciboPaypal` arma los datos del recibo a partir del snapshot del
 *   pago: concepto, monto acordado, comision, total, USD, fecha, pasarela y
 *   referencia externa. No incluye datos del pagador, tarjeta ni factura.
 *
 * Sin HTML, PDF ni acceso a base de datos: la pagina imprimible es T-13.
 */

import { randomBytes } from "node:crypto"
import {
  PaypalValidationError,
  validarMontoUsdCents,
  validarMonedaUsd,
} from "./utils"

export const RECIBO_PAYPAL_PREFIJO = "PAY"
export const RECIBO_PAYPAL_ALEATORIO_BYTES = 6
export const RECIBO_PAYPAL_CONCEPTO_MAX = 200
export const RECIBO_PAYPAL_REFERENCIA_MAX = 128
export const RECIBO_PAYPAL_ID_MAX = 80

export interface ReciboPaypal {
  reciboId: string
  concepto: string
  montoAcordado: number
  comision: number
  total: number
  moneda: "usd"
  fecha: Date
  pasarela: "PAYPAL"
  referenciaExterna: string
}

export interface DatosReciboPaypalInput {
  reciboId: string
  concepto: string
  montoAcordado: number
  comision: number
  total: number
  moneda: string
  fecha: Date
  referenciaExterna: string
}

function textoRequerido(valor: string, campo: string, maximo: number): string {
  const texto = typeof valor === "string" ? valor.trim() : ""
  if (texto.length === 0) {
    throw new PaypalValidationError(campo, `El campo ${campo} del recibo es obligatorio.`)
  }
  if (texto.length > maximo) {
    throw new PaypalValidationError(
      campo,
      `El campo ${campo} del recibo no puede superar ${maximo} caracteres.`
    )
  }
  return texto
}

function fechaValida(fecha: Date): Date {
  if (!(fecha instanceof Date) || !Number.isFinite(fecha.getTime())) {
    throw new PaypalValidationError("fecha", "La fecha del recibo no es valida.")
  }
  return new Date(fecha.getTime())
}

function validarComision(valor: number): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new PaypalValidationError(
      "comision",
      "La comision del recibo debe ser un entero mayor o igual a 0 centavos."
    )
  }
  return valor
}

/**
 * Identificador de recibo unico y sin PII: `PAY-YYYYMMDD-<12 hex>`.
 * La fecha se toma en UTC para que el id no dependa de la zona horaria.
 */
export function generarReciboId(fecha: Date = new Date()): string {
  const base = fechaValida(fecha)
  const anio = String(base.getUTCFullYear()).padStart(4, "0")
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0")
  const dia = String(base.getUTCDate()).padStart(2, "0")
  const aleatorio = randomBytes(RECIBO_PAYPAL_ALEATORIO_BYTES)
    .toString("hex")
    .toUpperCase()
  return `${RECIBO_PAYPAL_PREFIJO}-${anio}${mes}${dia}-${aleatorio}`
}

/**
 * Arma el snapshot del recibo. Valida el invariante de dinero
 * `montoAcordado + comision = total` y que todo sea USD entero.
 *
 * Solo acepta los campos listados: cualquier dato extra del caller (por
 * ejemplo, email o nombre del pagador) se descarta y nunca llega al recibo.
 */
export function construirReciboPaypal(input: DatosReciboPaypalInput): ReciboPaypal {
  const reciboId = textoRequerido(input.reciboId, "reciboId", RECIBO_PAYPAL_ID_MAX)
  const concepto = textoRequerido(input.concepto, "concepto", RECIBO_PAYPAL_CONCEPTO_MAX)
  const referenciaExterna = textoRequerido(
    input.referenciaExterna,
    "referenciaExterna",
    RECIBO_PAYPAL_REFERENCIA_MAX
  )

  const montoAcordado = validarMontoUsdCents(input.montoAcordado)
  const comision = validarComision(input.comision)
  const total = validarMontoUsdCents(input.total)

  if (montoAcordado + comision !== total) {
    throw new PaypalValidationError(
      "total",
      "El total del recibo debe ser igual al monto acordado mas la comision."
    )
  }

  return {
    reciboId,
    concepto,
    montoAcordado,
    comision,
    total,
    moneda: validarMonedaUsd(input.moneda),
    fecha: fechaValida(input.fecha),
    pasarela: "PAYPAL",
    referenciaExterna,
  }
}
