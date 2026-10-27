/**
 * Cliente REST de PayPal (Orders API v2 + verificacion de webhooks).
 *
 * - OAuth `client_credentials` con cache de token y margen de expiracion. La
 *   peticion compartida del token no hereda el timeout ni el `signal` del
 *   primer caller: cada caller la espera con su propio presupuesto.
 * - `createOrder`, `getOrder` y `captureOrder` contra `/v2/checkout/orders`.
 * - `verifyWebhookSignature` contra `/v1/notifications/verify-webhook-signature`.
 * - Timeouts con `AbortController`: 8 s por defecto (admin/retorno) y 4 s por
 *   llamada en el webhook (constante `PAYPAL_WEBHOOK_TIMEOUT_MS`).
 * - Ante un 401 con token cacheado se invalida la cache y se reintenta una vez.
 * - Errores tipados y sanitizados: nunca incluyen client secret, access token,
 *   `Authorization`, PII del pagador ni el payload crudo de PayPal.
 *
 * No toca endpoints ni base de datos: solo transporte y mapeo de respuestas.
 */

import { createHash } from "node:crypto"
import { paypalConfig, type PaypalConfigEnabled } from "./config"
import { PaypalValidationError, validarMontoUsdCents } from "./utils"

export const PAYPAL_DEFAULT_TIMEOUT_MS = 8_000
export const PAYPAL_WEBHOOK_TIMEOUT_MS = 4_000
export const PAYPAL_TOKEN_EXPIRY_MARGIN_MS = 60_000
export const PAYPAL_API_CURRENCY = "USD"

export type PaypalErrorCode =
  | "NO_CONFIGURADO"
  | "VALIDACION"
  | "AUTENTICACION"
  | "TIMEOUT"
  | "ABORTADO"
  | "RED"
  | "HTTP"
  | "RESPUESTA_INVALIDA"

/** Error tipado del cliente PayPal; `message` es siempre seguro de loguear. */
export class PaypalError extends Error {
  readonly code: PaypalErrorCode
  readonly httpStatus: number | null
  readonly issue: string | null

  constructor(params: {
    code: PaypalErrorCode
    message: string
    httpStatus?: number | null
    issue?: string | null
  }) {
    super(params.message)
    this.name = "PaypalError"
    this.code = params.code
    this.httpStatus = params.httpStatus ?? null
    this.issue = params.issue ?? null
  }
}

export function esPaypalError(error: unknown): error is PaypalError {
  return error instanceof PaypalError
}

/** `true` cuando falta configuracion: el endpoint debe responder 503. */
export function esPaypalNoConfigurado(error: unknown): error is PaypalError {
  return esPaypalError(error) && error.code === "NO_CONFIGURADO"
}

export interface PaypalRequestOptions {
  /** Timeout de la llamada en ms. Default: 8 s (o 4 s en webhook). */
  timeoutMs?: number
  /** Cancelacion externa (por ejemplo, aborto de la request de Next). */
  signal?: AbortSignal
  /** Idempotency key enviada como `PayPal-Request-Id` (create/capture). */
  requestId?: string
}

export interface CreateOrderInput {
  /** Monto total en centavos USD (entero positivo). */
  montoCents: number
  /** Referencia interna que viaja como `custom_id`/`invoice_id`. */
  referencia?: string
  /** Descripcion visible en el checkout (maximo 127 caracteres). */
  descripcion?: string
  returnUrl: string
  cancelUrl: string
  brandName?: string
  locale?: string
}

export interface PaypalCapture {
  id: string
  status: string
  amountCents: number | null
  currencyCode: string | null
  orderId: string | null
  customId: string | null
  invoiceId: string | null
  createTime: string | null
  finalCapture: boolean
}

export interface PaypalOrder {
  id: string
  status: string
  customId: string | null
  invoiceId: string | null
  amountCents: number | null
  currencyCode: string | null
  payerActionUrl: string | null
  createTime: string | null
  captures: PaypalCapture[]
}

export interface PaypalTransmissionHeaders {
  transmissionId: string
  transmissionTime: string
  transmissionSig: string
  certUrl: string
  authAlgo: string
}

export type PaypalHeadersInput = Headers | Record<string, string | null | undefined>

export interface VerifyWebhookInput {
  headers: PaypalHeadersInput
  event: unknown
}

export interface PaypalWebhookVerification {
  verificado: boolean
  estado: string | null
  motivo: "OK" | "FIRMA_INVALIDA" | "HEADERS_INCOMPLETOS"
}

interface TokenCacheado {
  accessToken: string
  expiresAt: number
}

interface RespuestaJson {
  status: number
  data: unknown
}

const tokens = new Map<string, TokenCacheado>()
const tokensEnCurso = new Map<string, Promise<TokenCacheado>>()

/**
 * Limpia la cache de tokens. Uso previsto: tests y rotacion de credenciales en
 * procesos de larga vida. No expone ni registra ningun token.
 */
export function resetPaypalTokenCache(): void {
  tokens.clear()
  tokensEnCurso.clear()
}

function configuracion(): PaypalConfigEnabled {
  const config = paypalConfig()
  if (!config.disponible) {
    throw new PaypalError({ code: "NO_CONFIGURADO", message: config.motivo })
  }
  return config
}

function resolverTimeout(valor: number | undefined, fallback: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) return fallback
  return Math.min(Math.floor(valor), 120_000)
}

function errorTimeout(contexto: string, timeoutMs: number): PaypalError {
  return new PaypalError({
    code: "TIMEOUT",
    message: `PayPal no respondio a tiempo al ${contexto} (${timeoutMs} ms).`,
  })
}

function errorAbortado(contexto: string): PaypalError {
  return new PaypalError({
    code: "ABORTADO",
    message: `La llamada a PayPal fue cancelada al ${contexto}.`,
  })
}

async function solicitarJson(
  url: string,
  init: RequestInit,
  contexto: string,
  options: PaypalRequestOptions = {}
): Promise<RespuestaJson> {
  const timeoutMs = resolverTimeout(options.timeoutMs, PAYPAL_DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  let vencido = false
  let abortadoExterno = false

  const temporizador = setTimeout(() => {
    vencido = true
    controller.abort()
  }, timeoutMs)

  const alAbortar = () => {
    abortadoExterno = true
    controller.abort()
  }

  if (options.signal) {
    if (options.signal.aborted) {
      abortadoExterno = true
      controller.abort()
    } else {
      options.signal.addEventListener("abort", alAbortar, { once: true })
    }
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const texto = await response.text()
    let data: unknown = null
    if (texto.length > 0) {
      try {
        data = JSON.parse(texto)
      } catch {
        data = null
      }
    }
    return { status: response.status, data }
  } catch {
    if (vencido) throw errorTimeout(contexto, timeoutMs)
    if (abortadoExterno) throw errorAbortado(contexto)
    throw new PaypalError({
      code: "RED",
      message: `No se pudo conectar con PayPal al ${contexto}.`,
    })
  } finally {
    clearTimeout(temporizador)
    options.signal?.removeEventListener("abort", alAbortar)
  }
}

function esExito(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Extrae un codigo seguro de error de PayPal (`name` o `details[].issue`).
 * Se descarta cualquier mensaje libre porque podria contener datos del pagador.
 */
function extraerIssue(data: unknown): string | null {
  if (!esRegistro(data)) return null

  const candidatos: unknown[] = [data.name]
  if (Array.isArray(data.details)) {
    for (const detalle of data.details) {
      if (esRegistro(detalle)) candidatos.push(detalle.issue)
    }
  }

  for (const candidato of candidatos) {
    if (typeof candidato !== "string") continue
    const codigo = candidato.trim()
    if (/^[A-Za-z0-9_.-]{1,80}$/.test(codigo)) return codigo
  }
  return null
}

function errorHttp(contexto: string, status: number, data: unknown): PaypalError {
  const issue = extraerIssue(data)
  const detalle = issue ? `, ${issue}` : ""
  return new PaypalError({
    code: status === 401 || status === 403 ? "AUTENTICACION" : "HTTP",
    httpStatus: status,
    issue,
    message: `PayPal rechazo ${contexto} (HTTP ${status}${detalle}).`,
  })
}

function errorRespuestaInvalida(contexto: string): PaypalError {
  return new PaypalError({
    code: "RESPUESTA_INVALIDA",
    message: `PayPal devolvio una respuesta invalida al ${contexto}.`,
  })
}

function claveToken(config: PaypalConfigEnabled): string {
  return `${config.baseUrl}|${config.clientId}`
}

function invalidarToken(config: PaypalConfigEnabled, accessToken: string): void {
  const clave = claveToken(config)
  const cacheado = tokens.get(clave)
  if (cacheado && cacheado.accessToken === accessToken) tokens.delete(clave)
}

/**
 * Peticion de token independiente del caller: usa su propio timeout fijo y no
 * recibe `signal`, para que un aborto o un presupuesto corto de un caller no
 * cancele el token que otros estan esperando.
 */
async function solicitarToken(config: PaypalConfigEnabled): Promise<TokenCacheado> {
  const credenciales = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8"
  ).toString("base64")

  const { status, data } = await solicitarJson(
    `${config.baseUrl}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credenciales}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    },
    "autenticar",
    { timeoutMs: PAYPAL_DEFAULT_TIMEOUT_MS }
  )

  if (!esExito(status)) {
    throw errorHttp("la autenticacion", status, data)
  }

  if (!esRegistro(data)) throw errorRespuestaInvalida("autenticar")

  const accessToken = textoOpcional(data.access_token)
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : null

  if (!accessToken || expiresIn === null || expiresIn <= 0) {
    throw errorRespuestaInvalida("autenticar")
  }

  const expiresInMs = expiresIn * 1000
  const margen = Math.min(PAYPAL_TOKEN_EXPIRY_MARGIN_MS, Math.floor(expiresInMs / 10))

  return {
    accessToken,
    expiresAt: Date.now() + Math.max(0, expiresInMs - margen),
  }
}

/**
 * Espera una promesa compartida respetando el presupuesto y el `signal` de
 * este caller. No cancela la promesa original: solo deja de esperarla.
 */
async function esperarConPresupuesto<T>(
  promesa: Promise<T>,
  options: PaypalRequestOptions,
  contexto: string
): Promise<T> {
  const timeoutMs = resolverTimeout(options.timeoutMs, PAYPAL_DEFAULT_TIMEOUT_MS)
  if (options.signal?.aborted) throw errorAbortado(contexto)

  let temporizador: ReturnType<typeof setTimeout> | undefined
  let alAbortar: (() => void) | undefined

  const porTimeout = new Promise<never>((_resolve, reject) => {
    temporizador = setTimeout(() => reject(errorTimeout(contexto, timeoutMs)), timeoutMs)
  })

  const porAborto = new Promise<never>((_resolve, reject) => {
    if (!options.signal) return
    alAbortar = () => reject(errorAbortado(contexto))
    options.signal.addEventListener("abort", alAbortar, { once: true })
  })

  try {
    return await Promise.race([promesa, porTimeout, porAborto])
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador)
    if (alAbortar && options.signal) {
      options.signal.removeEventListener("abort", alAbortar)
    }
  }
}

function promesaTokenCompartida(
  config: PaypalConfigEnabled,
  clave: string
): Promise<TokenCacheado> {
  const existente = tokensEnCurso.get(clave)
  if (existente) return existente

  const promesa = solicitarToken(config)
    .then((token) => {
      tokens.set(clave, token)
      return token
    })
    .finally(() => {
      if (tokensEnCurso.get(clave) === promesa) tokensEnCurso.delete(clave)
    })

  tokensEnCurso.set(clave, promesa)
  return promesa
}

interface TokenEnUso {
  accessToken: string
  /** `true` si salio de la cache (no de una peticion de token recien hecha). */
  cacheado: boolean
}

async function obtenerAccessToken(
  config: PaypalConfigEnabled,
  options: PaypalRequestOptions
): Promise<TokenEnUso> {
  const clave = claveToken(config)
  const cacheado = tokens.get(clave)

  if (cacheado && cacheado.expiresAt > Date.now()) {
    return { accessToken: cacheado.accessToken, cacheado: true }
  }
  if (cacheado) tokens.delete(clave)

  const token = await esperarConPresupuesto(
    promesaTokenCompartida(config, clave),
    options,
    "autenticar"
  )
  return { accessToken: token.accessToken, cacheado: false }
}

interface InitAutorizado {
  method: string
  body?: string
  headers?: Record<string, string>
}

/**
 * Ejecuta una llamada autenticada. Si PayPal responde 401 con un token que
 * teniamos cacheado, invalida ese token y reintenta una sola vez con uno nuevo.
 */
async function solicitarConAutorizacion(
  config: PaypalConfigEnabled,
  url: string,
  init: InitAutorizado,
  contexto: string,
  options: PaypalRequestOptions
): Promise<RespuestaJson> {
  const extra = init.headers ?? {}
  let respuesta: RespuestaJson = { status: 0, data: null }

  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerAccessToken(config, options)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extra,
    }

    respuesta = await solicitarJson(
      url,
      { method: init.method, body: init.body, headers },
      contexto,
      options
    )

    // Solo tiene sentido reintentar si el 401 vino de un token cacheado: uno
    // recien emitido y rechazado no se arregla pidiendo otro.
    if (respuesta.status === 401 && token.cacheado && intento === 0) {
      invalidarToken(config, token.accessToken)
      continue
    }
    return respuesta
  }

  return respuesta
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

function recortar(valor: string, maximo: number): string {
  return valor.length > maximo ? valor.slice(0, maximo) : valor
}

function validarUrl(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new PaypalError({ code: "VALIDACION", message: `El campo ${campo} es obligatorio.` })
  }

  const texto = valor.trim()
  let url: URL
  try {
    url = new URL(texto)
  } catch {
    throw new PaypalError({
      code: "VALIDACION",
      message: `El campo ${campo} debe ser una URL https valida.`,
    })
  }

  if (url.protocol !== "https:") {
    throw new PaypalError({
      code: "VALIDACION",
      message: `El campo ${campo} debe ser una URL https valida.`,
    })
  }

  if (url.username || url.password) {
    throw new PaypalError({
      code: "VALIDACION",
      message: `El campo ${campo} no puede incluir credenciales en la URL.`,
    })
  }

  return texto
}

function normalizarRequestId(valor: string | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  if (texto.length === 0) return null
  if (!/^[A-Za-z0-9._~:/+=,-]{1,108}$/.test(texto)) {
    throw new PaypalError({
      code: "VALIDACION",
      message: "El identificador de idempotencia de PayPal es invalido.",
    })
  }
  return texto
}

function requerirOrderId(valor: unknown): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new PaypalError({ code: "VALIDACION", message: "El order id de PayPal es obligatorio." })
  }
  return valor.trim()
}

/**
 * Valida un monto de PayPal y normaliza el error de dominio a `PaypalError`
 * (`VALIDACION`) para que los callers puedan usar `esPaypalError`.
 */
function validarMontoPaypal(monto: unknown): number {
  try {
    return validarMontoUsdCents(monto)
  } catch (error) {
    if (error instanceof PaypalValidationError) {
      throw new PaypalError({ code: "VALIDACION", message: error.message })
    }
    throw error
  }
}

/** Convierte centavos enteros a la representacion decimal de PayPal. */
export function formatearMontoPaypal(montoCents: number): string {
  const cents = validarMontoPaypal(montoCents)
  const enteros = Math.floor(cents / 100)
  const decimales = String(cents % 100).padStart(2, "0")
  return `${enteros}.${decimales}`
}

/** Convierte un monto decimal de PayPal (`"106.56"`) a centavos enteros. */
export function parsearMontoPaypal(valor: unknown): number | null {
  if (typeof valor !== "string") return null
  const coincidencia = /^(\d+)(?:\.(\d{1,2}))?$/.exec(valor.trim())
  if (!coincidencia) return null

  const enteros = Number(coincidencia[1])
  const decimales = (coincidencia[2] ?? "").padEnd(2, "0")
  const cents = enteros * 100 + Number(decimales)

  return Number.isSafeInteger(cents) ? cents : null
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/** Mapea una captura de PayPal (`PAYMENT.CAPTURE.*`) sin exponer el payload. */
export function parsePaypalCapture(payload: unknown): PaypalCapture | null {
  if (!esRegistro(payload)) return null

  const id = textoOpcional(payload.id)
  if (!id) return null

  const amount = esRegistro(payload.amount) ? payload.amount : null
  const supplementary = esRegistro(payload.supplementary_data)
    ? payload.supplementary_data
    : null
  const related =
    supplementary && esRegistro(supplementary.related_ids) ? supplementary.related_ids : null

  return {
    id,
    status: textoOpcional(payload.status) ?? "",
    amountCents: amount ? parsearMontoPaypal(amount.value) : null,
    currencyCode: amount ? leerMoneda(amount.currency_code) : null,
    orderId: related ? textoOpcional(related.order_id) : null,
    customId: textoOpcional(payload.custom_id),
    invoiceId: textoOpcional(payload.invoice_id),
    createTime: textoOpcional(payload.create_time),
    finalCapture: payload.final_capture === true,
  }
}

function leerMoneda(valor: unknown): string | null {
  const moneda = textoOpcional(valor)
  return moneda ? moneda.toUpperCase() : null
}

/** Mapea una orden de PayPal (create/get/capture) a un resultado seguro. */
export function parsePaypalOrder(payload: unknown): PaypalOrder | null {
  if (!esRegistro(payload)) return null

  const id = textoOpcional(payload.id)
  if (!id) return null

  const unidades: Record<string, unknown>[] = []
  if (Array.isArray(payload.purchase_units)) {
    for (const unidad of payload.purchase_units) {
      if (esRegistro(unidad)) unidades.push(unidad)
    }
  }

  const primera = unidades[0] ?? null
  const amount = primera && esRegistro(primera.amount) ? primera.amount : null

  const captures: PaypalCapture[] = []
  for (const unidad of unidades) {
    if (!esRegistro(unidad.payments)) continue
    if (!Array.isArray(unidad.payments.captures)) continue
    for (const captura of unidad.payments.captures) {
      const parseada = parsePaypalCapture(captura)
      if (parseada) captures.push(parseada)
    }
  }

  let payerActionUrl: string | null = null
  if (Array.isArray(payload.links)) {
    for (const link of payload.links) {
      if (!esRegistro(link)) continue
      const rel = textoOpcional(link.rel)
      if (rel !== "payer-action" && rel !== "approve") continue
      payerActionUrl = textoOpcional(link.href)
      if (payerActionUrl) break
    }
  }

  return {
    id,
    status: textoOpcional(payload.status) ?? "",
    customId: primera ? textoOpcional(primera.custom_id) : null,
    invoiceId: primera ? textoOpcional(primera.invoice_id) : null,
    amountCents: amount ? parsearMontoPaypal(amount.value) : null,
    currencyCode: amount ? leerMoneda(amount.currency_code) : null,
    payerActionUrl,
    createTime: textoOpcional(payload.create_time),
    captures,
  }
}

/** Primera captura de una orden, si existe. */
export function primeraCaptura(order: PaypalOrder): PaypalCapture | null {
  return order.captures.length > 0 ? order.captures[0] : null
}

function construirCuerpoOrden(input: {
  montoCents: number
  referencia: string | null
  descripcion: string | null
  returnUrl: string
  cancelUrl: string
  brandName: string
  locale: string
}): Record<string, unknown> {
  const purchaseUnit: Record<string, unknown> = {
    reference_id: "default",
    amount: {
      currency_code: PAYPAL_API_CURRENCY,
      value: formatearMontoPaypal(input.montoCents),
    },
  }

  if (input.referencia) {
    if (input.referencia.length > 127) {
      throw new PaypalError({
        code: "VALIDACION",
        message: "La referencia interna de PayPal no puede superar 127 caracteres.",
      })
    }
    purchaseUnit.custom_id = input.referencia
    purchaseUnit.invoice_id = input.referencia
  }
  if (input.descripcion) {
    purchaseUnit.description = recortar(input.descripcion, 127)
  }

  return {
    intent: "CAPTURE",
    purchase_units: [purchaseUnit],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: recortar(input.brandName, 127),
          locale: input.locale,
          landing_page: "NO_PREFERENCE",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  }
}

/** Crea una orden PayPal con `intent=CAPTURE`. No modifica estado local. */
export async function createOrder(
  input: CreateOrderInput,
  options: PaypalRequestOptions = {}
): Promise<PaypalOrder> {
  const config = configuracion()
  const montoCents = validarMontoPaypal(input.montoCents)
  const returnUrl = validarUrl(input.returnUrl, "returnUrl")
  const cancelUrl = validarUrl(input.cancelUrl, "cancelUrl")
  const requestId = normalizarRequestId(options.requestId)
  const headers: Record<string, string> = {}
  if (requestId) headers["PayPal-Request-Id"] = requestId

  const body = construirCuerpoOrden({
    montoCents,
    referencia: textoOpcional(input.referencia),
    descripcion: textoOpcional(input.descripcion),
    returnUrl,
    cancelUrl,
    brandName: textoOpcional(input.brandName) ?? "PixelArch",
    locale: textoOpcional(input.locale) ?? "es-AR",
  })

  const { status, data } = await solicitarConAutorizacion(
    config,
    `${config.baseUrl}/v2/checkout/orders`,
    { method: "POST", headers, body: JSON.stringify(body) },
    "crear la orden",
    options
  )

  if (!esExito(status)) throw errorHttp("crear la orden", status, data)

  const order = parsePaypalOrder(data)
  if (!order) throw errorRespuestaInvalida("crear la orden")
  return order
}

/** Consulta una orden por id (para conciliar capturas o reintentos). */
export async function getOrder(
  orderId: string,
  options: PaypalRequestOptions = {}
): Promise<PaypalOrder> {
  const config = configuracion()
  const id = requerirOrderId(orderId)

  const { status, data } = await solicitarConAutorizacion(
    config,
    `${config.baseUrl}/v2/checkout/orders/${encodeURIComponent(id)}`,
    { method: "GET" },
    "consultar la orden",
    options
  )

  if (!esExito(status)) throw errorHttp("consultar la orden", status, data)

  const order = parsePaypalOrder(data)
  if (!order) throw errorRespuestaInvalida("consultar la orden")
  return order
}

/**
 * Deriva una idempotency key estable del order id para que reintentos de
 * captura (retorno + webhook) no creen capturas duplicadas.
 */
function derivarRequestIdCaptura(orderId: string): string {
  const hash = createHash("sha256").update(`capture:${orderId}`).digest("hex")
  return `capture-${hash}`
}

/**
 * Captura una orden aprobada. Si el caller no provee un `requestId`, se deriva
 * uno estable del order id para que PayPal sea idempotente ante reintentos.
 */
export async function captureOrder(
  orderId: string,
  options: PaypalRequestOptions = {}
): Promise<PaypalOrder> {
  const config = configuracion()
  const id = requerirOrderId(orderId)
  const requestId = normalizarRequestId(options.requestId) ?? derivarRequestIdCaptura(id)
  const headers: Record<string, string> = { "PayPal-Request-Id": requestId }

  const { status, data } = await solicitarConAutorizacion(
    config,
    `${config.baseUrl}/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
    { method: "POST", headers, body: "{}" },
    "capturar la orden",
    options
  )

  if (!esExito(status)) throw errorHttp("capturar la orden", status, data)

  const order = parsePaypalOrder(data)
  if (!order) throw errorRespuestaInvalida("capturar la orden")
  return order
}

function leerHeader(headers: PaypalHeadersInput, nombre: string): string | null {
  const posibleGet = (headers as { get?: unknown }).get
  if (typeof posibleGet === "function") {
    const valor = (headers as Headers).get(nombre)
    return textoOpcional(valor)
  }

  const objetivo = nombre.toLowerCase()
  for (const [clave, valor] of Object.entries(headers)) {
    if (clave.toLowerCase() === objetivo) return textoOpcional(valor)
  }
  return null
}

/**
 * Lee los headers de transmision del webhook. Devuelve `null` si falta alguno:
 * el endpoint debe responder 401 sin llamar a PayPal.
 */
export function leerHeadersTransmision(
  headers: PaypalHeadersInput
): PaypalTransmissionHeaders | null {
  const transmissionId = leerHeader(headers, "PAYPAL-TRANSMISSION-ID")
  const transmissionTime = leerHeader(headers, "PAYPAL-TRANSMISSION-TIME")
  const transmissionSig = leerHeader(headers, "PAYPAL-TRANSMISSION-SIG")
  const certUrl = leerHeader(headers, "PAYPAL-CERT-URL")
  const authAlgo = leerHeader(headers, "PAYPAL-AUTH-ALGO")

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null
  }

  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo }
}

/**
 * Verifica un webhook server-to-server contra PayPal usando
 * `PAYPAL_WEBHOOK_ID`. Default 4 s por llamada (presupuesto del webhook).
 *
 * - Headers incompletos: `{ verificado: false, motivo: "HEADERS_INCOMPLETOS" }`
 *   sin llamada de red.
 * - `verification_status !== "SUCCESS"`: firma invalida (401 en el endpoint).
 * - Sin configuracion o error de transporte: lanza `PaypalError` tipado.
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookInput,
  options: PaypalRequestOptions = {}
): Promise<PaypalWebhookVerification> {
  const config = configuracion()

  const headers = leerHeadersTransmision(input.headers)
  if (!headers) {
    return { verificado: false, estado: null, motivo: "HEADERS_INCOMPLETOS" }
  }

  if (!esRegistro(input.event)) {
    throw new PaypalError({
      code: "VALIDACION",
      message: "El evento de PayPal es invalido.",
    })
  }

  const timeoutMs = resolverTimeout(options.timeoutMs, PAYPAL_WEBHOOK_TIMEOUT_MS)
  const opciones = { ...options, timeoutMs }

  const { status, data } = await solicitarConAutorizacion(
    config,
    `${config.baseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: config.webhookId,
        webhook_event: input.event,
      }),
    },
    "verificar el webhook",
    opciones
  )

  if (!esExito(status)) throw errorHttp("verificar el webhook", status, data)

  if (!esRegistro(data)) throw errorRespuestaInvalida("verificar el webhook")

  const estado = textoOpcional(data.verification_status)
  if (!estado) throw errorRespuestaInvalida("verificar el webhook")

  return {
    verificado: estado.toUpperCase() === "SUCCESS",
    estado,
    motivo: estado.toUpperCase() === "SUCCESS" ? "OK" : "FIRMA_INVALIDA",
  }
}
