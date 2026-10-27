/**
 * Servicio de links de pago PayPal (T-07).
 *
 * Un `EnlacePago` es el link estable de PixelArch (`/pago/paypal/<token>`), no
 * el checkout de PayPal: la orden vive 3 horas y el link local 30 dias. Al
 * generarlo se crea la primera orden PayPal y se guarda su id y su approve URL;
 * las rutas publicas (T-14) son las que renuevan la orden cuando hace falta.
 *
 * Reglas:
 * - Gross-up con la tarifa vigente de `paypalConfig().fee`; la tarifa queda
 *   snapshotteada en el enlace y no se recalcula ningun pago historico.
 * - `grupoCobroId` es estable por concepto (`hito:<id>` / `soporte:<id>`) y
 *   permite que convivan links de Mercado Pago y PayPal del mismo cobro.
 * - Un link PayPal ACTIVO y no vencido se reutiliza solo si coinciden monto y
 *   meses; si el request pide otros valores sin `regenerar`, se exige
 *   regenerar (`REQUIERE_REGENERAR`, 409) para no cambiar el snapshot en
 *   silencio. Regenerar crea y confirma el checkout nuevo antes de invalidar
 *   el anterior (se conserva el historial).
 * - El vencimiento es perezoso: al leer un link vencido se marca `VENCIDO`.
 * - Los links MP legacy (`mpLink`/`mpPreferenceId`/`mpLinkExpira`) se adoptan
 *   como `EnlacePago` de pasarela MERCADOPAGO sin modificar el hito/soporte.
 *   El snapshot adoptado usa los datos legacy (`mpLinkMeses`, concepto base y
 *   monto de referencia), nunca los overrides del request PayPal.
 * - Si PayPal falla al crear la orden, el enlace queda `FALLIDO` con un
 *   `ultimoError` sanitizado; el link anterior sigue vigente y solo se invalida
 *   despues de confirmar el nuevo checkout.
 *
 * No crea pagos, no marca hitos/soportes como pagados y no toca montos de MP.
 */

import type { EnlacePago, Estado, PlanTipo, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  grupoCobroDeHito,
  grupoCobroDeSuscripcion,
  tituloLink,
} from "@/lib/mp-utils"
import { precioDePlan } from "@/lib/pagos"
import { paypalConfig } from "./config"
import {
  PaypalError,
  createOrder,
  esPaypalError,
  type CreateOrderInput,
  type PaypalRequestOptions,
} from "./client"
import { calcularGrossUp } from "./fees"
import {
  PAYPAL_MONEDA,
  PaypalValidationError,
  calcularExpiracionEnlace,
  estaVencido,
  generarTokenEnlace,
  validarMontoUsdCents,
} from "./utils"

/** Vigencia de la orden PayPal creada al generar el link (plan §2.1). */
export const PAYPAL_ORDER_TTL_MS = 3 * 60 * 60 * 1000

/** Motivo guardado al reemplazar un link por regeneracion. */
export const MOTIVO_INVALIDACION_REGENERACION = "REGENERADO"

/** Mensaje canonico para un soporte que no admite cobros PayPal. */
export const MENSAJE_SOPORTE_NO_ELEGIBLE =
  "El soporte no esta habilitado para cobrar por PayPal (debe estar ACTIVE o PAST_DUE y ser plan SOPORTE)."

export type PaypalLinkErrorCodigo =
  | "ARGUMENTOS_INVALIDOS"
  | "CONCEPTO_NO_ENCONTRADO"
  | "CONCEPTO_NO_ELEGIBLE"
  | "NO_CONFIGURADO"
  | "REQUIERE_REGENERAR"
  | "PAYPAL_ERROR"
  | "ERROR_INTERNO"

const HTTP_STATUS_POR_CODIGO: Record<PaypalLinkErrorCodigo, number> = {
  ARGUMENTOS_INVALIDOS: 400,
  CONCEPTO_NO_ENCONTRADO: 404,
  CONCEPTO_NO_ELEGIBLE: 409,
  NO_CONFIGURADO: 503,
  REQUIERE_REGENERAR: 409,
  PAYPAL_ERROR: 502,
  ERROR_INTERNO: 500,
}

/** Error tipado del servicio de links; `message` es seguro de loguear. */
export class PaypalLinkError extends Error {
  readonly codigo: PaypalLinkErrorCodigo
  readonly httpStatus: number
  readonly enlaceId: string | null
  readonly ultimoError: string | null

  constructor(params: {
    codigo: PaypalLinkErrorCodigo
    mensaje: string
    enlaceId?: string | null
    ultimoError?: string | null
  }) {
    super(params.mensaje)
    this.name = "PaypalLinkError"
    this.codigo = params.codigo
    this.httpStatus = HTTP_STATUS_POR_CODIGO[params.codigo]
    this.enlaceId = params.enlaceId ?? null
    this.ultimoError = params.ultimoError ?? null
  }
}

export function esPaypalLinkError(error: unknown): error is PaypalLinkError {
  return error instanceof PaypalLinkError
}

export interface CrearEnlacePaypalInput {
  /** Exactamente uno de `hitoId` o `suscripcionId`. */
  hitoId?: string | null
  suscripcionId?: string | null
  /**
   * Monto acordado en centavos USD. Si falta:
   * - hito: `hito.monto`;
   * - soporte: precio mensual (custom o del servicio) por los meses.
   */
  montoAcordadoCents?: number | null
  /** Solo soporte: 1..12. Default: `mpLinkMeses` o 1. */
  meses?: number | null
  descripcion?: string | null
  notaInterna?: string | null
  generadoPor?: string | null
  generadoPorNombre?: string | null
  idioma?: string | null
  /** `true` invalida el link activo anterior y emite uno nuevo. */
  regenerar?: boolean
  /** Base publica (por ejemplo `https://pixelarch.dev`), inyectable en tests. */
  baseUrl: string
  /** Fecha de referencia para vencimientos y snapshots (inyectable en tests). */
  ahora?: Date
  timeoutMs?: number
}

export interface EnlacePaypalResultado {
  enlace: EnlacePago
  /** Link estable de PixelArch que se copia o envia al cliente. */
  url: string
  reutilizado: boolean
}

interface LegacyMp {
  mpLink: string | null
  mpPreferenceId: string | null
  mpLinkExpira: Date | null
  /**
   * Meses del link MP legacy (solo soporte). Es independiente de `input.meses`
   * y se conserva tal cual en el snapshot adoptado (null si no se conoce).
   */
  mpLinkMeses: number | null
  /** Concepto del link MP legacy, sin los overrides del request PayPal. */
  conceptoBase: string
  /**
   * Monto de referencia en centavos USD del link MP legacy.
   *
   * El monto real del link MP vivia en ARS dentro de Mercado Pago y no esta
   * persistido en el CRM. Este valor es solo una referencia (catalogo o precio
   * custom del concepto) y **no debe mostrarse como el monto real del link MP**;
   * T-18 resuelve el monto real. Es independiente de `input.montoAcordadoCents`
   * y de `input.meses`. Vale 0 cuando el concepto no tiene link MP legacy.
   */
  montoReferenciaCents: number
}

interface ConceptoBase {
  clienteId: string
  hitoId: string | null
  suscripcionId: string | null
  concepto: string
  grupoCobroId: string
  montoAcordadoCents: number
  meses: number | null
  legacy: LegacyMp
}

interface HitoConcepto {
  id: string
  titulo: string
  monto: number
  mpLink: string | null
  mpPreferenceId: string | null
  mpLinkExpira: Date | null
  proyecto: { titulo: string; clienteId: string }
}

interface SuscripcionConcepto {
  id: string
  clienteId: string
  plan: PlanTipo
  estado: Estado
  precioCustom: number | null
  mpLink: string | null
  mpPreferenceId: string | null
  mpLinkExpira: Date | null
  mpLinkMeses: number | null
  servicio: { nombre: string; precioMantenimiento: number }
}

// Se re-exportan desde `mp-utils` para conservar el contrato publico del
// servicio de links (T-07) sin duplicar la regla de agrupacion de cobros.
export { grupoCobroDeHito, grupoCobroDeSuscripcion }

function esHostLocal(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1"
}

function normalizarBaseUrl(valor: string): string {
  const raw = typeof valor === "string" ? valor.trim() : ""
  if (raw.length === 0) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "La URL base del sitio es obligatoria.",
    })
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "La URL base del sitio no es valida.",
    })
  }

  // Produccion exige HTTPS. HTTP solo se admite en localhost/loopback para
  // desarrollo local; asi una base invalida falla como argumento y no como un
  // error tardio de PayPal al construir returnUrl/cancelUrl.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && esHostLocal(url))) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "La URL base del sitio debe usar HTTPS (o HTTP en localhost para desarrollo).",
    })
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "La URL base del sitio no puede incluir credenciales, query ni hash.",
    })
  }

  const pathname = url.pathname.replace(/\/+$/, "")
  return `${url.origin}${pathname}`
}

/** Construye el link estable que se envia al cliente. */
export function urlPublicaEnlace(baseUrl: string, token: string): string {
  return `${normalizarBaseUrl(baseUrl)}/pago/paypal/${encodeURIComponent(token)}`
}

function resolverAhora(ahora: Date | undefined): Date {
  if (ahora === undefined) return new Date()
  if (!(ahora instanceof Date) || !Number.isFinite(ahora.getTime())) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "La fecha de referencia del enlace no es valida.",
    })
  }
  return ahora
}

function validarMonto(monto: number): number {
  try {
    return validarMontoUsdCents(monto)
  } catch (error) {
    const mensaje =
      error instanceof PaypalValidationError
        ? error.message
        : "El monto acordado debe ser un entero positivo en centavos."
    throw new PaypalLinkError({ codigo: "ARGUMENTOS_INVALIDOS", mensaje })
  }
}

function validarMeses(meses: number): number {
  if (!Number.isInteger(meses) || meses < 1 || meses > 12) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "Los meses de soporte deben ser un entero entre 1 y 12.",
    })
  }
  return meses
}

function normalizarIdioma(idioma: string | null | undefined): "es" | "en" | null {
  if (idioma === "es" || idioma === "en") return idioma
  return null
}

function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

/**
 * Ejecuta una operacion Prisma y traduce cualquier fallo a `ERROR_INTERNO` con
 * un mensaje fijo. El detalle crudo (SQL, host, credenciales) nunca se filtra.
 */
async function ejecutarPrisma<T>(
  operacion: () => Promise<T>,
  mensaje: string,
  enlaceId?: string | null
): Promise<T> {
  try {
    return await operacion()
  } catch (error) {
    if (esPaypalLinkError(error)) throw error
    throw new PaypalLinkError({
      codigo: "ERROR_INTERNO",
      mensaje,
      enlaceId: enlaceId ?? null,
    })
  }
}

/** `mpLinkMeses` usable: entero 1..12; cualquier otro valor se desconoce. */
function mesesLegacyMp(valor: number | null | undefined): number | null {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return null
  return valor >= 1 && valor <= 12 ? valor : null
}

function datosLegacy(
  origen: HitoConcepto | SuscripcionConcepto,
  datos: {
    conceptoBase: string
    montoReferenciaCents: number
    mpLinkMeses: number | null
  }
): LegacyMp {
  return {
    mpLink: textoOpcional(origen.mpLink),
    mpPreferenceId: textoOpcional(origen.mpPreferenceId),
    mpLinkExpira: origen.mpLinkExpira ?? null,
    mpLinkMeses: datos.mpLinkMeses,
    conceptoBase: datos.conceptoBase,
    montoReferenciaCents: datos.montoReferenciaCents,
  }
}

async function cargarConcepto(input: CrearEnlacePaypalInput): Promise<ConceptoBase> {
  const hitoId = textoOpcional(input.hitoId)
  const suscripcionId = textoOpcional(input.suscripcionId)

  if ((hitoId === null) === (suscripcionId === null)) {
    throw new PaypalLinkError({
      codigo: "ARGUMENTOS_INVALIDOS",
      mensaje: "Debe indicarse exactamente un hito o un soporte.",
    })
  }

  if (hitoId) {
    const hito = await ejecutarPrisma(
      () =>
        prisma.hito.findUnique({
          where: { id: hitoId },
          include: { proyecto: { select: { titulo: true, clienteId: true } } },
        }),
      "No se pudo consultar el hito."
    )
    if (!hito) {
      throw new PaypalLinkError({
        codigo: "CONCEPTO_NO_ENCONTRADO",
        mensaje: "El hito no existe.",
      })
    }

    const conceptoBase = `${hito.proyecto.titulo} — ${hito.titulo}`
    const monto = validarMonto(input.montoAcordadoCents ?? hito.monto)
    const tieneLegacyMp = Boolean(
      textoOpcional(hito.mpLink) || textoOpcional(hito.mpPreferenceId)
    )
    return {
      clienteId: hito.proyecto.clienteId,
      hitoId: hito.id,
      suscripcionId: null,
      concepto: conceptoBase,
      grupoCobroId: grupoCobroDeHito(hito.id),
      montoAcordadoCents: monto,
      meses: null,
      legacy: datosLegacy(hito, {
        conceptoBase,
        montoReferenciaCents: tieneLegacyMp ? validarMonto(hito.monto) : 0,
        mpLinkMeses: null,
      }),
    }
  }

  const suscripcion = await ejecutarPrisma(
    () =>
      prisma.suscripcion.findUnique({
        where: { id: suscripcionId! },
        include: { servicio: { select: { nombre: true, precioMantenimiento: true } } },
      }),
    "No se pudo consultar el soporte."
  )
  if (!suscripcion) {
    throw new PaypalLinkError({
      codigo: "CONCEPTO_NO_ENCONTRADO",
      mensaje: "El soporte no existe.",
    })
  }

  // Defensa en profundidad: la ruta ya valida elegibilidad, pero el servicio
  // tampoco debe emitir links de un soporte pausado/cancelado o de otro plan.
  const estadoElegible =
    suscripcion.estado === "ACTIVE" || suscripcion.estado === "PAST_DUE"
  if (suscripcion.plan !== "SOPORTE" || !estadoElegible) {
    throw new PaypalLinkError({
      codigo: "CONCEPTO_NO_ELEGIBLE",
      mensaje: MENSAJE_SOPORTE_NO_ELEGIBLE,
    })
  }

  const mpLinkMeses = mesesLegacyMp(suscripcion.mpLinkMeses)
  const mesesLegacy = mpLinkMeses ?? 1
  const meses = validarMeses(input.meses ?? mesesLegacy)
  // `precioCustom` solo es override si es > 0, igual que `precioDePlan`.
  const precioMensual = precioDePlan(
    "SOPORTE",
    {
      precioUnico: 0,
      precioBasico: 0,
      precioMantenimiento: suscripcion.servicio.precioMantenimiento,
    },
    suscripcion.precioCustom
  )
  const monto = validarMonto(input.montoAcordadoCents ?? precioMensual * meses)
  const tieneLegacyMp = Boolean(
    textoOpcional(suscripcion.mpLink) || textoOpcional(suscripcion.mpPreferenceId)
  )

  return {
    clienteId: suscripcion.clienteId,
    hitoId: null,
    suscripcionId: suscripcion.id,
    concepto: tituloLink(suscripcion.servicio.nombre, meses),
    grupoCobroId: grupoCobroDeSuscripcion(suscripcion.id),
    montoAcordadoCents: monto,
    meses,
    legacy: datosLegacy(suscripcion, {
      conceptoBase: tituloLink(suscripcion.servicio.nombre, mesesLegacy),
      montoReferenciaCents: tieneLegacyMp ? validarMonto(precioMensual * mesesLegacy) : 0,
      mpLinkMeses,
    }),
  }
}

/**
 * Adopta el link MP legacy del hito/soporte como `EnlacePago` MERCADOPAGO.
 *
 * No modifica `mpLink`, `mpPreferenceId` ni `mpLinkExpira`, no llama a Mercado
 * Pago y no duplica si ese mismo link ya fue adoptado. El snapshot usa
 * exclusivamente los datos legacy (`mpLinkMeses`, concepto base y monto de
 * referencia): los overrides del request PayPal no contaminan el link MP.
 *
 * El monto ARS original del link MP no esta persistido en el CRM, por lo que
 * `montoReferenciaCents` es solo una **referencia** en USD y no debe mostrarse
 * como el monto real del link MP. T-18 resuelve el monto real.
 */
async function adoptarLegacyMp(concepto: ConceptoBase, ahora: Date): Promise<void> {
  const { legacy } = concepto
  if (!legacy.mpLink && !legacy.mpPreferenceId) return

  const condiciones: Prisma.EnlacePagoWhereInput[] = []
  if (legacy.mpPreferenceId) condiciones.push({ externalId: legacy.mpPreferenceId })
  if (legacy.mpLink) condiciones.push({ checkoutUrl: legacy.mpLink })

  const existente = await ejecutarPrisma(
    () =>
      prisma.enlacePago.findFirst({
        where: { pasarela: "MERCADOPAGO", OR: condiciones },
        select: { id: true, estado: true, expiraEn: true },
      }),
    "No se pudo verificar el link de Mercado Pago."
  )

  if (existente) {
    if (existente.estado === "ACTIVO" && estaVencido(existente.expiraEn, ahora)) {
      await ejecutarPrisma(
        () =>
          prisma.enlacePago.update({
            where: { id: existente.id },
            data: { estado: "VENCIDO" },
          }),
        "No se pudo actualizar el link de Mercado Pago.",
        existente.id
      )
    }
    return
  }

  const expiraEn = legacy.mpLinkExpira ?? calcularExpiracionEnlace(ahora)
  const estado = estaVencido(expiraEn, ahora) ? "VENCIDO" : "ACTIVO"

  await ejecutarPrisma(
    () =>
      prisma.enlacePago.create({
        data: {
          token: generarTokenEnlace(),
          clienteId: concepto.clienteId,
          hitoId: concepto.hitoId,
          suscripcionId: concepto.suscripcionId,
          pasarela: "MERCADOPAGO",
          concepto: legacy.conceptoBase,
          descripcion: "Link existente de Mercado Pago",
          montoAcordado: legacy.montoReferenciaCents,
          comision: 0,
          total: legacy.montoReferenciaCents,
          moneda: "usd",
          meses: legacy.mpLinkMeses,
          feeBps: 0,
          feeFixedCents: 0,
          url: legacy.mpLink,
          checkoutUrl: legacy.mpLink,
          externalId: legacy.mpPreferenceId,
          estado,
          grupoCobroId: concepto.grupoCobroId,
          expiraEn,
        },
      }),
    "No se pudo registrar el link de Mercado Pago."
  )
}

function sanitizarErrorPaypal(error: unknown): string {
  let mensaje = "Error inesperado al crear la orden de PayPal."
  if (esPaypalError(error)) mensaje = error.message
  else if (error instanceof PaypalLinkError) mensaje = error.message
  else if (error instanceof PaypalValidationError) mensaje = error.message
  return mensaje.replace(/\s+/g, " ").trim().slice(0, 300)
}

/**
 * Crea la primera orden PayPal del enlace. Si PayPal falla (o no devuelve una
 * approve URL), marca **solo el enlace nuevo** como `FALLIDO` y lanza el error
 * tipado; los links anteriores siguen vigentes porque la invalidacion ocurre
 * recien despues de confirmar el checkout nuevo.
 */
async function crearOrdenPaypalDelEnlace(
  creado: EnlacePago,
  params: CreateOrderInput,
  opciones: PaypalRequestOptions
): Promise<{ orderId: string; payerActionUrl: string }> {
  try {
    const orden = await createOrder(params, opciones)
    if (!orden.payerActionUrl) {
      throw new PaypalError({
        code: "RESPUESTA_INVALIDA",
        message: "PayPal no devolvio un link de aprobacion.",
      })
    }
    return { orderId: orden.id, payerActionUrl: orden.payerActionUrl }
  } catch (error) {
    const ultimoError = sanitizarErrorPaypal(error)

    try {
      await ejecutarPrisma(
        () =>
          prisma.enlacePago.update({
            where: { id: creado.id },
            data: { estado: "FALLIDO", ultimoError },
          }),
        "No se pudo actualizar el enlace de pago.",
        creado.id
      )
    } catch {
      // Si tampoco se puede persistir el fallo, el error tipado sigue siendo la
      // fuente de verdad; no se expone el error crudo.
    }

    const noConfigurado = esPaypalError(error) && error.code === "NO_CONFIGURADO"
    throw new PaypalLinkError({
      codigo: noConfigurado ? "NO_CONFIGURADO" : "PAYPAL_ERROR",
      mensaje: noConfigurado
        ? "PayPal no esta configurado."
        : "PayPal no pudo crear el checkout.",
      enlaceId: creado.id,
      ultimoError,
    })
  }
}

/**
 * Crea, reutiliza o regenera el link PayPal de un hito o soporte.
 *
 * Lanza `PaypalLinkError` con un codigo estable para que la API (T-08) mapee
 * 400/404/409/503/502. Nunca crea un `Pago` ni cambia el estado del concepto.
 */
export async function crearEnlacePaypal(
  input: CrearEnlacePaypalInput
): Promise<EnlacePaypalResultado> {
  const baseUrl = normalizarBaseUrl(input.baseUrl)
  const ahora = resolverAhora(input.ahora)

  const config = paypalConfig()
  if (!config.disponible) {
    throw new PaypalLinkError({
      codigo: "NO_CONFIGURADO",
      mensaje: config.motivo,
    })
  }

  const concepto = await cargarConcepto(input)

  // Adoptar el MP legacy antes de reutilizar: ambos links coexisten por grupo.
  await adoptarLegacyMp(concepto, ahora)

  const activos = await ejecutarPrisma(
    () =>
      prisma.enlacePago.findMany({
        where: {
          grupoCobroId: concepto.grupoCobroId,
          pasarela: "PAYPAL",
          estado: "ACTIVO",
        },
        orderBy: { creadoEn: "desc" },
      }),
    "No se pudo consultar el link de pago."
  )

  const vigentes: EnlacePago[] = []
  for (const enlace of activos) {
    if (estaVencido(enlace.expiraEn, ahora)) {
      // Vencimiento perezoso: no se reutiliza un link vencido.
      await ejecutarPrisma(
        () =>
          prisma.enlacePago.update({
            where: { id: enlace.id },
            data: { estado: "VENCIDO" },
          }),
        "No se pudo actualizar el link de pago.",
        enlace.id
      )
    } else {
      vigentes.push(enlace)
    }
  }

  if (!input.regenerar && vigentes.length > 0) {
    // Solo se reutiliza un link compatible. Si el admin pide otro monto o
    // meses, debe regenerar explicitamente: nunca se cambia en silencio el
    // snapshot de un link ya enviado.
    const compatible = vigentes.find(
      (enlace) =>
        enlace.montoAcordado === concepto.montoAcordadoCents &&
        enlace.meses === concepto.meses
    )
    if (compatible) {
      return {
        enlace: compatible,
        url: urlPublicaEnlace(baseUrl, compatible.token),
        reutilizado: true,
      }
    }

    throw new PaypalLinkError({
      codigo: "REQUIERE_REGENERAR",
      mensaje:
        "Ya existe un link PayPal vigente con otro monto o meses. Regenerelo para aplicar el cambio.",
      enlaceId: vigentes[0].id,
    })
  }

  const grossUp = calcularGrossUp(concepto.montoAcordadoCents, config.fee)
  const token = generarTokenEnlace()
  const url = urlPublicaEnlace(baseUrl, token)
  const expiraEn = calcularExpiracionEnlace(ahora)

  // Primero se crea y confirma el nuevo checkout. Los links anteriores recien
  // se invalidan despues; si PayPal falla, el link viejo sigue vigente.
  const creado = await ejecutarPrisma(
    () =>
      prisma.enlacePago.create({
        data: {
          token,
          clienteId: concepto.clienteId,
          hitoId: concepto.hitoId,
          suscripcionId: concepto.suscripcionId,
          pasarela: "PAYPAL",
          concepto: concepto.concepto,
          descripcion: textoOpcional(input.descripcion),
          notaInterna: textoOpcional(input.notaInterna),
          montoAcordado: grossUp.montoAcordadoCents,
          comision: grossUp.comisionCents,
          total: grossUp.totalCents,
          moneda: PAYPAL_MONEDA,
          meses: concepto.meses,
          feeBps: grossUp.feeBps,
          feeFixedCents: grossUp.feeFixedCents,
          url,
          estado: "CREANDO",
          grupoCobroId: concepto.grupoCobroId,
          expiraEn,
          generadoPor: textoOpcional(input.generadoPor),
          generadoPorNombre: textoOpcional(input.generadoPorNombre),
          idioma: normalizarIdioma(input.idioma),
        },
      }),
    "No se pudo guardar el enlace de pago."
  )

  const opciones: PaypalRequestOptions = {
    requestId: `paypal-link-${token}`,
    timeoutMs: input.timeoutMs,
  }

  const { orderId, payerActionUrl } = await crearOrdenPaypalDelEnlace(
    creado,
    {
      montoCents: grossUp.totalCents,
      referencia: token,
      descripcion: textoOpcional(input.descripcion) ?? concepto.concepto,
      returnUrl: `${baseUrl}/pago/paypal/retorno?enlace=${encodeURIComponent(token)}`,
      cancelUrl: `${baseUrl}/pago/paypal/cancelado?enlace=${encodeURIComponent(token)}`,
      locale: normalizarIdioma(input.idioma) === "en" ? "en-US" : "es-AR",
    },
    opciones
  )

  const actualizado = await ejecutarPrisma(
    () =>
      prisma.enlacePago.update({
        where: { id: creado.id },
        data: {
          estado: "ACTIVO",
          externalId: orderId,
          checkoutUrl: payerActionUrl,
          orderExpiraEn: new Date(ahora.getTime() + PAYPAL_ORDER_TTL_MS),
          ultimoError: null,
        },
      }),
    "No se pudo confirmar el enlace de pago.",
    creado.id
  )

  if (input.regenerar) {
    for (const enlace of vigentes) {
      await ejecutarPrisma(
        () =>
          prisma.enlacePago.update({
            where: { id: enlace.id },
            data: {
              estado: "INVALIDADO",
              invalidadoEn: ahora,
              motivoInvalido: MOTIVO_INVALIDACION_REGENERACION,
            },
          }),
        "No se pudo invalidar el link de pago anterior.",
        enlace.id
      )
    }
  }

  return { enlace: actualizado, url, reutilizado: false }
}
