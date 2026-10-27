/**
 * Trazabilidad tecnica e idempotencia de eventos de pasarela (T-12).
 *
 * - `EventoPasarela.eventoId` es unico: un webhook repetido no se procesa dos
 *   veces. Si el `create` choca con la constraint (`P2002`), se devuelve el
 *   evento existente marcado como `duplicado`.
 * - Solo se persisten campos tecnicos (ids, tipo, resultado, motivo, monto y
 *   moneda). No se acepta ni se guarda el payload crudo de PayPal, datos del
 *   pagador, tarjetas ni credenciales. El `motivo` se redacta y se acota.
 * - Los resultados posibles siguen el plan: `PROCESADO`, `IGNORADO`,
 *   `DUPLICADO`, `REQUIERE_ACCION`, `FIRMA_INVALIDA` y `ERROR`.
 *
 * Sin red. El cliente Prisma se inyecta en tests; por defecto usa el singleton
 * de la app.
 */

import type { Pasarela, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { redactSensitiveString } from "./redact"
import { PaypalValidationError } from "./utils"

export const RESULTADOS_EVENTO_PASARELA = [
  "PROCESADO",
  "IGNORADO",
  "DUPLICADO",
  "REQUIERE_ACCION",
  "FIRMA_INVALIDA",
  "ERROR",
] as const

export type ResultadoEventoPasarela =
  (typeof RESULTADOS_EVENTO_PASARELA)[number]

const RESULTADOS_EVENTO = new Set<string>(RESULTADOS_EVENTO_PASARELA)
const PASARELAS = new Set<string>(["MANUAL", "MERCADOPAGO", "PAYPAL"])

export const EVENTO_PASARELA_ID_MAX = 256
export const EVENTO_PASARELA_TIPO_MAX = 120
export const EVENTO_PASARELA_REFERENCIA_MAX = 128
export const EVENTO_PASARELA_MOTIVO_MAX = 200
const PRISMA_INT_MAX = 2_147_483_647

export function esResultadoEventoPasarela(
  valor: unknown
): valor is ResultadoEventoPasarela {
  return typeof valor === "string" && RESULTADOS_EVENTO.has(valor)
}

function textoRequerido(valor: unknown, campo: string, maximo: number): string {
  const texto = typeof valor === "string" ? valor.trim() : ""
  if (texto.length === 0) {
    throw new PaypalValidationError(
      campo,
      `El campo ${campo} del evento es obligatorio.`
    )
  }
  if (texto.length > maximo) {
    throw new PaypalValidationError(
      campo,
      `El campo ${campo} del evento no puede superar ${maximo} caracteres.`
    )
  }
  return texto
}

function textoOpcional(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  if (texto.length === 0) return null
  return texto.slice(0, maximo)
}

function normalizarPasarela(valor: unknown): Pasarela {
  if (typeof valor === "string" && PASARELAS.has(valor)) {
    return valor as Pasarela
  }
  throw new PaypalValidationError(
    "pasarela",
    "La pasarela del evento no es valida."
  )
}

function motivoSeguro(valor: unknown): string | null {
  if (typeof valor !== "string") return null

  const limpio = redactSensitiveString(valor)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (limpio.length === 0) return null
  return limpio.slice(0, EVENTO_PASARELA_MOTIVO_MAX)
}

function montoSeguro(valor: unknown): number | null {
  if (
    typeof valor !== "number" ||
    !Number.isSafeInteger(valor) ||
    valor < 0 ||
    valor > PRISMA_INT_MAX
  ) {
    return null
  }
  return valor
}

function monedaSegura(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const moneda = valor.trim().toLowerCase()
  return /^[a-z]{3}$/.test(moneda) ? moneda : null
}

function resolverFecha(valor: Date | null | undefined, ahora: Date): Date {
  if (valor === null || valor === undefined) return ahora
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw new PaypalValidationError(
      "procesadoEn",
      "La fecha de procesamiento del evento no es valida."
    )
  }
  return new Date(valor.getTime())
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw new PaypalValidationError(
      "ahora",
      "La fecha de referencia del evento no es valida."
    )
  }
  return new Date(valor.getTime())
}

export interface RegistrarEventoPasarelaInput {
  /** Id unico del evento de la pasarela; base de la idempotencia. */
  eventoId: string
  pasarela: Pasarela
  /** Tipo del evento (por ejemplo `PAYMENT.CAPTURE.COMPLETED`). */
  tipo: string
  externalId?: string | null
  enlacePagoId?: string | null
  pagoId?: string | null
  resultado: ResultadoEventoPasarela
  /** Motivo sanitizado; nunca debe contener payload crudo ni PII. */
  motivo?: string | null
  monto?: number | null
  moneda?: string | null
  /**
   * Default: `true` cuando el resultado es `REQUIERE_ACCION`; en el resto,
   * `false`. El caller puede forzarlo si el resultado necesita intervencion.
   */
  requiereAccion?: boolean
  /** Default: la fecha de referencia (`ahora`) o el momento actual. */
  procesadoEn?: Date | null
}

export interface EventoPasarelaRegistrado {
  id: string
  pasarela: Pasarela
  eventoId: string
  tipo: string
  externalId: string | null
  enlacePagoId: string | null
  pagoId: string | null
  resultado: string
  motivo: string | null
  monto: number | null
  moneda: string | null
  requiereAccion: boolean
  creadoEn: Date
  procesadoEn: Date | null
}

/** Sub-cliente minimo de `EventoPasarela`; inyectable en tests. */
export interface EventoPasarelaClient {
  create(args: Prisma.EventoPasarelaCreateArgs): Promise<EventoPasarelaRegistrado>
  findUnique(
    args: Prisma.EventoPasarelaFindUniqueArgs
  ): Promise<EventoPasarelaRegistrado | null>
}

/** Cliente Prisma minimo que expone `eventoPasarela`. */
export interface EventoPasarelaDb {
  eventoPasarela: EventoPasarelaClient
}

export interface RegistrarEventoPasarelaOpciones {
  db?: EventoPasarelaDb
  ahora?: Date
}

export interface RegistroEventoPasarela {
  /** Evento persistido o el existente cuando el id ya estaba registrado. */
  evento: EventoPasarelaRegistrado | null
  /** `true` si `eventoId` ya existia (incluye el caso P2002). */
  duplicado: boolean
}

function esErrorUnico(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  )
}

/**
 * Registra un evento tecnico de pasarela de forma idempotente.
 *
 * Solo se copian los campos declarados en `RegistrarEventoPasarelaInput`: un
 * `payload`, `payerEmail`, `nombre` u otro dato extra del caller se descarta y
 * nunca llega a Prisma. El `motivo` pasa por el redactor de PII.
 */
export async function registrarEventoPasarela(
  input: RegistrarEventoPasarelaInput,
  opciones: RegistrarEventoPasarelaOpciones = {}
): Promise<RegistroEventoPasarela> {
  const ahora = resolverAhora(opciones.ahora)
  const eventoId = textoRequerido(
    input?.eventoId,
    "eventoId",
    EVENTO_PASARELA_ID_MAX
  )
  const tipo = textoRequerido(
    input?.tipo,
    "tipo",
    EVENTO_PASARELA_TIPO_MAX
  )

  if (!esResultadoEventoPasarela(input?.resultado)) {
    throw new PaypalValidationError(
      "resultado",
      "El resultado del evento no es valido."
    )
  }

  const data: Prisma.EventoPasarelaUncheckedCreateInput = {
    eventoId,
    pasarela: normalizarPasarela(input?.pasarela),
    tipo,
    externalId: textoOpcional(
      input?.externalId,
      EVENTO_PASARELA_REFERENCIA_MAX
    ),
    enlacePagoId: textoOpcional(
      input?.enlacePagoId,
      EVENTO_PASARELA_REFERENCIA_MAX
    ),
    pagoId: textoOpcional(input?.pagoId, EVENTO_PASARELA_REFERENCIA_MAX),
    resultado: input.resultado,
    motivo: motivoSeguro(input?.motivo),
    monto: montoSeguro(input?.monto),
    moneda: monedaSegura(input?.moneda),
    requiereAccion:
      input?.requiereAccion ?? input.resultado === "REQUIERE_ACCION",
    procesadoEn: resolverFecha(input?.procesadoEn, ahora),
  }

  const db = (opciones.db ?? prisma) as unknown as EventoPasarelaDb

  try {
    const evento = await db.eventoPasarela.create({ data })
    return { evento, duplicado: false }
  } catch (error) {
    if (!esErrorUnico(error)) throw error

    // Idempotencia: el evento ya existe (reintento o carrera). Se devuelve el
    // registro existente en lugar de propagar el P2002.
    try {
      const evento = await db.eventoPasarela.findUnique({
        where: { eventoId },
      })
      return { evento, duplicado: true }
    } catch {
      return { evento: null, duplicado: true }
    }
  }
}
