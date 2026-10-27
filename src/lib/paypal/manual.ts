/**
 * Registro manual de un pago PayPal (T-15, AC-17/AC-19/AC-24/AC-25).
 *
 * - Solo lo invoca el endpoint `/api/admin/paypal/manual`, que exige admin.
 * - Valida el desglose completo en centavos USD: `montoAcordado + comision =
 *   total`, con enteros dentro del rango Int32 de Prisma.
 * - Exige al menos una referencia PayPal unica (`externalId` = capture id y/o
 *   `paypalOrderId`) y una evidencia textual/URL. No persiste email ni nombre
 *   del pagador: solo ids de PayPal, montos, moneda y evidencia.
 * - Si se informa `paypalOrderId` y PayPal esta configurado, consulta la orden
 *   para resolver/verificar el capture id. Si la orden no coincide con el monto,
 *   la moneda, el capture informado o no tiene una captura completada, falla
 *   con un error claro y no escribe nada.
 * - Idempotencia por `externalId`/`paypalOrderId`: si ya existe un `Pago` con
 *   cualquiera de las referencias se devuelve DUPLICADO (409) sin crear otro.
 *   Al guardar tambien `paypalOrderId`, un webhook posterior que busque por
 *   capture id u order id encuentra este pago y no lo duplica.
 * - El pago se crea con `pasarela=PAYPAL`, `origen=MANUAL`, `metodo=PAYPAL`,
 *   `monto` = total, `montoEsperado` = total, `moneda=usd`, recibo interno y
 *   `registradoPor`. La transaccion aplica el concepto una sola vez segun los
 *   flags `marcarHitoPagado`/`acreditarMeses` (default true): hito PAGADO o
 *   soporte ACTIVE con el vencimiento extendido por los meses indicados.
 * - No toca Mercado Pago, no sube archivos (la evidencia es texto/URL) y no
 *   escribe datos del pagador en logs ni en la base.
 */

import type { EstadoHito, PlanTipo, Prisma } from "@prisma/client"
import { logger } from "@/lib/logger"
import { vencimientoConMeses } from "@/lib/mp-utils"
import { prisma } from "@/lib/prisma"
import {
  esPaypalError,
  getOrder,
  primeraCaptura,
  type PaypalOrder,
} from "./client"
import { paypalConfig } from "./config"
import { RECIBO_PAYPAL_ID_MAX, generarReciboId } from "./receipts"
import { PAYPAL_MONEDA, esMonedaUsd } from "./utils"

const PRISMA_INT_MAX = 2_147_483_647
export const EVIDENCIA_PAYPAL_MAX = 2_000
export const REFERENCIA_PAYPAL_MAX = 128
export const ID_CONCEPTO_MAX = 100
export const REGISTRADO_POR_MAX = 120

const PATRON_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PATRON_REFERENCIA = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const PATRON_CONTROL_INVALIDO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export type PaypalManualErrorCodigo =
  | "ARGUMENTOS_INVALIDOS"
  | "EVIDENCIA_INVALIDA"
  | "PII_EN_EVIDENCIA"
  | "CONCEPTO_NO_ENCONTRADO"
  | "CONCEPTO_NO_ELEGIBLE"
  | "DUPLICADO"
  | "LOOKUP_NO_COINCIDE"
  | "PAYPAL_ERROR"
  | "NO_CONFIGURADO"
  | "ERROR_INTERNO"

const HTTP_STATUS_POR_CODIGO: Record<PaypalManualErrorCodigo, number> = {
  ARGUMENTOS_INVALIDOS: 400,
  EVIDENCIA_INVALIDA: 400,
  PII_EN_EVIDENCIA: 400,
  CONCEPTO_NO_ENCONTRADO: 404,
  CONCEPTO_NO_ELEGIBLE: 409,
  DUPLICADO: 409,
  LOOKUP_NO_COINCIDE: 409,
  PAYPAL_ERROR: 502,
  NO_CONFIGURADO: 503,
  ERROR_INTERNO: 500,
}

/** Error tipado del registro manual; `message` es seguro de loguear. */
export class PaypalManualError extends Error {
  readonly codigo: PaypalManualErrorCodigo
  readonly httpStatus: number
  readonly pagoId: string | null
  readonly duplicado: boolean

  constructor(params: {
    codigo: PaypalManualErrorCodigo
    mensaje: string
    pagoId?: string | null
    duplicado?: boolean
  }) {
    super(params.mensaje)
    this.name = "PaypalManualError"
    this.codigo = params.codigo
    this.httpStatus = HTTP_STATUS_POR_CODIGO[params.codigo]
    this.pagoId = params.pagoId ?? null
    this.duplicado = params.duplicado === true
  }
}

export function esPaypalManualError(
  error: unknown
): error is PaypalManualError {
  return error instanceof PaypalManualError
}

export interface RegistrarPagoManualPaypalInput {
  /** Exactamente uno de `hitoId` o `suscripcionId`. */
  hitoId?: string | null
  suscripcionId?: string | null
  montoAcordadoCents: number
  comisionCents: number
  totalCents: number
  /** Capture id de PayPal. */
  externalId?: string | null
  /** Order id de PayPal. */
  paypalOrderId?: string | null
  /** Texto o URL; nunca archivos ni datos del pagador. */
  evidencia: string
  /** Solo soporte: 1..12. */
  meses?: number | null
  /** Default: `true`. */
  marcarHitoPagado?: boolean | null
  /** Default: `true`. */
  acreditarMeses?: boolean | null
  /** USD es la unica moneda aceptada; si se omite, se asume USD. */
  moneda?: string | null
  /** Trazabilidad: nombre del admin que registra el pago. */
  registradoPor?: string | null
}

export interface RegistrarPagoManualPaypalOpciones {
  /** Fecha de referencia para el recibo y la aplicacion del concepto. */
  ahora?: Date
  /** Generador de recibo inyectable en tests. Default: `generarReciboId`. */
  nuevoReciboId?: (ahora: Date) => string
}

export interface ResultadoPagoManualPaypal {
  pagoId: string
  duplicado: false
  reciboId: string
  hitoId: string | null
  suscripcionId: string | null
  monto: number
  montoAcordado: number
  comision: number
  montoEsperado: number
  moneda: "usd"
  meses: number | null
  aplicado: boolean
}

type ConceptoManual =
  | {
      tipo: "HITO"
      hitoId: string
      clienteId: string
      estado: EstadoHito
    }
  | {
      tipo: "SOPORTE"
      suscripcionId: string
      clienteId: string
      plan: PlanTipo
      proximoPago: Date | null
    }

interface DatosManualValidados {
  hitoId: string | null
  suscripcionId: string | null
  montoAcordadoCents: number
  comisionCents: number
  totalCents: number
  externalId: string | null
  paypalOrderId: string | null
  evidencia: string
  meses: number | null
  marcarHitoPagado: boolean
  acreditarMeses: boolean
  registradoPor: string
}

function error(
  codigo: PaypalManualErrorCodigo,
  mensaje: string,
  extra: { pagoId?: string | null; duplicado?: boolean } = {}
): PaypalManualError {
  return new PaypalManualError({ codigo, mensaje, ...extra })
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw error("ARGUMENTOS_INVALIDOS", "La fecha de registro no es valida.")
  }
  return new Date(valor.getTime())
}

function enteroEnRango(
  valor: unknown,
  campo: string,
  minimo: number,
  maximo: number
): number {
  if (
    typeof valor !== "number" ||
    !Number.isSafeInteger(valor) ||
    valor < minimo ||
    valor > maximo
  ) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      `El campo ${campo} debe ser un entero entre ${minimo} y ${maximo}.`
    )
  }
  return valor
}

function enteroCentavos(
  valor: unknown,
  campo: string,
  minimo: number
): number {
  return enteroEnRango(valor, campo, minimo, PRISMA_INT_MAX)
}

function normalizarId(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", `El campo ${campo} no es valido.`)
  }
  const texto = valor.trim()
  if (texto.length === 0 || texto.length > ID_CONCEPTO_MAX) {
    throw error("ARGUMENTOS_INVALIDOS", `El campo ${campo} no es valido.`)
  }
  return texto
}

function normalizarReferencia(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", `El campo ${campo} no es valido.`)
  }
  const texto = valor.trim()
  if (texto.length === 0) return null
  if (texto.length > REFERENCIA_PAYPAL_MAX || !PATRON_REFERENCIA.test(texto)) {
    throw error("ARGUMENTOS_INVALIDOS", `El campo ${campo} no es valido.`)
  }
  return texto
}

function normalizarEvidencia(valor: unknown): string {
  if (typeof valor !== "string") {
    throw error(
      "EVIDENCIA_INVALIDA",
      "La evidencia debe ser un texto o una URL."
    )
  }
  const texto = valor.trim()
  if (texto.length === 0 || texto.length > EVIDENCIA_PAYPAL_MAX) {
    throw error(
      "EVIDENCIA_INVALIDA",
      `La evidencia es obligatoria y no puede superar ${EVIDENCIA_PAYPAL_MAX} caracteres.`
    )
  }
  if (PATRON_CONTROL_INVALIDO.test(texto)) {
    throw error(
      "EVIDENCIA_INVALIDA",
      "La evidencia contiene caracteres no permitidos."
    )
  }
  if (PATRON_EMAIL.test(texto)) {
    throw error(
      "PII_EN_EVIDENCIA",
      "La evidencia no puede contener datos personales del pagador."
    )
  }
  return texto
}

function validarEntrada(
  input: RegistrarPagoManualPaypalInput | null | undefined
): DatosManualValidados {
  if (!input || typeof input !== "object") {
    throw error("ARGUMENTOS_INVALIDOS", "Datos invalidos.")
  }

  const hitoId = normalizarId(input.hitoId, "hitoId")
  const suscripcionId = normalizarId(input.suscripcionId, "suscripcionId")

  if ((hitoId === null) === (suscripcionId === null)) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "Debe indicarse exactamente uno de hitoId o suscripcionId."
    )
  }

  const montoAcordadoCents = enteroCentavos(
    input.montoAcordadoCents,
    "montoAcordadoCents",
    1
  )
  const comisionCents = enteroCentavos(
    input.comisionCents,
    "comisionCents",
    0
  )
  const totalCents = enteroCentavos(input.totalCents, "totalCents", 1)

  if (montoAcordadoCents + comisionCents !== totalCents) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "El total debe ser igual al monto acordado mas la comision."
    )
  }

  if (
    input.moneda !== null &&
    input.moneda !== undefined &&
    !esMonedaUsd(input.moneda)
  ) {
    throw error("ARGUMENTOS_INVALIDOS", "PayPal solo acepta montos en USD.")
  }

  const externalId = normalizarReferencia(input.externalId, "externalId")
  const paypalOrderId = normalizarReferencia(
    input.paypalOrderId,
    "paypalOrderId"
  )

  if (!externalId && !paypalOrderId) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "Se requiere externalId (capture id) y/o paypalOrderId."
    )
  }

  const evidencia = normalizarEvidencia(input.evidencia)

  let meses: number | null = null
  if (suscripcionId) {
    meses = enteroEnRango(input.meses, "meses", 1, 12)
  } else if (input.meses !== null && input.meses !== undefined) {
    throw error("ARGUMENTOS_INVALIDOS", "meses solo aplica a un soporte mensual.")
  }

  if (
    input.marcarHitoPagado !== null &&
    input.marcarHitoPagado !== undefined &&
    typeof input.marcarHitoPagado !== "boolean"
  ) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "El campo marcarHitoPagado debe ser booleano."
    )
  }

  if (
    input.acreditarMeses !== null &&
    input.acreditarMeses !== undefined &&
    typeof input.acreditarMeses !== "boolean"
  ) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "El campo acreditarMeses debe ser booleano."
    )
  }

  const registradoPor =
    typeof input.registradoPor === "string" && input.registradoPor.trim().length > 0
      ? input.registradoPor.trim().slice(0, REGISTRADO_POR_MAX)
      : "Admin"

  return {
    hitoId,
    suscripcionId,
    montoAcordadoCents,
    comisionCents,
    totalCents,
    externalId,
    paypalOrderId,
    evidencia,
    meses,
    marcarHitoPagado: input.marcarHitoPagado !== false,
    acreditarMeses: input.acreditarMeses !== false,
    registradoPor,
  }
}

function referenciasDePago(
  externalId: string | null,
  paypalOrderId: string | null
): Prisma.PagoWhereInput[] {
  const referencias: Prisma.PagoWhereInput[] = []
  if (externalId) referencias.push({ externalId })
  if (paypalOrderId) referencias.push({ paypalOrderId })
  return referencias
}

function duplicado(pagoId: string): PaypalManualError {
  return error(
    "DUPLICADO",
    "Ya existe un pago PayPal con la misma referencia.",
    { pagoId, duplicado: true }
  )
}

async function buscarDuplicado(
  db: Pick<Prisma.TransactionClient, "pago">,
  referencias: Prisma.PagoWhereInput[]
): Promise<void> {
  const existente = await db.pago.findFirst({
    where: { OR: referencias },
    select: { id: true },
  })
  if (existente) throw duplicado(existente.id)
}

/**
 * Consulta la orden en PayPal y devuelve el capture id que corresponde.
 * Cualquier diferencia (orden, capture, monto o moneda) se rechaza sin escribir.
 */
async function resolverCapturaDeOrden(params: {
  paypalOrderId: string
  externalId: string | null
  totalCents: number
}): Promise<string> {
  let order: PaypalOrder
  try {
    order = await getOrder(params.paypalOrderId)
  } catch (err) {
    if (esPaypalError(err) && err.code === "NO_CONFIGURADO") {
      throw error(
        "NO_CONFIGURADO",
        "PayPal no disponible: se requiere configuracion para verificar la orden."
      )
    }
    throw error(
      "PAYPAL_ERROR",
      "No se pudo consultar la orden en PayPal."
    )
  }

  if (order.id !== params.paypalOrderId) {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "La orden de PayPal no coincide con los datos informados."
    )
  }

  const captura = primeraCaptura(order)
  if (!captura) {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "La orden de PayPal no tiene una captura completada."
    )
  }

  if (params.externalId && captura.id !== params.externalId) {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "El capture id informado no coincide con la orden de PayPal."
    )
  }

  if (captura.status.trim().toUpperCase() !== "COMPLETED") {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "La captura de PayPal no esta completada."
    )
  }

  const montoCapturado = captura.amountCents ?? order.amountCents
  if (montoCapturado !== null && montoCapturado !== params.totalCents) {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "El monto de la captura de PayPal no coincide con el total informado."
    )
  }

  const moneda = (captura.currencyCode ?? order.currencyCode ?? "")
    .trim()
    .toUpperCase()
  if (moneda !== "USD") {
    throw error(
      "LOOKUP_NO_COINCIDE",
      "La captura de PayPal no esta expresada en USD."
    )
  }

  return captura.id
}

async function resolverConcepto(
  tx: Prisma.TransactionClient,
  hitoId: string | null,
  suscripcionId: string | null
): Promise<ConceptoManual> {
  if (hitoId) {
    const hito = await tx.hito.findUnique({
      where: { id: hitoId },
      select: {
        id: true,
        estado: true,
        proyecto: { select: { clienteId: true } },
      },
    })

    if (!hito || !hito.proyecto?.clienteId) {
      throw error("CONCEPTO_NO_ENCONTRADO", "Concepto no encontrado.")
    }

    return {
      tipo: "HITO",
      hitoId: hito.id,
      clienteId: hito.proyecto.clienteId,
      estado: hito.estado,
    }
  }

  const suscripcion = await tx.suscripcion.findUnique({
    where: { id: suscripcionId as string },
    select: {
      id: true,
      clienteId: true,
      plan: true,
      proximoPago: true,
    },
  })

  if (!suscripcion || !suscripcion.clienteId) {
    throw error("CONCEPTO_NO_ENCONTRADO", "Concepto no encontrado.")
  }

  if (suscripcion.plan !== "SOPORTE") {
    throw error(
      "CONCEPTO_NO_ELEGIBLE",
      "El soporte no es de plan SOPORTE."
    )
  }

  return {
    tipo: "SOPORTE",
    suscripcionId: suscripcion.id,
    clienteId: suscripcion.clienteId,
    plan: suscripcion.plan,
    proximoPago: suscripcion.proximoPago,
  }
}

function resolverReciboId(
  opciones: RegistrarPagoManualPaypalOpciones,
  ahora: Date
): string {
  let generado: string
  try {
    generado = opciones.nuevoReciboId
      ? opciones.nuevoReciboId(ahora)
      : generarReciboId(ahora)
  } catch {
    throw error("ERROR_INTERNO", "No se pudo generar el recibo del pago.")
  }

  const reciboId = typeof generado === "string" ? generado.trim() : ""
  if (!reciboId || reciboId.length > RECIBO_PAYPAL_ID_MAX) {
    throw error("ERROR_INTERNO", "No se pudo generar el recibo del pago.")
  }
  return reciboId
}

function esErrorUnico(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  )
}

/**
 * Registra el pago manual en una unica transaccion y aplica el concepto una
 * sola vez. Si el hito ya esta pagado o existe otro pago exitoso para el mismo
 * hito, no se crea nada.
 */
export async function registrarPagoManualPaypal(
  input: RegistrarPagoManualPaypalInput,
  opciones: RegistrarPagoManualPaypalOpciones = {}
): Promise<ResultadoPagoManualPaypal> {
  const ahora = resolverAhora(opciones.ahora)
  const datos = validarEntrada(input)

  // Duplicado rapido por las referencias informadas: evita consultar PayPal o
  // abrir una transaccion cuando el reintento es evidente.
  await buscarDuplicado(
    prisma,
    referenciasDePago(datos.externalId, datos.paypalOrderId)
  )

  let externalId = datos.externalId
  if (datos.paypalOrderId) {
    const config = paypalConfig()
    if (config.disponible) {
      externalId = await resolverCapturaDeOrden({
        paypalOrderId: datos.paypalOrderId,
        externalId,
        totalCents: datos.totalCents,
      })
    }
  }

  const referencias = referenciasDePago(externalId, datos.paypalOrderId)
  const reciboId = resolverReciboId(opciones, ahora)

  try {
    return await prisma.$transaction(async (tx) => {
      await buscarDuplicado(tx, referencias)

      const concepto = await resolverConcepto(
        tx,
        datos.hitoId,
        datos.suscripcionId
      )

      if (concepto.tipo === "HITO") {
        if (concepto.estado === "PAGADO") {
          throw error("CONCEPTO_NO_ELEGIBLE", "El hito ya esta pagado.")
        }

        const pagoGanador = await tx.pago.findFirst({
          where: { hitoId: concepto.hitoId, estadoPago: "SUCCEEDED" },
          select: { id: true },
        })
        if (pagoGanador) {
          throw error(
            "CONCEPTO_NO_ELEGIBLE",
            "El hito ya tiene un pago exitoso registrado."
          )
        }
      }

      const data: Prisma.PagoUncheckedCreateInput = {
        clienteId: concepto.clienteId,
        hitoId: concepto.tipo === "HITO" ? concepto.hitoId : null,
        suscripcionId:
          concepto.tipo === "SOPORTE" ? concepto.suscripcionId : null,
        externalId,
        paypalOrderId: datos.paypalOrderId,
        monto: datos.totalCents,
        montoAcordado: datos.montoAcordadoCents,
        comision: datos.comisionCents,
        montoEsperado: datos.totalCents,
        moneda: PAYPAL_MONEDA,
        metodo: "PAYPAL",
        pasarela: "PAYPAL",
        origen: "MANUAL",
        estadoPago: "SUCCEEDED",
        evidencia: datos.evidencia,
        registradoPor: datos.registradoPor,
        reciboId,
        reciboEmitidoEn: ahora,
        meses: concepto.tipo === "SOPORTE" ? datos.meses : null,
      }

      const pago = await tx.pago.create({
        data,
        select: { id: true },
      })

      let aplicado = false

      if (concepto.tipo === "HITO" && datos.marcarHitoPagado) {
        const actualizado = await tx.hito.updateMany({
          where: { id: concepto.hitoId, estado: "PENDIENTE" },
          data: { estado: "PAGADO", pagadoEn: ahora },
        })

        if (actualizado.count !== 1) {
          throw error(
            "CONCEPTO_NO_ELEGIBLE",
            "El hito ya fue pagado por otra operacion."
          )
        }
        aplicado = true
      }

      if (concepto.tipo === "SOPORTE" && datos.acreditarMeses) {
        const meses = datos.meses as number
        await tx.suscripcion.update({
          where: { id: concepto.suscripcionId },
          data: {
            estado: "ACTIVE",
            proximoPago: vencimientoConMeses(
              concepto.proximoPago,
              meses,
              ahora
            ),
            pastDueEn: null,
            canceladoEn: null,
          },
        })
        aplicado = true
      }

      return {
        pagoId: pago.id,
        duplicado: false as const,
        reciboId,
        hitoId: concepto.tipo === "HITO" ? concepto.hitoId : null,
        suscripcionId:
          concepto.tipo === "SOPORTE" ? concepto.suscripcionId : null,
        monto: datos.totalCents,
        montoAcordado: datos.montoAcordadoCents,
        comision: datos.comisionCents,
        montoEsperado: datos.totalCents,
        moneda: PAYPAL_MONEDA,
        meses: concepto.tipo === "SOPORTE" ? datos.meses : null,
        aplicado,
      }
    })
  } catch (err) {
    if (esPaypalManualError(err)) throw err

    if (esErrorUnico(err)) {
      // Carrera: otra operacion gano entre el chequeo y el insert. Se busca el
      // pago ya persistido por las mismas referencias.
      try {
        const existente = await prisma.pago.findFirst({
          where: { OR: referencias },
          select: { id: true },
        })
        if (existente) throw duplicado(existente.id)
      } catch (busqueda) {
        if (esPaypalManualError(busqueda)) throw busqueda
      }
    }

    logger.error("Error registrando pago PayPal manual", {
      error: err instanceof Error ? err.name : "Error desconocido",
      hitoId: datos.hitoId,
      suscripcionId: datos.suscripcionId,
      externalId,
      paypalOrderId: datos.paypalOrderId,
      monto: datos.totalCents,
      moneda: PAYPAL_MONEDA,
    })

    throw error("ERROR_INTERNO", "Error al registrar el pago manual de PayPal.")
  }
}
