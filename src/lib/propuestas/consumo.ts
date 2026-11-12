/**
 * T-11 (AC-11, AC-12, AC-38, AC-39; RF-17, RF-57, RF-58): cupos, consumo y
 * costos por proveedor/dia para el portal de propuestas.
 *
 * Reglas del plan §4.1/§4.3 y la spec §14:
 * - `evaluarCupo` es logica pura: cap <= 0 bloquea, entradas invalidas fallan
 *   cerrado, el 80% avisa y el 100% bloquea. No inventa valores.
 * - `reservarCupo` corre dentro de una transaccion Prisma provista por el
 *   llamador. Cuando el presupuesto efectivo es mayor que 0 toma primero el
 *   lock global del presupuesto (`PROPUESTAS_PRESUPUESTO`) y despues el lock
 *   por `(proveedor, fecha)`. El orden fijo global -> diario evita el ciclo de
 *   deadlock incluso cuando una transaccion reserva dias o meses distintos:
 *   ninguna retiene un diario mientras espera el global que otra ya tiene.
 *   Relee el consumo ya confirmado y recien despues hace el upsert. Dos
 *   reservas simultaneas quedan serializadas y no pueden superar el tope ni el
 *   presupuesto.
 * - La fila de `ConsumoProveedor` se identifica por
 *   `clave = <campanaId>:<proveedor>:<YYYY-MM-DD>:<prospectoId|GLOBAL>`.
 *   La fecha se normaliza a UTC con `Date.UTC(y, m, d)`.
 * - El tope diario global se calcula sumando todas las campañas del proveedor;
 *   el tope por campaña se aplica solo si se pasa. El presupuesto mensual es
 *   global y se aplica cuando el presupuesto efectivo es mayor que 0.
 * - Presupuesto efectivo (`resolverPresupuestoEfectivo`): si
 *   `configPropuestas().costos.presupuestoMensualCentavos` es > 0, ese valor es
 *   autoritativo y los overrides de la reserva/opciones no pueden anularlo (ni
 *   con 0); `estadoCupos` usa la misma regla. El override solo se usa cuando
 *   la config global es 0 (tests/dev). Un presupuesto invalido falla con
 *   `LIMITE`/`CONFIGURACION`.
 * - Los costos se guardan en centavos. Sin configuracion de costo se registra
 *   0; no se estima un valor que no exista.
 *
 * Modulo server-only. No importa el cliente de Prisma en tiempo de carga:
 * recibe un cliente o transaccion inyectable (`Pick<Prisma.TransactionClient,
 * ...>`) y solo usa un import dinamico del singleton si no se inyecta cliente.
 * `configPropuestas()` se usa como fallback cuando un limite/costo no se pasa
 * de forma explicita. No toca red, Resend ni Places.
 */

import type { Prisma } from "@prisma/client"

import { configPropuestas, type ConfigPropuestas } from "./config"
import type { CodigoError } from "./errores"

export const UMBRAL_ALERTA_CUPO = 0.8

/** Orden estable para mostrar el estado de cupos en la UI. */
export const PROVEEDORES_CONSUMO = [
  "GOOGLE_PLACES",
  "WEB_FETCH",
  "AUDITORIA",
  "REDACTOR",
  "RESEND",
] as const

export type ClienteConsumo = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "consumoProveedor"
>

export type ConfigConsumo = Pick<ConfigPropuestas, "cupos" | "costos">

export type CodigoErrorCupo = Extract<CodigoError, "CUPO" | "LIMITE">

export type AmbitoErrorCupo =
  | "GLOBAL"
  | "CAMPANA"
  | "PRESUPUESTO"
  | "CONFIGURACION"
  | "VALIDACION"

const MENSAJES_CUPO: Record<CodigoErrorCupo, string> = {
  CUPO: "Se alcanzo el cupo configurado.",
  LIMITE: "Se alcanzo un limite del proveedor.",
}

/** Error tipado de cupo/presupuesto; el mensaje es seguro de mostrar y loguear. */
export class ErrorCupo extends Error {
  readonly codigo: CodigoErrorCupo
  readonly httpStatus = 429
  readonly ambito: AmbitoErrorCupo
  readonly restantes: number
  readonly restantePresupuestoCentavos: number | null

  constructor(params: {
    codigo: CodigoErrorCupo
    ambito?: AmbitoErrorCupo
    restantes?: number
    restantePresupuestoCentavos?: number | null
    mensaje?: string
  }) {
    super(params.mensaje ?? MENSAJES_CUPO[params.codigo])
    this.name = "ErrorCupo"
    this.codigo = params.codigo
    this.ambito = params.ambito ?? "GLOBAL"
    this.restantes = params.restantes ?? 0
    this.restantePresupuestoCentavos =
      params.restantePresupuestoCentavos ?? null
  }
}

export function esErrorCupo(error: unknown): error is ErrorCupo {
  return error instanceof ErrorCupo
}

function esEnteroNoNegativo(valor: unknown): valor is number {
  return Number.isSafeInteger(valor) && (valor as number) >= 0
}

function esEnteroPositivo(valor: unknown): valor is number {
  return Number.isSafeInteger(valor) && (valor as number) >= 1
}

function esProveedorConsumo(valor: unknown): valor is ProveedorConsumoCupo {
  return (
    typeof valor === "string" &&
    (PROVEEDORES_CONSUMO as readonly string[]).includes(valor)
  )
}

export type ProveedorConsumoCupo = (typeof PROVEEDORES_CONSUMO)[number]

function errorValidacion(mensaje?: string): ErrorCupo {
  return new ErrorCupo({
    codigo: "LIMITE",
    ambito: "VALIDACION",
    mensaje,
  })
}

function errorConfiguracion(mensaje?: string): ErrorCupo {
  return new ErrorCupo({
    codigo: "LIMITE",
    ambito: "CONFIGURACION",
    mensaje,
  })
}

function crearConfigLazy(opciones: {
  config?: ConfigConsumo
}): () => ConfigConsumo {
  let cache: ConfigConsumo | null = null

  return () => {
    if (cache === null) cache = opciones.config ?? configPropuestas()
    return cache
  }
}

/**
 * Resuelve el presupuesto mensual efectivo en centavos con una unica regla
 * compartida por `reservarCupo` y `estadoCupos`:
 *
 * - `config.costos.presupuestoMensualCentavos > 0` es autoritativo y no se
 *   puede desactivar con un override (ni con 0).
 * - Si la config es 0, se usa `override ?? 0` (tests/dev).
 * - Cualquier valor invalido falla cerrado con `LIMITE`/`CONFIGURACION`.
 *
 * El presupuesto es global: no depende de proveedor, campaña ni mes.
 */
export function resolverPresupuestoEfectivo(
  config: ConfigConsumo,
  override?: number,
): number {
  const presupuestoConfig = config.costos.presupuestoMensualCentavos
  if (!esEnteroNoNegativo(presupuestoConfig)) {
    throw errorConfiguracion("El presupuesto mensual no es valido.")
  }

  if (presupuestoConfig > 0) return presupuestoConfig

  const efectivo = override ?? 0
  if (!esEnteroNoNegativo(efectivo)) {
    throw errorConfiguracion("El presupuesto mensual no es valido.")
  }

  return efectivo
}

function capPorProveedor(
  proveedor: ProveedorConsumoCupo,
  config: ConfigConsumo,
): number {
  switch (proveedor) {
    case "GOOGLE_PLACES":
      return config.cupos.placesDia
    case "WEB_FETCH":
      return config.cupos.fetchesDia
    case "AUDITORIA":
      return config.cupos.auditoriasDia
    case "REDACTOR":
      return config.cupos.borradoresDia
    case "RESEND":
      return config.cupos.enviosDia
    default:
      return 0
  }
}

function costoUnidadPorProveedor(
  proveedor: ProveedorConsumoCupo,
  config: ConfigConsumo,
): number {
  switch (proveedor) {
    case "GOOGLE_PLACES":
      return config.costos.placesCentavos
    case "RESEND":
      return config.costos.resendCentavos
    default:
      // Fetch, auditoria y redactor no tienen costo variable configurado.
      return 0
  }
}

/** Normaliza una fecha a medianoche UTC con `Date.UTC(y, m, d)`. */
export function normalizarFechaUTC(fecha: Date): Date {
  if (!(fecha instanceof Date) || !Number.isFinite(fecha.getTime())) {
    throw errorValidacion("La fecha no es valida.")
  }

  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate(),
    ),
  )
}

/** Fecha estable `YYYY-MM-DD` en UTC (base de la clave de consumo). */
export function fechaISOUTC(fecha: Date): string {
  return normalizarFechaUTC(fecha).toISOString().slice(0, 10)
}

function validarIdentificador(
  valor: unknown,
  campo: string,
): string {
  if (typeof valor !== "string") {
    throw errorValidacion(`Falta ${campo}.`)
  }

  const limpio = valor.trim()
  if (limpio.length === 0 || limpio.length > 128 || limpio.includes(":")) {
    throw errorValidacion(`${campo} no es valido.`)
  }

  return limpio
}

export interface PartesClaveConsumo {
  campanaId: string
  proveedor: ProveedorConsumoCupo
  fecha: Date
  prospectoId?: string | null
}

/**
 * Clave estable de la fila de consumo:
 * `<campanaId>:<proveedor>:<YYYY-MM-DD>:<prospectoId|GLOBAL>`.
 */
export function claveConsumo(partes: PartesClaveConsumo): string {
  const campanaId = validarIdentificador(partes.campanaId, "campanaId")

  if (!esProveedorConsumo(partes.proveedor)) {
    throw errorValidacion("El proveedor no es valido.")
  }

  const prospectoId =
    partes.prospectoId === undefined || partes.prospectoId === null
      ? "GLOBAL"
      : validarIdentificador(partes.prospectoId, "prospectoId")

  return `${campanaId}:${partes.proveedor}:${fechaISOUTC(partes.fecha)}:${prospectoId}`
}

/**
 * Clave del advisory lock: un dia UTC por proveedor. Se exporta para que un
 * cliente simulado pueda reproducir la exclusion mutua en los tests.
 */
export function claveLockCupo(
  proveedor: ProveedorConsumoCupo,
  fecha: Date,
): { proveedor: ProveedorConsumoCupo; fecha: string } {
  return { proveedor, fecha: fechaISOUTC(fecha) }
}

/**
 * Clave del advisory lock global del presupuesto. Se exporta para que un
 * cliente simulado pueda reproducir la exclusion mutua en los tests.
 *
 * El presupuesto es global (todos los proveedores, campañas, dias y meses):
 * una sola clave `PROPUESTAS_PRESUPUESTO` serializa cualquier reserva con
 * presupuesto efectivo > 0. Al no depender de la fecha, una transaccion que
 * reserva meses distintos no puede invertir locks con otra.
 */
export function claveLockPresupuesto(): {
  clave: "PROPUESTAS_PRESUPUESTO"
} {
  return { clave: "PROPUESTAS_PRESUPUESTO" }
}

// ---------------------------------------------------------------------------
// Evaluacion pura de cupo
// ---------------------------------------------------------------------------

export interface EntradaEvaluarCupo {
  usado: number
  cantidad: number
  cap: number
  /** Default 0.8; debe ser > 0 y <= 1. */
  umbral?: number
}

export interface ResultadoEvaluarCupo {
  permitido: boolean
  /** Capacidad restante despues de la cantidad solicitada (nunca negativa). */
  restantes: number
  /** `usado + cantidad` alcanza el umbral de aviso (80% por defecto). */
  alerta: boolean
}

/**
 * Evalua si una reserva cabe en el cupo. Entradas invalidas, negativas o
 * `cap <= 0` fallan cerrado. No modifica estado ni inventa valores.
 */
export function evaluarCupo(
  entrada: EntradaEvaluarCupo,
): ResultadoEvaluarCupo {
  const umbral = entrada.umbral ?? UMBRAL_ALERTA_CUPO

  if (
    !esEnteroNoNegativo(entrada.usado) ||
    !esEnteroPositivo(entrada.cantidad) ||
    !esEnteroNoNegativo(entrada.cap) ||
    !Number.isFinite(umbral) ||
    umbral <= 0 ||
    umbral > 1
  ) {
    return { permitido: false, restantes: 0, alerta: false }
  }

  if (entrada.cap <= 0) {
    return { permitido: false, restantes: 0, alerta: false }
  }

  const total = entrada.usado + entrada.cantidad
  if (!Number.isSafeInteger(total)) {
    return { permitido: false, restantes: 0, alerta: false }
  }

  return {
    permitido: total <= entrada.cap,
    restantes: Math.max(0, entrada.cap - total),
    alerta: total / entrada.cap >= umbral,
  }
}

// ---------------------------------------------------------------------------
// Reserva transaccional
// ---------------------------------------------------------------------------

export interface ReservaCupo {
  campanaId: string
  proveedor: ProveedorConsumoCupo
  /** Si se omite, la clave usa `GLOBAL` (consumo por campaña). */
  prospectoId?: string | null
  /** Default: ahora. Se normaliza a medianoche UTC. */
  fecha?: Date
  /** Unidades de cupo. Default 1. */
  cantidad?: number
  /** Llamadas externas. Default: `cantidad`. */
  llamadas?: number
  /** Tope diario global del proveedor (todas las campañas). */
  capDiario?: number
  /** Tope diario de la campaña; si se omite no se aplica. */
  capCampana?: number
  /** Costo total de esta reserva en centavos. */
  costoCentavos?: number
  /**
   * Override de tests/dev; solo aplica si la config global es 0. La config
   * global con valor > 0 es autoritativa y no se puede anular. 0 = sin tope
   * monetario. El presupuesto es global (todos los proveedores).
   */
  presupuestoMensualCentavos?: number
  umbral?: number
}

export interface OpcionesReservaCupo {
  config?: ConfigConsumo
  capDiario?: number
  capCampana?: number
  /** Costo por unidad en centavos; se multiplica por `cantidad`. */
  costoUnidadCentavos?: number
  /**
   * Override de tests/dev; solo aplica si la config global es 0. Nunca
   * desactiva un presupuesto configurado.
   */
  presupuestoMensualCentavos?: number
  umbral?: number
}

export interface ResultadoReservaCupo {
  /** Cupo diario global restante despues de esta reserva. */
  restantes: number
}

async function leerFilasDia(
  tx: Pick<Prisma.TransactionClient, "consumoProveedor">,
  proveedor: ProveedorConsumoCupo,
  fecha: Date,
): Promise<Array<{ campanaId: string; unidades: number; costoCentavos: number }>> {
  const filas = await tx.consumoProveedor.findMany({
    where: { proveedor, fecha },
    select: {
      campanaId: true,
      unidades: true,
      costoCentavos: true,
    },
  })

  for (const fila of filas) {
    if (!esEnteroNoNegativo(fila.unidades)) {
      throw errorConfiguracion("El consumo registrado no es valido.")
    }
    if (!esEnteroNoNegativo(fila.costoCentavos)) {
      throw errorConfiguracion("El costo registrado no es valido.")
    }
  }

  return filas
}

async function leerCostoMes(
  tx: Pick<Prisma.TransactionClient, "consumoProveedor">,
  fecha: Date,
): Promise<number> {
  const inicio = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1),
  )
  const siguiente = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 1),
  )

  const filas = await tx.consumoProveedor.findMany({
    where: { fecha: { gte: inicio, lt: siguiente } },
    select: { costoCentavos: true },
  })

  let total = 0
  for (const fila of filas) {
    if (!esEnteroNoNegativo(fila.costoCentavos)) {
      throw errorConfiguracion("El costo registrado no es valido.")
    }

    total += fila.costoCentavos
    if (!Number.isSafeInteger(total)) {
      throw errorConfiguracion("El costo registrado no es valido.")
    }
  }

  return total
}

/**
 * Reserva cupo dentro de una transaccion Prisma. El llamador debe envolver la
 * llamada en `prisma.$transaction(async (tx) => reservarCupo(tx, reserva))`.
 *
 * Orden: validar -> lock global del presupuesto (`PROPUESTAS_PRESUPUESTO`) si
 * el presupuesto efectivo es > 0 (aunque el costo sea 0) -> lock diario
 * `(proveedor, fecha)` -> releer consumo confirmado -> evaluar tope
 * global/campaña -> chequeo de presupuesto (solo si el costo es > 0) -> upsert.
 * El orden global -> diario es fijo para todas las reservas y evita deadlocks
 * incluso cuando una transaccion reserva proveedores, dias o meses distintos.
 * Los locks se liberan al terminar la transaccion (`pg_advisory_xact_lock`).
 *
 * Lanza `ErrorCupo` con codigo `CUPO` (tope diario/por campaña) o `LIMITE`
 * (presupuesto/entrada invalida). No hay sobreconsumo silencioso ni cola.
 */
export async function reservarCupo(
  tx: ClienteConsumo,
  reserva: ReservaCupo,
  opciones: OpcionesReservaCupo = {},
): Promise<ResultadoReservaCupo> {
  if (!esProveedorConsumo(reserva.proveedor)) {
    throw errorValidacion("El proveedor no es valido.")
  }

  const campanaId = validarIdentificador(reserva.campanaId, "campanaId")
  const prospectoId =
    reserva.prospectoId === undefined || reserva.prospectoId === null
      ? null
      : validarIdentificador(reserva.prospectoId, "prospectoId")
  const proveedor = reserva.proveedor
  const fecha = normalizarFechaUTC(reserva.fecha ?? new Date())

  const cantidad = reserva.cantidad ?? 1
  if (!esEnteroPositivo(cantidad)) {
    throw errorValidacion("La cantidad debe ser un entero positivo.")
  }

  const llamadas = reserva.llamadas ?? cantidad
  if (!esEnteroNoNegativo(llamadas)) {
    throw errorValidacion("Las llamadas deben ser un entero no negativo.")
  }

  const config = crearConfigLazy(opciones)

  let capDiario = reserva.capDiario ?? opciones.capDiario
  if (capDiario === undefined) {
    capDiario = capPorProveedor(proveedor, config())
  }
  if (!Number.isSafeInteger(capDiario)) {
    throw errorConfiguracion("El cupo diario no es valido.")
  }
  if (capDiario <= 0) {
    throw new ErrorCupo({
      codigo: "CUPO",
      ambito: "CONFIGURACION",
      restantes: 0,
      mensaje: "El cupo diario no esta configurado; la accion queda bloqueada.",
    })
  }

  const capCampana = reserva.capCampana ?? opciones.capCampana
  if (capCampana !== undefined) {
    if (!Number.isSafeInteger(capCampana)) {
      throw errorConfiguracion("El cupo por campaña no es valido.")
    }
    if (capCampana <= 0) {
      throw new ErrorCupo({
        codigo: "CUPO",
        ambito: "CAMPANA",
        restantes: 0,
        mensaje: "El cupo de la campaña no esta configurado; la accion queda bloqueada.",
      })
    }
  }

  // Presupuesto efectivo: la config global > 0 manda y no puede desactivarse
  // con un override (ni con 0). Los overrides solo aplican cuando la config
  // global es 0 (tests/dev). Un valor invalido falla cerrado. La misma regla
  // se comparte con `estadoCupos`.
  const presupuestoMensualCentavos = resolverPresupuestoEfectivo(
    config(),
    reserva.presupuestoMensualCentavos ??
      opciones.presupuestoMensualCentavos,
  )

  let costoCentavos: number
  if (reserva.costoCentavos !== undefined) {
    if (!esEnteroNoNegativo(reserva.costoCentavos)) {
      throw errorConfiguracion("El costo no es valido.")
    }
    costoCentavos = reserva.costoCentavos
  } else {
    const costoUnidad =
      opciones.costoUnidadCentavos ??
      costoUnidadPorProveedor(proveedor, config())
    if (!esEnteroNoNegativo(costoUnidad)) {
      throw errorConfiguracion("El costo unitario no es valido.")
    }

    costoCentavos = costoUnidad * cantidad
    if (!Number.isSafeInteger(costoCentavos)) {
      throw errorConfiguracion("El costo no es valido.")
    }
  }

  const umbral = reserva.umbral ?? opciones.umbral ?? UMBRAL_ALERTA_CUPO
  if (!Number.isFinite(umbral) || umbral <= 0 || umbral > 1) {
    throw errorConfiguracion("El umbral de alerta no es valido.")
  }

  // El lock global del presupuesto se toma siempre que el presupuesto efectivo
  // sea > 0, aunque el costo de esta reserva sea 0, para que todas las
  // reservas sigan el mismo orden. El chequeo del gasto mensual solo corre si
  // ademas hay costo.
  const aplicaPresupuesto = presupuestoMensualCentavos > 0
  const verificaPresupuesto = aplicaPresupuesto && costoCentavos > 0

  // Orden fijo de locks para evitar deadlocks: (1) global del presupuesto y
  // (2) diario por (proveedor, fecha). El presupuesto es global (no depende
  // del mes), asi que una transaccion que reserva proveedores, dias o meses
  // distintos toma siempre el mismo lock global antes que cualquier diario y
  // nunca puede retener un diario mientras espera un lock global que otra
  // transaccion ya tiene: no hay ciclo posible. Ambos locks son
  // transaccionales (`pg_advisory_xact_lock`) y se liberan al commit/rollback.
  if (aplicaPresupuesto) {
    const lockPresupuesto = claveLockPresupuesto()
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockPresupuesto.clave}))`
  }

  const lockDiario = claveLockCupo(proveedor, fecha)

  // Lock transaccional por (proveedor, fecha). Parametrizado: nada de SQL
  // interpolado.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockDiario.proveedor}), hashtext(${lockDiario.fecha}))`

  // Relectura dentro de los locks: las reservas concurrentes del mismo dia
  // quedan serializadas y ven el consumo ya confirmado por la anterior.
  const filasDia = await leerFilasDia(tx, proveedor, fecha)

  let usadoGlobal = 0
  let usadoCampana = 0
  for (const fila of filasDia) {
    usadoGlobal += fila.unidades
    if (fila.campanaId === campanaId) usadoCampana += fila.unidades
  }

  const cupoGlobal = evaluarCupo({
    usado: usadoGlobal,
    cantidad,
    cap: capDiario,
    umbral,
  })
  if (!cupoGlobal.permitido) {
    throw new ErrorCupo({
      codigo: "CUPO",
      ambito: "GLOBAL",
      restantes: cupoGlobal.restantes,
    })
  }

  if (capCampana !== undefined) {
    const cupoCampana = evaluarCupo({
      usado: usadoCampana,
      cantidad,
      cap: capCampana,
      umbral,
    })
    if (!cupoCampana.permitido) {
      throw new ErrorCupo({
        codigo: "CUPO",
        ambito: "CAMPANA",
        restantes: cupoCampana.restantes,
      })
    }
  }

  if (verificaPresupuesto) {
    const gastadoMes = await leerCostoMes(tx, fecha)
    const totalMes = gastadoMes + costoCentavos

    if (!Number.isSafeInteger(totalMes)) {
      throw errorConfiguracion("El costo mensual no es valido.")
    }
    if (totalMes > presupuestoMensualCentavos) {
      throw new ErrorCupo({
        codigo: "LIMITE",
        ambito: "PRESUPUESTO",
        restantes: cupoGlobal.restantes,
        restantePresupuestoCentavos: Math.max(
          0,
          presupuestoMensualCentavos - gastadoMes,
        ),
      })
    }
  }

  const clave = claveConsumo({
    campanaId,
    proveedor,
    fecha,
    prospectoId,
  })

  await tx.consumoProveedor.upsert({
    where: { clave },
    create: {
      clave,
      campanaId,
      prospectoId,
      proveedor,
      fecha,
      llamadas,
      unidades: cantidad,
      costoCentavos,
    },
    update: {
      llamadas: { increment: llamadas },
      unidades: { increment: cantidad },
      costoCentavos: { increment: costoCentavos },
    },
  })

  return { restantes: cupoGlobal.restantes }
}

// ---------------------------------------------------------------------------
// Estado para la UI
// ---------------------------------------------------------------------------

export interface EstadoCupoProveedor {
  proveedor: ProveedorConsumoCupo
  usado: number
  cap: number
  restante: number
  alerta: boolean
  llamadas: number
  costoCentavos: number
}

export interface EstadoCupos {
  /** Dia UTC normalizado que se consulto. */
  fecha: Date
  proveedores: EstadoCupoProveedor[]
  totalCostoCentavos: number
  presupuestoMensualCentavos: number
  /** `null` cuando no hay presupuesto configurado (0 = sin tope). */
  gastadoMesCentavos: number | null
  /** `null` cuando no hay presupuesto configurado. */
  restanteMesCentavos: number | null
  alertaPresupuesto: boolean
}

export interface OpcionesEstadoCupos {
  /** Cliente o transaccion Prisma inyectable; si se omite se usa el singleton. */
  cliente?: Pick<Prisma.TransactionClient, "consumoProveedor">
  config?: ConfigConsumo
  /** Topes diarios por proveedor; los que falten salen de la config. */
  caps?: Partial<Record<ProveedorConsumoCupo, number>>
  /**
   * Override de tests/dev; solo aplica si la config global es 0. Nunca
   * desactiva un presupuesto configurado.
   */
  presupuestoMensualCentavos?: number
  umbral?: number
}

async function resolverClienteEstado(
  opciones: OpcionesEstadoCupos,
): Promise<Pick<Prisma.TransactionClient, "consumoProveedor">> {
  if (opciones.cliente !== undefined) return opciones.cliente

  // Import dinamico: este modulo no acopla su carga al singleton de Prisma.
  const { prisma } = await import("@/lib/prisma")
  return prisma
}

/**
 * Agregados del dia por proveedor (usado, cap, restante, alerta 80% y costo)
 * mas el estado del presupuesto mensual. Solo lectura; no reserva ni escribe.
 *
 * `fecha` es opcional para conveniencia del llamador, pero siempre se normaliza
 * a UTC. El cliente Prisma se puede inyectar para testear sin base.
 */
export async function estadoCupos(
  fecha: Date = new Date(),
  opciones: OpcionesEstadoCupos = {},
): Promise<EstadoCupos> {
  const fechaDia = normalizarFechaUTC(fecha)
  const cliente = await resolverClienteEstado(opciones)
  const config = crearConfigLazy(opciones)

  const umbral = opciones.umbral ?? UMBRAL_ALERTA_CUPO
  if (!Number.isFinite(umbral) || umbral <= 0 || umbral > 1) {
    throw errorConfiguracion("El umbral de alerta no es valido.")
  }

  // Misma regla que `reservarCupo`: la config global > 0 es autoritativa y un
  // override (incluido 0) no puede desactivar el hard cap.
  const presupuestoMensualCentavos = resolverPresupuestoEfectivo(
    config(),
    opciones.presupuestoMensualCentavos,
  )

  const filas = await cliente.consumoProveedor.findMany({
    where: { fecha: fechaDia },
    select: {
      proveedor: true,
      unidades: true,
      llamadas: true,
      costoCentavos: true,
    },
  })

  const acumulado = new Map<
    ProveedorConsumoCupo,
    { usado: number; llamadas: number; costoCentavos: number }
  >()

  for (const proveedor of PROVEEDORES_CONSUMO) {
    acumulado.set(proveedor, { usado: 0, llamadas: 0, costoCentavos: 0 })
  }

  for (const fila of filas) {
    if (!esProveedorConsumo(fila.proveedor)) {
      throw errorConfiguracion("El proveedor registrado no es valido.")
    }
    if (!esEnteroNoNegativo(fila.unidades)) {
      throw errorConfiguracion("El consumo registrado no es valido.")
    }
    if (!esEnteroNoNegativo(fila.llamadas)) {
      throw errorConfiguracion("El consumo registrado no es valido.")
    }
    if (!esEnteroNoNegativo(fila.costoCentavos)) {
      throw errorConfiguracion("El costo registrado no es valido.")
    }

    const actual = acumulado.get(fila.proveedor)
    if (actual === undefined) {
      throw errorConfiguracion("El proveedor registrado no es valido.")
    }

    actual.usado += fila.unidades
    actual.llamadas += fila.llamadas
    actual.costoCentavos += fila.costoCentavos

    if (
      !Number.isSafeInteger(actual.usado) ||
      !Number.isSafeInteger(actual.llamadas) ||
      !Number.isSafeInteger(actual.costoCentavos)
    ) {
      throw errorConfiguracion("El consumo registrado no es valido.")
    }
  }

  const proveedores: EstadoCupoProveedor[] = []
  let totalCostoCentavos = 0

  for (const proveedor of PROVEEDORES_CONSUMO) {
    const actual = acumulado.get(proveedor)
    if (actual === undefined) continue

    const capConfigurado =
      opciones.caps?.[proveedor] ?? capPorProveedor(proveedor, config())
    const cap =
      Number.isSafeInteger(capConfigurado) && capConfigurado > 0
        ? capConfigurado
        : 0

    proveedores.push({
      proveedor,
      usado: actual.usado,
      cap,
      restante: Math.max(0, cap - actual.usado),
      alerta: cap > 0 && actual.usado / cap >= umbral,
      llamadas: actual.llamadas,
      costoCentavos: actual.costoCentavos,
    })

    totalCostoCentavos += actual.costoCentavos
    if (!Number.isSafeInteger(totalCostoCentavos)) {
      throw errorConfiguracion("El costo registrado no es valido.")
    }
  }

  let gastadoMesCentavos: number | null = null
  let restanteMesCentavos: number | null = null
  let alertaPresupuesto = false

  if (presupuestoMensualCentavos > 0) {
    gastadoMesCentavos = await leerCostoMes(cliente, fechaDia)
    restanteMesCentavos = Math.max(
      0,
      presupuestoMensualCentavos - gastadoMesCentavos,
    )
    alertaPresupuesto =
      gastadoMesCentavos / presupuestoMensualCentavos >= umbral
  }

  return {
    fecha: fechaDia,
    proveedores,
    totalCostoCentavos,
    presupuestoMensualCentavos,
    gastadoMesCentavos,
    restanteMesCentavos,
    alertaPresupuesto,
  }
}
