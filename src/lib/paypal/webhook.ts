/**
 * Parseo y dispatch de webhooks de PayPal (T-29/T-30).
 *
 * - Solo se extraen campos tecnicos del evento: ids de evento/orden/captura,
 *   tipo, estado, monto y moneda. Nunca se guarda el payload crudo ni datos del
 *   pagador (email, nombre, direccion, telefono, PII en general).
 * - `EventoPasarela.eventoId` (id real de PayPal) es la base de idempotencia:
 *   un evento ya resuelto responde `duplicado` sin volver a ejecutar el
 *   dispatch. Un evento con resultado `ERROR` se puede reintentar (PayPal
 *   reintenta hasta recibir 200).
 * - `CHECKOUT.ORDER.APPROVED` resuelve el link por order id y captura la orden
 *   si todavia no tiene captura. `CHECKOUT.ORDER.COMPLETED` solo traza.
 *   `PAYMENT.CAPTURE.COMPLETED` delega en `procesarCapturaPaypal`, que ya es
 *   idempotente por capture id/order id. `PAYMENT.CAPTURE.DENIED` expira la
 *   orden del link para forzar una nueva y traza el intento, sin tocar el
 *   cobro. Reembolsos, reversiones y disputas solo marcan `requiereAccion`
 *   (ninguna reversion automatica). Los eventos desconocidos son `IGNORADO`.
 * - Sin acceso directo a red salvo las llamadas inyectables a PayPal (get y
 *   capture de la orden); timeout de `PAYPAL_WEBHOOK_TIMEOUT_MS` por llamada.
 * - El registro de firma invalida usa un id tecnico sintetico (hash del
 *   transmission id/event id), de modo que un intento no verificado nunca
 *   bloquea el evento real por la constraint unica `eventoId`.
 */

import { createHash } from "node:crypto"
import type { EstadoEnlace, Pasarela, Prisma } from "@prisma/client"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import {
  PAYPAL_WEBHOOK_TIMEOUT_MS,
  captureOrder,
  getOrder,
  parsePaypalCapture,
  parsearMontoPaypal,
  primeraCaptura,
  type PaypalOrder,
  type PaypalTransmissionHeaders,
} from "./client"
import {
  registrarEventoPasarela,
  type EventoPasarelaClient,
  type EventoPasarelaRegistrado,
  type RegistrarEventoPasarelaInput,
  type ResultadoEventoPasarela,
} from "./events"
import {
  procesarCapturaPaypal,
  type CapturaPaypalProcesable,
  type ResultadoProcesamientoPaypal,
} from "./process"

/** Tipos de evento que maneja el CRM (plan.md §4.4). */
export const EVENTO_ORDER_APPROVED = "CHECKOUT.ORDER.APPROVED"
export const EVENTO_ORDER_COMPLETED = "CHECKOUT.ORDER.COMPLETED"
export const EVENTO_CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED"
export const EVENTO_CAPTURE_DENIED = "PAYMENT.CAPTURE.DENIED"
export const EVENTO_CAPTURE_REFUNDED = "PAYMENT.CAPTURE.REFUNDED"
export const EVENTO_CAPTURE_REVERSED = "PAYMENT.CAPTURE.REVERSED"
export const EVENTO_DISPUTE_CREATED = "CUSTOMER.DISPUTE.CREATED"

const MOTIVO_ORDEN_CAPTURADA = "ORDEN_CAPTURADA"
const MOTIVO_ORDEN_YA_CAPTURADA = "ORDEN_YA_CAPTURADA"
const MOTIVO_ORDEN_COMPLETADA = "ORDEN_COMPLETADA"
const MOTIVO_SIN_CAPTURA = "SIN_CAPTURA"
const MOTIVO_ENLACE_NO_ENCONTRADO = "ENLACE_NO_ENCONTRADO"
const MOTIVO_ENLACE_NO_ACTIVO = "ENLACE_NO_ACTIVO"
const MOTIVO_CAPTURA_RECHAZADA = "CAPTURA_RECHAZADA"
const MOTIVO_CAPTURA_NO_COMPLETADA = "CAPTURA_NO_COMPLETADA"
const MOTIVO_REEMBOLSO = "REEMBOLSO"
const MOTIVO_CONTRACARGO = "CONTRACARGO"
const MOTIVO_DISPUTA = "DISPUTA"
const MOTIVO_FIRMA_INVALIDA = "FIRMA_INVALIDA"
const MOTIVO_HEADERS_INCOMPLETOS = "HEADERS_INCOMPLETOS"
const MOTIVO_CUERPO_INVALIDO = "CUERPO_INVALIDO"
const MOTIVO_EVENTO_INVALIDO = "EVENTO_INVALIDO"

const ID_EVENTO_MAX = 256
const TIPO_MAX = 120
const REFERENCIA_MAX = 128
const ESTADO_MAX = 40

/** Estados terminales del link que no admiten una nueva captura. */
const ESTADOS_SIN_CAPTURA = new Set<EstadoEnlace>([
  "CREANDO",
  "PAGADO",
  "VENCIDO",
  "INVALIDADO",
  "FALLIDO",
])

export type MotivoFirmaInvalida =
  | "FIRMA_INVALIDA"
  | "HEADERS_INCOMPLETOS"
  | "CUERPO_INVALIDO"
  | "EVENTO_INVALIDO"

/** Vista segura del evento: sin payload, sin PII y sin datos de tarjeta. */
export interface EventoPaypalSeguro {
  /** `id` real del evento PayPal. Base de la idempotencia. */
  id: string
  /** `event_type` de PayPal. */
  tipo: string
  /** Id del recurso principal (capture, order o dispute). */
  resourceId: string | null
  orderId: string | null
  captureId: string | null
  amountCents: number | null
  currency: string | null
  status: string | null
  /** Referencia interna de la orden (`custom_id`). Es el token del link. */
  customId: string | null
  /** Referencia interna de la orden (`invoice_id`). Es el token del link. */
  invoiceId: string | null
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function texto(
  valor: unknown,
  maximo: number,
  patron?: RegExp
): string | null {
  if (typeof valor !== "string") return null

  const limpio = valor.trim()
  if (limpio.length === 0 || limpio.length > maximo) return null
  if (/[\u0000-\u001f\u007f]/.test(limpio)) return null
  if (patron && !patron.test(limpio)) return null

  return limpio
}

function moneda(valor: unknown): string | null {
  const codigo = texto(valor, 3, /^[A-Za-z]{3}$/)
  return codigo ? codigo.toUpperCase() : null
}

function monto(valor: unknown): number | null {
  if (!esRegistro(valor)) return null
  return parsearMontoPaypal(valor.value)
}

function referenciasOrden(
  unidad: Record<string, unknown> | null
): { customId: string | null; invoiceId: string | null } {
  return {
    customId: unidad ? texto(unidad.custom_id, REFERENCIA_MAX) : null,
    invoiceId: unidad ? texto(unidad.invoice_id, REFERENCIA_MAX) : null,
  }
}

/**
 * Convierte el body de PayPal en una vista segura. Devuelve `null` si no es un
 * evento identificable (sin `id`/`event_type` validos). Nunca copia el objeto
 * original ni detalles del pagador.
 */
export function parsearEventoPaypal(payload: unknown): EventoPaypalSeguro | null {
  if (!esRegistro(payload)) return null

  const id = texto(payload.id, ID_EVENTO_MAX)
  const tipo = texto(payload.event_type, TIPO_MAX, /^[A-Za-z][A-Za-z0-9._-]*$/)
  if (!id || !tipo) return null

  const resource = esRegistro(payload.resource) ? payload.resource : null
  const base: EventoPaypalSeguro = {
    id,
    tipo,
    resourceId: resource ? texto(resource.id, REFERENCIA_MAX) : null,
    orderId: null,
    captureId: null,
    amountCents: null,
    currency: null,
    status: null,
    customId: null,
    invoiceId: null,
  }

  if (!resource) return base

  if (tipo.startsWith("PAYMENT.CAPTURE.")) {
    const captura = parsePaypalCapture(resource)
    if (captura) {
      return {
        ...base,
        captureId: captura.id,
        orderId: captura.orderId,
        amountCents: captura.amountCents,
        currency: captura.currencyCode,
        status: captura.status.length > 0 ? captura.status : null,
        customId: captura.customId,
        invoiceId: captura.invoiceId,
      }
    }

    // Captura sin el formato esperado: se conserva solo el id y el monto.
    const amountCrudo = esRegistro(resource.amount) ? resource.amount : null
    return {
      ...base,
      captureId: base.resourceId,
      orderId: null,
      amountCents: amountCrudo ? monto(amountCrudo) : null,
      currency: amountCrudo ? moneda(amountCrudo.currency_code) : null,
      status: texto(resource.status, ESTADO_MAX),
      customId: texto(resource.custom_id, REFERENCIA_MAX),
      invoiceId: texto(resource.invoice_id, REFERENCIA_MAX),
    }
  }

  if (tipo.startsWith("CHECKOUT.ORDER.")) {
    const unidades = Array.isArray(resource.purchase_units)
      ? resource.purchase_units
      : []
    const primera = esRegistro(unidades[0]) ? unidades[0] : null
    const amount = primera && esRegistro(primera.amount) ? primera.amount : null
    const refs = referenciasOrden(primera)

    let captureId: string | null = null
    if (primera && esRegistro(primera.payments) && Array.isArray(primera.payments.captures)) {
      const primeraCapturaCruda = primera.payments.captures[0]
      if (esRegistro(primeraCapturaCruda)) {
        captureId = texto(primeraCapturaCruda.id, REFERENCIA_MAX)
      }
    }

    return {
      ...base,
      orderId: base.resourceId,
      captureId,
      amountCents: amount ? monto(amount) : null,
      currency: amount ? moneda(amount.currency_code) : null,
      status: texto(resource.status, ESTADO_MAX),
      customId: refs.customId,
      invoiceId: refs.invoiceId,
    }
  }

  if (tipo === EVENTO_DISPUTE_CREATED) {
    const transacciones = Array.isArray(resource.disputed_transactions)
      ? resource.disputed_transactions
      : []
    const primera = esRegistro(transacciones[0]) ? transacciones[0] : null

    return {
      ...base,
      captureId: primera
        ? texto(primera.seller_transaction_id, REFERENCIA_MAX)
        : null,
      status: texto(resource.status, ESTADO_MAX),
    }
  }

  return base
}

/** Fila de `EnlacePago` que necesita el dispatch (sin PII). */
export interface EnlaceWebhook {
  id: string
  token: string
  pasarela: Pasarela
  montoAcordado: number
  total: number
  moneda: string
  externalId: string | null
  estado: EstadoEnlace
}

const SELECT_ENLACE = {
  id: true,
  token: true,
  pasarela: true,
  montoAcordado: true,
  total: true,
  moneda: true,
  externalId: true,
  estado: true,
} satisfies Prisma.EnlacePagoSelect

/** Cliente Prisma minimo para el webhook; inyectable en tests. */
export interface PaypalWebhookDb {
  eventoPasarela?: EventoPasarelaClient
  enlacePago: {
    findUnique(args: Prisma.EnlacePagoFindUniqueArgs): Promise<EnlaceWebhook | null>
    update(args: Prisma.EnlacePagoUpdateArgs): Promise<unknown>
  }
  pago: {
    findUnique(
      args: Prisma.PagoFindUniqueArgs
    ): Promise<{ id: string; enlacePagoId: string | null } | null>
  }
}

export interface PaypalWebhookDeps {
  db?: PaypalWebhookDb
  ahora?: Date
  /** Lectura de la orden (inyectable; default cliente real con timeout de 4 s). */
  getOrder?: (
    orderId: string,
    options?: { timeoutMs?: number }
  ) => Promise<PaypalOrder>
  /** Captura de la orden (inyectable; default cliente real con timeout de 4 s). */
  captureOrder?: (
    orderId: string,
    options?: { timeoutMs?: number }
  ) => Promise<PaypalOrder>
  /** Procesador de capturas (inyectable; default `procesarCapturaPaypal`). */
  procesarCaptura?: typeof procesarCapturaPaypal
  /** Registro de `EventoPasarela` (inyectable; default real). */
  registrarEvento?: typeof registrarEventoPasarela
}

export type EstadoWebhookPaypal =
  | "PROCESADO"
  | "DUPLICADO"
  | "IGNORADO"
  | "REQUIERE_ACCION"

export interface ResultadoWebhookPaypal {
  estado: EstadoWebhookPaypal
  eventoId: string
  tipo: string
  duplicate: boolean
  ignored: boolean
  enlacePagoId: string | null
  pagoId: string | null
}

function resultado(
  estado: EstadoWebhookPaypal,
  evento: EventoPaypalSeguro,
  extra: {
    duplicate?: boolean
    enlacePagoId?: string | null
    pagoId?: string | null
  } = {}
): ResultadoWebhookPaypal {
  return {
    estado,
    eventoId: evento.id,
    tipo: evento.tipo,
    duplicate: extra.duplicate === true,
    ignored: estado === "IGNORADO",
    enlacePagoId: extra.enlacePagoId ?? null,
    pagoId: extra.pagoId ?? null,
  }
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    return new Date()
  }
  return new Date(valor.getTime())
}

function resolverDb(deps: PaypalWebhookDeps): PaypalWebhookDb {
  return (deps.db ?? prisma) as unknown as PaypalWebhookDb
}

function opcionesPaypal(): { timeoutMs: number } {
  return { timeoutMs: PAYPAL_WEBHOOK_TIMEOUT_MS }
}

async function registrarEvento(
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  data: Omit<RegistrarEventoPasarelaInput, "pasarela">,
  ahora: Date
): Promise<void> {
  const registrar = deps.registrarEvento ?? registrarEventoPasarela
  await registrar(
    { ...data, pasarela: "PAYPAL" },
    {
      ...(db.eventoPasarela ? { db: { eventoPasarela: db.eventoPasarela } } : {}),
      ahora,
    }
  )
}

async function buscarPorOrden(
  db: PaypalWebhookDb,
  orderId: string
): Promise<EnlaceWebhook | null> {
  const enlace = await db.enlacePago.findUnique({
    where: { externalId: orderId },
    select: SELECT_ENLACE,
  })
  return enlace && enlace.pasarela === "PAYPAL" ? enlace : null
}

async function buscarPorToken(
  db: PaypalWebhookDb,
  token: string
): Promise<EnlaceWebhook | null> {
  const enlace = await db.enlacePago.findUnique({
    where: { token },
    select: SELECT_ENLACE,
  })
  return enlace && enlace.pasarela === "PAYPAL" ? enlace : null
}

interface EnlaceResuelto {
  enlace: EnlaceWebhook
  orderId: string | null
}

/**
 * Resuelve el link de un capture por `supplementary_data.related_ids.order_id`
 * y, si falta, por `custom_id`/`invoice_id` (token del link). Si aun no hay
 * link y existe el order id, consulta la orden en PayPal para obtener sus
 * referencias. No confia en datos del body mas alla de ids/referencias.
 */
async function resolverEnlaceCaptura(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb
): Promise<EnlaceResuelto | null> {
  if (evento.orderId) {
    const porOrden = await buscarPorOrden(db, evento.orderId)
    if (porOrden) return { enlace: porOrden, orderId: evento.orderId }
  }

  const token = evento.customId ?? evento.invoiceId
  if (token) {
    const porToken = await buscarPorToken(db, token)
    if (porToken) {
      return { enlace: porToken, orderId: evento.orderId ?? porToken.externalId }
    }
  }

  if (!evento.orderId) return null

  const obtener = deps.getOrder ?? getOrder
  let orden: PaypalOrder
  try {
    orden = await obtener(evento.orderId, opcionesPaypal())
  } catch (error) {
    logger.warn("No se pudo consultar la orden PayPal del capture", {
      orderId: evento.orderId,
      codigo: error instanceof Error ? error.name : "DESCONOCIDO",
    })
    throw error
  }

  const referencia = orden.customId ?? orden.invoiceId
  if (!referencia) return null

  const porToken = await buscarPorToken(db, referencia)
  if (!porToken) return null

  return {
    enlace: porToken,
    orderId: evento.orderId ?? porToken.externalId,
  }
}

async function procesarCapturaCompletada(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date
): Promise<ResultadoWebhookPaypal> {
  if (evento.status && evento.status.toUpperCase() !== "COMPLETED") {
    await registrarEvento(
      deps,
      db,
      {
        eventoId: evento.id,
        tipo: evento.tipo,
        externalId: evento.captureId,
        resultado: "IGNORADO",
        motivo: MOTIVO_CAPTURA_NO_COMPLETADA,
        monto: evento.amountCents,
        moneda: evento.currency,
        requiereAccion: false,
        procesadoEn: ahora,
      },
      ahora
    )
    return resultado("IGNORADO", evento)
  }

  const resolucion = await resolverEnlaceCaptura(evento, deps, db)
  if (!resolucion) {
    await registrarEvento(
      deps,
      db,
      {
        eventoId: evento.id,
        tipo: evento.tipo,
        externalId: evento.captureId,
        resultado: "IGNORADO",
        motivo: MOTIVO_ENLACE_NO_ENCONTRADO,
        monto: evento.amountCents,
        moneda: evento.currency,
        requiereAccion: false,
        procesadoEn: ahora,
      },
      ahora
    )
    return resultado("IGNORADO", evento)
  }

  const captura: CapturaPaypalProcesable = {
    captureId: evento.captureId ?? "",
    orderId: resolucion.orderId,
    amountCents: evento.amountCents,
    currency: evento.currency,
    status: "COMPLETED",
    customId: evento.customId,
    invoiceId: evento.invoiceId,
  }

  // El procesador registra el `EventoPasarela` con el id real del webhook; no
  // se duplica el registro aca. Si falla, registra ERROR y el webhook responde
  // 500 para que PayPal reintente.
  const procesar = deps.procesarCaptura ?? procesarCapturaPaypal
  const procesado = await procesar(captura, {
    ahora,
    evento: { eventoId: evento.id, tipo: evento.tipo },
  })

  return resultadoDesdeProcesamiento(procesado, evento)
}

function resultadoDesdeProcesamiento(
  procesado: ResultadoProcesamientoPaypal,
  evento: EventoPaypalSeguro
): ResultadoWebhookPaypal {
  switch (procesado.tipo) {
    case "PROCESADO":
      return resultado("PROCESADO", evento, {
        enlacePagoId: procesado.enlaceId,
        pagoId: procesado.pagoId,
      })
    case "DUPLICADO":
      return resultado(
        procesado.requiereAccion ? "REQUIERE_ACCION" : "DUPLICADO",
        evento,
        {
          duplicate: true,
          enlacePagoId: procesado.enlaceId,
          pagoId: procesado.pagoId,
        }
      )
    case "REVISION":
      return resultado("REQUIERE_ACCION", evento, {
        enlacePagoId: procesado.enlaceId,
        pagoId: procesado.pagoId,
      })
    case "CONFLICTO":
      return resultado("REQUIERE_ACCION", evento, {
        enlacePagoId: procesado.enlaceId,
        pagoId: procesado.pagoId,
      })
  }
}

async function procesarOrdenAprobada(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date
): Promise<ResultadoWebhookPaypal> {
  const orderId = evento.orderId
  if (!orderId) {
    await registrarEvento(
      deps,
      db,
      {
        eventoId: evento.id,
        tipo: evento.tipo,
        resultado: "IGNORADO",
        motivo: MOTIVO_ENLACE_NO_ENCONTRADO,
        requiereAccion: false,
        procesadoEn: ahora,
      },
      ahora
    )
    return resultado("IGNORADO", evento)
  }

  const enlace = await buscarPorOrden(db, orderId)
  if (!enlace) {
    await registrarEvento(
      deps,
      db,
      {
        eventoId: evento.id,
        tipo: evento.tipo,
        externalId: orderId,
        resultado: "IGNORADO",
        motivo: MOTIVO_ENLACE_NO_ENCONTRADO,
        procesadoEn: ahora,
      },
      ahora
    )
    return resultado("IGNORADO", evento)
  }

  if (ESTADOS_SIN_CAPTURA.has(enlace.estado)) {
    await registrarEvento(
      deps,
      db,
      {
        eventoId: evento.id,
        tipo: evento.tipo,
        externalId: orderId,
        enlacePagoId: enlace.id,
        resultado: "IGNORADO",
        motivo: `${MOTIVO_ENLACE_NO_ACTIVO}:${enlace.estado}`,
        monto: enlace.total,
        moneda: enlace.moneda,
        requiereAccion: false,
        procesadoEn: ahora,
      },
      ahora
    )
    return resultado("IGNORADO", evento, { enlacePagoId: enlace.id })
  }

  const obtener = deps.getOrder ?? getOrder
  const capturar = deps.captureOrder ?? captureOrder

  let orden: PaypalOrder
  try {
    orden = await obtener(orderId, opcionesPaypal())
  } catch (error) {
    logger.warn("No se pudo consultar la orden aprobada de PayPal", {
      orderId,
      enlacePagoId: enlace.id,
      codigo: error instanceof Error ? error.name : "DESCONOCIDO",
    })
    throw error
  }

  let captura = primeraCaptura(orden)
  let capturada = false

  if (!captura) {
    try {
      const ordenCapturada = await capturar(orderId, opcionesPaypal())
      captura = primeraCaptura(ordenCapturada)
      capturada = captura !== null
    } catch (error) {
      // Otro webhook/retorno pudo capturar entre la lectura y la captura. Se
      // relee la orden: si ya tiene captura, el intento se traza sin duplicar.
      const httpStatus = (error as { httpStatus?: unknown }).httpStatus
      if (httpStatus !== 422) throw error

      const releida = await obtener(orderId, opcionesPaypal())
      captura = primeraCaptura(releida)
    }
  }

  const resultadoEvento: ResultadoEventoPasarela = captura
    ? capturada
      ? "PROCESADO"
      : "IGNORADO"
    : "IGNORADO"

  await registrarEvento(
    deps,
    db,
    {
      eventoId: evento.id,
      tipo: evento.tipo,
      externalId: orderId,
      enlacePagoId: enlace.id,
      resultado: resultadoEvento,
      motivo: captura
        ? capturada
          ? MOTIVO_ORDEN_CAPTURADA
          : MOTIVO_ORDEN_YA_CAPTURADA
        : MOTIVO_SIN_CAPTURA,
      monto: captura?.amountCents ?? null,
      moneda: captura?.currencyCode ?? null,
      requiereAccion: false,
      procesadoEn: ahora,
    },
    ahora
  )

  return resultado(resultadoEvento === "PROCESADO" ? "PROCESADO" : "IGNORADO", evento, {
    enlacePagoId: enlace.id,
  })
}

async function procesarOrdenCompletada(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date
): Promise<ResultadoWebhookPaypal> {
  const orderId = evento.orderId
  const enlace = orderId ? await buscarPorOrden(db, orderId) : null

  await registrarEvento(
    deps,
    db,
    {
      eventoId: evento.id,
      tipo: evento.tipo,
      externalId: orderId,
      enlacePagoId: enlace?.id ?? null,
      resultado: "IGNORADO",
      motivo: MOTIVO_ORDEN_COMPLETADA,
      monto: evento.amountCents,
      moneda: evento.currency,
      requiereAccion: false,
      procesadoEn: ahora,
    },
    ahora
  )

  return resultado("IGNORADO", evento, { enlacePagoId: enlace?.id ?? null })
}

async function procesarCapturaRechazada(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date
): Promise<ResultadoWebhookPaypal> {
  const orderId = evento.orderId
  const enlace = orderId ? await buscarPorOrden(db, orderId) : null

  // Solo se expira la orden actual del link. Si el link ya fue pagado o
  // invalidado no se toca nada; si el order id es de una orden vieja (el link
  // ya renovo), tampoco se expira la orden nueva.
  if (enlace && enlace.estado === "ACTIVO") {
    await db.enlacePago.update({
      where: { id: enlace.id },
      data: { orderExpiraEn: ahora, checkoutUrl: null },
    })
  }

  await registrarEvento(
    deps,
    db,
    {
      eventoId: evento.id,
      tipo: evento.tipo,
      externalId: evento.captureId ?? orderId,
      enlacePagoId: enlace?.id ?? null,
      resultado: "IGNORADO",
      motivo: MOTIVO_CAPTURA_RECHAZADA,
      monto: evento.amountCents,
      moneda: evento.currency,
      requiereAccion: false,
      procesadoEn: ahora,
    },
    ahora
  )

  return resultado("IGNORADO", evento, { enlacePagoId: enlace?.id ?? null })
}

async function buscarPagoDeCaptura(
  db: PaypalWebhookDb,
  captureId: string | null
): Promise<{ id: string; enlacePagoId: string | null } | null> {
  if (!captureId) return null
  return db.pago.findUnique({
    where: { externalId: captureId },
    select: { id: true, enlacePagoId: true },
  })
}

async function procesarRequiereAccion(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date,
  motivo: string
): Promise<ResultadoWebhookPaypal> {
  const pago = await buscarPagoDeCaptura(db, evento.captureId)

  await registrarEvento(
    deps,
    db,
    {
      eventoId: evento.id,
      tipo: evento.tipo,
      externalId: evento.captureId ?? evento.resourceId,
      enlacePagoId: pago?.enlacePagoId ?? null,
      pagoId: pago?.id ?? null,
      resultado: "REQUIERE_ACCION",
      motivo,
      monto: evento.amountCents,
      moneda: evento.currency,
      requiereAccion: true,
      procesadoEn: ahora,
    },
    ahora
  )

  return resultado("REQUIERE_ACCION", evento, {
    enlacePagoId: pago?.enlacePagoId ?? null,
    pagoId: pago?.id ?? null,
  })
}

async function procesarEventoDesconocido(
  evento: EventoPaypalSeguro,
  deps: PaypalWebhookDeps,
  db: PaypalWebhookDb,
  ahora: Date
): Promise<ResultadoWebhookPaypal> {
  await registrarEvento(
    deps,
    db,
    {
      eventoId: evento.id,
      tipo: evento.tipo,
      resultado: "IGNORADO",
      requiereAccion: false,
      procesadoEn: ahora,
    },
    ahora
  )

  return resultado("IGNORADO", evento)
}

function resultadoExistente(
  evento: EventoPaypalSeguro,
  existente: EventoPasarelaRegistrado
): ResultadoWebhookPaypal {
  const estado: EstadoWebhookPaypal =
    existente.resultado === "PROCESADO"
      ? "PROCESADO"
      : existente.resultado === "REQUIERE_ACCION"
        ? "REQUIERE_ACCION"
        : existente.resultado === "IGNORADO"
          ? "IGNORADO"
          : "DUPLICADO"

  return resultado(estado, evento, {
    duplicate: true,
    enlacePagoId: existente.enlacePagoId,
    pagoId: existente.pagoId,
  })
}

/**
 * Procesa un evento ya verificado. Devuelve siempre un resultado de dominio;
 * lanza solo ante errores que ameritan reintento (500) o ante un link que no
 * se pudo resolver de forma recuperable.
 */
export async function procesarEventoPaypal(
  payload: unknown,
  deps: PaypalWebhookDeps = {}
): Promise<ResultadoWebhookPaypal> {
  const evento = parsearEventoPaypal(payload)
  if (!evento) {
    return {
      estado: "IGNORADO",
      eventoId: "",
      tipo: "",
      duplicate: false,
      ignored: true,
      enlacePagoId: null,
      pagoId: null,
    }
  }

  const ahora = resolverAhora(deps.ahora)
  const db = resolverDb(deps)

  if (db.eventoPasarela) {
    const existente = await db.eventoPasarela.findUnique({
      where: { eventoId: evento.id },
    })
    // Un ERROR no bloquea el reintento de PayPal: el evento se vuelve a
    // intentar y, si sale bien, el pago queda registrado igual.
    if (existente && existente.resultado !== "ERROR") {
      return resultadoExistente(evento, existente)
    }
  }

  switch (evento.tipo) {
    case EVENTO_ORDER_APPROVED:
      return procesarOrdenAprobada(evento, deps, db, ahora)
    case EVENTO_ORDER_COMPLETED:
      return procesarOrdenCompletada(evento, deps, db, ahora)
    case EVENTO_CAPTURE_COMPLETED:
      return procesarCapturaCompletada(evento, deps, db, ahora)
    case EVENTO_CAPTURE_DENIED:
      return procesarCapturaRechazada(evento, deps, db, ahora)
    case EVENTO_CAPTURE_REFUNDED:
      return procesarRequiereAccion(
        evento,
        deps,
        db,
        ahora,
        MOTIVO_REEMBOLSO
      )
    case EVENTO_CAPTURE_REVERSED:
      return procesarRequiereAccion(
        evento,
        deps,
        db,
        ahora,
        MOTIVO_CONTRACARGO
      )
    case EVENTO_DISPUTE_CREATED:
      return procesarRequiereAccion(evento, deps, db, ahora, MOTIVO_DISPUTA)
    default:
      return procesarEventoDesconocido(evento, deps, db, ahora)
  }
}

function motivoFirma(motivo: MotivoFirmaInvalida): string {
  switch (motivo) {
    case "HEADERS_INCOMPLETOS":
      return MOTIVO_HEADERS_INCOMPLETOS
    case "CUERPO_INVALIDO":
      return MOTIVO_CUERPO_INVALIDO
    case "EVENTO_INVALIDO":
      return MOTIVO_EVENTO_INVALIDO
    case "FIRMA_INVALIDA":
      return MOTIVO_FIRMA_INVALIDA
  }
}

function hashTecnico(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex").slice(0, 24)
}

/**
 * Registra un intento no verificado sin PII y sin bloquear el evento real.
 * El id es sintetico (hash del transmission id/event id) y nunca usa el id del
 * body como `eventoId` para que una firma invalida no consuma la idempotencia
 * de un evento legitimo.
 */
export async function registrarFirmaInvalida(input: {
  headers: PaypalTransmissionHeaders | null
  evento: unknown
  motivo: MotivoFirmaInvalida
  db?: PaypalWebhookDb
  ahora?: Date
}): Promise<void> {
  const parsed = parsearEventoPaypal(input.evento)
  const base = input.headers?.transmissionId ?? parsed?.id ?? "SIN_HEADERS"
  const eventoId = `PAYPAL:FIRMA_INVALIDA:${hashTecnico(base)}`
  const ahora = resolverAhora(input.ahora)
  const db = (input.db ?? prisma) as unknown as PaypalWebhookDb

  try {
    await registrarEvento(
      { db, ahora },
      db,
      {
        eventoId,
        tipo: parsed?.tipo ?? "PAYPAL.FIRMA_INVALIDA",
        resultado: "FIRMA_INVALIDA",
        motivo: motivoFirma(input.motivo),
        requiereAccion: false,
        procesadoEn: ahora,
      },
      ahora
    )
  } catch {
    logger.warn("No se pudo registrar el intento de webhook PayPal no verificado", {
      motivo: input.motivo,
    })
  }
}
