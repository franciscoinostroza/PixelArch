/**
 * Resolucion de pagos PayPal en revision (T-17, AC-11/AC-17/AC-27).
 *
 * Contexto: T-10/T-11 registran en `REVISION` un capture ya confirmado cuyo
 * monto o moneda no coincide con el snapshot del `EnlacePago`. El link queda
 * PAGADO y sus hermanos INVALIDADO, pero el hito no se marca ni se acreditan
 * meses, y **no** se emite recibo. Esta capa permite al admin aceptar o
 * rechazar la diferencia.
 *
 * Reglas:
 *
 * - Solo `POST /api/admin/paypal/revision` (requireAdmin estricto: la asistente
 *   recibe 403). El servicio valida el body otra vez por defensa.
 * - Solo opera pagos `pasarela=PAYPAL`, `estadoPago=REVISION` y
 *   `revisionEstado=PENDIENTE`. Un pago inexistente o de otra pasarela es 404;
 *   uno ya resuelto o en otro estado es 409.
 * - `RECHAZAR` deja `estadoPago=REVISION`, pasa `revisionEstado` a `RECHAZADO`
 *   y registra nota/staff/fecha. No aplica el hito, no acredita meses y no
 *   emite recibo. Despues el admin puede registrar un ajuste/reembolso (T-16),
 *   que exige precisamente ese estado.
 * - `ACEPTAR` aplica el pago en una sola transaccion:
 *   - hito: `PENDIENTE -> PAGADO` con `pagadoEn=ahora`;
 *   - soporte: `vencimientoConMeses` sobre 1..12 meses del `Pago`, dejando la
 *     suscripcion `ACTIVE` (misma regla que Mercado Pago);
 *   - `estadoPago=SUCCEEDED`, `revisionEstado=ACEPTADO`,
 *     `revisionResueltaPor/En`, nota y recibo (`reciboId`/`reciboEmitidoEn`).
 * - El recibo solo se emite al aceptar. Para que el recibo reconcile
 *   (`montoAcordado + comision = total`), el pago se ajusta al monto capturado:
 *   `comision` conserva la comision original si es menor al monto y, si no
 *   alcanza, pasa a 0; `montoAcordado = monto - comision`. `montoEsperado`
 *   conserva el total original del link para auditoria y `monto` nunca cambia.
 * - Solo se acepta un pago en USD. Si `Pago.moneda` no es USD o la revision
 *   quedo marcada por una captura en otra moneda (T-10/T-11 escriben
 *   `revisionNota` con el prefijo estable "Moneda capturada ..."), `ACEPTAR`
 *   responde 409 sin escribir: no se puede convertir ni persistir un importe
 *   extranjero como USD. La salida es `RECHAZAR` y registrar el cobro manual
 *   (T-15) o reembolsar. Una `nota` del admin ya no habilita esa aceptacion.
 * - `ACEPTAR` exige ademas una referencia externa (`externalId` o
 *   `paypalOrderId`): sin ella el recibo no puede reconciliar. `RECHAZAR` no
 *   la exige.
 * - `RECHAZAR` limpia `reciboId`/`reciboEmitidoEn` si existieran, deja el pago
 *   sin aplicar y conserva el motivo original junto a la nota.
 * - Cada resolucion persiste un `EventoPasarela` con la accion, el staff
 *   estable (`resueltoPorId`), los montos originales y el resultado. No se
 *   guarda PII del pagador ni la nota en el evento.
 * - La resolucion se reserva con un `updateMany` condicional por
 *   `pasarela/estadoPago/revisionEstado` y `count === 1`. Si otra operacion
 *   gano la carrera, se lanza un conflicto, se revierte la transaccion y nunca
 *   se aplica dos veces el hito/meses ni se emiten dos recibos.
 * - No persiste PII del pagador ni la registra en logs: solo ids, accion,
 *   estado, montos y referencias internas del pago. La `nota` es interna del
 *   admin y nunca se loguea.
 *
 * Sin red y sin llamadas a PayPal: la captura ya ocurrio y solo se resuelve el
 * estado local.
 */

import type {
  EstadoPago,
  EstadoRevision,
  Pasarela,
  Prisma,
} from "@prisma/client"
import * as Sentry from "@sentry/nextjs"
import { logger } from "@/lib/logger"
import { vencimientoConMeses } from "@/lib/mp-utils"
import { prisma } from "@/lib/prisma"
import { registrarEventoPasarela, type EventoPasarelaClient } from "./events"
import { RECIBO_PAYPAL_ID_MAX, generarReciboId } from "./receipts"
import { esRevisionPorMoneda } from "./revision-view"
import { esMonedaUsd } from "./utils"

/**
 * `revisionNota` con el formato estructural que T-10/T-11 escriben cuando la
 * captura o el link no estaban en USD. La implementacion vive en
 * `revision-view.ts` (client-safe) y se reexporta para no duplicar la regla.
 */
export { esRevisionPorMoneda } from "./revision-view"

const PRISMA_INT_MAX = 2_147_483_647

export const PAGO_REVISION_ID_MAX = 100
export const NOTA_REVISION_MAX = 2_000
export const RESUELTO_POR_MAX = 120
export const RESUELTO_POR_ID_MAX = 120

const PATRON_CONTROL_INVALIDO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export type AccionRevisionPaypal = "ACEPTAR" | "RECHAZAR"

export type PaypalReviewErrorCodigo =
  | "ARGUMENTOS_INVALIDOS"
  | "PAGO_NO_ENCONTRADO"
  | "ESTADO_NO_REVISION"
  | "MONEDA_NO_ACEPTABLE"
  | "REFERENCIA_EXTERNA_FALTANTE"
  | "MONTO_INVALIDO"
  | "MESES_INVALIDOS"
  | "CONCEPTO_INVALIDO"
  | "HITO_NO_PENDIENTE"
  | "SUSCRIPCION_NO_ENCONTRADA"
  | "CONFLICTO"
  | "ERROR_INTERNO"

const HTTP_STATUS_POR_CODIGO: Record<PaypalReviewErrorCodigo, number> = {
  ARGUMENTOS_INVALIDOS: 400,
  PAGO_NO_ENCONTRADO: 404,
  ESTADO_NO_REVISION: 409,
  MONEDA_NO_ACEPTABLE: 409,
  REFERENCIA_EXTERNA_FALTANTE: 409,
  MONTO_INVALIDO: 409,
  MESES_INVALIDOS: 409,
  CONCEPTO_INVALIDO: 409,
  HITO_NO_PENDIENTE: 409,
  SUSCRIPCION_NO_ENCONTRADA: 409,
  CONFLICTO: 409,
  ERROR_INTERNO: 500,
}

/** Contexto tecnico del pago para logs estructurados (sin PII). */
export interface ContextoRevisionPaypal {
  externalId: string | null
  enlaceId: string | null
  moneda: string | null
}

/** Error tipado de la revision; `message` es seguro de loguear y devolver. */
export class PaypalReviewError extends Error {
  readonly codigo: PaypalReviewErrorCodigo
  readonly httpStatus: number
  readonly contexto: ContextoRevisionPaypal | null

  constructor(params: {
    codigo: PaypalReviewErrorCodigo
    mensaje: string
    contexto?: ContextoRevisionPaypal | null
  }) {
    super(params.mensaje)
    this.name = "PaypalReviewError"
    this.codigo = params.codigo
    this.httpStatus = HTTP_STATUS_POR_CODIGO[params.codigo]
    this.contexto = params.contexto ?? null
  }
}

export function esPaypalReviewError(error: unknown): error is PaypalReviewError {
  return error instanceof PaypalReviewError
}

export interface ResolverRevisionPaypalInput {
  pagoId: string
  accion: AccionRevisionPaypal
  /** Nota interna del admin; opcional y nunca habilita aceptar otra moneda. */
  nota?: string | null
  /** Trazabilidad: nombre visible del admin que resuelve. */
  resueltoPor?: string | null
  /** Trazabilidad: identificador estable del staff (Clerk o id interno). */
  resueltoPorId?: string | null
}

export interface ResolverRevisionPaypalOpciones {
  /** Fecha de referencia para la resolucion y el recibo. */
  ahora?: Date
  /** Cliente Prisma inyectable en tests. Default: singleton de la app. */
  db?: PaypalReviewDb
  /** Generador de recibo inyectable en tests. Default: `generarReciboId`. */
  nuevoReciboId?: (ahora: Date) => string
}

export interface ResultadoRevisionPaypal {
  pagoId: string
  accion: AccionRevisionPaypal
  pasarela: "PAYPAL"
  externalId: string | null
  enlaceId: string | null
  moneda: string
  estadoPago: EstadoPago
  revisionEstado: EstadoRevision
  revisionNota: string | null
  revisionResueltaPor: string
  revisionResueltaEn: Date
  /** Solo en `ACEPTAR`; en `RECHAZAR` es `null`. */
  reciboId: string | null
  /** Fecha de emision del recibo; solo en `ACEPTAR`. */
  reciboEmitidoEn: Date | null
  hitoAplicado: boolean
  /** Solo soporte aceptado: meses acreditados. */
  mesesAcreditados: number | null
  /** Montos del pago ya ajustados (o intactos si se rechazo). */
  monto: number
  montoAcordado: number | null
  comision: number
  montoEsperado: number | null
}

/** Pago minimo para decidir la revision. */
export interface PagoEnRevision {
  id: string
  pasarela: Pasarela
  estadoPago: EstadoPago
  revisionEstado: EstadoRevision | null
  revisionNota: string | null
  monto: number
  montoAcordado: number | null
  comision: number
  montoEsperado: number | null
  meses: number | null
  hitoId: string | null
  suscripcionId: string | null
  enlacePagoId: string | null
  externalId: string | null
  paypalOrderId: string | null
  moneda: string
  reciboId: string | null
  reciboEmitidoEn: Date | null
}

/** Suscripcion minima para acreditar meses una sola vez. */
export interface SuscripcionRevisable {
  id: string
  proximoPago: Date | null
}

/** Cliente dentro de la transaccion. */
export interface PaypalReviewTx {
  pago: {
    findUnique(args: Prisma.PagoFindUniqueArgs): Promise<PagoEnRevision | null>
    updateMany(args: Prisma.PagoUpdateManyArgs): Promise<{ count: number }>
  }
  hito: {
    updateMany(args: Prisma.HitoUpdateManyArgs): Promise<{ count: number }>
  }
  suscripcion: {
    findUnique(
      args: Prisma.SuscripcionFindUniqueArgs
    ): Promise<SuscripcionRevisable | null>
    updateMany(
      args: Prisma.SuscripcionUpdateManyArgs
    ): Promise<{ count: number }>
  }
  /**
   * Trazabilidad tecnica. Opcional para que los dobles historicos sin eventos
   * sigan funcionando; en la app real siempre esta presente.
   */
  eventoPasarela?: EventoPasarelaClient
}

/**
 * Cliente Prisma con transacciones. `$transaction` es opcional para que los
 * dobles de test puedan ejecutar el callback directamente; en la app real
 * siempre esta presente y la resolucion es atomica.
 */
export interface PaypalReviewDb extends PaypalReviewTx {
  $transaction?<T>(fn: (tx: PaypalReviewTx) => Promise<T>): Promise<T>
}

interface DatosRevisionValidados {
  pagoId: string
  accion: AccionRevisionPaypal
  nota: string | null
  resueltoPor: string
  resueltoPorId: string | null
}

function error(
  codigo: PaypalReviewErrorCodigo,
  mensaje: string,
  contexto?: ContextoRevisionPaypal | null
): PaypalReviewError {
  return new PaypalReviewError({ codigo, mensaje, contexto })
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw error("ARGUMENTOS_INVALIDOS", "La fecha de la revision no es valida.")
  }
  return new Date(valor.getTime())
}

function normalizarPagoId(valor: unknown): string {
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", "El pagoId no es valido.")
  }
  const texto = valor.trim()
  if (texto.length === 0 || texto.length > PAGO_REVISION_ID_MAX) {
    throw error("ARGUMENTOS_INVALIDOS", "El pagoId no es valido.")
  }
  return texto
}

function normalizarAccion(valor: unknown): AccionRevisionPaypal {
  if (valor === "ACEPTAR" || valor === "RECHAZAR") return valor
  throw error(
    "ARGUMENTOS_INVALIDOS",
    "La accion debe ser ACEPTAR o RECHAZAR."
  )
}

function normalizarNota(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", "La nota de la revision no es valida.")
  }

  const texto = valor.trim()
  if (texto.length === 0) return null
  if (texto.length > NOTA_REVISION_MAX) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      `La nota no puede superar ${NOTA_REVISION_MAX} caracteres.`
    )
  }
  if (PATRON_CONTROL_INVALIDO.test(texto)) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "La nota contiene caracteres no permitidos."
    )
  }
  return texto
}

function normalizarResueltoPor(valor: unknown): string {
  if (typeof valor !== "string") return "Admin"
  const texto = valor.trim()
  return texto.length > 0 ? texto.slice(0, RESUELTO_POR_MAX) : "Admin"
}

function normalizarResueltoPorId(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto.slice(0, RESUELTO_POR_ID_MAX) : null
}

function validarEntrada(
  input: ResolverRevisionPaypalInput | null | undefined
): DatosRevisionValidados {
  if (!input || typeof input !== "object") {
    throw error("ARGUMENTOS_INVALIDOS", "Datos invalidos.")
  }

  return {
    pagoId: normalizarPagoId(input.pagoId),
    accion: normalizarAccion(input.accion),
    nota: normalizarNota(input.nota),
    resueltoPor: normalizarResueltoPor(input.resueltoPor),
    resueltoPorId: normalizarResueltoPorId(input.resueltoPorId),
  }
}

/**
 * Conserva el motivo original de la revision y agrega la nota del admin. El
 * motivo original nunca se descarta para que la auditoria siga mostrando que la
 * captura no fue en USD.
 */
export function combinarNotaRevision(
  original: string | null | undefined,
  nota: string | null | undefined
): string | null {
  const motivo = typeof original === "string" ? original.trim() : ""
  const agregada = typeof nota === "string" ? nota.trim() : ""

  if (!agregada) return motivo.length > 0 ? motivo : null
  if (!motivo) return agregada
  return `${motivo} | ${agregada}`
}

function validarMontoCapturado(valor: unknown): number {
  if (
    typeof valor !== "number" ||
    !Number.isSafeInteger(valor) ||
    valor <= 0 ||
    valor > PRISMA_INT_MAX
  ) {
    throw error(
      "MONTO_INVALIDO",
      "El monto capturado del pago no es un entero USD positivo."
    )
  }
  return valor
}

function validarMeses(valor: unknown): number {
  if (
    typeof valor !== "number" ||
    !Number.isInteger(valor) ||
    valor < 1 ||
    valor > 12
  ) {
    throw error(
      "MESES_INVALIDOS",
      "Los meses del soporte deben ser un entero entre 1 y 12."
    )
  }
  return valor
}

function resolverReciboId(
  opciones: ResolverRevisionPaypalOpciones,
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
  if (reciboId.length === 0 || reciboId.length > RECIBO_PAYPAL_ID_MAX) {
    throw error("ERROR_INTERNO", "No se pudo generar el recibo del pago.")
  }
  return reciboId
}

async function enTransaccion<T>(
  db: PaypalReviewDb,
  fn: (tx: PaypalReviewTx) => Promise<T>
): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction(fn)
  }
  return fn(db)
}

function resultadoBase(
  pago: PagoEnRevision,
  datos: DatosRevisionValidados,
  ahora: Date,
  revisionNota: string | null
) {
  return {
    pagoId: pago.id,
    accion: datos.accion,
    pasarela: "PAYPAL" as const,
    externalId: pago.externalId,
    enlaceId: pago.enlacePagoId,
    moneda: pago.moneda,
    revisionNota,
    revisionResueltaPor: datos.resueltoPor,
    revisionResueltaEn: ahora,
    monto: pago.monto,
    montoAcordado: pago.montoAcordado,
    comision: pago.comision,
    montoEsperado: pago.montoEsperado,
  }
}

interface RegistrarEventoRevisionParams {
  pago: PagoEnRevision
  datos: DatosRevisionValidados
  ahora: Date
  estadoRevision: "ACEPTADO" | "RECHAZADO"
  resultado: "PROCESADO" | "REQUIERE_ACCION"
}

/**
 * Deja trazabilidad de la decision en `EventoPasarela`: accion, staff estable,
 * montos originales y resultado. El motivo no incluye nombre ni nota (sin PII).
 * Se escribe en la misma transaccion que la resolucion.
 */
async function registrarEventoRevision(
  tx: PaypalReviewTx,
  params: RegistrarEventoRevisionParams
): Promise<void> {
  if (!tx.eventoPasarela) return

  const { pago, datos, ahora, estadoRevision, resultado } = params
  const staff = datos.resueltoPorId ?? "desconocido"
  const montoAcordado =
    typeof pago.montoAcordado === "number" ? pago.montoAcordado : "null"
  const montoEsperado =
    typeof pago.montoEsperado === "number" ? pago.montoEsperado : "null"

  await registrarEventoPasarela(
    {
      eventoId: `revision:${pago.id}:${datos.accion}`,
      pasarela: "PAYPAL",
      tipo: `REVISION.PAYPAL.${datos.accion}`,
      externalId: pago.externalId,
      enlacePagoId: pago.enlacePagoId,
      pagoId: pago.id,
      resultado,
      motivo: `${estadoRevision} monto=${pago.monto} montoAcordado=${montoAcordado} comision=${pago.comision} montoEsperado=${montoEsperado} staff=${staff}`,
      monto: pago.monto,
      moneda: pago.moneda,
      requiereAccion: resultado === "REQUIERE_ACCION",
      procesadoEn: ahora,
    },
    { db: { eventoPasarela: tx.eventoPasarela }, ahora }
  )
}

async function rechazarRevision(
  tx: PaypalReviewTx,
  pago: PagoEnRevision,
  datos: DatosRevisionValidados,
  ahora: Date
): Promise<ResultadoRevisionPaypal> {
  const revisionNota = combinarNotaRevision(pago.revisionNota, datos.nota)

  // El where repite pasarela/estado para que dos resoluciones concurrentes no
  // ganen las dos. RECHAZAR deja el pago sin aplicar y sin recibo: si un pago
  // en revision ya tuviera un recibo, se limpia.
  const actualizado = await tx.pago.updateMany({
    where: {
      id: pago.id,
      pasarela: "PAYPAL",
      estadoPago: "REVISION",
      revisionEstado: "PENDIENTE",
    },
    data: {
      estadoPago: "REVISION",
      revisionEstado: "RECHAZADO",
      revisionNota,
      revisionResueltaPor: datos.resueltoPor,
      revisionResueltaEn: ahora,
      reciboId: null,
      reciboEmitidoEn: null,
    },
  })
  if (actualizado.count !== 1) {
    throw error(
      "CONFLICTO",
      "El pago ya fue resuelto por otra operacion."
    )
  }

  await registrarEventoRevision(tx, {
    pago,
    datos,
    ahora,
    estadoRevision: "RECHAZADO",
    resultado: "REQUIERE_ACCION",
  })

  return {
    ...resultadoBase(pago, datos, ahora, revisionNota),
    estadoPago: "REVISION",
    revisionEstado: "RECHAZADO",
    reciboId: null,
    reciboEmitidoEn: null,
    hitoAplicado: false,
    mesesAcreditados: null,
  }
}

async function aceptarRevision(
  tx: PaypalReviewTx,
  pago: PagoEnRevision,
  datos: DatosRevisionValidados,
  ahora: Date,
  opciones: ResolverRevisionPaypalOpciones
): Promise<ResultadoRevisionPaypal> {
  // Solo USD: no se acepta un importe extranjero como si fuera USD. T-10/T-11
  // persisten `moneda="usd"` aunque la captura haya sido en otra moneda, por eso
  // tambien se detecta el prefijo estructural de `revisionNota`.
  if (!esMonedaUsd(pago.moneda) || esRevisionPorMoneda(pago.revisionNota)) {
    throw error(
      "MONEDA_NO_ACEPTABLE",
      "No se puede aceptar un pago en moneda distinta de USD. Rechaza la revision y registra el cobro manualmente."
    )
  }

  const conceptos =
    Number(pago.hitoId !== null) + Number(pago.suscripcionId !== null)
  if (conceptos !== 1) {
    throw error(
      "CONCEPTO_INVALIDO",
      "El pago no tiene un unico concepto (hito o soporte) vinculado."
    )
  }

  // El recibo exige una referencia externa de PayPal para reconciliar.
  const referencia =
    (typeof pago.externalId === "string" && pago.externalId.trim()) ||
    (typeof pago.paypalOrderId === "string" && pago.paypalOrderId.trim()) ||
    ""
  if (referencia.length === 0) {
    throw error(
      "REFERENCIA_EXTERNA_FALTANTE",
      "El pago no tiene referencia externa de PayPal (externalId o paypalOrderId); no se puede emitir el recibo."
    )
  }

  const monto = validarMontoCapturado(pago.monto)

  // El recibo exige montoAcordado + comision = total. Se conserva la comision
  // del snapshot si entra en el monto capturado; si no alcanza, pasa a 0. El
  // monto esperado original queda intacto para auditoria.
  const comisionOriginal =
    typeof pago.comision === "number" &&
    Number.isSafeInteger(pago.comision) &&
    pago.comision >= 0
      ? pago.comision
      : 0
  const comision = comisionOriginal < monto ? comisionOriginal : 0
  const montoAcordado = monto - comision

  let meses: number | null = null
  let suscripcion: SuscripcionRevisable | null = null

  if (pago.suscripcionId) {
    // Se valida antes de escribir: sin meses 1..12 no hay aplicacion ni recibo.
    meses = validarMeses(pago.meses)
    suscripcion = await tx.suscripcion.findUnique({
      where: { id: pago.suscripcionId },
      select: { id: true, proximoPago: true },
    })
    if (!suscripcion) {
      throw error(
        "SUSCRIPCION_NO_ENCONTRADA",
        "El soporte vinculado al pago no existe."
      )
    }
  }

  // El id se genera dentro de la transaccion y solo en el camino ACEPTAR.
  const reciboId = resolverReciboId(opciones, ahora)
  const revisionNota = combinarNotaRevision(pago.revisionNota, datos.nota)

  const actualizado = await tx.pago.updateMany({
    where: {
      id: pago.id,
      pasarela: "PAYPAL",
      estadoPago: "REVISION",
      revisionEstado: "PENDIENTE",
    },
    data: {
      estadoPago: "SUCCEEDED",
      revisionEstado: "ACEPTADO",
      revisionNota,
      revisionResueltaPor: datos.resueltoPor,
      revisionResueltaEn: ahora,
      montoAcordado,
      comision,
      reciboId,
      reciboEmitidoEn: ahora,
    },
  })
  if (actualizado.count !== 1) {
    throw error(
      "CONFLICTO",
      "El pago ya fue resuelto por otra operacion."
    )
  }

  let hitoAplicado = false

  if (pago.hitoId) {
    // CAS: solo se aplica si el hito sigue PENDIENTE. Si otro pago lo gano, la
    // transaccion completa se revierte (pago, recibo y estado).
    const hito = await tx.hito.updateMany({
      where: { id: pago.hitoId, estado: "PENDIENTE" },
      data: { estado: "PAGADO", pagadoEn: ahora },
    })
    if (hito.count !== 1) {
      throw error(
        "HITO_NO_PENDIENTE",
        "El hito no esta pendiente y no se puede aplicar el pago."
      )
    }
    hitoAplicado = true
  }

  if (pago.suscripcionId && suscripcion && meses !== null) {
    const proximoPago = vencimientoConMeses(
      suscripcion.proximoPago,
      meses,
      ahora
    )
    if (!(proximoPago instanceof Date)) {
      throw error(
        "ERROR_INTERNO",
        "No se pudo calcular el vencimiento del soporte."
      )
    }

    // CAS por `proximoPago`, igual que el procesador de capturas: si otro pago
    // acredito meses en paralelo, esta resolucion se revierte y no duplica.
    const actualizada = await tx.suscripcion.updateMany({
      where: {
        id: suscripcion.id,
        proximoPago: suscripcion.proximoPago,
      },
      data: {
        estado: "ACTIVE",
        proximoPago,
        pastDueEn: null,
        canceladoEn: null,
      },
    })
    if (actualizada.count !== 1) {
      throw error(
        "CONFLICTO",
        "El soporte fue actualizado por otra operacion."
      )
    }
  }

  // La resolucion quedo aplicada: se deja el evento con los montos originales
  // del snapshot (el pago ya fue ajustado para el recibo).
  await registrarEventoRevision(tx, {
    pago,
    datos,
    ahora,
    estadoRevision: "ACEPTADO",
    resultado: "PROCESADO",
  })

  // La respuesta refleja el desglose ya ajustado (no el snapshot original).
  return {
    pagoId: pago.id,
    accion: datos.accion,
    pasarela: "PAYPAL",
    externalId: pago.externalId,
    enlaceId: pago.enlacePagoId,
    moneda: pago.moneda,
    estadoPago: "SUCCEEDED",
    revisionEstado: "ACEPTADO",
    revisionNota,
    revisionResueltaPor: datos.resueltoPor,
    revisionResueltaEn: ahora,
    reciboId,
    reciboEmitidoEn: ahora,
    hitoAplicado,
    mesesAcreditados: meses,
    monto,
    montoAcordado,
    comision,
    montoEsperado: pago.montoEsperado,
  }
}

async function resolverEnTransaccion(
  tx: PaypalReviewTx,
  datos: DatosRevisionValidados,
  ahora: Date,
  opciones: ResolverRevisionPaypalOpciones,
  contexto: ContextoRevisionPaypal
): Promise<ResultadoRevisionPaypal> {
  const pago = await tx.pago.findUnique({
    where: { id: datos.pagoId },
    select: {
      id: true,
      pasarela: true,
      estadoPago: true,
      revisionEstado: true,
      revisionNota: true,
      monto: true,
      montoAcordado: true,
      comision: true,
      montoEsperado: true,
      meses: true,
      hitoId: true,
      suscripcionId: true,
      enlacePagoId: true,
      externalId: true,
      paypalOrderId: true,
      moneda: true,
      reciboId: true,
      reciboEmitidoEn: true,
    },
  })

  // Un pago de otra pasarela se trata como inexistente: este flujo solo opera
  // PayPal y no debe exponer ni modificar pagos de Mercado Pago.
  if (!pago || pago.pasarela !== "PAYPAL") {
    throw error("PAGO_NO_ENCONTRADO", "Pago PayPal en revision no encontrado.")
  }

  contexto.externalId = pago.externalId
  contexto.enlaceId = pago.enlacePagoId
  contexto.moneda = pago.moneda

  try {
    if (pago.estadoPago !== "REVISION" || pago.revisionEstado !== "PENDIENTE") {
      throw error(
        "ESTADO_NO_REVISION",
        "El pago no esta pendiente de revision."
      )
    }

    if (datos.accion === "RECHAZAR") {
      return await rechazarRevision(tx, pago, datos, ahora)
    }

    return await aceptarRevision(tx, pago, datos, ahora, opciones)
  } catch (err) {
    // Adjunta el contexto tecnico del pago a los errores funcionales para que
    // los logs de la ruta incluyan externalId/enlaceId/moneda sin PII.
    if (esPaypalReviewError(err) && !err.contexto) {
      throw new PaypalReviewError({
        codigo: err.codigo,
        mensaje: err.message,
        contexto: { ...contexto },
      })
    }
    throw err
  }
}

/**
 * Resuelve un pago PayPal en `REVISION` aceptandolo o rechazandolo.
 *
 * Cualquier fallo de la aplicacion (hito ya pagado, soporte inexistente,
 * conflicto de carrera) revierte toda la transaccion: el pago vuelve a quedar
 * `REVISION`/`PENDIENTE`, sin recibo y sin cambios en hito/soporte.
 */
export async function resolverRevisionPaypal(
  input: ResolverRevisionPaypalInput,
  opciones: ResolverRevisionPaypalOpciones = {}
): Promise<ResultadoRevisionPaypal> {
  const ahora = resolverAhora(opciones.ahora)
  const datos = validarEntrada(input)
  const db = (opciones.db ?? prisma) as unknown as PaypalReviewDb
  const contexto: ContextoRevisionPaypal = {
    externalId: null,
    enlaceId: null,
    moneda: null,
  }

  try {
    return await enTransaccion(db, (tx) =>
      resolverEnTransaccion(tx, datos, ahora, opciones, contexto)
    )
  } catch (err) {
    if (esPaypalReviewError(err)) {
      const ctx = err.contexto ?? contexto
      // Los errores funcionales (400/404/409) son parte del contrato. Un
      // ERROR_INTERNO si es un 5xx: se reporta sin incluir la nota ni PII.
      if (err.codigo === "ERROR_INTERNO") {
        Sentry.captureException(err)
        logger.error("Error interno resolviendo revision PayPal", {
          pagoId: datos.pagoId,
          accion: datos.accion,
          pasarela: "PAYPAL",
          externalId: ctx.externalId,
          enlaceId: ctx.enlaceId,
          moneda: ctx.moneda,
          error: err.name,
        })
      }
      throw err
    }

    Sentry.captureException(err)
    logger.error("Error resolviendo revision PayPal", {
      pagoId: datos.pagoId,
      accion: datos.accion,
      pasarela: "PAYPAL",
      externalId: contexto.externalId,
      enlaceId: contexto.enlaceId,
      moneda: contexto.moneda,
      error: err instanceof Error ? err.name : "Error desconocido",
    })

    throw error(
      "ERROR_INTERNO",
      "Error al resolver la revision del pago de PayPal."
    )
  }
}
