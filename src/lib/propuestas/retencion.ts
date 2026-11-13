/**
 * T-22 (AC-37, AC-40; RF-30, RF-65): retención de prospectos del portal.
 *
 * Reglas de la spec §7.3 y del plan §7.5:
 * - Un prospecto vence cuando `ultimaInteraccionEn < ahora - meses` (12 por
 *   defecto). El corte se calcula en UTC y nunca borra por sí solo: la
 *   selección es pura y devuelve solo ids/fechas ordenados de forma estable.
 * - La purga borra en lotes de 100 (`Prospecto.deleteMany`). El esquema tiene
 *   `EnvioPropuesta.prospecto` con `onDelete: Cascade` y
 *   `ConsumoProveedor.prospectoId` con `onDelete: SetNull`: se eliminan los
 *   borradores/envíos y se conserva el costo histórico. `SupresionProspecto` no
 *   tiene relación con `Prospecto`, así que la supresión permanece intacta.
 * - `pg_try_advisory_xact_lock(hashtext('PROPUESTAS_RETENCION'))` evita que dos
 *   purgas se solapen. Si el lock no se obtiene, se devuelve `omitido: true`
 *   sin borrar nada.
 * - La purga se detiene al agotar los vencidos o tras un máximo acotado de
 *   lotes. No hay borrado masivo sin límite ni acciones en red.
 * - Fechas UTC. Los errores de esquema se convierten en un `ErrorRetencion`
 *   con código y mensaje sanitizados (sin nombres de tablas ni detalles de
 *   Prisma).
 *
 * Módulo server-only. No toca el CRM, no llama a proveedores y no registra PII.
 */

import { prisma } from "@/lib/prisma"
import { configPropuestas } from "./config"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "./errores"

/** Clave del advisory lock de la purga de retención. */
export const CLAVE_LOCK_RETENCION = "PROPUESTAS_RETENCION"

/** Tamaño de lote por defecto (plan §7.5). */
export const LOTE_RETENCION = 100

/** Tope de lotes por corrida: 100 × 100 = 10.000 prospectos como máximo. */
export const MAX_LOTES_RETENCION = 100

/** Meses de retención por defecto (spec §7.3). */
export const MESES_RETENCION_DEFAULT = 12

export interface ProspectoVencido {
  id: string
  ultimaInteraccionEn: Date
}

export interface OpcionesSeleccionRetencionBase {
  /** Instante de referencia; se usa en UTC. */
  ahora: Date
  /** Meses de retención. Default 12; valores <= 0 fallan cerrado. */
  meses?: number
  /** Máximo de ids devueltos. Default 100. */
  limite?: number
}

export interface OpcionesSeleccionRetencion
  extends OpcionesSeleccionRetencionBase {
  /**
   * Candidatos a evaluar. La función es pura: no consulta Prisma ni borra
   * nada. El llamador decide de dónde salen los candidatos.
   */
  prospectos: readonly ProspectoVencido[]
}

export interface ResultadoPurgaRetencion {
  /** `true` si otra purga tenía el advisory lock. */
  omitido: boolean
  /** Prospectos efectivamente borrados en esta corrida. */
  eliminados: number
  /** Cantidad de `deleteMany` ejecutados. */
  lotes: number
}

/** Error tipado de retención con código y mensaje ya sanitizados. */
export class ErrorRetencion extends Error {
  readonly codigo: CodigoError

  constructor(codigo: CodigoError) {
    super(sanitizarError(null, { codigo }).mensaje)
    this.name = "ErrorRetencion"
    this.codigo = codigo
  }
}

/** Cliente mínimo que necesita la purga (inyectable en tests). */
export interface ClienteRetencion {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>
  prospecto: {
    findMany: (args: unknown) => Promise<Array<{ id: string }>>
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
}

export interface TransaccionRetencion {
  $transaction: <T>(
    fn: (tx: ClienteRetencion) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ) => Promise<T>
}

export interface OpcionesPurgaRetencion {
  /**
   * Cliente Prisma o transacción inyectable para tests. Si tiene
   * `$transaction`, la purga corre dentro de esa transacción; si es un
   * `TransactionClient` (sin `$transaction`), se usa directamente. En
   * producción se omite y se usa el singleton.
   */
  cliente?: ClienteRetencion | TransaccionRetencion
  /** Instante de referencia; default ahora. */
  ahora?: Date
  /** Meses de retención; default config (12) o 12 si no hay config. */
  meses?: number
  /** Tamaño de lote; default 100. */
  lote?: number
}

function validarMeses(meses: unknown): number {
  if (
    !Number.isSafeInteger(meses) ||
    (meses as number) < 1 ||
    (meses as number) > 120
  ) {
    // Un valor inválido nunca debe interpretarse como "borrar todo": la purga
    // falla cerrada y el operador corrige la configuración.
    throw new ErrorRetencion("CONFIGURACION")
  }

  return meses as number
}

function validarLimite(limite: unknown, codigo: CodigoError): number {
  if (
    !Number.isSafeInteger(limite) ||
    (limite as number) < 1 ||
    (limite as number) > 1000
  ) {
    throw new ErrorRetencion(codigo)
  }

  return limite as number
}

/**
 * Resta meses calendario en UTC. Si el día no existe en el mes destino (por
 * ejemplo 31 de marzo menos un mes), se ajusta al último día de ese mes. No
 * usa la zona horaria del servidor.
 */
export function calcularCorteRetencion(
  ahora: Date,
  meses: number = MESES_RETENCION_DEFAULT,
): Date {
  if (!(ahora instanceof Date) || !Number.isFinite(ahora.getTime())) {
    throw new ErrorRetencion("VALIDACION")
  }

  const cantidadMeses = validarMeses(meses)
  const anio = ahora.getUTCFullYear()
  const mes = ahora.getUTCMonth() - cantidadMeses
  const dia = ahora.getUTCDate()
  const ultimoDiaMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      anio,
      mes,
      Math.min(dia, ultimoDiaMes),
      ahora.getUTCHours(),
      ahora.getUTCMinutes(),
      ahora.getUTCSeconds(),
      ahora.getUTCMilliseconds(),
    ),
  )
}

/**
 * Selecciona los prospectos vencidos de una lista. Es puro:
 * - calcula el corte en UTC (`ahora - meses`);
 * - incluye solo `ultimaInteraccionEn` válida y estrictamente anterior al
 *   corte (el mismo día del corte no vence);
 * - ordena por fecha ascendente y, a igual fecha, por id;
 * - acota a `limite` (100 por defecto).
 *
 * Acepta los candidatos dentro del objeto (`{ ahora, meses, limite,
 * prospectos }`) o como segundo argumento (`{ ahora, meses, limite },
 * prospectos`). No borra, no consulta Prisma y no devuelve datos de contacto.
 */
export function seleccionarProspectosVencidos(
  entrada: OpcionesSeleccionRetencion,
): ProspectoVencido[]
export function seleccionarProspectosVencidos(
  entrada: OpcionesSeleccionRetencionBase,
  prospectos: readonly ProspectoVencido[],
): ProspectoVencido[]
export function seleccionarProspectosVencidos(
  entrada: OpcionesSeleccionRetencion | OpcionesSeleccionRetencionBase,
  prospectos?: readonly ProspectoVencido[],
): ProspectoVencido[] {
  const candidatos =
    prospectos ??
    (entrada as OpcionesSeleccionRetencion).prospectos

  if (!entrada || !Array.isArray(candidatos)) {
    throw new ErrorRetencion("VALIDACION")
  }

  const corte = calcularCorteRetencion(
    entrada.ahora,
    entrada.meses ?? MESES_RETENCION_DEFAULT,
  )
  const limite = validarLimite(
    entrada.limite ?? LOTE_RETENCION,
    "VALIDACION",
  )
  const corteMs = corte.getTime()

  return candidatos
    .filter(
      (prospecto) =>
        prospecto.ultimaInteraccionEn instanceof Date &&
        Number.isFinite(prospecto.ultimaInteraccionEn.getTime()) &&
        prospecto.ultimaInteraccionEn.getTime() < corteMs,
    )
    .slice()
    .sort((a, b) => {
      const porFecha =
        a.ultimaInteraccionEn.getTime() - b.ultimaInteraccionEn.getTime()
      if (porFecha !== 0) return porFecha
      return a.id.localeCompare(b.id)
    })
    .slice(0, limite)
    .map((prospecto) => ({
      id: prospecto.id,
      ultimaInteraccionEn: new Date(prospecto.ultimaInteraccionEn.getTime()),
    }))
}

function esTransaccion(
  cliente: ClienteRetencion | TransaccionRetencion,
): cliente is TransaccionRetencion {
  return (
    typeof (cliente as TransaccionRetencion).$transaction === "function"
  )
}

function crearEjecutor(
  opciones: OpcionesPurgaRetencion,
): <T>(fn: (tx: ClienteRetencion) => Promise<T>) => Promise<T> {
  const inyectado = opciones.cliente

  if (inyectado === undefined) {
    return <T>(fn: (tx: ClienteRetencion) => Promise<T>) =>
      prisma.$transaction(
        (tx) => fn(tx as unknown as ClienteRetencion),
        { timeout: 60_000 },
      ) as Promise<T>
  }

  if (esTransaccion(inyectado)) {
    return <T>(fn: (tx: ClienteRetencion) => Promise<T>) =>
      inyectado.$transaction(fn)
  }

  return <T>(fn: (tx: ClienteRetencion) => Promise<T>) => fn(inyectado)
}

async function purgarEnCliente(
  cliente: ClienteRetencion,
  corte: Date,
  lote: number,
): Promise<ResultadoPurgaRetencion> {
  // Lock transaccional por clave fija. Si otra purga lo tiene, esta corrida se
  // omite sin tocar datos.
  const filasLock = await cliente.$queryRaw<
    Array<Record<string, unknown>>
  >`SELECT pg_try_advisory_xact_lock(hashtext(${CLAVE_LOCK_RETENCION})) AS obtenido`

  // Se acepta el alias `obtenido` o la columna cruda del driver (algunos
  // dobles de test no aplican el alias). Cualquier valor falsy omite la purga.
  const filaLock = filasLock[0]
  const obtenido =
    filaLock?.obtenido ?? (filaLock ? Object.values(filaLock)[0] : undefined)

  if (!obtenido) {
    return { omitido: true, eliminados: 0, lotes: 0 }
  }

  let eliminados = 0
  let lotes = 0

  while (lotes < MAX_LOTES_RETENCION) {
    const candidatos = await cliente.prospecto.findMany({
      where: { ultimaInteraccionEn: { lt: corte } },
      orderBy: [{ ultimaInteraccionEn: "asc" }, { id: "asc" }],
      take: lote,
      select: { id: true },
    })

    if (candidatos.length === 0) break

    const ids = candidatos.map((fila) => fila.id)
    const borrados = await cliente.prospecto.deleteMany({
      // Se repite el corte para no borrar una ficha que recibió una
      // interacción entre la lectura y el borrado.
      where: { id: { in: ids }, ultimaInteraccionEn: { lt: corte } },
    })

    eliminados += borrados.count
    lotes += 1

    // Si no quedó nada por borrar o el lote vino incompleto, no hay más
    // páginas que recorrer en esta corrida.
    if (borrados.count === 0 || candidatos.length < lote) break
  }

  return { omitido: false, eliminados, lotes }
}

/**
 * Purga los prospectos vencidos en lotes, conservando la supresión.
 *
 * - Toma `pg_try_advisory_xact_lock` sobre `PROPUESTAS_RETENCION`; si no lo
 *   obtiene, devuelve `{ omitido: true, eliminados: 0, lotes: 0 }`.
 * - Borra con `Prospecto.deleteMany`: la cascada del esquema elimina
 *   borradores/envíos y `ConsumoProveedor.prospectoId` pasa a `null`.
 * - No borra `SupresionProspecto` (no hay relación entre ambos modelos).
 * - Se detiene al agotar los vencidos o tras `MAX_LOTES_RETENCION`.
 * - Un error de esquema se reporta como `ErrorRetencion` sanitizado.
 */
export async function purgarProspectosVencidos(
  opciones: OpcionesPurgaRetencion = {},
): Promise<ResultadoPurgaRetencion> {
  const ahora = opciones.ahora ?? new Date()
  const meses =
    opciones.meses ?? configPropuestas().limites.retencionMeses
  const corte = calcularCorteRetencion(ahora, meses)
  const lote = validarLimite(opciones.lote ?? LOTE_RETENCION, "VALIDACION")
  const ejecutar = crearEjecutor(opciones)

  try {
    return await ejecutar((cliente) =>
      purgarEnCliente(cliente, corte, lote),
    )
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      throw new ErrorRetencion("ESQUEMA_NO_APLICADO")
    }

    throw error
  }
}
