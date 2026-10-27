/**
 * Helpers puros de historial para pagos PayPal, Mercado Pago y manuales (T-19).
 *
 * Objetivo: que `/admin/pagos` (T-23) y el detalle del cliente (T-24) compartan
 * una unica forma de leer la fila de `Pago`: concepto, referencias, desglose,
 * envio, autor, estado visible y elegibilidad del recibo interno.
 *
 * Reglas:
 * - Sin base de datos, sin red y sin React: solo transformaciones de datos.
 * - Tolerante a `null`/`undefined` y a datos historicos incompletos (por
 *   ejemplo, pagos previos al backfill sin `montoAcordado`/`montoEsperado`).
 * - `formatearMonto` es la unica fuente de formato: es-AR por defecto
 *   (`US$100,50`, `$1.000 ARS`). La excepcion en-US queda para T-05, no aqui.
 * - **No expone PII del pagador ni del cliente.** El tipo de entrada ni
 *   siquiera declara `cliente`, `pagadorEmail`, `pagadorNombre` o `payer`:
 *   cualquier campo extra que reciba el caller se ignora. El unico nombre
 *   visible es el del staff que genero el link (`generadoPorNombre`) o registro
 *   el pago manual (`registradoPor`).
 * - El filtro por pasarela trata `pasarela = null` como `MANUAL`, el default de
 *   Prisma, para no ocultar pagos historicos.
 */

import type {
  EstadoPago,
  EstadoRevision,
  OrigenPago,
  Pasarela,
} from "@prisma/client"
import { formatearMonto, normalizeMoneda, type LocaleMonto, type Moneda } from "@/lib/pagos"

export const PASARELAS_HISTORIAL = ["PAYPAL", "MERCADOPAGO", "MANUAL"] as const
export const ESTADOS_REVISION_HISTORIAL = [
  "PENDIENTE",
  "ACEPTADO",
  "RECHAZADO",
] as const
export const ESTADOS_PAGO_HISTORIAL = [
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
  "PENDING",
  "REVISION",
  "CONTRACARGO",
] as const
export const ORIGENES_PAGO_HISTORIAL = ["AUTOMATICO", "MANUAL"] as const

export const PASARELA_LABEL: Record<Pasarela, string> = {
  PAYPAL: "PayPal",
  MERCADOPAGO: "Mercado Pago",
  MANUAL: "Manual",
}

export const ESTADO_REVISION_LABEL: Record<EstadoRevision, string> = {
  PENDIENTE: "Pendiente",
  ACEPTADO: "Aceptado",
  RECHAZADO: "Rechazado",
}

export const ORIGEN_PAGO_LABEL: Record<OrigenPago, string> = {
  AUTOMATICO: "Automático",
  MANUAL: "Manual",
}

export type CanalEnvioHistorial = "EMAIL" | "WHATSAPP" | "COPIA"
export const CANALES_ENVIO_HISTORIAL = ["EMAIL", "WHATSAPP", "COPIA"] as const
export const CANAL_ENVIO_LABEL: Record<CanalEnvioHistorial, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  COPIA: "Copia",
}

export type IdiomaHistorial = "es" | "en"
export const IDIOMAS_HISTORIAL = ["es", "en"] as const
export const IDIOMA_LABEL: Record<IdiomaHistorial, string> = {
  es: "Español",
  en: "Inglés",
}

export type TonoEstadoHistorial = "mint" | "yellow" | "red" | "gray"

/* -------------------------------------------------------------------------- */
/* Normalizacion                                                              */
/* -------------------------------------------------------------------------- */

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

function fechaOpcional(valor: Date | string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null
  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor)
  return Number.isFinite(fecha.getTime()) ? fecha : null
}

function centavosOpcionales(valor: unknown): number | null {
  if (
    typeof valor !== "number" ||
    !Number.isSafeInteger(valor) ||
    valor < 0
  ) {
    return null
  }
  return valor
}

export function normalizarPasarela(
  valor: string | null | undefined
): Pasarela | null {
  const normalizado = textoOpcional(valor)?.toUpperCase()
  switch (normalizado) {
    case "PAYPAL":
      return "PAYPAL"
    case "MERCADOPAGO":
      return "MERCADOPAGO"
    case "MANUAL":
      return "MANUAL"
    default:
      return null
  }
}

/** Una pasarela ausente o invalida se considera MANUAL (default de Prisma). */
export function pasarelaEfectiva(valor: string | null | undefined): Pasarela {
  return normalizarPasarela(valor) ?? "MANUAL"
}

export function etiquetaPasarela(valor: string | null | undefined): string {
  return PASARELA_LABEL[pasarelaEfectiva(valor)]
}

export function normalizarRevision(
  valor: string | null | undefined
): EstadoRevision | null {
  const normalizado = textoOpcional(valor)?.toUpperCase()
  switch (normalizado) {
    case "PENDIENTE":
      return "PENDIENTE"
    case "ACEPTADO":
      return "ACEPTADO"
    case "RECHAZADO":
      return "RECHAZADO"
    default:
      return null
  }
}

export function etiquetaRevision(
  valor: string | null | undefined
): string | null {
  const revision = normalizarRevision(valor)
  return revision ? ESTADO_REVISION_LABEL[revision] : null
}

function normalizarOrigen(valor: string | null | undefined): OrigenPago | null {
  const normalizado = textoOpcional(valor)?.toUpperCase()
  switch (normalizado) {
    case "AUTOMATICO":
      return "AUTOMATICO"
    case "MANUAL":
      return "MANUAL"
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* Filtros de historial                                                       */
/* -------------------------------------------------------------------------- */

export interface FiltrosHistorialPagos {
  /** `PAYPAL`, `MERCADOPAGO` o `MANUAL`. Valores vacios/invalidos no filtran. */
  pasarela?: string | null
  /** `PENDIENTE`, `ACEPTADO` o `RECHAZADO`. Valores invalidos no filtran. */
  revision?: string | null
}

export interface PagoFiltrableHistorial {
  pasarela?: string | null
  revisionEstado?: string | null
}

/**
 * Devuelve `true` si la fila cumple todos los filtros informados. Un filtro
 * ausente, vacio o invalido no restringe. `revision` compara exactamente
 * `Pago.revisionEstado`; un pago en `REVISION` sin estado no cuenta como
 * `PENDIENTE` (los flujos actuales siempre lo persisten).
 */
export function coincideFiltroHistorial(
  pago: PagoFiltrableHistorial,
  filtros: FiltrosHistorialPagos = {}
): boolean {
  const pasarela = normalizarPasarela(filtros.pasarela)
  if (pasarela && pasarelaEfectiva(pago.pasarela) !== pasarela) return false

  const revision = normalizarRevision(filtros.revision)
  if (revision && normalizarRevision(pago.revisionEstado) !== revision) {
    return false
  }

  return true
}

/** Filtra preservando el tipo y la identidad de las filas. */
export function filtrarPagosHistorial<T extends PagoFiltrableHistorial>(
  pagos: readonly T[],
  filtros: FiltrosHistorialPagos = {}
): T[] {
  return pagos.filter((pago) => coincideFiltroHistorial(pago, filtros))
}

/* -------------------------------------------------------------------------- */
/* Concepto                                                                   */
/* -------------------------------------------------------------------------- */

export type TipoConceptoPago = "HITO" | "SOPORTE" | "ENLACE" | "SIN_CONCEPTO"

export interface ConceptoPagoHistorial {
  tipo: TipoConceptoPago
  /** Texto principal de la fila: "Proyecto — Hito" o el servicio del soporte. */
  titulo: string
  /** Descripcion/concepto del enlace, si existe. */
  descripcion: string | null
  proyecto: string | null
  hito: string | null
  servicio: string | null
}

export interface HitoHistorialInput {
  titulo?: string | null
  proyecto?: { titulo?: string | null } | null
}

export interface SuscripcionHistorialInput {
  servicio?: { nombre?: string | null } | null
}

export interface ConceptoPagoInput {
  hito?: HitoHistorialInput | null
  suscripcion?: SuscripcionHistorialInput | null
  enlacePago?: {
    concepto?: string | null
    descripcion?: string | null
  } | null
}

/**
 * Mapea el concepto vinculado al pago:
 * - hito: `Proyecto — Hito` (o solo el hito si no hay proyecto);
 * - soporte: nombre del servicio, con el concepto del enlace como detalle;
 * - sin vinculo: concepto/descripcion del `EnlacePago`;
 * - sin nada: "Pago sin concepto".
 */
export function mapearConceptoPago(
  input: ConceptoPagoInput
): ConceptoPagoHistorial {
  const proyecto = textoOpcional(input.hito?.proyecto?.titulo)
  const hito = textoOpcional(input.hito?.titulo)
  const servicio = textoOpcional(input.suscripcion?.servicio?.nombre)
  const enlaceConcepto = textoOpcional(input.enlacePago?.concepto)
  const enlaceDescripcion = textoOpcional(input.enlacePago?.descripcion)
  const descripcionEnlace = enlaceDescripcion ?? enlaceConcepto

  if (hito || proyecto) {
    const titulo =
      proyecto && hito ? `${proyecto} — ${hito}` : (hito ?? proyecto ?? "")
    return {
      tipo: "HITO",
      titulo,
      descripcion: descripcionEnlace,
      proyecto,
      hito,
      servicio: null,
    }
  }

  if (servicio) {
    return {
      tipo: "SOPORTE",
      titulo: servicio,
      descripcion: descripcionEnlace,
      proyecto: null,
      hito: null,
      servicio,
    }
  }

  if (input.suscripcion) {
    return {
      tipo: "SOPORTE",
      titulo: enlaceConcepto ?? "Soporte",
      descripcion: enlaceDescripcion,
      proyecto: null,
      hito: null,
      servicio: null,
    }
  }

  if (enlaceConcepto) {
    return {
      tipo: "ENLACE",
      titulo: enlaceConcepto,
      descripcion: enlaceDescripcion,
      proyecto: null,
      hito: null,
      servicio: null,
    }
  }

  return {
    tipo: "SIN_CONCEPTO",
    titulo: "Pago sin concepto",
    descripcion: enlaceDescripcion,
    proyecto: null,
    hito: null,
    servicio: null,
  }
}

/* -------------------------------------------------------------------------- */
/* Referencias externas                                                       */
/* -------------------------------------------------------------------------- */

export type TipoReferenciaPago =
  | "CAPTURE"
  | "ORDER"
  | "PREFERENCE"
  | "PAYMENT"
  | "EXTERNAL"

export interface ReferenciaEtiquetada {
  tipo: TipoReferenciaPago
  /** Texto listo para la tabla: "Capture ABC", "Orden XYZ", etc. */
  etiqueta: string
  valor: string
}

export interface ReferenciasPagoHistorial {
  captureId: string | null
  orderId: string | null
  preferenceId: string | null
  /** Id de pago de Mercado Pago (`Pago.externalId` en ese flujo). */
  paymentId: string | null
  /** Referencia libre de un pago MANUAL. */
  referenciaExterna: string | null
  /** Primera referencia disponible, en orden capture/order/preference/pago. */
  principal: ReferenciaEtiquetada | null
  /** Todas las referencias no nulas y sin duplicar por valor. */
  todas: ReferenciaEtiquetada[]
}

export interface ReferenciasPagoInput {
  pasarela?: string | null
  externalId?: string | null
  paypalOrderId?: string | null
  enlacePago?: { externalId?: string | null } | null
}

const REFERENCIA_PREFIJO: Record<TipoReferenciaPago, string> = {
  CAPTURE: "Capture",
  ORDER: "Orden",
  PREFERENCE: "Preferencia",
  PAYMENT: "Pago MP",
  EXTERNAL: "Referencia",
}

/**
 * Referencia externa segun la pasarela:
 * - PayPal: `externalId` es el capture id y `paypalOrderId` (o
 *   `EnlacePago.externalId`) la orden;
 * - Mercado Pago: `EnlacePago.externalId` es la preferencia y `Pago.externalId`
 *   el id de pago;
 * - Manual: `externalId` es una referencia libre.
 */
export function mapearReferenciasPago(
  input: ReferenciasPagoInput
): ReferenciasPagoHistorial {
  const pasarela = pasarelaEfectiva(input.pasarela)
  const externalId = textoOpcional(input.externalId)
  const paypalOrderId = textoOpcional(input.paypalOrderId)
  const enlaceExternalId = textoOpcional(input.enlacePago?.externalId)

  let captureId: string | null = null
  let orderId: string | null = null
  let preferenceId: string | null = null
  let paymentId: string | null = null
  let referenciaExterna: string | null = null

  if (pasarela === "PAYPAL") {
    captureId = externalId
    orderId = paypalOrderId ?? enlaceExternalId
  } else if (pasarela === "MERCADOPAGO") {
    preferenceId = enlaceExternalId
    paymentId = externalId
  } else {
    referenciaExterna = externalId
  }

  const todas: ReferenciaEtiquetada[] = []
  const vistos = new Set<string>()
  const agregar = (tipo: TipoReferenciaPago, valor: string | null) => {
    if (!valor || vistos.has(valor)) return
    vistos.add(valor)
    todas.push({
      tipo,
      etiqueta: `${REFERENCIA_PREFIJO[tipo]} ${valor}`,
      valor,
    })
  }

  agregar("CAPTURE", captureId)
  agregar("ORDER", orderId)
  agregar("PREFERENCE", preferenceId)
  agregar("PAYMENT", paymentId)
  agregar("EXTERNAL", referenciaExterna)

  return {
    captureId,
    orderId,
    preferenceId,
    paymentId,
    referenciaExterna,
    principal: todas[0] ?? null,
    todas,
  }
}

/* -------------------------------------------------------------------------- */
/* Desglose de montos                                                         */
/* -------------------------------------------------------------------------- */

export interface MontoFormateadoHistorial {
  montoAcordado: string | null
  comision: string | null
  monto: string | null
  montoEsperado: string | null
  /** Diferencia con signo: `+US$6,06`, `-US$6,06` o `US$0,00`. */
  diferencia: string | null
}

export interface DesglosePagoHistorial {
  montoAcordado: number | null
  comision: number | null
  /** Total cobrado (`Pago.monto`). */
  monto: number | null
  montoEsperado: number | null
  /** `monto - montoEsperado`; `null` si falta el esperado. */
  diferencia: number | null
  moneda: Moneda
  monedaOriginal: string | null
  monedaEtiqueta: "USD" | "ARS"
  formateado: MontoFormateadoHistorial
  /** `true` solo si hay diferencia distinta de cero. */
  tieneDiferencia: boolean
}

export interface DesglosePagoInput {
  montoAcordado?: number | null
  comision?: number | null
  monto?: number | null
  montoEsperado?: number | null
  moneda?: string | null
}

/**
 * Formatea centavos con `formatearMonto` y devuelve `null` si el monto no es un
 * entero no negativo. El default de moneda es USD (convencion del CRM).
 */
export function formatearMontoHistorial(
  montoCents: number | null | undefined,
  moneda: string | null | undefined,
  locale: LocaleMonto = "es-AR"
): string | null {
  const monto = centavosOpcionales(montoCents)
  if (monto === null) return null
  return formatearMonto(monto, normalizeMoneda(moneda), locale)
}

function formatearDiferencia(
  diferencia: number | null,
  moneda: Moneda
): string | null {
  if (diferencia === null) return null
  if (diferencia === 0) return formatearMonto(0, moneda)
  const absoluto = formatearMonto(Math.abs(diferencia), moneda)
  return diferencia > 0 ? `+${absoluto}` : `-${absoluto}`
}

/**
 * Desglose visible del pago. En un pago normal
 * `monto = montoAcordado + comision = montoEsperado`; en `REVISION`, `monto` es
 * lo capturado y `montoEsperado` el total del link, y la diferencia queda
 * expuesta sin recalcular nada.
 */
export function mapearDesglosePago(
  input: DesglosePagoInput
): DesglosePagoHistorial {
  const montoAcordado = centavosOpcionales(input.montoAcordado)
  const comision = centavosOpcionales(input.comision)
  const monto = centavosOpcionales(input.monto)
  const montoEsperado = centavosOpcionales(input.montoEsperado)
  const moneda = normalizeMoneda(input.moneda)
  const monedaOriginal = textoOpcional(input.moneda)?.toUpperCase() ?? null
  const diferencia =
    monto !== null && montoEsperado !== null ? monto - montoEsperado : null

  return {
    montoAcordado,
    comision,
    monto,
    montoEsperado,
    diferencia,
    moneda,
    monedaOriginal,
    monedaEtiqueta: moneda === "ars" ? "ARS" : "USD",
    formateado: {
      montoAcordado: formatearMontoHistorial(montoAcordado, moneda),
      comision: formatearMontoHistorial(comision, moneda),
      monto: formatearMontoHistorial(monto, moneda),
      montoEsperado: formatearMontoHistorial(montoEsperado, moneda),
      diferencia: formatearDiferencia(diferencia, moneda),
    },
    tieneDiferencia: diferencia !== null && diferencia !== 0,
  }
}

/* -------------------------------------------------------------------------- */
/* Envio y autor                                                              */
/* -------------------------------------------------------------------------- */

export interface EnvioPagoHistorial {
  /** Canal normalizado a mayusculas; `null` si no se registro. */
  canalEnvio: string | null
  canalEtiqueta: string | null
  enviadoEn: Date | null
  enviadoEnIso: string | null
  idioma: string | null
  idiomaEtiqueta: string | null
  /** `true` solo si hay fecha de envio valida. */
  enviado: boolean
}

export interface EnvioPagoInput {
  canalEnvio?: string | null
  enviadoEn?: Date | string | null
  idioma?: string | null
}

export function mapearEnvioPago(
  input: EnvioPagoInput | null | undefined
): EnvioPagoHistorial {
  const canalEnvio = textoOpcional(input?.canalEnvio)?.toUpperCase() ?? null
  const canalEtiqueta = canalEnvio
    ? CANAL_ENVIO_LABEL[canalEnvio as CanalEnvioHistorial] ?? canalEnvio
    : null
  const enviadoEn = fechaOpcional(input?.enviadoEn)
  const idioma = textoOpcional(input?.idioma)?.toLowerCase() ?? null
  const idiomaEtiqueta = idioma
    ? IDIOMA_LABEL[idioma as IdiomaHistorial] ?? idioma
    : null

  return {
    canalEnvio,
    canalEtiqueta,
    enviadoEn,
    enviadoEnIso: enviadoEn?.toISOString() ?? null,
    idioma,
    idiomaEtiqueta,
    enviado: enviadoEn !== null,
  }
}

export interface AutorPagoHistorial {
  generadoPorNombre: string | null
  registradoPor: string | null
  /** Quien genero el link o, si no hay link, quien registro el pago. */
  nombre: string | null
  fuente: "ENLACE" | "REGISTRO" | null
}

export interface AutorPagoInput {
  registradoPor?: string | null
  enlacePago?: { generadoPorNombre?: string | null } | null
}

export function mapearAutorPago(input: AutorPagoInput): AutorPagoHistorial {
  const generadoPorNombre = textoOpcional(input.enlacePago?.generadoPorNombre)
  const registradoPor = textoOpcional(input.registradoPor)
  const nombre = generadoPorNombre ?? registradoPor

  return {
    generadoPorNombre,
    registradoPor,
    nombre,
    fuente: generadoPorNombre ? "ENLACE" : registradoPor ? "REGISTRO" : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Estado visible                                                             */
/* -------------------------------------------------------------------------- */

export interface EstadoPagoVisibleHistorial {
  estadoPago: EstadoPago | null
  revisionEstado: EstadoRevision | null
  etiqueta: string
  tono: TonoEstadoHistorial
  /** Clave estable para tests/UI, independiente del texto visible. */
  clave: string
  /** Diferencia pendiente de resolucion o evento que amerita revision. */
  requiereAccion: boolean
}

function normalizarEstadoPago(
  valor: string | null | undefined
): EstadoPago | null {
  const normalizado = textoOpcional(valor)?.toUpperCase()
  switch (normalizado) {
    case "SUCCEEDED":
      return "SUCCEEDED"
    case "FAILED":
      return "FAILED"
    case "REFUNDED":
      return "REFUNDED"
    case "PENDING":
      return "PENDING"
    case "REVISION":
      return "REVISION"
    case "CONTRACARGO":
      return "CONTRACARGO"
    default:
      return null
  }
}

/**
 * Estado visible combinando `estadoPago` y `revisionEstado`. Un pago en
 * `REVISION` sin estado (dato historico/incompleto) se muestra como pendiente y
 * requiere accion, para no ocultar una diferencia sin resolver.
 */
export function mapearEstadoPagoVisible(
  estadoPago: string | null | undefined,
  revisionEstado?: string | null
): EstadoPagoVisibleHistorial {
  const estado = normalizarEstadoPago(estadoPago)
  const revision = normalizarRevision(revisionEstado)

  switch (estado) {
    case "SUCCEEDED":
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "Pagado",
        tono: "mint",
        clave: "SUCCEEDED",
        requiereAccion: false,
      }
    case "FAILED":
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "Fallido",
        tono: "red",
        clave: "FAILED",
        requiereAccion: false,
      }
    case "REFUNDED":
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "Reembolsado",
        tono: "gray",
        clave: "REFUNDED",
        requiereAccion: false,
      }
    case "CONTRACARGO":
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "Contracargo",
        tono: "red",
        clave: "CONTRACARGO",
        requiereAccion: false,
      }
    case "PENDING":
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "Pendiente",
        tono: "yellow",
        clave: "PENDING",
        requiereAccion: false,
      }
    case "REVISION": {
      if (revision === "ACEPTADO") {
        return {
          estadoPago: estado,
          revisionEstado: revision,
          etiqueta: "Revisión aceptada",
          tono: "mint",
          clave: "REVISION:ACEPTADO",
          requiereAccion: false,
        }
      }
      if (revision === "RECHAZADO") {
        return {
          estadoPago: estado,
          revisionEstado: revision,
          etiqueta: "Revisión rechazada",
          tono: "red",
          clave: "REVISION:RECHAZADO",
          requiereAccion: false,
        }
      }
      return {
        estadoPago: estado,
        revisionEstado: revision,
        etiqueta: "En revisión",
        tono: "yellow",
        clave: revision ? `REVISION:${revision}` : "REVISION:SIN_ESTADO",
        requiereAccion: true,
      }
    }
    default:
      return {
        estadoPago: null,
        revisionEstado: revision,
        etiqueta: "Desconocido",
        tono: "gray",
        clave: "DESCONOCIDO",
        requiereAccion: false,
      }
  }
}

/* -------------------------------------------------------------------------- */
/* Recibo                                                                     */
/* -------------------------------------------------------------------------- */

export type MotivoReciboHistorial =
  | "DISPONIBLE"
  | "NO_PAYPAL"
  | "SIN_RECIBO"
  | "SIN_REFERENCIA"

export interface ElegibilidadReciboHistorial {
  disponible: boolean
  motivo: MotivoReciboHistorial
  reciboId: string | null
  /** Referencia externa que respalda el recibo. */
  referencia: string | null
  emitidoEn: Date | null
  emitidoEnIso: string | null
  /** Ruta imprimible solo si el recibo esta disponible. */
  href: string | null
}

export interface ElegibilidadReciboInput {
  id: string
  pasarela?: string | null
  reciboId?: string | null
  reciboEmitidoEn?: Date | string | null
  externalId?: string | null
  paypalOrderId?: string | null
  /**
   * Se acepta porque la fila de Prisma puede incluirlo, pero no se usa: la
   * pagina del recibo exige una referencia guardada en `Pago`.
   */
  enlacePago?: { externalId?: string | null } | null
}

/**
 * El recibo interno solo aplica a pagos PayPal con `reciboId` y una referencia
 * guardada en `Pago` (`externalId` o `paypalOrderId`), que es exactamente la
 * condicion de la pagina del recibo. Un pago MP o manual nunca expone el recibo
 * PayPal aunque tuviera un `reciboId` historico, y un `EnlacePago` sin
 * referencia en el pago no habilita un recibo que la pagina no podria mostrar.
 */
export function evaluarElegibilidadRecibo(
  input: ElegibilidadReciboInput
): ElegibilidadReciboHistorial {
  const pagoId = textoOpcional(input.id)
  const pasarela = normalizarPasarela(input.pasarela)
  const reciboId = textoOpcional(input.reciboId)
  const referencia =
    textoOpcional(input.externalId) ?? textoOpcional(input.paypalOrderId)
  const emitidoEn = fechaOpcional(input.reciboEmitidoEn)

  const base = {
    reciboId,
    referencia,
    emitidoEn,
    emitidoEnIso: emitidoEn?.toISOString() ?? null,
  }

  if (pasarela !== "PAYPAL") {
    return { ...base, disponible: false, motivo: "NO_PAYPAL", href: null }
  }
  if (!reciboId) {
    return { ...base, disponible: false, motivo: "SIN_RECIBO", href: null }
  }
  if (!referencia) {
    return { ...base, disponible: false, motivo: "SIN_REFERENCIA", href: null }
  }

  return {
    ...base,
    disponible: true,
    motivo: "DISPONIBLE",
    href: pagoId ? `/admin/pagos/${encodeURIComponent(pagoId)}/recibo` : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Fila compuesta                                                             */
/* -------------------------------------------------------------------------- */

export interface EnlacePagoHistorialInput extends EnvioPagoInput {
  concepto?: string | null
  descripcion?: string | null
  externalId?: string | null
  generadoPorNombre?: string | null
}

/**
 * Fila de `Pago` que consumen T-23/T-24. Deliberadamente **no** declara
 * `cliente` ni campos del pagador: el caller puede pasar la fila completa de
 * Prisma, pero esos datos se ignoran y nunca llegan a la vista.
 */
export interface PagoHistorialInput {
  id: string
  estadoPago?: string | null
  revisionEstado?: string | null
  montoAcordado?: number | null
  comision?: number | null
  monto?: number | null
  montoEsperado?: number | null
  moneda?: string | null
  pasarela?: string | null
  origen?: string | null
  externalId?: string | null
  paypalOrderId?: string | null
  reciboId?: string | null
  reciboEmitidoEn?: Date | string | null
  creadoEn?: Date | string | null
  registradoPor?: string | null
  hito?: HitoHistorialInput | null
  suscripcion?: SuscripcionHistorialInput | null
  enlacePago?: EnlacePagoHistorialInput | null
}

export interface PagoHistorial {
  id: string
  creadoEn: Date | null
  creadoEnIso: string | null
  pasarela: Pasarela
  pasarelaEtiqueta: string
  origen: OrigenPago | null
  origenEtiqueta: string | null
  concepto: ConceptoPagoHistorial
  referencias: ReferenciasPagoHistorial
  desglose: DesglosePagoHistorial
  envio: EnvioPagoHistorial
  autor: AutorPagoHistorial
  estado: EstadoPagoVisibleHistorial
  recibo: ElegibilidadReciboHistorial
}

/** Compone todos los helpers en la fila que renderizan las tablas del CRM. */
export function mapearPagoHistorial(input: PagoHistorialInput): PagoHistorial {
  const pasarela = pasarelaEfectiva(input.pasarela)
  const origen = normalizarOrigen(input.origen)
  const creadoEn = fechaOpcional(input.creadoEn)

  return {
    id: textoOpcional(input.id) ?? "",
    creadoEn,
    creadoEnIso: creadoEn?.toISOString() ?? null,
    pasarela,
    pasarelaEtiqueta: PASARELA_LABEL[pasarela],
    origen,
    origenEtiqueta: origen ? ORIGEN_PAGO_LABEL[origen] : null,
    concepto: mapearConceptoPago(input),
    referencias: mapearReferenciasPago(input),
    desglose: mapearDesglosePago(input),
    envio: mapearEnvioPago(input.enlacePago),
    autor: mapearAutorPago(input),
    estado: mapearEstadoPagoVisible(input.estadoPago, input.revisionEstado),
    recibo: evaluarElegibilidadRecibo(input),
  }
}
