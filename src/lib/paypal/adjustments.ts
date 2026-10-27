/**
 * Reembolsos y contracargos manuales de pagos PayPal (T-16, AC-17/AC-19/AC-22).
 *
 * - Solo lo invoca `POST /api/admin/paypal/ajustes`, que exige `requireAdmin`
 *   estricto: la asistente recibe 403. El webhook de refund/chargeback solo
 *   marca `requiereAccion`; **no** hay reversion ni descuento automatico.
 * - Crea un `AjustePago` con tipo, monto, motivo, evidencia, decision, meses y
 *   `registradoPor`, y cambia **solo** `Pago.estadoPago` a `REFUNDED`
 *   (REEMBOLSO) o `CONTRACARGO`. El pago original se conserva intacto: monto,
 *   monto acordado, comision, monto esperado, recibo y referencias PayPal no se
 *   recalculan, no se borran y no se pisan.
 * - Solo acepta pagos con `pasarela = PAYPAL`; un pago de Mercado Pago o
 *   inexistente se informa como no encontrado y no se toca.
 * - Solo son ajustables los pagos `SUCCEEDED` y los `REVISION` rechazados
 *   (`revisionEstado = RECHAZADO`). El resto responde `409
 *   ESTADO_NO_AJUSTABLE`. El `updateMany` incluye el estado (y
 *   `revisionEstado`) para que dos ajustes concurrentes no confirmen ambos.
 * - El monto no puede superar `Pago.monto` menos la suma de los `AjustePago`
 *   previos del mismo pago (`400 MONTO_EXCEDE_PAGO`). La suma se calcula dentro
 *   de la transaccion y el guard de estado evita el doble commit concurrente.
 * - La decision la elige siempre el admin:
 *   - `NINGUNA`: no toca el hito ni la suscripcion.
 *   - `REVERTIR_HITO`: el hito vinculado a **ese** pago vuelve a `PENDIENTE`
 *     con `pagadoEn = null`. No toca otros hitos, pagos ni links. Si otro
 *     `Pago` `SUCCEEDED` apunta al mismo hito se responde `409
 *     HITO_CON_OTRO_PAGO` y no se escribe nada: el admin puede registrar el
 *     reembolso con decision `NINGUNA` para no alterar el hito.
 *   - `DESCONTAR_MESES`: resta `mesesDescontados` (1..12) a
 *     `Suscripcion.proximoPago` con `addMonths`. Si la fecha calculada queda en
 *     el pasado, se conserva esa fecha (no se inventa una fecha futura) y el
 *     soporte pasa a `PAST_DUE` con `pastDueEn` (se conserva el existente). Si
 *     sigue en el futuro y estaba `PAST_DUE`, vuelve a `ACTIVE` y limpia
 *     `pastDueEn`.
 * - La PII en motivo/evidencia no se bloquea: son textos internos del admin.
 *   AC-19 se cumple porque esos campos nunca se loguean; solo ids, montos,
 *   moneda, estado y decision.
 */

import type {
  DecisionAjuste,
  Estado,
  EstadoPago,
  EstadoRevision,
  Pasarela,
  Prisma,
  TipoAjuste,
} from "@prisma/client"
import * as Sentry from "@sentry/nextjs"
import { logger } from "@/lib/logger"
import { addMonths } from "@/lib/pagos"
import { prisma } from "@/lib/prisma"

const PRISMA_INT_MAX = 2_147_483_647

export const PAGO_AJUSTE_ID_MAX = 100
export const MOTIVO_AJUSTE_MAX = 2_000
export const EVIDENCIA_AJUSTE_MAX = 2_000
export const REGISTRADO_POR_MAX = 120

const PATRON_CONTROL_INVALIDO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

const TIPOS_AJUSTE: readonly TipoAjuste[] = ["REEMBOLSO", "CONTRACARGO"]
const DECISIONES: readonly DecisionAjuste[] = [
  "NINGUNA",
  "REVERTIR_HITO",
  "DESCONTAR_MESES",
]

export type PaypalAdjustmentErrorCodigo =
  | "ARGUMENTOS_INVALIDOS"
  | "PAGO_NO_ENCONTRADO"
  | "ESTADO_NO_AJUSTABLE"
  | "MONTO_EXCEDE_PAGO"
  | "HITO_CON_OTRO_PAGO"
  | "DECISION_INCOMPATIBLE"
  | "SIN_VENCIMIENTO"
  | "ERROR_INTERNO"

const HTTP_STATUS_POR_CODIGO: Record<PaypalAdjustmentErrorCodigo, number> = {
  ARGUMENTOS_INVALIDOS: 400,
  PAGO_NO_ENCONTRADO: 404,
  ESTADO_NO_AJUSTABLE: 409,
  MONTO_EXCEDE_PAGO: 400,
  HITO_CON_OTRO_PAGO: 409,
  DECISION_INCOMPATIBLE: 400,
  SIN_VENCIMIENTO: 409,
  ERROR_INTERNO: 500,
}

/** Error tipado del ajuste; `message` es seguro de loguear y de devolver. */
export class PaypalAdjustmentError extends Error {
  readonly codigo: PaypalAdjustmentErrorCodigo
  readonly httpStatus: number

  constructor(params: {
    codigo: PaypalAdjustmentErrorCodigo
    mensaje: string
  }) {
    super(params.mensaje)
    this.name = "PaypalAdjustmentError"
    this.codigo = params.codigo
    this.httpStatus = HTTP_STATUS_POR_CODIGO[params.codigo]
  }
}

export function esPaypalAdjustmentError(
  error: unknown
): error is PaypalAdjustmentError {
  return error instanceof PaypalAdjustmentError
}

export interface RegistrarAjustePaypalInput {
  /** Pago PayPal original; nunca se borra ni se recalcula. */
  pagoId: string
  tipo: TipoAjuste
  /** Monto del reembolso/contracargo en centavos USD enteros. */
  montoCents: number
  motivo?: string | null
  /** Texto o URL (id de reembolso, comprobante o nota). Sin archivos ni PII. */
  evidencia?: string | null
  /** Decision explicita del admin; no existe default automatico. */
  decision: DecisionAjuste
  /** Solo `DESCONTAR_MESES`: 1..12. */
  mesesDescontados?: number | null
  /** Trazabilidad: nombre del admin que registra el ajuste. */
  registradoPor?: string | null
}

export interface RegistrarAjustePaypalOpciones {
  /** Fecha de referencia para `creadoEn` y para detectar el soporte vencido. */
  ahora?: Date
  /** Cliente Prisma inyectable en tests. Default: singleton de la app. */
  db?: PaypalAdjustmentDb
}

export type EstadoPagoAjuste = Extract<EstadoPago, "REFUNDED" | "CONTRACARGO">

export interface ResultadoAjustePaypal {
  ajusteId: string
  pagoId: string
  tipo: TipoAjuste
  decision: DecisionAjuste
  estadoPago: EstadoPagoAjuste
  mesesDescontados: number | null
  hitoRevertido: boolean
  vencimientoDescontado: boolean
  /** `true` si el nuevo vencimiento quedo en el pasado y el soporte es PAST_DUE. */
  soporteEnMora: boolean
}

/** Pago minimo para decidir el ajuste. */
export interface PagoAjustable {
  id: string
  pasarela: Pasarela
  hitoId: string | null
  suscripcionId: string | null
  estadoPago: EstadoPago
  revisionEstado: EstadoRevision | null
  monto: number
}

/** Suscripcion minima para descontar meses. */
export interface SuscripcionAjustable {
  id: string
  proximoPago: Date | null
  estado: Estado
  pastDueEn: Date | null
}

/** Cliente dentro de la transaccion. */
export interface PaypalAdjustmentTx {
  pago: {
    findUnique(args: Prisma.PagoFindUniqueArgs): Promise<PagoAjustable | null>
    findFirst(args: Prisma.PagoFindFirstArgs): Promise<{ id: string } | null>
    updateMany(args: Prisma.PagoUpdateManyArgs): Promise<{ count: number }>
  }
  hito: {
    updateMany(args: Prisma.HitoUpdateManyArgs): Promise<{ count: number }>
  }
  suscripcion: {
    findUnique(
      args: Prisma.SuscripcionFindUniqueArgs
    ): Promise<SuscripcionAjustable | null>
    updateMany(
      args: Prisma.SuscripcionUpdateManyArgs
    ): Promise<{ count: number }>
  }
  ajustePago: {
    findMany(
      args: Prisma.AjustePagoFindManyArgs
    ): Promise<Array<{ monto: number }>>
    create(args: Prisma.AjustePagoCreateArgs): Promise<{ id: string }>
  }
}

/**
 * Cliente Prisma con transacciones. `$transaction` es opcional para que los
 * dobles de test puedan ejecutar el callback directamente; en la app real
 * siempre esta presente y el ajuste es atomico.
 */
export interface PaypalAdjustmentDb extends PaypalAdjustmentTx {
  $transaction?<T>(fn: (tx: PaypalAdjustmentTx) => Promise<T>): Promise<T>
}

interface DatosAjusteValidados {
  pagoId: string
  tipo: TipoAjuste
  montoCents: number
  motivo: string | null
  evidencia: string | null
  decision: DecisionAjuste
  mesesDescontados: number | null
  registradoPor: string
}

function error(
  codigo: PaypalAdjustmentErrorCodigo,
  mensaje: string
): PaypalAdjustmentError {
  return new PaypalAdjustmentError({ codigo, mensaje })
}

function resolverAhora(valor: Date | undefined): Date {
  if (valor === undefined) return new Date()
  if (!(valor instanceof Date) || !Number.isFinite(valor.getTime())) {
    throw error("ARGUMENTOS_INVALIDOS", "La fecha del ajuste no es valida.")
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

function normalizarPagoId(valor: unknown): string {
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", "El pagoId no es valido.")
  }
  const texto = valor.trim()
  if (texto.length === 0 || texto.length > PAGO_AJUSTE_ID_MAX) {
    throw error("ARGUMENTOS_INVALIDOS", "El pagoId no es valido.")
  }
  return texto
}

function normalizarTipo(valor: unknown): TipoAjuste {
  if (
    typeof valor !== "string" ||
    !TIPOS_AJUSTE.includes(valor as TipoAjuste)
  ) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "El tipo debe ser REEMBOLSO o CONTRACARGO."
    )
  }
  return valor as TipoAjuste
}

function normalizarDecision(valor: unknown): DecisionAjuste {
  if (
    typeof valor !== "string" ||
    !DECISIONES.includes(valor as DecisionAjuste)
  ) {
    throw error("ARGUMENTOS_INVALIDOS", "La decision del ajuste no es valida.")
  }
  return valor as DecisionAjuste
}

function normalizarTexto(
  valor: unknown,
  campo: string,
  maximo: number
): string | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== "string") {
    throw error("ARGUMENTOS_INVALIDOS", `El campo ${campo} no es valido.`)
  }

  const texto = valor.trim()
  if (texto.length === 0) return null
  if (texto.length > maximo) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      `El campo ${campo} no puede superar ${maximo} caracteres.`
    )
  }
  if (PATRON_CONTROL_INVALIDO.test(texto)) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      `El campo ${campo} contiene caracteres no permitidos.`
    )
  }

  // La PII en texto libre no se bloquea: es evidencia interna del admin. AC-19
  // se cumple porque motivo/evidencia nunca se loguean.
  return texto
}

function validarEntrada(
  input: RegistrarAjustePaypalInput | null | undefined
): DatosAjusteValidados {
  if (!input || typeof input !== "object") {
    throw error("ARGUMENTOS_INVALIDOS", "Datos invalidos.")
  }

  const pagoId = normalizarPagoId(input.pagoId)
  const tipo = normalizarTipo(input.tipo)
  const montoCents = enteroEnRango(
    input.montoCents,
    "montoCents",
    1,
    PRISMA_INT_MAX
  )
  const decision = normalizarDecision(input.decision)

  let mesesDescontados: number | null = null
  if (decision === "DESCONTAR_MESES") {
    mesesDescontados = enteroEnRango(
      input.mesesDescontados,
      "mesesDescontados",
      1,
      12
    )
  } else if (
    input.mesesDescontados !== null &&
    input.mesesDescontados !== undefined
  ) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "mesesDescontados solo aplica a la decision DESCONTAR_MESES."
    )
  }

  const motivo = normalizarTexto(input.motivo, "motivo", MOTIVO_AJUSTE_MAX)
  const evidencia = normalizarTexto(
    input.evidencia,
    "evidencia",
    EVIDENCIA_AJUSTE_MAX
  )

  if (!motivo && !evidencia) {
    throw error(
      "ARGUMENTOS_INVALIDOS",
      "El ajuste requiere al menos un motivo o una evidencia."
    )
  }

  const registradoPor =
    typeof input.registradoPor === "string" &&
    input.registradoPor.trim().length > 0
      ? input.registradoPor.trim().slice(0, REGISTRADO_POR_MAX)
      : "Admin"

  return {
    pagoId,
    tipo,
    montoCents,
    motivo,
    evidencia,
    decision,
    mesesDescontados,
    registradoPor,
  }
}

function estadoPagoDeAjuste(tipo: TipoAjuste): EstadoPagoAjuste {
  return tipo === "REEMBOLSO" ? "REFUNDED" : "CONTRACARGO"
}

function esEstadoAjustable(pago: PagoAjustable): boolean {
  return (
    pago.estadoPago === "SUCCEEDED" ||
    (pago.estadoPago === "REVISION" &&
      pago.revisionEstado === "RECHAZADO")
  )
}

async function enTransaccion<T>(
  db: PaypalAdjustmentDb,
  fn: (tx: PaypalAdjustmentTx) => Promise<T>
): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction(fn)
  }
  return fn(db)
}

/**
 * Registra el ajuste y aplica la decision elegida por el admin en una sola
 * transaccion. Cualquier fallo posterior revierte el `AjustePago`, el estado
 * del pago y el efecto sobre el hito/soporte.
 */
export async function registrarAjustePaypal(
  input: RegistrarAjustePaypalInput,
  opciones: RegistrarAjustePaypalOpciones = {}
): Promise<ResultadoAjustePaypal> {
  const ahora = resolverAhora(opciones.ahora)
  const datos = validarEntrada(input)
  const db = (opciones.db ?? prisma) as unknown as PaypalAdjustmentDb

  try {
    return await enTransaccion(db, async (tx) => {
      const pago = await tx.pago.findUnique({
        where: { id: datos.pagoId },
        select: {
          id: true,
          pasarela: true,
          hitoId: true,
          suscripcionId: true,
          estadoPago: true,
          revisionEstado: true,
          monto: true,
        },
      })

      // Un pago de otra pasarela se trata como inexistente: este flujo solo
      // opera PayPal y no debe exponer ni modificar datos de Mercado Pago.
      if (!pago || pago.pasarela !== "PAYPAL") {
        throw error("PAGO_NO_ENCONTRADO", "Pago PayPal no encontrado.")
      }

      if (!esEstadoAjustable(pago)) {
        throw error(
          "ESTADO_NO_AJUSTABLE",
          "El pago no esta en un estado ajustable."
        )
      }

      const ajustesPrevios = await tx.ajustePago.findMany({
        where: { pagoId: pago.id },
        select: { monto: true },
      })
      const montoAjustado = ajustesPrevios.reduce(
        (total, ajuste) => total + ajuste.monto,
        0
      )
      const montoDisponible = pago.monto - montoAjustado
      if (datos.montoCents > montoDisponible) {
        throw error(
          "MONTO_EXCEDE_PAGO",
          "El monto del ajuste supera el monto disponible del pago."
        )
      }

      if (datos.decision === "REVERTIR_HITO" && !pago.hitoId) {
        throw error(
          "DECISION_INCOMPATIBLE",
          "El pago no tiene un hito para revertir."
        )
      }

      if (datos.decision === "DESCONTAR_MESES" && !pago.suscripcionId) {
        throw error(
          "DECISION_INCOMPATIBLE",
          "El pago no tiene un soporte para descontar meses."
        )
      }

      // Si el hito ya esta pagado por otro pago exitoso, revertirlo dejaria un
      // cobro vigente sin hito pagado. Se rechaza sin escribir nada (ni el
      // ajuste ni el estado del pago): el admin puede usar NINGUNA si solo
      // quiere registrar el reembolso/contracargo.
      if (datos.decision === "REVERTIR_HITO" && pago.hitoId) {
        const otroPago = await tx.pago.findFirst({
          where: {
            hitoId: pago.hitoId,
            estadoPago: "SUCCEEDED",
            id: { not: pago.id },
          },
          select: { id: true },
        })
        if (otroPago) {
          throw error(
            "HITO_CON_OTRO_PAGO",
            "El hito tiene otro pago exitoso y no se puede revertir."
          )
        }
      }

      const estadoPago = estadoPagoDeAjuste(datos.tipo)
      const mesesDescontados =
        datos.decision === "DESCONTAR_MESES" ? datos.mesesDescontados : null

      const ajuste = await tx.ajustePago.create({
        data: {
          pagoId: pago.id,
          tipo: datos.tipo,
          monto: datos.montoCents,
          motivo: datos.motivo,
          evidencia: datos.evidencia,
          decision: datos.decision,
          mesesDescontados,
          registradoPor: datos.registradoPor,
          creadoEn: ahora,
        },
        select: { id: true },
      })

      // Solo se cambia el estado. Montos, comision, recibo y referencias del
      // pago original se conservan tal cual (AC-22). El where repite el estado
      // leido (y revisionEstado en REVISION) para que dos ajustes concurrentes
      // no puedan confirmar ambos.
      const actualizado = await tx.pago.updateMany({
        where: {
          id: pago.id,
          pasarela: "PAYPAL",
          estadoPago: pago.estadoPago,
          ...(pago.estadoPago === "REVISION"
            ? { revisionEstado: pago.revisionEstado }
            : {}),
        },
        data: { estadoPago },
      })
      if (actualizado.count !== 1) {
        throw error(
          "ERROR_INTERNO",
          "No se pudo actualizar el pago de PayPal."
        )
      }

      let hitoRevertido = false
      let vencimientoDescontado = false
      let soporteEnMora = false

      if (datos.decision === "REVERTIR_HITO" && pago.hitoId) {
        const revertido = await tx.hito.updateMany({
          where: { id: pago.hitoId },
          data: { estado: "PENDIENTE", pagadoEn: null },
        })
        if (revertido.count !== 1) {
          throw error(
            "ERROR_INTERNO",
            "No se pudo revertir el hito del pago."
          )
        }
        hitoRevertido = true
      }

      if (datos.decision === "DESCONTAR_MESES" && pago.suscripcionId) {
        const suscripcion = await tx.suscripcion.findUnique({
          where: { id: pago.suscripcionId },
          select: {
            id: true,
            proximoPago: true,
            estado: true,
            pastDueEn: true,
          },
        })

        if (!suscripcion || !suscripcion.proximoPago) {
          throw error(
            "SIN_VENCIMIENTO",
            "El soporte no tiene un vencimiento para descontar."
          )
        }

        const nuevoProximoPago = addMonths(
          suscripcion.proximoPago,
          -(mesesDescontados as number)
        )
        if (
          !(nuevoProximoPago instanceof Date) ||
          !Number.isFinite(nuevoProximoPago.getTime())
        ) {
          throw error(
            "ERROR_INTERNO",
            "No se pudo calcular el nuevo vencimiento del soporte."
          )
        }

        // Si el descuento deja el vencimiento en el pasado, se conserva la
        // fecha calculada (sin inventar una futura) y el soporte queda vencido.
        soporteEnMora = nuevoProximoPago.getTime() < ahora.getTime()

        const actualizada = await tx.suscripcion.updateMany({
          where: { id: suscripcion.id },
          data: {
            proximoPago: nuevoProximoPago,
            ...(soporteEnMora
              ? {
                  estado: "PAST_DUE" as const,
                  pastDueEn: suscripcion.pastDueEn ?? ahora,
                }
              : suscripcion.estado === "PAST_DUE"
                ? {
                    estado: "ACTIVE" as const,
                    pastDueEn: null,
                  }
                : {}),
          },
        })
        if (actualizada.count !== 1) {
          throw error(
            "ERROR_INTERNO",
            "No se pudo descontar los meses del soporte."
          )
        }
        vencimientoDescontado = true
      }

      return {
        ajusteId: ajuste.id,
        pagoId: pago.id,
        tipo: datos.tipo,
        decision: datos.decision,
        estadoPago,
        mesesDescontados,
        hitoRevertido,
        vencimientoDescontado,
        soporteEnMora,
      }
    })
  } catch (err) {
    if (esPaypalAdjustmentError(err)) {
      // Los errores funcionales (400/404/409) ya son parte del contrato. Un
      // ERROR_INTERNO si es un 5xx: se reporta sin incluir motivo/evidencia.
      if (err.codigo === "ERROR_INTERNO") {
        Sentry.captureException(err)
        logger.error("Error interno registrando ajuste PayPal", {
          pagoId: datos.pagoId,
          tipo: datos.tipo,
          decision: datos.decision,
          monto: datos.montoCents,
          moneda: "usd",
          error: err.name,
        })
      }
      throw err
    }

    // Nunca se loguean motivo, evidencia ni datos del pagador: solo ids,
    // montos, moneda y decision. Sentry recibe el error tecnico, no el input.
    Sentry.captureException(err)
    logger.error("Error registrando ajuste PayPal", {
      pagoId: datos.pagoId,
      tipo: datos.tipo,
      decision: datos.decision,
      monto: datos.montoCents,
      moneda: "usd",
      error: err instanceof Error ? err.name : "Error desconocido",
    })

    throw error(
      "ERROR_INTERNO",
      "Error al registrar el ajuste de PayPal."
    )
  }
}
