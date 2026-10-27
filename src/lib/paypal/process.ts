/**
 * Procesador de capturas PayPal para hitos (T-10) y soporte mensual (T-11).
 *
 * Recibe una captura ya parseada (`parsePaypalCapture`) y registra el pago de
 * forma atomica:
 *
 * 1. Resuelve el `EnlacePago` PayPal por el order id (`externalId`) o, como
 *    respaldo, por el token interno que viaja en `custom_id`/`invoice_id`.
 * 2. Idempotencia por `Pago.externalId` (capture id) y `Pago.paypalOrderId`
 *    (order id). Un `P2002` de las constraints unicas tambien se resuelve como
 *    duplicado: nunca se crea un segundo pago ni se acredita dos veces un
 *    soporte. Un segundo capture de la misma orden (mismo order id, capture id
 *    distinto) se traza como duplicado que requiere accion.
 * 3. Hito: si ya esta PAGADO o existe otro pago exitoso para el mismo hito, no
 *    se crea nada y se devuelve un conflicto. Un link invalidado por la otra
 *    pasarela tampoco registra un pago nuevo.
 * 4. Si el monto y la moneda coinciden con el snapshot del link (total/moneda
 *    USD), crea un `Pago` SUCCEEDED con desglose, recibo y referencias. En un
 *    hito ademas lo marca PAGADO/pagadoEn; en un soporte acredita `meses`
 *    (1..12 desde el link) actualizando `Suscripcion` una sola vez mediante un
 *    CAS por `proximoPago` (pagos simultaneos: solo uno acredita). El recibo se
 *    emite **solo** en este camino exitoso.
 * 5. Primer pago gana (T-12): el link ganador se marca PAGADO con un
 *    `updateMany` condicional (count 1) y luego se invalidan, dentro de la
 *    misma transaccion, todos los `EnlacePago` ACTIVOS del mismo
 *    `grupoCobroId` distintos del ganador (incluido el link MP legacy
 *    adoptado), con `estado=INVALIDADO`, `invalidadoEn` y
 *    `motivoInvalido=OTRO_PAGO_GANO`. Los `Hito`/`Suscripcion` de MP no se
 *    tocan: solo se actualiza el concepto ganador con su pago. Los links y
 *    eventos no se borran; el intento descartado queda en `EventoPasarela` con
 *    `REQUIERE_ACCION` y `requiereAccion=true`. El mismo cierre del link se
 *    aplica al camino REVISION (ver punto 6).
 * 6. Si el monto o la moneda difieren, crea el `Pago` en REVISION (PENDIENTE),
 *    con el monto capturado y el esperado, y **no** marca el hito, **no**
 *    acredita meses ni actualiza `proximoPago`/estado del soporte, ni emite
 *    recibo: T-17 lo emite al aceptar la revision. El link queda PAGADO porque
 *    el capture ya ocurrio: no debe permitir un segundo cobro; ademas se
 *    invalidan los hermanos del mismo `grupoCobroId` (un capture COMPLETED en
 *    REVISION ya es un pago confirmado y no debe dejar otros links cobrables).
 *    La diferencia se resuelve desde el CRM (T-17). Es la misma decision que
 *    T-10.
 *
 * En soporte se validan los `meses` del snapshot antes de escribir: si faltan o
 * estan fuera de 1..12 se lanza `MESES_INVALIDOS` sin crear `Pago`, sin tocar
 * la `Suscripcion` y sin consumir el link. Un soporte admite pagos sucesivos en
 * meses distintos (cada capture se acredita una vez, generando un link nuevo
 * tras cada pago); un mismo capture/order no se acredita dos veces.
 *
 * La captura debe traer monto entero (rango Int32 de Prisma) y moneda: un
 * capture COMPLETED sin monto no registra un pago de 0 ni consume el link.
 *
 * No persiste datos del pagador (email, nombre, direccion ni tarjeta): solo
 * ids de PayPal, montos, moneda y estado. Solo loguea, best-effort y sin PII,
 * el fallo de la trazabilidad tecnica en `EventoPasarela`. Sin acceso a red.
 */

import type {
  EstadoEnlace,
  EstadoHito,
  EstadoPago,
  Pasarela,
  Prisma,
} from "@prisma/client"
import { logger } from "@/lib/logger"
import {
  MOTIVO_INVALIDACION_OTRO_PAGO,
  vencimientoConMeses,
} from "@/lib/mp-utils"
import { prisma } from "@/lib/prisma"
import {
  registrarEventoPasarela,
  type EventoPasarelaClient,
  type ResultadoEventoPasarela,
} from "./events"
import { generarReciboId } from "./receipts"
import { PAYPAL_MONEDA } from "./utils"

const MONEDA_ESPERADA = PAYPAL_MONEDA.toUpperCase()
/** Limite del entero de Prisma (`Int`, Int32); defensa contra montos absurdos. */
const PRISMA_INT_MAX = 2_147_483_647
const MAX_INTENTOS_RECIBO = 2
const EVENTO_TIPO_CAPTURA = "PAYMENT.CAPTURE.COMPLETED"
const EVENTO_ID_CAPTURA_PREFIJO = "PAYPAL:CAPTURA:"

/** Motivo persistido en los links hermanos cuando otro pago gano el cobro. */
export { MOTIVO_INVALIDACION_OTRO_PAGO }

export type PaypalProcessErrorCodigo =
  | "CAPTURA_INVALIDA"
  | "CAPTURA_NO_COMPLETADA"
  | "ENLACE_NO_ENCONTRADO"
  | "ENLACE_INVALIDO"
  | "MESES_INVALIDOS"
  | "ERROR_INTERNO"

const HTTP_STATUS_POR_CODIGO: Record<PaypalProcessErrorCodigo, number> = {
  CAPTURA_INVALIDA: 400,
  CAPTURA_NO_COMPLETADA: 409,
  ENLACE_NO_ENCONTRADO: 404,
  ENLACE_INVALIDO: 409,
  MESES_INVALIDOS: 409,
  ERROR_INTERNO: 500,
}

/** Error tipado del procesador; `message` es siempre seguro de loguear. */
export class PaypalProcessError extends Error {
  readonly codigo: PaypalProcessErrorCodigo
  readonly httpStatus: number

  constructor(params: { codigo: PaypalProcessErrorCodigo; mensaje: string }) {
    super(params.mensaje)
    this.name = "PaypalProcessError"
    this.codigo = params.codigo
    this.httpStatus = HTTP_STATUS_POR_CODIGO[params.codigo]
  }
}

export function esPaypalProcessError(error: unknown): error is PaypalProcessError {
  return error instanceof PaypalProcessError
}

/** Captura de PayPal ya parseada, sin payload crudo ni datos del pagador. */
export interface CapturaPaypalProcesable {
  captureId: string
  orderId?: string | null
  amountCents: number | null
  currency: string | null
  status: string
  /** Token del link en `custom_id`/`invoice_id` (respaldo del order id). */
  customId?: string | null
  invoiceId?: string | null
}

/** Identidad tecnica de la notificacion PayPal que origino la captura. */
export interface EventoCapturaPaypal {
  /** `id` del evento PayPal; si falta se usa uno sintetico por capture id. */
  eventoId: string
  /** Tipo PayPal (`PAYMENT.CAPTURE.COMPLETED`, etc.). */
  tipo?: string | null
}

export interface ProcesarCapturaOpciones {
  /** Fecha de referencia para `pagadoEn`, `reciboEmitidoEn` y el recibo. */
  ahora?: Date
  /** Cliente Prisma inyectable en tests. Default: singleton de la app. */
  db?: PaypalProcessDb
  /** Generador de recibo inyectable en tests. Default: `generarReciboId`. */
  nuevoReciboId?: (ahora: Date) => string
  /**
   * Evento PayPal que origino la captura. Si no se informa, se sintetiza un
   * `eventoId` estable a partir del capture id para no perder trazabilidad en
   * el retorno del comprador.
   */
  evento?: EventoCapturaPaypal
}

export type MotivoRevision = "MONTO" | "MONEDA"
export type MotivoConflicto =
  | "HITO_PAGADO"
  | "PAGO_GANADOR"
  | "ENLACE_PAGADO"
  | "ENLACE_INVALIDADO"

export type ResultadoProcesamientoPaypal =
  | {
      tipo: "PROCESADO"
      duplicado: false
      pagoId: string
      enlaceId: string
      hitoId: string | null
      /** Solo soporte: concepto acreditado y meses aplicados. */
      suscripcionId?: string | null
      meses?: number | null
      reciboId: string
      monto: number
      montoAcordado: number
      comision: number
      moneda: "usd"
    }
  | {
      tipo: "REVISION"
      duplicado: false
      pagoId: string
      enlaceId: string
      hitoId: string | null
      /** Solo soporte: concepto pendiente de revision (no acredita meses). */
      suscripcionId?: string | null
      meses?: number | null
      monto: number
      montoAcordado: number
      comision: number
      montoEsperado: number
      moneda: "usd"
      motivoRevision: MotivoRevision
    }
  | {
      tipo: "DUPLICADO"
      duplicado: true
      pagoId: string
      enlaceId: string | null
      hitoId: string | null
      suscripcionId?: string | null
      /**
       * `true` cuando el duplicado es un segundo capture de la misma orden
       * (capture id distinto), no un reintento exacto del mismo capture. Ese
       * intento se marca para revision y no crea un pago nuevo.
       */
      requiereAccion?: boolean
    }
  | {
      tipo: "CONFLICTO"
      duplicado: false
      motivo: MotivoConflicto
      enlaceId: string
      hitoId: string | null
      pagoId: string | null
      suscripcionId?: string | null
    }

/** Fila de `EnlacePago` con lo minimo para conciliar un capture. */
export interface EnlaceProcesable {
  id: string
  token: string
  clienteId: string
  hitoId: string | null
  suscripcionId: string | null
  pasarela: Pasarela
  concepto: string
  montoAcordado: number
  comision: number
  total: number
  moneda: string
  meses: number | null
  feeBps: number
  feeFixedCents: number
  externalId: string | null
  estado: EstadoEnlace
  /** Grupo de cobro compartido con los links MP/PayPal del mismo concepto. */
  grupoCobroId: string
  hito: { id: string; estado: EstadoHito } | null
}

export interface PagoExistente {
  id: string
  estadoPago: EstadoPago
  enlacePagoId: string | null
  hitoId: string | null
  /** Referencias usadas para distinguir un reintento exacto de otro capture. */
  externalId: string | null
  paypalOrderId: string | null
}

/** Datos minimos de la suscripcion para acreditar meses una sola vez. */
export interface SuscripcionProcesable {
  id: string
  proximoPago: Date | null
}

/** Cliente dentro de la transaccion. */
export interface PaypalProcessTx {
  enlacePago: {
    findFirst(args: Prisma.EnlacePagoFindFirstArgs): Promise<EnlaceProcesable | null>
    update(args: Prisma.EnlacePagoUpdateArgs): Promise<unknown>
    /**
     * Invalidacion condicional de los links hermanos (T-12). Opcional para que
     * los dobles historicos de T-10/T-11, que no la declaran, sigan funcionando;
     * en la app real siempre esta presente.
     */
    updateMany?(
      args: Prisma.EnlacePagoUpdateManyArgs
    ): Promise<{ count: number }>
  }
  pago: {
    findFirst(args: Prisma.PagoFindFirstArgs): Promise<PagoExistente | null>
    create(args: Prisma.PagoCreateArgs): Promise<{ id: string }>
  }
  hito: {
    updateMany(args: Prisma.HitoUpdateManyArgs): Promise<{ count: number }>
  }
  suscripcion: {
    findUnique(
      args: Prisma.SuscripcionFindUniqueArgs
    ): Promise<SuscripcionProcesable | null>
    update(args: Prisma.SuscripcionUpdateArgs): Promise<unknown>
    /**
     * CAS opcional por `proximoPago` para acreditar meses una sola vez ante
     * pagos simultaneos. Opcional para los dobles historicos de T-11.
     */
    updateMany?(
      args: Prisma.SuscripcionUpdateManyArgs
    ): Promise<{ count: number }>
  }
}

/** Cliente Prisma con transacciones interactivas. */
export interface PaypalProcessDb extends PaypalProcessTx {
  /**
   * Trazabilidad tecnica. Es opcional para que los dobles de T-10/T-11 que no
   * la declaran sigan funcionando; en la app real siempre esta presente.
   */
  eventoPasarela?: EventoPasarelaClient
  $transaction<T>(fn: (tx: PaypalProcessTx) => Promise<T>): Promise<T>
}

interface CapturaValidada {
  captureId: string
  orderId: string | null
  amountCents: number
  currency: string
  customId: string | null
  invoiceId: string | null
}

/** Conflicto detectado dentro de la transaccion; fuerza el rollback. */
class ConflictoProcesamiento extends Error {
  readonly motivo: MotivoConflicto
  readonly enlaceId: string
  readonly hitoId: string | null

  constructor(motivo: MotivoConflicto, enlaceId: string, hitoId: string | null) {
    super(motivo)
    this.name = "ConflictoProcesamiento"
    this.motivo = motivo
    this.enlaceId = enlaceId
    this.hitoId = hitoId
  }
}

function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw new PaypalProcessError({
      codigo: "CAPTURA_INVALIDA",
      mensaje: "La fecha de procesamiento del pago no es valida.",
    })
  }
  return new Date(valor.getTime())
}

function resolverReciboId(
  opciones: ProcesarCapturaOpciones,
  ahora: Date
): string {
  let generado: string
  try {
    generado = opciones.nuevoReciboId
      ? opciones.nuevoReciboId(ahora)
      : generarReciboId(ahora)
  } catch {
    throw new PaypalProcessError({
      codigo: "ERROR_INTERNO",
      mensaje: "No se pudo generar el recibo del pago.",
    })
  }

  const reciboId = textoOpcional(generado)
  if (!reciboId) {
    throw new PaypalProcessError({
      codigo: "ERROR_INTERNO",
      mensaje: "No se pudo generar el recibo del pago.",
    })
  }
  return reciboId
}

function validarCaptura(captura: CapturaPaypalProcesable): CapturaValidada {
  const captureId = textoOpcional(captura?.captureId)
  if (!captureId) {
    throw new PaypalProcessError({
      codigo: "CAPTURA_INVALIDA",
      mensaje: "La captura de PayPal no tiene un identificador valido.",
    })
  }

  const estado = textoOpcional(captura.status)?.toUpperCase()
  if (estado !== "COMPLETED") {
    throw new PaypalProcessError({
      codigo: "CAPTURA_NO_COMPLETADA",
      mensaje: "La captura de PayPal no esta completada.",
    })
  }

  // Un capture COMPLETED sin monto no puede registrarse como pago: si se
  // aceptara, quedaria un pago de 0, se consumiria el link y se perderia el
  // cobro real. Se exige entero seguro dentro del rango Int32 de Prisma.
  const amountCents = captura.amountCents
  if (
    typeof amountCents !== "number" ||
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    amountCents > PRISMA_INT_MAX
  ) {
    throw new PaypalProcessError({
      codigo: "CAPTURA_INVALIDA",
      mensaje: "El monto de la captura de PayPal no es valido.",
    })
  }

  const currency = textoOpcional(captura.currency)
  if (!currency) {
    throw new PaypalProcessError({
      codigo: "CAPTURA_INVALIDA",
      mensaje: "La moneda de la captura de PayPal no es valida.",
    })
  }

  return {
    captureId,
    orderId: textoOpcional(captura.orderId),
    amountCents,
    currency,
    customId: textoOpcional(captura.customId),
    invoiceId: textoOpcional(captura.invoiceId),
  }
}

/** Invariantes del snapshot del link (plan.md §4.5), antes de escribir. */
function validarSnapshotEnlace(enlace: EnlaceProcesable): void {
  const { montoAcordado, comision, total } = enlace
  const enteroInt32 = (valor: number) =>
    typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor >= 0 &&
    valor <= PRISMA_INT_MAX

  const valido =
    enteroInt32(montoAcordado) &&
    montoAcordado > 0 &&
    enteroInt32(comision) &&
    enteroInt32(total) &&
    total > 0 &&
    montoAcordado + comision === total

  if (!valido) {
    throw new PaypalProcessError({
      codigo: "ENLACE_INVALIDO",
      mensaje: "El link de pago tiene montos invalidos.",
    })
  }
}

function normalizarMoneda(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const moneda = valor.trim().toUpperCase()
  return moneda.length > 0 ? moneda : null
}

/**
 * `meses` del snapshot de soporte: entero 1..12. Un link de soporte sin meses
 * (o con un valor fuera de rango) no debe acreditar ni consumir nada.
 */
function validarMesesSoporte(valor: number | null | undefined): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 1 || valor > 12) {
    throw new PaypalProcessError({
      codigo: "MESES_INVALIDOS",
      mensaje: "Los meses del soporte deben ser un entero entre 1 y 12.",
    })
  }
  return valor
}

interface EvaluacionMonto {
  montoCapturado: number
  motivoRevision: MotivoRevision | null
  revisionNota: string | null
}

/**
 * Compara la captura contra el snapshot del link. PayPal solo opera USD: en
 * `Pago.moneda` nunca se persiste ARS ni otra moneda; la diferencia de moneda
 * queda documentada en la nota de revision.
 */
function evaluarMonto(
  captura: CapturaValidada,
  enlace: EnlaceProcesable
): EvaluacionMonto {
  const montoCapturado = captura.amountCents
  const monedaCapturada = normalizarMoneda(captura.currency)
  const monedaDelLink = normalizarMoneda(enlace.moneda)

  const montoCoincide = montoCapturado === enlace.total
  const monedaCoincide =
    monedaCapturada === MONEDA_ESPERADA && monedaDelLink === MONEDA_ESPERADA

  const motivoRevision: MotivoRevision | null = montoCoincide
    ? monedaCoincide
      ? null
      : "MONEDA"
    : "MONTO"

  const monedaCapturadaSegura =
    monedaCapturada && /^[A-Z]{3}$/.test(monedaCapturada)
      ? monedaCapturada
      : "desconocida"
  const monedaDelLinkSegura =
    monedaDelLink && /^[A-Z]{3}$/.test(monedaDelLink)
      ? monedaDelLink
      : "desconocida"
  const revisionNota =
    monedaCapturada !== MONEDA_ESPERADA || monedaDelLink !== MONEDA_ESPERADA
      ? `Moneda capturada ${monedaCapturadaSegura}; moneda del link ${monedaDelLinkSegura}; esperado USD.`
      : null

  return { montoCapturado, motivoRevision, revisionNota }
}

function condicionesDeEnlace(captura: CapturaValidada): Prisma.EnlacePagoWhereInput[] {
  const condiciones: Prisma.EnlacePagoWhereInput[] = []
  if (captura.orderId) condiciones.push({ externalId: captura.orderId })
  if (captura.customId) condiciones.push({ token: captura.customId })
  if (captura.invoiceId && captura.invoiceId !== captura.customId) {
    condiciones.push({ token: captura.invoiceId })
  }
  return condiciones
}

function referenciasDePago(captura: CapturaValidada): Prisma.PagoWhereInput[] {
  const referencias: Prisma.PagoWhereInput[] = [{ externalId: captura.captureId }]
  if (captura.orderId) referencias.push({ paypalOrderId: captura.orderId })
  return referencias
}

function esErrorUnico(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  )
}

/**
 * `P2002` por `Pago.reciboId`: la colision es del identificador de recibo, no
 * del pago. Se reintenta una vez con un id nuevo. Prisma informa el campo en
 * `meta.target` (Postgres) o el nombre de la constraint (otros motores).
 */
function esColisionDeRecibo(error: unknown): boolean {
  if (!esErrorUnico(error)) return false

  const meta = (error as { meta?: unknown }).meta
  if (typeof meta !== "object" || meta === null) return false

  const target =
    (meta as { target?: unknown }).target ??
    (meta as { field_name?: unknown }).field_name
  const nombres = Array.isArray(target) ? target : [target]

  return nombres.some(
    (nombre) =>
      typeof nombre === "string" && nombre.toLowerCase().includes("reciboid")
  )
}

/**
 * `requiereAccion` solo se marca cuando el pago existente se encontro por el
 * order id pero el capture id es distinto: no es un reintento exacto, es un
 * segundo capture de la misma orden (fuera de orden/duplicado) que debe quedar
 * trazado como `REQUIERE_ACCION`. Un reintento exacto del mismo capture queda
 * como `DUPLICADO` sin accion.
 */
function resultadoDuplicado(
  pago: PagoExistente,
  enlace?: EnlaceProcesable,
  captura?: CapturaValidada
): ResultadoProcesamientoPaypal {
  const requiereAccion =
    captura !== undefined && pago.externalId !== captura.captureId

  return {
    tipo: "DUPLICADO",
    duplicado: true,
    pagoId: pago.id,
    enlaceId: pago.enlacePagoId ?? enlace?.id ?? null,
    hitoId: pago.hitoId ?? enlace?.hitoId ?? null,
    ...(requiereAccion ? { requiereAccion: true } : {}),
  }
}

function resultadoConflicto(
  motivo: MotivoConflicto,
  enlaceId: string,
  hitoId: string | null,
  pagoId: string | null = null
): ResultadoProcesamientoPaypal {
  return {
    tipo: "CONFLICTO",
    duplicado: false,
    motivo,
    enlaceId,
    hitoId,
    pagoId,
  }
}

/**
 * Marca el link ganador como PAGADO de forma condicional cuando el link tiene
 * grupo y el doble/cliente soporta `updateMany`:
 *
 * - `count === 1`: el link seguia ACTIVO y esta transaccion gano.
 * - `count !== 1`: otro pago lo invalido/pago en paralelo; se lanza un
 *   conflicto para revertir el Pago y la acreditacion de esta transaccion.
 *
 * Sin grupo (dobles historicos de T-10/T-11) se usa el `update` de siempre.
 */
async function marcarEnlaceComoPagado(
  tx: PaypalProcessTx,
  enlace: EnlaceProcesable
): Promise<void> {
  const grupoCobroId = textoOpcional(enlace.grupoCobroId)
  const updateMany = tx.enlacePago.updateMany

  if (grupoCobroId && typeof updateMany === "function") {
    // Se permite VENCIDO/CREANDO/FALLIDO: un capture ya completado debe
    // registrarse aunque el vencimiento perezoso haya corrido entre medio. Solo
    // se excluyen los estados terminales que ya tienen dueno (INVALIDADO) o un
    // pago aplicado (PAGADO); si otro gano la carrera, count sera 0.
    const actualizado = await updateMany.call(tx.enlacePago, {
      where: {
        id: enlace.id,
        estado: { notIn: ["INVALIDADO", "PAGADO"] },
      },
      data: { estado: "PAGADO" },
    })

    const count = (actualizado as { count?: unknown } | null)?.count
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new PaypalProcessError({
        codigo: "ERROR_INTERNO",
        mensaje: "No se pudo confirmar el link de pago.",
      })
    }
    if (count !== 1) {
      throw new ConflictoProcesamiento("ENLACE_PAGADO", enlace.id, enlace.hitoId)
    }
    return
  }

  await tx.enlacePago.update({
    where: { id: enlace.id },
    data: { estado: "PAGADO" },
  })
}

/**
 * Acredita los meses del soporte una sola vez mediante un CAS sobre
 * `proximoPago`: si otra transaccion ya lo actualizo (pago simultaneo), el
 * `count` es 0 y se lanza un conflicto que revierte el Pago y el link.
 *
 * Sin `updateMany` (dobles historicos de T-11) se usa el `update` de siempre.
 */
async function acreditarSuscripcionUnaVez(
  tx: PaypalProcessTx,
  params: {
    suscripcionId: string
    proximoPagoAnterior: Date | null
    /** `vencimientoConMeses` tipa `Date | null`; con meses 1..12 siempre es Date. */
    proximoPagoNuevo: Date | null
    enlaceId: string
  }
): Promise<void> {
  const updateMany = tx.suscripcion.updateMany
  const data = {
    estado: "ACTIVE" as const,
    proximoPago: params.proximoPagoNuevo,
    pastDueEn: null,
    canceladoEn: null,
  }

  if (typeof updateMany === "function") {
    const actualizada = await updateMany.call(tx.suscripcion, {
      where: {
        id: params.suscripcionId,
        proximoPago: params.proximoPagoAnterior,
      },
      data,
    })

    const count = (actualizada as { count?: unknown } | null)?.count
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new PaypalProcessError({
        codigo: "ERROR_INTERNO",
        mensaje: "No se pudo acreditar el soporte.",
      })
    }
    if (count !== 1) {
      throw new ConflictoProcesamiento("PAGO_GANADOR", params.enlaceId, null)
    }
    return
  }

  await tx.suscripcion.update({
    where: { id: params.suscripcionId },
    data,
  })
}

export interface InvalidarEnlacesHermanosParams {
  /** Link ganador; se excluye del update y aporta el `grupoCobroId`. */
  enlace: Pick<EnlaceProcesable, "id" | "grupoCobroId">
  ahora: Date
}

/**
 * Invalida, dentro de la transaccion del pago ganador, los `EnlacePago`
 * ACTIVOS del mismo `grupoCobroId` distintos del ganador (T-12).
 *
 * - Incluye el link MP legacy adoptado (`pasarela=MERCADOPAGO`) y cualquier
 *   link PayPal hermano: solo se filtra por grupo/estado, nunca por pasarela.
 * - Solo toca `EnlacePago`: no modifica `Hito` ni `Suscripcion` de Mercado Pago
 *   (el concepto ganador ya se actualizo por su propio camino).
 * - El `updateMany` es condicional (`estado=ACTIVO`), de modo que un link ya
 *   PAGADO/INVALIDADO no se pisa. Devuelve cuantos se invalidaron.
 * - Verifica el `count` de Prisma: un valor ausente o invalido aborta la
 *   transaccion para no dejar un pago aplicado con hermanos aun cobrables.
 *
 * Devuelve `0` cuando no hay grupo o cuando el doble inyectado no implementa
 * `updateMany` (dobles historicos de T-10/T-11 sin grupo).
 */
export async function invalidarEnlacesHermanos(
  tx: PaypalProcessTx,
  params: InvalidarEnlacesHermanosParams
): Promise<number> {
  const grupoCobroId = textoOpcional(params.enlace.grupoCobroId)
  if (!grupoCobroId) return 0

  const updateMany = tx.enlacePago.updateMany
  if (typeof updateMany !== "function") return 0

  const resultado = await updateMany.call(tx.enlacePago, {
    where: {
      grupoCobroId,
      id: { not: params.enlace.id },
      estado: "ACTIVO",
    },
    data: {
      estado: "INVALIDADO",
      invalidadoEn: params.ahora,
      motivoInvalido: MOTIVO_INVALIDACION_OTRO_PAGO,
    },
  })

  const count = (resultado as { count?: unknown } | null)?.count
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new PaypalProcessError({
      codigo: "ERROR_INTERNO",
      mensaje: "No se pudo invalidar los links hermanos del cobro.",
    })
  }

  return count
}

interface RegistrarPagoEnRevisionParams {
  enlace: EnlaceProcesable
  ahora: Date
  datosBase: Omit<Prisma.PagoUncheckedCreateInput, "estadoPago">
  revisionNota: string | null
}

/**
 * Consume el link de un capture COMPLETED cuyo monto/moneda no coincide con el
 * snapshot: registra el `Pago` en REVISION, marca el link ganador como PAGADO e
 * invalida los hermanos ACTIVOS del mismo grupo.
 *
 * Aunque la diferencia quede pendiente de resolucion (T-17), el capture ya es
 * un pago confirmado: el link no debe admitir un segundo cobro y ningun otro
 * link del concepto debe seguir cobrable. Si la invalidacion falla o devuelve
 * un count invalido, la transaccion se revierte completa (Pago y estados).
 */
async function registrarPagoEnRevision(
  tx: PaypalProcessTx,
  params: RegistrarPagoEnRevisionParams
): Promise<string> {
  const pago = await tx.pago.create({
    data: {
      ...params.datosBase,
      estadoPago: "REVISION",
      revisionEstado: "PENDIENTE",
      revisionNota: params.revisionNota,
    },
  })

  await marcarEnlaceComoPagado(tx, params.enlace)
  await invalidarEnlacesHermanos(tx, {
    enlace: params.enlace,
    ahora: params.ahora,
  })

  return pago.id
}

interface EventoResuelto {
  eventoId: string
  tipo: string
}

interface DatosEventoProcesamiento {
  resultado: ResultadoEventoPasarela
  motivo: string | null
  externalId: string | null
  enlacePagoId: string | null
  pagoId: string | null
  monto: number | null
  moneda: string | null
  requiereAccion: boolean
}

/**
 * Identidad del evento tecnico. El webhook aporta el id real de PayPal; el
 * retorno del comprador (que no trae event id) usa un id sintetico estable por
 * capture, de modo que un reintento tampoco duplique la trazabilidad.
 */
function resolverEventoProcesamiento(
  captura: CapturaPaypalProcesable | null | undefined,
  opciones: ProcesarCapturaOpciones
): EventoResuelto | null {
  const explicito = textoOpcional(opciones.evento?.eventoId)
  const captureId = textoOpcional(captura?.captureId)
  const eventoId =
    explicito ?? (captureId ? `${EVENTO_ID_CAPTURA_PREFIJO}${captureId}` : null)
  if (!eventoId) return null

  return {
    eventoId,
    tipo: textoOpcional(opciones.evento?.tipo) ?? EVENTO_TIPO_CAPTURA,
  }
}

function datosEventoDesdeResultado(
  resultado: ResultadoProcesamientoPaypal,
  captura: CapturaValidada
): DatosEventoProcesamiento {
  switch (resultado.tipo) {
    case "PROCESADO":
      return {
        resultado: "PROCESADO",
        motivo: null,
        externalId: captura.captureId,
        enlacePagoId: resultado.enlaceId,
        pagoId: resultado.pagoId,
        monto: resultado.monto,
        moneda: resultado.moneda,
        requiereAccion: false,
      }
    case "DUPLICADO":
      // Un segundo capture/order del mismo grupo no crea Pago ni acredita: se
      // traza como REQUIERE_ACCION para que el admin lo vea. Un reintento
      // exacto del mismo capture queda como DUPLICADO sin accion.
      return {
        resultado: resultado.requiereAccion ? "REQUIERE_ACCION" : "DUPLICADO",
        motivo: "DUPLICADO",
        externalId: captura.captureId,
        enlacePagoId: resultado.enlaceId,
        pagoId: resultado.pagoId,
        monto: captura.amountCents,
        moneda: captura.currency,
        requiereAccion: resultado.requiereAccion === true,
      }
    case "REVISION":
      return {
        resultado: "REQUIERE_ACCION",
        motivo: resultado.motivoRevision,
        externalId: captura.captureId,
        enlacePagoId: resultado.enlaceId,
        pagoId: resultado.pagoId,
        monto: resultado.monto,
        moneda: resultado.moneda,
        requiereAccion: true,
      }
    case "CONFLICTO":
      return {
        resultado: "REQUIERE_ACCION",
        motivo: resultado.motivo,
        externalId: captura.captureId,
        enlacePagoId: resultado.enlaceId,
        pagoId: resultado.pagoId,
        monto: captura.amountCents,
        moneda: captura.currency,
        requiereAccion: true,
      }
  }
}

function datosEventoDeError(
  captura: CapturaPaypalProcesable | null | undefined,
  error: PaypalProcessError,
  enlacePagoId: string | null = null
): DatosEventoProcesamiento {
  return {
    resultado: "ERROR",
    motivo: error.codigo,
    externalId: textoOpcional(captura?.captureId),
    // Se propaga cuando el error ocurre despues de resolver el link
    // (`ENLACE_INVALIDO`, `MESES_INVALIDOS`, `ERROR_INTERNO`) para diagnostico.
    enlacePagoId,
    pagoId: null,
    monto: captura?.amountCents ?? null,
    moneda: captura?.currency ?? null,
    requiereAccion: false,
  }
}

/**
 * Registra el resultado en `EventoPasarela` sin comprometer el resultado del
 * pago: si la trazabilidad falla (base caida, constraint inesperada), el cobro
 * ya confirmado no se revierte ni se convierte en error para el webhook.
 */
async function registrarEventoProcesamiento(
  db: PaypalProcessDb,
  evento: EventoResuelto | null,
  datos: DatosEventoProcesamiento,
  ahora: Date
): Promise<void> {
  if (!evento || !db.eventoPasarela) return

  try {
    await registrarEventoPasarela(
      {
        eventoId: evento.eventoId,
        pasarela: "PAYPAL",
        tipo: evento.tipo,
        ...datos,
        procesadoEn: ahora,
      },
      { db: { eventoPasarela: db.eventoPasarela }, ahora }
    )
  } catch {
    // La trazabilidad nunca cambia el resultado del cobro, pero el fallo no
    // debe quedar silencioso: se loguea solo con ids/estado tecnicos, sin PII,
    // payload ni errores internos de la base.
    logger.warn("No se pudo registrar el evento de pasarela PayPal", {
      eventoId: evento.eventoId,
      tipo: evento.tipo,
      pasarela: "PAYPAL",
      resultado: datos.resultado,
      motivo: datos.motivo,
      externalId: datos.externalId,
      enlacePagoId: datos.enlacePagoId,
      pagoId: datos.pagoId,
      monto: datos.monto,
      moneda: datos.moneda,
    })
  }
}

/**
 * Camino de soporte mensual (T-11). Comparte transaccion, idempotencia por
 * capture/order y snapshot con el camino de hito, pero:
 *
 * - valida `EnlacePago.meses` (1..12) antes de escribir;
 * - acredita meses una sola vez por capture, actualizando `Suscripcion` una
 *   sola vez (`ACTIVE`, `proximoPago`, `pastDueEn=null`, `canceladoEn=null`);
 * - no aplica la logica de hito (un soporte admite pagos sucesivos en meses
 *   distintos; un mismo capture/order no se acredita dos veces);
 * - en REVISION no acredita meses ni toca la suscripcion, pero consume el link
 *   e invalida los hermanos del grupo porque el capture ya ocurrio (misma
 *   decision que T-10).
 */
async function procesarSoporteEnTransaccion(
  tx: PaypalProcessTx,
  params: {
    enlace: EnlaceProcesable
    captura: CapturaValidada
    referencias: Prisma.PagoWhereInput[]
    ahora: Date
    /** Se invoca solo si el pago se aplica: duplicados y REVISION no emiten recibo. */
    generarRecibo: () => string
  }
): Promise<ResultadoProcesamientoPaypal> {
  const { enlace, captura, referencias, ahora, generarRecibo } = params
  const suscripcionId = enlace.suscripcionId

  if (!suscripcionId) {
    throw new PaypalProcessError({
      codigo: "ENLACE_INVALIDO",
      mensaje: "El link de pago no tiene un soporte asociado.",
    })
  }

  // Se valida antes de cualquier escritura: sin meses validos no hay pago, no
  // se acredita soporte y el link sigue disponible para corregirse.
  const meses = validarMesesSoporte(enlace.meses)

  // Idempotencia: mismo capture id u order id ya registrado. No se acredita
  // dos veces el soporte.
  const existente = await tx.pago.findFirst({
    where: { OR: referencias },
    select: {
      id: true,
      estadoPago: true,
      enlacePagoId: true,
      hitoId: true,
      externalId: true,
    },
  })
  if (existente) {
    return {
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: existente.id,
      enlaceId: existente.enlacePagoId ?? enlace.id,
      hitoId: null,
      suscripcionId,
      // Segundo capture de la misma orden: no acredita ni crea Pago, pero
      // requiere revision del admin.
      ...(existente.externalId !== captura.captureId
        ? { requiereAccion: true }
        : {}),
    }
  }

  if (enlace.estado === "INVALIDADO") {
    return {
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_INVALIDADO",
      enlaceId: enlace.id,
      hitoId: null,
      pagoId: null,
      suscripcionId,
    }
  }

  if (enlace.estado === "PAGADO") {
    return {
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_PAGADO",
      enlaceId: enlace.id,
      hitoId: null,
      pagoId: null,
      suscripcionId,
    }
  }

  const suscripcion = await tx.suscripcion.findUnique({
    where: { id: suscripcionId },
    select: { id: true, proximoPago: true },
  })
  if (!suscripcion) {
    throw new PaypalProcessError({
      codigo: "ENLACE_INVALIDO",
      mensaje: "El link de pago no tiene un soporte asociado.",
    })
  }

  const { montoCapturado, motivoRevision, revisionNota } = evaluarMonto(
    captura,
    enlace
  )

  const datosBase: Omit<Prisma.PagoUncheckedCreateInput, "estadoPago"> = {
    clienteId: enlace.clienteId,
    suscripcionId,
    hitoId: null,
    enlacePagoId: enlace.id,
    externalId: captura.captureId,
    paypalOrderId: captura.orderId ?? enlace.externalId ?? null,
    monto: montoCapturado,
    montoAcordado: enlace.montoAcordado,
    comision: enlace.comision,
    montoEsperado: enlace.total,
    meses,
    feeBps: enlace.feeBps,
    feeFixedCents: enlace.feeFixedCents,
    moneda: PAYPAL_MONEDA,
    metodo: "PAYPAL",
    pasarela: "PAYPAL",
    origen: "AUTOMATICO",
  }

  if (motivoRevision !== null) {
    // El capture ya ocurrio: el link se consume para impedir un segundo cobro
    // y se invalidan los hermanos del grupo (misma decision que T-10). La
    // Suscripcion no se toca: no se acreditan meses ni se actualiza
    // `proximoPago`/estado hasta resolver la revision.
    const pagoId = await registrarPagoEnRevision(tx, {
      enlace,
      ahora,
      datosBase,
      revisionNota,
    })

    return {
      tipo: "REVISION",
      duplicado: false,
      pagoId,
      enlaceId: enlace.id,
      hitoId: null,
      suscripcionId,
      meses,
      monto: montoCapturado,
      montoAcordado: enlace.montoAcordado,
      comision: enlace.comision,
      montoEsperado: enlace.total,
      moneda: PAYPAL_MONEDA,
      motivoRevision,
    }
  }

  // Recibo solo en el camino exitoso: si el generador falla, la transaccion se
  // revierte y no queda ni pago, ni meses acreditados, ni link consumido.
  const reciboId = generarRecibo()
  const pago = await tx.pago.create({
    data: {
      ...datosBase,
      estadoPago: "SUCCEEDED",
      reciboId,
      reciboEmitidoEn: ahora,
    },
  })

  // Una sola actualizacion por capture, con la misma regla que Mercado Pago:
  // si `proximoPago` es futuro se extiende desde esa fecha; si vencio (o no
  // existe), la base es `ahora` (`vencimientoConMeses`). El CAS evita
  // acreditar dos veces si dos pagos del mismo soporte llegan en paralelo.
  await acreditarSuscripcionUnaVez(tx, {
    suscripcionId,
    proximoPagoAnterior: suscripcion.proximoPago,
    proximoPagoNuevo: vencimientoConMeses(suscripcion.proximoPago, meses, ahora),
    enlaceId: enlace.id,
  })

  await marcarEnlaceComoPagado(tx, enlace)

  // Primer pago gana: con el pago ya aplicado y el soporte acreditado, se
  // invalidan los demas links ACTIVOS del grupo (PayPal y MP legacy). No se
  // toca la Suscripcion por los links descartados.
  await invalidarEnlacesHermanos(tx, { enlace, ahora })

  return {
    tipo: "PROCESADO",
    duplicado: false,
    pagoId: pago.id,
    enlaceId: enlace.id,
    hitoId: null,
    suscripcionId,
    meses,
    reciboId,
    monto: montoCapturado,
    montoAcordado: enlace.montoAcordado,
    comision: enlace.comision,
    moneda: PAYPAL_MONEDA,
  }
}

/**
 * Estado compartido entre la transaccion y el manejo de errores: una vez
 * resuelto el `EnlacePago`, los eventos de error posteriores
 * (`ENLACE_INVALIDO`, `MESES_INVALIDOS`, `ERROR_INTERNO`) incluyen su id para
 * diagnostico. Nunca contiene PII.
 */
interface ContextoProcesamiento {
  enlacePagoId: string | null
}

async function procesarEnTransaccion(
  tx: PaypalProcessTx,
  params: {
    captura: CapturaValidada
    condiciones: Prisma.EnlacePagoWhereInput[]
    referencias: Prisma.PagoWhereInput[]
    ahora: Date
    contexto: ContextoProcesamiento
    /** Se invoca solo si el pago se aplica: duplicados y REVISION no emiten recibo. */
    generarRecibo: () => string
  }
): Promise<ResultadoProcesamientoPaypal> {
  const { captura, condiciones, referencias, ahora, contexto, generarRecibo } =
    params

  const enlace = await tx.enlacePago.findFirst({
    where: { pasarela: "PAYPAL", OR: condiciones },
    include: { hito: { select: { id: true, estado: true } } },
  })

  if (!enlace) {
    throw new PaypalProcessError({
      codigo: "ENLACE_NO_ENCONTRADO",
      mensaje: "No se encontro el link de pago de PayPal.",
    })
  }

  contexto.enlacePagoId = enlace.id

  // Snapshot corrupto (montos invalidos o desglose que no reconcilia): no se
  // escribe ningun pago. El error es sanitizado y no expone los montos.
  validarSnapshotEnlace(enlace)

  if (enlace.suscripcionId) {
    return procesarSoporteEnTransaccion(tx, {
      enlace,
      captura,
      referencias,
      ahora,
      generarRecibo,
    })
  }

  const hitoId = enlace.hitoId
  const hito = enlace.hito

  if (!hitoId || !hito) {
    throw new PaypalProcessError({
      codigo: "ENLACE_INVALIDO",
      mensaje: "El link de pago no tiene un hito asociado.",
    })
  }

  // Idempotencia: mismo capture id u order id ya registrado.
  const existente = await tx.pago.findFirst({
    where: { OR: referencias },
    select: {
      id: true,
      estadoPago: true,
      enlacePagoId: true,
      hitoId: true,
      externalId: true,
    },
  })
  if (existente) return resultadoDuplicado(existente, enlace, captura)

  if (enlace.estado === "INVALIDADO") {
    return resultadoConflicto("ENLACE_INVALIDADO", enlace.id, hitoId)
  }

  if (hito.estado === "PAGADO") {
    return resultadoConflicto("HITO_PAGADO", enlace.id, hitoId)
  }

  // Primer pago exitoso gana: un segundo pago del mismo hito no se registra.
  const ganador = await tx.pago.findFirst({
    where: { hitoId, estadoPago: "SUCCEEDED" },
    select: {
      id: true,
      estadoPago: true,
      enlacePagoId: true,
      hitoId: true,
    },
  })
  if (ganador) {
    return resultadoConflicto("PAGO_GANADOR", enlace.id, hitoId, ganador.id)
  }

  if (enlace.estado === "PAGADO") {
    return resultadoConflicto("ENLACE_PAGADO", enlace.id, hitoId)
  }

  const { montoCapturado, motivoRevision, revisionNota } = evaluarMonto(
    captura,
    enlace
  )

  const datosBase: Omit<Prisma.PagoUncheckedCreateInput, "estadoPago"> = {
    clienteId: enlace.clienteId,
    hitoId,
    enlacePagoId: enlace.id,
    externalId: captura.captureId,
    paypalOrderId: captura.orderId ?? enlace.externalId ?? null,
    monto: montoCapturado,
    montoAcordado: enlace.montoAcordado,
    comision: enlace.comision,
    montoEsperado: enlace.total,
    meses: enlace.meses,
    feeBps: enlace.feeBps,
    feeFixedCents: enlace.feeFixedCents,
    moneda: PAYPAL_MONEDA,
    metodo: "PAYPAL",
    pasarela: "PAYPAL",
    origen: "AUTOMATICO",
  }

  if (motivoRevision !== null) {
    // El capture ya ocurrio: el link se consume para impedir un segundo cobro
    // y se invalidan los hermanos del grupo. La diferencia queda pendiente en
    // el Pago y el hito sigue PENDIENTE.
    const pagoId = await registrarPagoEnRevision(tx, {
      enlace,
      ahora,
      datosBase,
      revisionNota,
    })

    return {
      tipo: "REVISION",
      duplicado: false,
      pagoId,
      enlaceId: enlace.id,
      hitoId,
      monto: montoCapturado,
      montoAcordado: enlace.montoAcordado,
      comision: enlace.comision,
      montoEsperado: enlace.total,
      moneda: PAYPAL_MONEDA,
      motivoRevision,
    }
  }

  // Recibo solo en el camino exitoso: si el generador falla, la transaccion se
  // revierte y no queda ni pago ni link consumido.
  const reciboId = generarRecibo()
  const pago = await tx.pago.create({
    data: {
      ...datosBase,
      estadoPago: "SUCCEEDED",
      reciboId,
      reciboEmitidoEn: ahora,
    },
  })

  // Actualizacion condicional: si otra transaccion gano la carrera, el hito ya
  // no esta PENDIENTE y el pago de esta transaccion se revierte.
  const hitoActualizado = await tx.hito.updateMany({
    where: { id: hitoId, estado: "PENDIENTE" },
    data: { estado: "PAGADO", pagadoEn: ahora },
  })
  if (hitoActualizado.count !== 1) {
    throw new ConflictoProcesamiento("PAGO_GANADOR", enlace.id, hitoId)
  }

  await marcarEnlaceComoPagado(tx, enlace)

  // Primer pago gana: con el hito ya PAGADO y el Pago registrado, se invalidan
  // los demas links ACTIVOS del grupo (PayPal y MP legacy). No se toca el hito
  // ni la Suscripcion por los links descartados.
  await invalidarEnlacesHermanos(tx, { enlace, ahora })

  return {
    tipo: "PROCESADO",
    duplicado: false,
    pagoId: pago.id,
    enlaceId: enlace.id,
    hitoId,
    reciboId,
    monto: montoCapturado,
    montoAcordado: enlace.montoAcordado,
    comision: enlace.comision,
    moneda: PAYPAL_MONEDA,
  }
}

/**
 * Registra una captura COMPLETED de PayPal contra su `EnlacePago` e hito.
 *
 * Lanza `PaypalProcessError` con un codigo estable si la captura o el link no
 * son validos. Los conflictos y duplicados se devuelven como resultado (no son
 * errores): el webhook/retorno decide el HTTP y la trazabilidad.
 */
export async function procesarCapturaPaypal(
  captura: CapturaPaypalProcesable,
  opciones: ProcesarCapturaOpciones = {}
): Promise<ResultadoProcesamientoPaypal> {
  const ahora = resolverAhora(opciones.ahora)
  const db = (opciones.db ?? prisma) as unknown as PaypalProcessDb
  const evento = resolverEventoProcesamiento(captura, opciones)
  const contexto: ContextoProcesamiento = { enlacePagoId: null }

  let validada: CapturaValidada
  try {
    validada = validarCaptura(captura)
  } catch (error) {
    if (esPaypalProcessError(error)) {
      await registrarEventoProcesamiento(
        db,
        evento,
        datosEventoDeError(captura, error, contexto.enlacePagoId),
        ahora
      )
    }
    throw error
  }

  const condiciones = condicionesDeEnlace(validada)
  if (condiciones.length === 0) {
    const error = new PaypalProcessError({
      codigo: "ENLACE_NO_ENCONTRADO",
      mensaje: "No se encontro el link de pago de PayPal.",
    })
    await registrarEventoProcesamiento(
      db,
      evento,
      datosEventoDeError(captura, error, contexto.enlacePagoId),
      ahora
    )
    throw error
  }

  const referencias = referenciasDePago(validada)

  for (let intento = 1; intento <= MAX_INTENTOS_RECIBO; intento += 1) {
    try {
      const resultado = await db.$transaction((tx) =>
        procesarEnTransaccion(tx, {
          captura: validada,
          condiciones,
          referencias,
          ahora,
          contexto,
          // El id se genera dentro de la transaccion y solo si el pago aplica.
          generarRecibo: () => resolverReciboId(opciones, ahora),
        })
      )

      await registrarEventoProcesamiento(
        db,
        evento,
        datosEventoDesdeResultado(resultado, validada),
        ahora
      )
      return resultado
    } catch (error) {
      if (esColisionDeRecibo(error)) {
        if (intento < MAX_INTENTOS_RECIBO) {
          // Colision del `reciboId`: se reintenta una vez con un id nuevo.
          continue
        }
        const fallo = new PaypalProcessError({
          codigo: "ERROR_INTERNO",
          mensaje: "No se pudo generar un identificador de recibo unico.",
        })
        await registrarEventoProcesamiento(
          db,
          evento,
          datosEventoDeError(captura, fallo, contexto.enlacePagoId),
          ahora
        )
        throw fallo
      }

      if (error instanceof ConflictoProcesamiento) {
        const resultado = resultadoConflicto(
          error.motivo,
          error.enlaceId,
          error.hitoId
        )
        await registrarEventoProcesamiento(
          db,
          evento,
          datosEventoDesdeResultado(resultado, validada),
          ahora
        )
        return resultado
      }

      if (esErrorUnico(error)) {
        // Carrera: otra notificacion gano entre el chequeo y el insert. Se busca
        // el pago ya persistido por las mismas referencias y se devuelve duplicado.
        try {
          const existente = await db.pago.findFirst({
            where: { OR: referencias },
            select: {
              id: true,
              estadoPago: true,
              enlacePagoId: true,
              hitoId: true,
              externalId: true,
            },
          })
          if (existente) {
            const resultado = resultadoDuplicado(
              existente,
              undefined,
              validada
            )
            await registrarEventoProcesamiento(
              db,
              evento,
              datosEventoDesdeResultado(resultado, validada),
              ahora
            )
            return resultado
          }
        } catch {
          // Se traduce abajo a un error interno sanitizado.
        }

        const fallo = new PaypalProcessError({
          codigo: "ERROR_INTERNO",
          mensaje: "No se pudo registrar el pago de PayPal.",
        })
        await registrarEventoProcesamiento(
          db,
          evento,
          datosEventoDeError(captura, fallo, contexto.enlacePagoId),
          ahora
        )
        throw fallo
      }

      if (esPaypalProcessError(error)) {
        await registrarEventoProcesamiento(
          db,
          evento,
          datosEventoDeError(captura, error, contexto.enlacePagoId),
          ahora
        )
        throw error
      }

      const fallo = new PaypalProcessError({
        codigo: "ERROR_INTERNO",
        mensaje: "No se pudo procesar el pago de PayPal.",
      })
      await registrarEventoProcesamiento(
        db,
        evento,
        datosEventoDeError(captura, fallo, contexto.enlacePagoId),
        ahora
      )
      throw fallo
    }
  }

  const fallo = new PaypalProcessError({
    codigo: "ERROR_INTERNO",
    mensaje: "No se pudo procesar el pago de PayPal.",
  })
  await registrarEventoProcesamiento(
    db,
    evento,
    datosEventoDeError(captura, fallo, contexto.enlacePagoId),
    ahora
  )
  throw fallo
}
