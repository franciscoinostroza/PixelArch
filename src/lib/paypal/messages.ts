/**
 * Plantillas puras de email y WhatsApp para cobros PayPal (T-05, AC-3, RNF-14).
 *
 * - No envian nada: solo arman texto plano canonico. El envio vive en T-09.
 * - No hay HTML ni React Email.
 * - Montos: centavos USD enteros y `formatearMonto` (ES es-AR, EN en-US).
 * - Fechas: `America/Argentina/Buenos_Aires` fijo, dd/mm/aaaa (es-AR) y
 *   mm/dd/aaaa (en-US), para que los tests no dependan del entorno.
 * - Privacidad: no acepta datos del pagador. Solo usa el nombre del cliente del
 *   CRM si se pasa; los campos desconocidos se ignoran.
 */

import { formatearMonto, type LocaleMonto } from "@/lib/pagos"
import { PAYPAL_MONEDA, PaypalValidationError } from "./utils"

export type PaypalIdioma = "es" | "en"
export type PaypalCanalMensaje = "EMAIL" | "WHATSAPP"

/** Zona horaria documentada para mostrar el vencimiento del link. */
export const PAYPAL_MENSAJE_TIMEZONE = "America/Argentina/Buenos_Aires"

const LOCALES: Record<PaypalIdioma, LocaleMonto> = {
  es: "es-AR",
  en: "en-US",
}

export interface PaypalMensajeBase {
  idioma: PaypalIdioma
  concepto: string
  montoAcordadoCents: number
  /** Comision de PayPal incluida en el total (gross-up). */
  comisionCents: number
  /** Total a pagar: monto acordado + comision. */
  totalCents: number
  /** PayPal solo cobra USD. */
  moneda: typeof PAYPAL_MONEDA
  /** Link estable de PixelArch, no la URL interna del checkout de PayPal. */
  link: string
  /** Instante de vencimiento del link (Date o ISO con hora). */
  vencimiento: Date | string
  /** Nombre del cliente del CRM (opcional). Nunca datos del pagador. */
  clienteNombre?: string | null
  /** Nota para el cliente (opcional). */
  nota?: string | null
}

export interface PaypalMensajeEmailInput extends PaypalMensajeBase {
  canal: "EMAIL"
}

export interface PaypalMensajeWhatsappInput extends PaypalMensajeBase {
  canal: "WHATSAPP"
}

export type PaypalMensajeInput = PaypalMensajeEmailInput | PaypalMensajeWhatsappInput

export interface PaypalEmailMensaje {
  asunto: string
  cuerpo: string
}

export interface PaypalWhatsappMensaje {
  texto: string
}

export type PaypalMensaje = PaypalEmailMensaje | PaypalWhatsappMensaje

interface DatosPlantilla {
  idioma: PaypalIdioma
  canal: PaypalCanalMensaje
  concepto: string
  clienteNombre: string | null
  nota: string | null
  montoAcordado: string
  comision: string
  total: string
  link: string
  vencimiento: string
}

function textoRequerido(valor: string, campo: string, mensaje: string): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new PaypalValidationError(campo, mensaje)
  }
  return valor.trim()
}

/** Colapsa espacios y saltos de linea para nombres y conceptos de una linea. */
function normalizarEspacios(valor: string): string {
  return valor.replace(/\s+/g, " ")
}

/** Nombre opcional: vacio/ausente -> null; se colapsan espacios. */
function nombreOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const limpio = normalizarEspacios(valor.trim())
  return limpio.length > 0 ? limpio : null
}

/** Nota opcional: conserva saltos de linea internos. */
function notaOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const limpia = valor.trim()
  return limpia.length > 0 ? limpia : null
}

function enteroPositivo(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor <= 0) {
    throw new PaypalValidationError(campo, "El monto debe ser un entero positivo en centavos.")
  }
  return valor
}

function comisionValida(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new PaypalValidationError(
      "comisionCents",
      "La comision debe ser un entero mayor o igual a 0 centavos."
    )
  }
  return valor
}

function parsearVencimiento(valor: Date | string): Date {
  if (!(valor instanceof Date) && typeof valor !== "string") {
    throw new PaypalValidationError("vencimiento", "El vencimiento no es una fecha valida.")
  }

  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor)
  if (!Number.isFinite(fecha.getTime())) {
    throw new PaypalValidationError("vencimiento", "El vencimiento no es una fecha valida.")
  }
  return fecha
}

function formatearVencimiento(fecha: Date, idioma: PaypalIdioma): string {
  return new Intl.DateTimeFormat(LOCALES[idioma], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: PAYPAL_MENSAJE_TIMEZONE,
  }).format(fecha)
}

function prepararDatos(input: PaypalMensajeInput): DatosPlantilla {
  if (input.idioma !== "es" && input.idioma !== "en") {
    throw new PaypalValidationError("idioma", "El idioma debe ser es o en.")
  }

  if (input.canal !== "EMAIL" && input.canal !== "WHATSAPP") {
    throw new PaypalValidationError("canal", "El canal debe ser EMAIL o WHATSAPP.")
  }

  if (input.moneda !== PAYPAL_MONEDA) {
    throw new PaypalValidationError("moneda", "PayPal solo acepta montos en USD.")
  }

  const montoAcordadoCents = enteroPositivo(input.montoAcordadoCents, "montoAcordadoCents")
  const comisionCents = comisionValida(input.comisionCents)
  const totalCents = enteroPositivo(input.totalCents, "totalCents")

  const esperado = montoAcordadoCents + comisionCents
  if (!Number.isSafeInteger(esperado) || esperado !== totalCents) {
    throw new PaypalValidationError(
      "totalCents",
      "El total debe ser igual al monto acordado mas la comision."
    )
  }

  const concepto = normalizarEspacios(
    textoRequerido(input.concepto, "concepto", "El concepto es obligatorio.")
  )

  const link = textoRequerido(input.link, "link", "El link de pago es obligatorio.")
  const fechaVencimiento = parsearVencimiento(input.vencimiento)

  return {
    idioma: input.idioma,
    canal: input.canal,
    concepto,
    clienteNombre: nombreOpcional(input.clienteNombre),
    nota: notaOpcional(input.nota),
    montoAcordado: formatearMonto(montoAcordadoCents, PAYPAL_MONEDA, LOCALES[input.idioma]),
    comision: formatearMonto(comisionCents, PAYPAL_MONEDA, LOCALES[input.idioma]),
    total: formatearMonto(totalCents, PAYPAL_MONEDA, LOCALES[input.idioma]),
    link,
    vencimiento: formatearVencimiento(fechaVencimiento, input.idioma),
  }
}

function saludo(datos: DatosPlantilla): string {
  if (datos.idioma === "es") {
    return datos.clienteNombre ? `Hola ${datos.clienteNombre},` : "Hola,"
  }
  return datos.clienteNombre ? `Hi ${datos.clienteNombre},` : "Hi,"
}

function lineasDetalle(datos: DatosPlantilla): string[] {
  const es = datos.idioma === "es"
  const lineas = [
    es ? `Concepto: ${datos.concepto}` : `Concept: ${datos.concepto}`,
    es ? `Monto acordado: ${datos.montoAcordado}` : `Agreed amount: ${datos.montoAcordado}`,
    es ? `Comisión de PayPal: ${datos.comision}` : `PayPal fee: ${datos.comision}`,
    es
      ? `Total a pagar (incluye la comisión de PayPal): ${datos.total}`
      : `Total to pay (includes the PayPal fee): ${datos.total}`,
    "",
    es ? "Pagá con PayPal desde este link:" : "Pay with PayPal using this link:",
    datos.link,
    "",
    es
      ? `Vencimiento del link: ${datos.vencimiento} (hora de Argentina).`
      : `Link expiry: ${datos.vencimiento} (Argentina time).`,
  ]

  if (datos.nota) {
    lineas.push("", es ? `Nota: ${datos.nota}` : `Note: ${datos.nota}`)
  }

  return lineas
}

function armarEmail(datos: DatosPlantilla): PaypalEmailMensaje {
  const es = datos.idioma === "es"
  const lineas = [
    saludo(datos),
    "",
    es
      ? "Te enviamos el detalle del cobro por PayPal:"
      : "Here are the details of your PayPal payment:",
    "",
    ...lineasDetalle(datos),
    "",
    es
      ? "Si tenés alguna consulta, respondé este correo."
      : "If you have any questions, just reply to this email.",
    "",
    es ? "Saludos," : "Best,",
    es ? "Equipo PixelArch" : "PixelArch Team",
  ]

  return {
    asunto: es ? `Cobro por PayPal — ${datos.concepto}` : `PayPal payment — ${datos.concepto}`,
    cuerpo: lineas.join("\n"),
  }
}

function armarWhatsapp(datos: DatosPlantilla): PaypalWhatsappMensaje {
  const es = datos.idioma === "es"
  const intro = es
    ? "te paso el detalle del cobro por PayPal:"
    : "here are the details of your PayPal payment:"

  const lineas = [`${saludo(datos)} ${intro}`, "", ...lineasDetalle(datos)]

  return { texto: lineas.join("\n") }
}

/**
 * Arma el mensaje canonico segun canal e idioma. Es puro: no envia ni consulta
 * nada. Para EMAIL devuelve `{ asunto, cuerpo }`; para WHATSAPP, `{ texto }`.
 * El nombre del cliente es opcional y nunca se incluyen datos del pagador.
 */
export function armarMensajePaypal(input: PaypalMensajeEmailInput): PaypalEmailMensaje
export function armarMensajePaypal(input: PaypalMensajeWhatsappInput): PaypalWhatsappMensaje
export function armarMensajePaypal(input: PaypalMensajeInput): PaypalMensaje
export function armarMensajePaypal(input: PaypalMensajeInput): PaypalMensaje {
  const datos = prepararDatos(input)
  return datos.canal === "EMAIL" ? armarEmail(datos) : armarWhatsapp(datos)
}
