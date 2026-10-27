"use client"

/**
 * Modal accesible para generar, regenerar y enviar el link de pago de PayPal
 * (T-20: AC-1, AC-2, AC-3, AC-14, AC-16, AC-23, AC-24, AC-26).
 *
 * - El admin/asistente elige el monto acordado (USD) y, en soporte, los meses
 *   (1..12). La comision y el total se previsualizan con `calcularGrossUp`
 *   (aritmetica entera, sin floats) importado de `fees-core` (modulo puro,
 *   client-safe) y se formatean en es-AR.
 * - El link que se copia o envia es el link estable de PixelArch; el checkout
 *   de PayPal queda del lado del servidor.
 * - Generar, reutilizar y regenerar usan `POST /api/admin/paypal/link`;
 *   WhatsApp, email y copia usan `POST /api/admin/paypal/enviar`. Se puede
 *   inyectar un callback para testear o reutilizar el modal sin acoplarlo al
 *   fetch.
 * - Con un link vigente se puede editar monto/meses, pero regenerar exige una
 *   confirmacion explicita. Si el servidor responde 409 REQUIERE_REGENERAR se
 *   ofrece la accion de regenerar en el lugar.
 * - T-22: si no hay link vigente pero si un ultimo intento fallido, vencido o
 *   invalidado, se muestra el motivo y la accion principal es regenerar. Esa
 *   accion solo crea el link: no cambia el estado del hito ni del soporte.
 * - El boton de copia registra el canal COPIA en el servidor antes de copiar el
 *   mensaje canonico (trazabilidad de `canalEnvio`/`enviadoEn`).
 * - Accesibilidad: `role=dialog`, `aria-modal`, `aria-labelledby`, foco inicial,
 *   trampa de foco, Escape, retorno de foco, `aria-live` para el estado,
 *   errores con `role=alert`, `aria-invalid` en el monto y motivo accesible si
 *   el cliente no tiene telefono.
 * - Privacidad: no se muestran ni se registran datos del pagador. Los avisos
 *   no incluyen nombre, email ni telefono del cliente.
 */

import { useEffect, useId, useRef, useState } from "react"
import { Check, Copy, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { waLink } from "@/lib/contact"
import { formatearMonto } from "@/lib/pagos"
import { calcularGrossUp } from "@/lib/paypal/fees-core"
import {
  estadoIntentoLabel,
  formatearFechaEnlace,
  type UltimoIntentoVista,
} from "@/lib/paypal/links-view"

export type PaypalIdiomaMensaje = "es" | "en"
export type PaypalCanalEnvio = "EMAIL" | "WHATSAPP" | "COPIA"
export type PaypalCanalRegistrado = PaypalCanalEnvio

export interface PaypalConceptoHito {
  tipo: "hito"
  hitoId: string
  titulo: string
}

export interface PaypalConceptoSoporte {
  tipo: "soporte"
  suscripcionId: string
  titulo: string
}

export type PaypalConcepto = PaypalConceptoHito | PaypalConceptoSoporte

/** Link vigente que ya existe para el concepto (AC-2). */
export interface PaypalEnlaceExistente {
  enlaceId: string
  url: string
  total: number
  expiraEn: string
  montoAcordado?: number | null
  comision?: number | null
  /** Meses del snapshot del link (solo soporte). */
  meses?: number | null
  /** Idioma con el que se genero/envio el link. */
  idioma?: PaypalIdiomaMensaje | null
  /** `true` cuando el servidor devolvio un link ya existente. */
  reutilizado?: boolean
}

/** Respuesta de `POST /api/admin/paypal/link`. */
export interface PaypalEnlaceGenerado {
  enlaceId: string
  url: string
  montoAcordado: number
  comision: number
  total: number
  moneda?: string
  expiraEn: string
  reutilizado: boolean
  meses?: number | null
  idioma?: PaypalIdiomaMensaje | null
}

/**
 * Ultimo intento PayPal no vigente (T-22). Se muestra cuando no hay un link
 * activo para explicar si fallo, vencio o fue invalidado y ofrecer regenerar.
 */
export type PaypalUltimoIntento = UltimoIntentoVista

export interface PaypalLinkRequest {
  hitoId?: string
  suscripcionId?: string
  montoAcordadoCents: number
  meses?: number
  descripcion?: string | null
  notaInterna?: string | null
  idioma: PaypalIdiomaMensaje
  regenerar: boolean
}

export interface PaypalEnviarRequest {
  enlaceId: string
  canal: PaypalCanalEnvio
  idioma: PaypalIdiomaMensaje
}

export interface PaypalMensajeEnviado {
  asunto?: string
  cuerpo?: string
  texto?: string
}

/** Respuesta de `POST /api/admin/paypal/enviar`. */
export interface PaypalEnviarResult {
  ok?: boolean
  canal?: PaypalCanalRegistrado
  enviado?: boolean
  mensaje?: PaypalMensajeEnviado
}

export interface PaypalLinkModalProps {
  open: boolean
  onClose: () => void
  concepto: PaypalConcepto
  /** Monto acordado por defecto, en centavos USD enteros. */
  montoAcordadoDefaultCents: number
  /**
   * Precio mensual en centavos. Si se informa, el monto inicial de un soporte
   * es `precioMensual * meses` y se recalcula al cambiar los meses. El monto
   * sigue siendo editable a mano.
   */
  montoMensualCents?: number | null
  /** Meses iniciales de un soporte (1..12). Se ignora en hitos. */
  mesesDefault?: number
  /** Comision porcentual en puntos basicos (540 = 5,40%). Obligatoria. */
  feeBps: number
  /** Comision fija en centavos USD (30 = US$0,30). Obligatoria. */
  feeFixedCents: number
  /** `false` deshabilita la generacion y muestra el motivo (AC-16). Obligatoria. */
  paypalDisponible: boolean
  enlaceExistente?: PaypalEnlaceExistente | null
  /** Ultimo intento PayPal no vigente (fallido/vencido/invalidado). */
  ultimoIntento?: PaypalUltimoIntento | null
  clienteTelefono?: string | null
  idiomaDefault?: PaypalIdiomaMensaje
  /** Descripcion opcional que viaja al link (RF-3). */
  descripcion?: string | null
  /** Nota interna opcional que viaja al link (RF-3). */
  notaInterna?: string | null
  /** Presupuesto del modal para generar/enviar. Default 15 s. */
  timeoutMs?: number
  generarLink?: (input: PaypalLinkRequest) => Promise<PaypalEnlaceGenerado>
  enviarLink?: (input: PaypalEnviarRequest) => Promise<PaypalEnviarResult>
}

type Accion = "generar" | "regenerar" | "whatsapp" | "email" | "copiar"
type OrigenEnlace = "generado" | "reutilizado" | "regenerado"

const TIMEOUT_MS_DEFAULT = 15_000
const MENSAJE_TIMEOUT = "La operación tardó demasiado. Reintentá."
const MENSAJE_CONEXION = "Error de conexión. Reintentá."
const MENSAJE_COPIA = "No se pudo copiar el mensaje. Copialo a mano."
const MENSAJE_MONTO = "Ingresá un monto válido en USD (por ejemplo 100,50)."
const MENSAJE_TARIFA = "No se pudo calcular la comisión con la tarifa configurada."
const MENSAJE_WHATSAPP = "No se pudo armar el mensaje de WhatsApp."
const MENSAJE_SIN_TELEFONO = "El cliente no tiene un teléfono cargado."
const MENSAJE_GENERAR = "No se pudo generar el link de PayPal."
const MENSAJE_ENVIAR = "No se pudo enviar el cobro de PayPal."

export const MENSAJE_PAYPAL_NO_DISPONIBLE =
  "PayPal no disponible: configuración incompleta."

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

/**
 * Error de dominio del cliente: el servidor respondio 409 REQUIERE_REGENERAR.
 * La UI lo usa para ofrecer la regeneracion sin obligar al usuario a adivinar
 * que tiene que volver a enviar el formulario.
 */
export class PaypalLinkRequiereRegenerarError extends Error {
  readonly requiereRegenerar = true

  constructor(mensaje: string) {
    super(mensaje)
    this.name = "PaypalLinkRequiereRegenerarError"
  }
}

export function esRequiereRegenerar(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { requiereRegenerar?: unknown }).requiereRegenerar === true
  )
}

/** Detecta abortos por `error.name`, sin depender de `instanceof Error`. */
function esAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

function mensajeDeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return "No se pudo completar la operación. Reintentá."
}

/** Envuelve un callback con el mismo presupuesto que el fetch interno. */
function conTimeout<T>(promesa: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(MENSAJE_TIMEOUT)), timeoutMs)
    promesa.then(
      (valor) => {
        clearTimeout(timer)
        resolve(valor)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Lee el JSON de una respuesta sin ocultar abortos: si el timeout corta la
 * lectura del body, el error se propaga para mostrarse como timeout.
 */
async function leerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  } catch (error) {
    if (esAbort(error)) throw error
    return {}
  }
}

function mensajeDeRespuesta(
  body: Record<string, unknown>,
  fallback: string
): string {
  return typeof body.error === "string" && body.error.trim().length > 0
    ? body.error
    : fallback
}

function enteroPositivo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor > 0
    ? valor
    : null
}

function enteroNoNegativo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0
    ? valor
    : null
}

function leerEnlace(body: Record<string, unknown>): PaypalEnlaceGenerado {
  const enlaceId = typeof body.enlaceId === "string" ? body.enlaceId : ""
  const url = typeof body.url === "string" ? body.url.trim() : ""
  const montoAcordado = enteroPositivo(body.montoAcordado)
  const comision = enteroNoNegativo(body.comision)
  const total = enteroPositivo(body.total)
  const expiraEn = typeof body.expiraEn === "string" ? body.expiraEn : ""

  if (
    enlaceId.length === 0 ||
    url.length === 0 ||
    montoAcordado === null ||
    comision === null ||
    total === null ||
    expiraEn.length === 0
  ) {
    throw new Error("El servidor devolvió un link inválido.")
  }

  const meses =
    typeof body.meses === "number" &&
    Number.isSafeInteger(body.meses) &&
    body.meses >= 1 &&
    body.meses <= 12
      ? body.meses
      : undefined

  const idioma =
    body.idioma === "es" || body.idioma === "en" ? body.idioma : undefined

  return {
    enlaceId,
    url,
    montoAcordado,
    comision,
    total,
    moneda: typeof body.moneda === "string" ? body.moneda : "usd",
    expiraEn,
    reutilizado: body.reutilizado === true,
    meses,
    idioma,
  }
}

function leerEnvio(body: Record<string, unknown>): PaypalEnviarResult {
  const mensajeRaw =
    body.mensaje && typeof body.mensaje === "object"
      ? (body.mensaje as Record<string, unknown>)
      : null

  return {
    ok: body.ok === true,
    canal:
      body.canal === "EMAIL" || body.canal === "WHATSAPP" || body.canal === "COPIA"
        ? body.canal
        : undefined,
    enviado: body.enviado === true,
    mensaje: mensajeRaw
      ? {
          asunto:
            typeof mensajeRaw.asunto === "string" ? mensajeRaw.asunto : undefined,
          cuerpo:
            typeof mensajeRaw.cuerpo === "string" ? mensajeRaw.cuerpo : undefined,
          texto:
            typeof mensajeRaw.texto === "string" ? mensajeRaw.texto : undefined,
        }
      : undefined,
  }
}

/**
 * POST con presupuesto que cubre tanto la respuesta como la lectura del body.
 * Un abort se informa como timeout; cualquier otro fallo, como conexion.
 */
async function postConTimeout(
  url: string,
  input: unknown,
  timeoutMs: number
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let res: Response
    let body: Record<string, unknown>
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      body = await leerJson(res)
    } catch (error) {
      throw new Error(esAbort(error) ? MENSAJE_TIMEOUT : MENSAJE_CONEXION)
    }
    return { res, body }
  } finally {
    clearTimeout(timer)
  }
}

function respuestaRequiereRegenerar(
  status: number,
  body: Record<string, unknown>,
  mensaje: string
): boolean {
  if (status !== 409) return false
  return body.codigo === "REQUIERE_REGENERAR" || /regener/i.test(mensaje)
}

async function pedirEnlace(
  input: PaypalLinkRequest,
  timeoutMs: number
): Promise<PaypalEnlaceGenerado> {
  const { res, body } = await postConTimeout(
    "/api/admin/paypal/link",
    input,
    timeoutMs
  )

  if (!res.ok) {
    const mensaje = mensajeDeRespuesta(body, MENSAJE_GENERAR)
    if (respuestaRequiereRegenerar(res.status, body, mensaje)) {
      throw new PaypalLinkRequiereRegenerarError(mensaje)
    }
    throw new Error(mensaje)
  }

  return leerEnlace(body)
}

async function pedirEnvio(
  input: PaypalEnviarRequest,
  timeoutMs: number
): Promise<PaypalEnviarResult> {
  const { res, body } = await postConTimeout(
    "/api/admin/paypal/enviar",
    input,
    timeoutMs
  )

  if (!res.ok) {
    throw new Error(mensajeDeRespuesta(body, MENSAJE_ENVIAR))
  }

  return leerEnvio(body)
}

/** Centavos -> texto editable con coma decimal, sin separador de miles. */
function centavosAInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) return ""
  const enteros = Math.floor(cents / 100)
  const decimales = String(cents % 100).padStart(2, "0")
  return `${enteros},${decimales}`
}

/**
 * Texto editable -> centavos, sin pasar por floats. Acepta coma o punto como
 * separador decimal y hasta dos decimales ("100", "100,5", "100,50").
 */
function parsearMontoUsd(valor: string): number | null {
  const limpio = valor.trim()
  if (!/^\d{1,9}(?:[.,]\d{0,2})?$/.test(limpio)) return null

  const [enteros, decimales = ""] = limpio.split(/[.,]/)
  const cents = Number(enteros) * 100 + Number(`${decimales}00`.slice(0, 2))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** 540 bps -> "5,40%" (sin floats). */
function formatearBps(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) return ""
  const enteros = Math.floor(bps / 100)
  const decimales = String(bps % 100).padStart(2, "0")
  return `${enteros},${decimales}%`
}

function esVigente(expiraEn: string | null | undefined, ahora = Date.now()): boolean {
  if (!expiraEn) return false
  const ms = new Date(expiraEn).getTime()
  return Number.isFinite(ms) && ms > ahora
}

function fechaLegible(expiraEn: string): string {
  const fecha = new Date(expiraEn)
  if (!Number.isFinite(fecha.getTime())) return ""
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(fecha)
}

function normalizarExistente(
  existente: PaypalEnlaceExistente | null | undefined,
  ahora = Date.now()
): PaypalEnlaceGenerado | null {
  if (!existente) return null
  if (!existente.enlaceId || !existente.url?.trim()) return null
  if (!esVigente(existente.expiraEn, ahora)) return null
  if (!Number.isSafeInteger(existente.total) || existente.total <= 0) return null

  const comisionInformada =
    typeof existente.comision === "number" &&
    Number.isSafeInteger(existente.comision) &&
    existente.comision >= 0
      ? existente.comision
      : Math.max(0, existente.total - (existente.montoAcordado ?? 0))

  const montoAcordado =
    typeof existente.montoAcordado === "number" &&
    Number.isSafeInteger(existente.montoAcordado) &&
    existente.montoAcordado > 0
      ? existente.montoAcordado
      : comisionInformada > 0 && existente.total > comisionInformada
        ? existente.total - comisionInformada
        : 0

  const meses =
    typeof existente.meses === "number" &&
    Number.isSafeInteger(existente.meses) &&
    existente.meses >= 1 &&
    existente.meses <= 12
      ? existente.meses
      : undefined

  const idioma =
    existente.idioma === "es" || existente.idioma === "en"
      ? existente.idioma
      : undefined

  return {
    enlaceId: existente.enlaceId,
    url: existente.url,
    montoAcordado,
    comision: comisionInformada,
    total: existente.total,
    expiraEn: existente.expiraEn,
    reutilizado: existente.reutilizado !== false,
    meses,
    idioma,
  }
}

function normalizarMeses(valor: number | null | undefined): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor)) return 1
  return Math.min(12, Math.max(1, valor))
}

function mesesIniciales(
  enlace: PaypalEnlaceGenerado | null,
  soporte: boolean,
  mesesDefault: number,
  ultimoIntento: PaypalUltimoIntento | null = null
): number {
  if (!soporte) return 1
  return normalizarMeses(enlace?.meses ?? ultimoIntento?.meses ?? mesesDefault)
}

function idiomaInicial(
  enlace: PaypalEnlaceGenerado | null,
  idiomaDefault: PaypalIdiomaMensaje,
  ultimoIntento: PaypalUltimoIntento | null = null
): PaypalIdiomaMensaje {
  if (enlace?.idioma === "es" || enlace?.idioma === "en") return enlace.idioma
  if (ultimoIntento?.idioma === "es" || ultimoIntento?.idioma === "en") {
    return ultimoIntento.idioma
  }
  return idiomaDefault
}

/**
 * Monto inicial del formulario: si hay un enlace vigente se respeta su snapshot;
 * si no, se recupera el del ultimo intento; en soporte con precio mensual se usa
 * `precioMensual * meses`; en el resto, el default informado por el caller.
 */
function montoInicial(
  enlace: PaypalEnlaceGenerado | null,
  soporte: boolean,
  meses: number,
  montoMensualCents: number | null,
  montoAcordadoDefaultCents: number,
  ultimoIntento: PaypalUltimoIntento | null = null
): number {
  if (enlace && enlace.montoAcordado > 0) return enlace.montoAcordado

  if (
    ultimoIntento &&
    typeof ultimoIntento.montoAcordado === "number" &&
    Number.isSafeInteger(ultimoIntento.montoAcordado) &&
    ultimoIntento.montoAcordado > 0
  ) {
    return ultimoIntento.montoAcordado
  }

  if (soporte && typeof montoMensualCents === "number" && montoMensualCents > 0) {
    const total = montoMensualCents * meses
    if (Number.isSafeInteger(total)) return total
  }

  return montoAcordadoDefaultCents
}

/** Pre-abre la ventana de WhatsApp dentro del gesto del usuario. */
function abrirVentanaWhatsapp(): Window | null {
  if (typeof window === "undefined") return null
  try {
    const ventana = window.open("about:blank", "_blank")
    if (ventana) {
      try {
        ventana.opener = null
      } catch {
        // Algunos navegadores no permiten modificar `opener`; no es critico.
      }
    }
    return ventana
  } catch {
    return null
  }
}

export function PaypalLinkModal({
  open,
  onClose,
  concepto,
  montoAcordadoDefaultCents,
  montoMensualCents = null,
  mesesDefault = 1,
  feeBps,
  feeFixedCents,
  paypalDisponible,
  enlaceExistente = null,
  ultimoIntento = null,
  clienteTelefono = null,
  idiomaDefault = "es",
  descripcion = null,
  notaInterna = null,
  timeoutMs = TIMEOUT_MS_DEFAULT,
  generarLink,
  enviarLink,
}: PaypalLinkModalProps) {
  const tituloId = useId()
  const descripcionId = useId()
  const montoId = useId()
  const montoAyudaId = useId()
  const montoErrorId = useId()
  const mesesId = useId()
  const idiomaId = useId()
  const whatsappMotivoId = useId()
  const urlId = useId()

  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const estabaAbiertoRef = useRef(false)
  const copiadoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peticionRef = useRef(0)
  const cargandoRef = useRef(false)
  const enlaceInicial = normalizarExistente(enlaceExistente)
  const soporteInicial = concepto.tipo === "soporte"
  const mesesInicial = mesesIniciales(
    enlaceInicial,
    soporteInicial,
    mesesDefault,
    ultimoIntento
  )

  const [enlace, setEnlace] = useState<PaypalEnlaceGenerado | null>(enlaceInicial)
  const [origen, setOrigen] = useState<OrigenEnlace>(
    enlaceInicial ? "reutilizado" : "generado"
  )
  const [monto, setMonto] = useState(() =>
    centavosAInput(
      montoInicial(
        enlaceInicial,
        soporteInicial,
        mesesInicial,
        montoMensualCents,
        montoAcordadoDefaultCents,
        ultimoIntento
      )
    )
  )
  const [meses, setMeses] = useState(mesesInicial)
  const [idioma, setIdioma] = useState<PaypalIdiomaMensaje>(() =>
    idiomaInicial(enlaceInicial, idiomaDefault, ultimoIntento)
  )
  const [accion, setAccion] = useState<Accion | null>(null)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [copiado, setCopiado] = useState(false)
  const [requiereRegenerar, setRequiereRegenerar] = useState(false)
  const [confirmandoRegeneracion, setConfirmandoRegeneracion] = useState(false)

  useEffect(() => {
    onCloseRef.current = () => {
      peticionRef.current += 1
      onClose()
    }
  }, [onClose])

  const disponible = paypalDisponible
  const soporte = concepto.tipo === "soporte"
  const enlaceVigente = enlace !== null && esVigente(enlace.expiraEn)
  const mostrarEnlace = disponible && enlaceVigente
  // El ultimo intento solo se muestra mientras no hay un link vigente: con un
  // link activo la accion util es reutilizarlo/enviarlo, no regenerarlo.
  const intentoPrevio = disponible && !mostrarEnlace ? ultimoIntento : null
  const cargando = accion !== null

  useEffect(() => {
    cargandoRef.current = cargando
  }, [cargando])

  const montoCents = parsearMontoUsd(monto)
  const montoInvalido = monto.trim().length > 0 && montoCents === null
  let preview: ReturnType<typeof calcularGrossUp> | null = null
  let tarifaInvalida = false

  if (montoCents !== null) {
    try {
      preview = calcularGrossUp(montoCents, {
        bps: feeBps,
        fixedCents: feeFixedCents,
      })
    } catch {
      preview = null
      tarifaInvalida = true
    }
  }

  const puedeGenerar = disponible && preview !== null && !cargando
  const hayCambios =
    enlace !== null &&
    enlaceVigente &&
    ((enlace.montoAcordado > 0 && montoCents !== enlace.montoAcordado) ||
      (soporte && enlace.meses !== undefined && meses !== enlace.meses))

  const etiquetaEnlace =
    origen === "regenerado"
      ? "Link regenerado"
      : origen === "reutilizado"
        ? "Link vigente reutilizado"
        : "Link generado"

  // Con un link vigente sin cambios se muestra el snapshot con el que se
  // generó (comisión/total), no una reconstrucción con la tarifa actual.
  const desgloseSnapshot =
    mostrarEnlace &&
    enlace !== null &&
    !hayCambios &&
    Number.isSafeInteger(enlace.montoAcordado) &&
    enlace.montoAcordado > 0 &&
    Number.isSafeInteger(enlace.comision) &&
    enlace.comision >= 0 &&
    Number.isSafeInteger(enlace.total) &&
    enlace.total > 0
      ? {
          montoAcordadoCents: enlace.montoAcordado,
          comisionCents: enlace.comision,
          totalCents: enlace.total,
        }
      : null
  const desglose = desgloseSnapshot ?? preview
  const tarifaActualDistinta =
    desgloseSnapshot !== null &&
    preview !== null &&
    (desgloseSnapshot.comisionCents !== preview.comisionCents ||
      desgloseSnapshot.totalCents !== preview.totalCents)

  // Reset al abrir: se evita depender de props que el padre puede recrear en
  // cada render (por ejemplo, el objeto `concepto`).
  useEffect(() => {
    if (open && !estabaAbiertoRef.current) {
      peticionRef.current += 1
      const inicial = normalizarExistente(enlaceExistente)
      const esSoporte = concepto.tipo === "soporte"
      const mesesNuevos = mesesIniciales(
        inicial,
        esSoporte,
        mesesDefault,
        ultimoIntento
      )
      setEnlace(inicial)
      setOrigen(inicial ? "reutilizado" : "generado")
      setMonto(
        centavosAInput(
          montoInicial(
            inicial,
            esSoporte,
            mesesNuevos,
            montoMensualCents,
            montoAcordadoDefaultCents,
            ultimoIntento
          )
        )
      )
      setMeses(mesesNuevos)
      setIdioma(idiomaInicial(inicial, idiomaDefault, ultimoIntento))
      setAccion(null)
      setError("")
      setFeedback("")
      setCopiado(false)
      setRequiereRegenerar(false)
      setConfirmandoRegeneracion(false)
    }

    // Al cerrar se invalida cualquier respuesta en vuelo: si llega tarde no
    // debe pisar el estado del proximo uso del modal.
    if (!open) peticionRef.current += 1

    estabaAbiertoRef.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Foco inicial, trampa de foco, Escape y retorno de foco (AC-23).
  useEffect(() => {
    if (!open) return

    const previo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.focus()

    function enfocables(): HTMLElement[] {
      if (!dialog) return []
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (elemento) =>
          !elemento.hasAttribute("disabled") &&
          elemento.getAttribute("aria-hidden") !== "true"
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Con una operacion en curso el modal no se cierra: la peticion sigue
        // viva y el usuario perderia el contexto del link.
        if (cargandoRef.current) return
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== "Tab") return

      const elementos = enfocables()
      if (elementos.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }

      const primero = elementos[0]
      const ultimo = elementos[elementos.length - 1]
      const activo = document.activeElement
      const dentro = activo instanceof Node && dialog?.contains(activo) === true

      if (event.shiftKey) {
        if (!dentro || activo === primero || activo === dialog) {
          event.preventDefault()
          ultimo.focus()
        }
        return
      }

      if (!dentro || activo === ultimo) {
        event.preventDefault()
        primero.focus()
      }
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target
      if (target instanceof Node && dialog && !dialog.contains(target)) {
        const primero = enfocables()[0]
        if (primero) {
          primero.focus()
        } else {
          dialog.focus()
        }
      }
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocusIn)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocusIn)
      previo?.focus()
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (copiadoTimerRef.current) clearTimeout(copiadoTimerRef.current)
    }
  }, [])

  function nuevaPeticion(): number {
    peticionRef.current += 1
    return peticionRef.current
  }

  function limpiarAvisos() {
    setError("")
    setFeedback("")
    setRequiereRegenerar(false)
    setConfirmandoRegeneracion(false)
  }

  function marcarCopiado() {
    setCopiado(true)
    if (copiadoTimerRef.current) clearTimeout(copiadoTimerRef.current)
    copiadoTimerRef.current = setTimeout(() => setCopiado(false), 2000)
  }

  function cambiarMonto(valor: string) {
    setMonto(valor)
    limpiarAvisos()
  }

  function cambiarMeses(valor: number) {
    const nuevo = normalizarMeses(valor)
    setMeses(nuevo)
    limpiarAvisos()
    if (soporte && typeof montoMensualCents === "number" && montoMensualCents > 0) {
      const total = montoMensualCents * nuevo
      if (Number.isSafeInteger(total)) {
        setMonto(centavosAInput(total))
      }
    }
  }

  function cambiarIdioma(valor: string) {
    setIdioma(valor === "en" ? "en" : "es")
    limpiarAvisos()
  }

  function descartarCambios() {
    if (!enlace) return
    setMonto(centavosAInput(enlace.montoAcordado))
    if (soporte) setMeses(normalizarMeses(enlace.meses ?? mesesDefault))
    setIdioma(idiomaInicial(enlace, idiomaDefault))
    limpiarAvisos()
  }

  async function generar(regenerar: boolean) {
    if (!disponible || cargando) return

    const cents = parsearMontoUsd(monto)
    if (cents === null) {
      setError(MENSAJE_MONTO)
      return
    }

    const descripcionLimpia = descripcion?.trim() ?? ""
    const notaLimpia = notaInterna?.trim() ?? ""
    const input: PaypalLinkRequest = {
      montoAcordadoCents: cents,
      idioma,
      regenerar,
      ...(concepto.tipo === "hito"
        ? { hitoId: concepto.hitoId }
        : { suscripcionId: concepto.suscripcionId, meses }),
      ...(descripcionLimpia ? { descripcion: descripcionLimpia } : {}),
      ...(notaLimpia ? { notaInterna: notaLimpia } : {}),
    }

    const peticion = nuevaPeticion()
    limpiarAvisos()
    setCopiado(false)
    setAccion(regenerar ? "regenerar" : "generar")

    try {
      const resultado = generarLink
        ? await conTimeout(generarLink(input), timeoutMs)
        : await pedirEnlace(input, timeoutMs)

      if (peticion !== peticionRef.current) return

      const siguienteOrigen: OrigenEnlace = regenerar
        ? "regenerado"
        : resultado.reutilizado
          ? "reutilizado"
          : "generado"

      // La API no devuelve `meses`/`idioma`; se conserva lo que se acaba de
      // pedir para que la UI detecte futuras ediciones sobre el link vigente.
      const enlaceFinal: PaypalEnlaceGenerado = {
        ...resultado,
        meses: soporte ? (resultado.meses ?? meses) : resultado.meses,
        idioma: resultado.idioma ?? idioma,
      }

      setEnlace(enlaceFinal)
      setOrigen(siguienteOrigen)
      setMonto(centavosAInput(resultado.montoAcordado || cents))
      setFeedback(
        siguienteOrigen === "regenerado"
          ? "Link regenerado."
          : siguienteOrigen === "reutilizado"
            ? "Se reutilizó el link vigente."
            : "Link generado."
      )
    } catch (fallo) {
      if (peticion !== peticionRef.current) return
      setError(mensajeDeError(fallo))
      setRequiereRegenerar(esRequiereRegenerar(fallo))
    } finally {
      if (peticion === peticionRef.current) setAccion(null)
    }
  }

  async function copiarTexto(texto: string) {
    try {
      const clipboard =
        typeof navigator !== "undefined" ? navigator.clipboard : undefined
      if (!clipboard?.writeText) throw new Error("Clipboard no disponible")
      await clipboard.writeText(texto)
    } catch {
      throw new Error(MENSAJE_COPIA)
    }
  }

  async function copiar() {
    if (!enlace || cargando) return

    const peticion = nuevaPeticion()
    limpiarAvisos()
    setCopiado(false)
    setAccion("copiar")

    try {
      const input: PaypalEnviarRequest = {
        enlaceId: enlace.enlaceId,
        canal: "COPIA",
        idioma,
      }
      const resultado = enviarLink
        ? await conTimeout(enviarLink(input), timeoutMs)
        : await pedirEnvio(input, timeoutMs)

      if (peticion !== peticionRef.current) return

      const texto = resultado.mensaje?.texto?.trim() || enlace.url
      await copiarTexto(texto)

      if (peticion !== peticionRef.current) return

      setFeedback("Mensaje copiado.")
      marcarCopiado()
    } catch (fallo) {
      if (peticion !== peticionRef.current) return
      setError(mensajeDeError(fallo))
    } finally {
      if (peticion === peticionRef.current) setAccion(null)
    }
  }

  async function enviar(canal: "EMAIL" | "WHATSAPP") {
    if (!enlace || cargando) return

    if (canal === "WHATSAPP" && !clienteTelefono) {
      setError(MENSAJE_SIN_TELEFONO)
      return
    }

    const peticion = nuevaPeticion()
    const ventanaWhatsapp = canal === "WHATSAPP" ? abrirVentanaWhatsapp() : null
    limpiarAvisos()
    setCopiado(false)
    setAccion(canal === "WHATSAPP" ? "whatsapp" : "email")

    try {
      const input: PaypalEnviarRequest = {
        enlaceId: enlace.enlaceId,
        canal,
        idioma,
      }
      const resultado = enviarLink
        ? await conTimeout(enviarLink(input), timeoutMs)
        : await pedirEnvio(input, timeoutMs)

      if (peticion !== peticionRef.current) {
        ventanaWhatsapp?.close()
        return
      }

      if (canal === "EMAIL") {
        setFeedback(
          resultado.enviado === false ? "Envío de email registrado." : "Email enviado."
        )
        return
      }

      const texto = resultado.mensaje?.texto?.trim() ?? ""
      if (!texto) throw new Error(MENSAJE_WHATSAPP)
      if (!clienteTelefono) throw new Error(MENSAJE_SIN_TELEFONO)

      const url = waLink(clienteTelefono, texto)
      if (ventanaWhatsapp && !ventanaWhatsapp.closed) {
        ventanaWhatsapp.location.href = url
      } else {
        // Si el navegador bloqueo la pre-apertura, se intenta como fallback.
        window.open(url, "_blank", "noopener,noreferrer")
      }
      setFeedback("Mensaje de WhatsApp listo.")
    } catch (fallo) {
      ventanaWhatsapp?.close()
      if (peticion !== peticionRef.current) return
      setError(mensajeDeError(fallo))
    } finally {
      if (peticion === peticionRef.current) setAccion(null)
    }
  }

  function cerrar() {
    if (cargandoRef.current) return
    onCloseRef.current()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={cerrar}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descripcionId}
        aria-busy={cargando}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-2xl"
        style={{
          background:
            "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={tituloId} className="font-display text-lg font-bold text-text">
              Link de pago PayPal
            </h2>
            <p
              id={descripcionId}
              className="mt-1 truncate text-xs text-text-dim"
              title={concepto.titulo}
            >
              {soporte ? "Soporte mensual" : "Hito"} · {concepto.titulo}
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            disabled={cargando}
            aria-label="Cerrar modal"
            title={
              cargando
                ? "La operación está en curso. Esperá a que termine."
                : undefined
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-white/10 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {feedback}
        </p>

        {!disponible ? (
          <div className="space-y-4">
            <p
              role="alert"
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}
            >
              {MENSAJE_PAYPAL_NO_DISPONIBLE}
            </p>
            <Button variant="ghost" className="w-full" onClick={cerrar}>
              Cerrar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {intentoPrevio && (
              <div className="rounded-lg border border-border px-3 py-2.5">
                <p className="text-xs" style={{ color: "#fbbf24" }}>
                  Último intento PayPal:{" "}
                  {estadoIntentoLabel(intentoPrevio.estado)}
                  {formatearFechaEnlace(
                    intentoPrevio.creadoEn ?? intentoPrevio.expiraEn
                  ) && (
                    <span style={{ color: "var(--color-text-faint)" }}>
                      {" · "}
                      {formatearFechaEnlace(
                        intentoPrevio.creadoEn ?? intentoPrevio.expiraEn
                      )}
                    </span>
                  )}
                </p>
                {intentoPrevio.motivo && (
                  <p className="mt-1 text-xs text-text-dim">
                    {intentoPrevio.motivo}
                  </p>
                )}
                <p className="mt-1 text-xs text-text-dim">
                  El cobro sigue pendiente. Regenerá el link para reintentar.
                </p>
              </div>
            )}

            {mostrarEnlace && enlace && (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: "#34d399" }}>
                  ✓ {etiquetaEnlace}
                  {fechaLegible(enlace.expiraEn) && (
                    <span style={{ color: "var(--color-text-faint)" }}>
                      {" · válido hasta "}
                      {fechaLegible(enlace.expiraEn)}
                    </span>
                  )}
                </p>

                <div>
                  <label
                    htmlFor={urlId}
                    className="mb-1 block text-xs text-text-dim"
                  >
                    Link de pago
                  </label>
                  <input
                    id={urlId}
                    readOnly
                    value={enlace.url}
                    onFocus={(event) => event.currentTarget.select()}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-xs text-text-dim"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor={montoId} className="mb-1 block text-xs text-text-dim">
                Monto acordado (USD)
              </label>
              <input
                id={montoId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                disabled={cargando}
                aria-invalid={montoInvalido || tarifaInvalida}
                aria-describedby={`${montoAyudaId}${montoInvalido ? ` ${montoErrorId}` : ""}`}
                value={monto}
                onChange={(event) => cambiarMonto(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
              />
              <p
                id={montoAyudaId}
                className="mt-1 text-text-dim"
                style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
              >
                Sin separador de miles. La comisión de PayPal se suma al total.
              </p>
              {montoInvalido && (
                <p id={montoErrorId} role="alert" className="mt-1 text-xs text-red-400">
                  {MENSAJE_MONTO}
                </p>
              )}
            </div>

            {soporte && (
              <div>
                <label htmlFor={mesesId} className="mb-1 block text-xs text-text-dim">
                  Meses
                </label>
                <select
                  id={mesesId}
                  value={meses}
                  disabled={cargando}
                  onChange={(event) => cambiarMeses(Number(event.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                >
                  {Array.from({ length: 12 }, (_, indice) => indice + 1).map(
                    (valor) => (
                      <option key={valor} value={valor}>
                        {valor} {valor === 1 ? "mes" : "meses"}
                      </option>
                    )
                  )}
                </select>
                <p
                  className="mt-1 text-text-dim"
                  style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
                >
                  El monto acordado es el total por los meses elegidos.
                </p>
              </div>
            )}

            <div>
              <label htmlFor={idiomaId} className="mb-1 block text-xs text-text-dim">
                Idioma del mensaje
              </label>
              <select
                id={idiomaId}
                value={idioma}
                disabled={cargando}
                onChange={(event) => cambiarIdioma(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
              >
                <option value="es">Español (ES)</option>
                <option value="en">English (EN)</option>
              </select>
            </div>

            <dl
              aria-label="Desglose del cobro"
              className="space-y-1 rounded-lg border border-border px-3 py-2.5 text-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-dim">Monto acordado</dt>
                <dd className="font-mono text-text">
                  {desglose ? formatearMonto(desglose.montoAcordadoCents, "usd") : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-dim">Comisión de PayPal</dt>
                <dd className="font-mono text-text">
                  {desglose ? formatearMonto(desglose.comisionCents, "usd") : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-text">Total a pagar</dt>
                <dd className="font-mono font-semibold text-text">
                  {desglose ? formatearMonto(desglose.totalCents, "usd") : "—"}
                </dd>
              </div>
            </dl>

            {desgloseSnapshot ? (
              <p
                className="text-text-dim"
                style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
              >
                El link vigente conserva el desglose con el que se generó.
                {tarifaActualDistinta && (
                  <>
                    {" "}
                    Tarifa actual: {formatearBps(feeBps)} +{" "}
                    {formatearMonto(feeFixedCents, "usd")}.
                  </>
                )}
              </p>
            ) : (
              <p
                className="text-text-dim"
                style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
              >
                Tarifa aplicada: {formatearBps(feeBps)} +{" "}
                {formatearMonto(feeFixedCents, "usd")}
              </p>
            )}

            {tarifaInvalida && (
              <p role="alert" className="text-xs text-red-400">
                {MENSAJE_TARIFA}
              </p>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}

            {requiereRegenerar && !intentoPrevio && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!puedeGenerar}
                onClick={() => void generar(true)}
              >
                {accion === "regenerar" ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : null}
                Regenerar link
              </Button>
            )}

            {mostrarEnlace && enlace && hayCambios && (
              <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
                {confirmandoRegeneracion ? (
                  <>
                    <p role="alert" className="text-xs text-red-400">
                      Se reemplazará el link vigente y el anterior quedará
                      invalidado. ¿Confirmás la regeneración?
                    </p>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        className="flex-1"
                        disabled={!puedeGenerar}
                        onClick={() => void generar(true)}
                      >
                        {accion === "regenerar" ? (
                          <Loader2 size={14} className="mr-1.5 animate-spin" />
                        ) : null}
                        Sí, regenerar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="flex-1"
                        disabled={cargando}
                        onClick={() => setConfirmandoRegeneracion(false)}
                      >
                        Volver
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-text-dim">
                      Cambiaste el monto o los meses. Regenerar invalida el link
                      vigente.
                    </p>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        className="flex-1"
                        disabled={!puedeGenerar}
                        onClick={() => setConfirmandoRegeneracion(true)}
                      >
                        Regenerar con estos datos
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="flex-1"
                        disabled={cargando}
                        onClick={descartarCambios}
                      >
                        Descartar cambios
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {mostrarEnlace && enlace && !hayCambios && !requiereRegenerar && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={!puedeGenerar}
                onClick={() => void generar(true)}
              >
                {accion === "regenerar" ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : null}
                Regenerar link
              </Button>
            )}

            {!mostrarEnlace && (
              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  onClick={() => void generar(intentoPrevio !== null)}
                  disabled={!puedeGenerar}
                  className="flex-1"
                >
                  {accion === "generar" || accion === "regenerar" ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      {intentoPrevio ? "Regenerando…" : "Generando…"}
                    </>
                  ) : intentoPrevio ? (
                    "Regenerar link"
                  ) : (
                    "Generar link"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cerrar}
                  disabled={cargando}
                  className="flex-1"
                >
                  Cancelar
                </Button>
              </div>
            )}

            {mostrarEnlace && enlace && (
              <>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    onClick={() => void copiar()}
                    className="flex-1"
                    variant="outline"
                    disabled={cargando}
                  >
                    {accion === "copiar" ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : copiado ? (
                      <Check size={14} className="mr-1.5" />
                    ) : (
                      <Copy size={14} className="mr-1.5" />
                    )}
                    {copiado ? "Copiado" : "Copiar mensaje"}
                  </Button>
                  <Button
                    type="button"
                    variant="gradient"
                    className="flex-1"
                    disabled={!clienteTelefono || cargando}
                    title={clienteTelefono ? undefined : MENSAJE_SIN_TELEFONO}
                    aria-describedby={
                      clienteTelefono ? undefined : whatsappMotivoId
                    }
                    onClick={() => void enviar("WHATSAPP")}
                  >
                    {accion === "whatsapp" ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : null}
                    Enviar por WhatsApp
                  </Button>
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={cargando}
                    onClick={() => void enviar("EMAIL")}
                  >
                    {accion === "email" ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : null}
                    Enviar por email
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    disabled={cargando}
                    onClick={cerrar}
                  >
                    Cerrar
                  </Button>
                </div>

                {!clienteTelefono && (
                  <span id={whatsappMotivoId} className="sr-only">
                    {MENSAJE_SIN_TELEFONO}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
