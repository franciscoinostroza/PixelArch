/**
 * Dominio **server-only** del recibo interno de Mercado Pago (spec 002, T-01).
 *
 * - `generarReciboIdMp` deriva un identificador determinista de la referencia
 *   externa (payment id de Mercado Pago) y de la fecha del recibo (D-1a). No se
 *   persiste ni modifica `Pago.reciboId`/`reciboEmitidoEn`.
 * - `construirReciboMercadoPago` arma el snapshot visible: concepto, desglose
 *   de montos, moneda, fecha, pasarela y referencia externa. Sin PII ni datos
 *   del pagador.
 * - `evaluarDatosReciboMercadoPago` decide si un pago admite recibo y devuelve
 *   el motivo cuando no.
 *
 * Importa `node:crypto`, por eso **no debe importarse en runtime desde un
 * componente cliente**. Los helpers browser-safe (estados, montos, moneda,
 * fecha y el tipo `ReciboMercadoPago`) viven en `mp-utils.ts`. Sin Prisma, sin
 * React y sin red.
 */

import { createHash } from "node:crypto"
import {
  RECIBO_MP_CONCEPTO_MAX,
  RECIBO_MP_REFERENCIA_MAX,
  ReciboMpValidationError,
  esEstadoReciboMercadoPago,
  monedaReciboMp,
  resolverFechaReciboMp,
  validarMontosReciboMp,
  type ReciboMercadoPago,
} from "@/lib/mp-utils"

/** Prefijo propio de Mercado Pago: no colisiona con el `PAY-` de PayPal. */
export const RECIBO_MP_PREFIJO = "MP"
/** 32 hex = 128 bits del SHA-256 de la referencia: colision despreciable. */
export const RECIBO_MP_HASH_HEX = 32
export const RECIBO_MP_ID_MAX = 80
/** Concepto por defecto cuando el pago no tiene un concepto vinculado (RF-9). */
export const RECIBO_MP_CONCEPTO_DEFAULT = "Pago Mercado Pago"

function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

function textoRequerido(
  valor: string,
  campo: string,
  maximo: number
): string {
  const texto = textoOpcional(valor)
  if (texto === null) {
    throw new ReciboMpValidationError(
      campo,
      `El campo ${campo} del recibo es obligatorio.`
    )
  }
  if (texto.length > maximo) {
    throw new ReciboMpValidationError(
      campo,
      `El campo ${campo} del recibo no puede superar ${maximo} caracteres.`
    )
  }
  return texto
}

function fechaValida(fecha: Date): Date {
  if (!(fecha instanceof Date) || !Number.isFinite(fecha.getTime())) {
    throw new ReciboMpValidationError(
      "fecha",
      "La fecha del recibo no es valida."
    )
  }
  return new Date(fecha.getTime())
}

/**
 * Identificador determinista y sin PII: `MP-AAAAMMDD-<32 hex>`.
 *
 * - fecha en UTC (misma fecha que el campo "Fecha" del recibo);
 * - SHA-256 de la referencia externa recortada (trim) a 128 bits, en
 *   mayusculas;
 * - misma referencia + misma fecha -> mismo id; dos pagos distintos no
 *   comparten id ( `Pago.externalId` es `@unique`).
 */
export function generarReciboIdMp(
  referenciaExterna: string,
  fecha: Date
): string {
  const referencia = textoRequerido(
    referenciaExterna,
    "referenciaExterna",
    RECIBO_MP_REFERENCIA_MAX
  )
  const base = fechaValida(fecha)

  const hash = createHash("sha256")
    .update(referencia, "utf8")
    .digest("hex")
    .slice(0, RECIBO_MP_HASH_HEX)
    .toUpperCase()

  const anio = String(base.getUTCFullYear()).padStart(4, "0")
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0")
  const dia = String(base.getUTCDate()).padStart(2, "0")

  return `${RECIBO_MP_PREFIJO}-${anio}${mes}${dia}-${hash}`
}

export interface DatosReciboMercadoPagoInput {
  referenciaExterna: string
  concepto: string
  /** Total cobrado en centavos (`Pago.monto`). */
  monto: number
  montoAcordado?: number | null
  comision?: number | null
  moneda: string
  fecha: Date
}

/**
 * Arma el snapshot del recibo. Solo acepta los campos listados: cualquier dato
 * extra del caller (nombre/email del pagador, ids internos) se descarta y nunca
 * llega al recibo.
 */
export function construirReciboMercadoPago(
  input: DatosReciboMercadoPagoInput
): ReciboMercadoPago {
  const referenciaExterna = textoRequerido(
    input.referenciaExterna,
    "referenciaExterna",
    RECIBO_MP_REFERENCIA_MAX
  )
  const concepto = textoRequerido(
    input.concepto,
    "concepto",
    RECIBO_MP_CONCEPTO_MAX
  )
  const moneda = monedaReciboMp(input.moneda)
  if (!moneda) {
    throw new ReciboMpValidationError(
      "moneda",
      "La moneda del recibo debe ser ARS o USD."
    )
  }
  const fecha = fechaValida(input.fecha)
  const { montoAcordado, comision, total } = validarMontosReciboMp({
    monto: input.monto,
    montoAcordado: input.montoAcordado,
    comision: input.comision,
  })

  return {
    reciboId: generarReciboIdMp(referenciaExterna, fecha),
    concepto,
    montoAcordado,
    comision,
    total,
    moneda,
    fecha,
    pasarela: "MERCADOPAGO",
    referenciaExterna,
  }
}

/** Motivo por el que un pago de Mercado Pago no admite recibo. */
export type MotivoDatosReciboMp =
  | "ESTADO"
  | "SIN_REFERENCIA"
  | "DATOS_INCONSISTENTES"

export interface EvaluacionDatosReciboMpInput {
  estadoPago: string | null | undefined
  /** `Pago.externalId`: payment id de Mercado Pago. */
  referenciaExterna: string | null | undefined
  /** Total cobrado en centavos; ausente o invalido -> datos inconsistentes. */
  monto: number | null | undefined
  montoAcordado?: number | null
  comision?: number | null
  moneda: string | null | undefined
  concepto?: string | null
  fechaEmision?: Date | string | null
  fechaPago: Date | string | null | undefined
}

export type EvaluacionDatosReciboMp =
  | { ok: true; recibo: ReciboMercadoPago }
  | { ok: false; motivo: MotivoDatosReciboMp }

/**
 * Evalua si los datos del pago alcanzan para emitir el recibo (AC-25).
 *
 * Orden de motivos (mismo que la elegibilidad del historial):
 * 1. sin referencia -> `SIN_REFERENCIA`; referencia demasiado larga ->
 *    `DATOS_INCONSISTENTES`;
 * 2. estado sin recibo (`FAILED`, `PENDING`, `null`, desconocido) -> `ESTADO`;
 * 3. fecha/monto/moneda/desglose/concepto invalidos ->
 *    `DATOS_INCONSISTENTES`.
 */
export function evaluarDatosReciboMercadoPago(
  input: EvaluacionDatosReciboMpInput
): EvaluacionDatosReciboMp {
  const referenciaExterna = textoOpcional(input.referenciaExterna)
  if (referenciaExterna === null) {
    return { ok: false, motivo: "SIN_REFERENCIA" }
  }
  if (referenciaExterna.length > RECIBO_MP_REFERENCIA_MAX) {
    return { ok: false, motivo: "DATOS_INCONSISTENTES" }
  }

  if (!esEstadoReciboMercadoPago(input.estadoPago)) {
    return { ok: false, motivo: "ESTADO" }
  }

  const fecha = resolverFechaReciboMp(input.fechaEmision, input.fechaPago)
  if (!fecha) return { ok: false, motivo: "DATOS_INCONSISTENTES" }
  if (typeof input.monto !== "number") {
    return { ok: false, motivo: "DATOS_INCONSISTENTES" }
  }

  try {
    const recibo = construirReciboMercadoPago({
      referenciaExterna,
      concepto: textoOpcional(input.concepto) ?? RECIBO_MP_CONCEPTO_DEFAULT,
      monto: input.monto,
      montoAcordado: input.montoAcordado,
      comision: input.comision,
      moneda: input.moneda ?? "",
      fecha,
    })
    return { ok: true, recibo }
  } catch (error) {
    if (error instanceof ReciboMpValidationError) {
      return { ok: false, motivo: "DATOS_INCONSISTENTES" }
    }
    throw error
  }
}
