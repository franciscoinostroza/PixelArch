/**
 * T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56): supresiones
 * persistentes del portal.
 *
 * Modulo server-only (Prisma). No hace red, no llama a Resend, no lee ni
 * escribe el CRM y no registra emails, dominios, hashes ni notas en logs.
 *
 * Reglas:
 * - `EMAIL`: se calcula el HMAC-SHA256 del email normalizado con
 *   `PROPUESTAS_SECRETO`; se guardan `clave EMAIL:<hash>`, `emailHash` y un
 *   email enmascarado para la UI. El email en claro no se guarda ni se loguea.
 * - `DOMINIO`: solo dominios de negocio suprimibles. `dominioSuprimible`
 *   rechaza proveedores publicos, redes/marketplaces/agregadores y plataformas
 *   multiinquilino; la clave es `DOMINIO:<dominio>`.
 * - La clave unica hace la creacion idempotente. Repetir el alta reactiva una
 *   supresion revocada, pero conserva el motivo/origen/creador/fecha
 *   originales y agrega una entrada `REACTIVADA` al historial. Una fila ya
 *   activa no se reescribe, salvo que se pase `registroArco`: en ese caso solo
 *   se agrega la entrada `SOLICITUD_ARCO` al historial (evidencia durable de
 *   una solicitud ARCO), sin tocar los demas campos. `reactivar: false` evita
 *   la reactivacion.
 * - `aplicarSupresionAProspectos` cancela los envios BORRADOR/APROBADO y marca
 *   SUPRIMIDO con historial sin PII. Para EMAIL solo afecta al prospecto cuyo
 *   email normalizado actual coincide con el suprimido. Para DOMINIO afecta a
 *   los prospectos cuyo `dominioNormalizado` coincide (criterio conservador:
 *   la supresion es de la empresa, no de una direccion puntual).
 * - La revocacion es una excepcion explicita con motivo y trazabilidad. No
 *   reabre prospectos ni reactiva envios: el admin decide el siguiente paso.
 * - La purga manual solo elimina la fila de una supresion ya revocada. Es una
 *   excepcion administrativa: no toca prospectos, envios ni historial.
 */

import type {
  AmbitoSupresion,
  MotivoSupresion,
  OrigenSupresion,
  Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { normalizarEmail } from "./normalizar"
import {
  agregarEntradaHistorial,
  MAX_HISTORIAL_PROSPECTO,
} from "./prospectos"
import {
  claveSupresionDominio,
  claveSupresionEmail,
  dominioSuprimible,
  emailEnmascarado,
  ErrorSupresion,
  hashEmail,
} from "./supresion"

type ClienteSupresiones = Prisma.TransactionClient

const MAX_NOTAS = 1000

export interface OpcionesCliente {
  /** Cliente Prisma o transaccion; por defecto el singleton del portal. */
  cliente?: ClienteSupresiones
}

export interface EntradaCrearSupresion {
  ambito: "EMAIL" | "DOMINIO"
  /** Obligatorio para `EMAIL`; se normaliza antes de calcular el hash. */
  email?: string | null
  /** Obligatorio para `DOMINIO`; nunca un proveedor publico/multiinquilino. */
  dominioNegocio?: string | null
  motivo: MotivoSupresion
  origen: OrigenSupresion
  notas?: string | null
  creadaPor: string
  creadaPorNombre?: string | null
  /** Obligatorio para `EMAIL` (HMAC); no se guarda ni se loguea. */
  secreto?: string | null
}

export interface ResultadoCrearSupresion {
  id: string
  clave: string
  /** `false` si la clave ya existia (alta idempotente o reactivacion). */
  creada: boolean
  /** `true` solo si la clave existia revocada y se volvio a activar. */
  reactivada: boolean
}

export interface OpcionesCrearSupresion extends OpcionesCliente {
  /**
   * Si es `false`, una supresion revocada no se reactiva: se devuelve
   * `reactivada: false` sin escribir. Default `true`.
   */
  reactivar?: boolean
  /**
   * Evidencia durable de una solicitud ARCO. Si se pasa, agrega una entrada
   * `SOLICITUD_ARCO` al historial de la supresion, incluso cuando la fila ya
   * existia activa. Solo contiene hash/longitud del motivo, autor y fecha:
   * nunca el texto libre ni datos de contacto.
   */
  registroArco?: RegistroSolicitudArco
}

export interface RegistroSolicitudArco {
  /** SHA-256 del motivo; `null` si la solicitud no trajo motivo. */
  motivoHash: string | null
  motivoLongitud: number
  por: string
  en?: Date
}

interface DatosSupresion {
  ambito: "EMAIL" | "DOMINIO"
  clave: string
  emailHash: string | null
  emailEnmascarado: string | null
  dominioNegocio: string | null
}

function normalizarNotas(notas: string | null | undefined): string | null {
  if (typeof notas !== "string") return null
  const limpio = notas.trim()
  return limpio.length > 0 ? limpio.slice(0, MAX_NOTAS) : null
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/**
 * Entrada de historial de una solicitud ARCO. No guarda el motivo libre ni
 * datos de contacto: solo su hash SHA-256, la longitud, quien la atendio y
 * cuando. Se usa tanto al crear la supresion como al agregarla a una fila
 * existente.
 */
function entradaSolicitudArco(
  registro: RegistroSolicitudArco,
  ahora: Date,
): Record<string, unknown> {
  return {
    accion: "SOLICITUD_ARCO",
    motivoHash: registro.motivoHash,
    motivoLongitud: registro.motivoLongitud,
    por: registro.por,
    en: (registro.en ?? ahora).toISOString(),
  }
}

/**
 * Agrega una entrada a un historial JSON arbitrario conservando las anteriores
 * y acotando el tamaño. Descarta valores que no sean objetos.
 */
function agregarEntradaJson(
  actual: unknown,
  entrada: Record<string, unknown>,
): Record<string, unknown>[] {
  const previas = Array.isArray(actual) ? actual.filter(esObjeto) : []
  return [...previas, entrada].slice(-MAX_HISTORIAL_PROSPECTO)
}

function prepararDatos(entrada: EntradaCrearSupresion): DatosSupresion {
  if (entrada.ambito === "EMAIL") {
    const email = normalizarEmail(entrada.email ?? "")
    if (email === null) throw new ErrorSupresion("EMAIL")

    const secreto = entrada.secreto
    if (typeof secreto !== "string" || secreto.trim().length === 0) {
      throw new ErrorSupresion("SECRETO")
    }

    const hash = hashEmail(email, secreto)

    return {
      ambito: "EMAIL",
      clave: claveSupresionEmail(hash),
      emailHash: hash,
      emailEnmascarado: emailEnmascarado(email) || null,
      dominioNegocio: null,
    }
  }

  const dominio = dominioSuprimible(entrada.dominioNegocio)
  if (dominio === null) throw new ErrorSupresion("DOMINIO")

  return {
    ambito: "DOMINIO",
    clave: claveSupresionDominio(dominio),
    emailHash: null,
    emailEnmascarado: null,
    dominioNegocio: dominio,
  }
}

/**
 * Crea o reactiva una supresion de forma idempotente por `clave`.
 *
 * - No devuelve ni loguea el email en claro.
 * - Si la clave ya existe activa, no reescribe sus datos: `creada: false`,
 *   `reactivada: false`. Con `registroArco` solo agrega la entrada
 *   `SOLICITUD_ARCO` al historial existente, para que la atencion ARCO quede
 *   registrada de forma durable sin tocar motivo/origen/creador/fecha.
 * - Si la clave existe revocada y `reactivar` es `true` (default), vuelve a
 *   dejarla activa, limpia los campos de revocacion y agrega una entrada
 *   `REACTIVADA` al historial con `por`, `en` y motivo. No pisa el motivo,
 *   origen, creador ni fecha de creacion originales.
 * - Con `reactivar: false`, una fila revocada no se toca.
 */
export async function crearSupresion(
  entrada: EntradaCrearSupresion,
  opciones: OpcionesCrearSupresion = {},
): Promise<ResultadoCrearSupresion> {
  const cliente = opciones.cliente ?? prisma
  const datos = prepararDatos(entrada)
  const reactivar = opciones.reactivar ?? true
  const ahora = new Date()
  const registroArco = opciones.registroArco
  const entradaArco = registroArco
    ? entradaSolicitudArco(registroArco, ahora)
    : null

  const existente = await cliente.supresionProspecto.findUnique({
    where: { clave: datos.clave },
    select: {
      id: true,
      activa: true,
      historial: true,
      motivo: true,
      origen: true,
      creadaPor: true,
      creadaPorNombre: true,
      creadaEn: true,
    },
  })

  // Alta idempotente: una fila activa no se reescribe. Con `reactivar: false`
  // una fila revocada tampoco se reactiva ni se modifica.
  if (existente !== null && (existente.activa || !reactivar)) {
    // La solicitud ARCO debe quedar registrada aunque la supresion ya
    // estuviera activa. El update solo agrega historial: no pisa motivo,
    // origen, creadaPor ni creadaEn.
    if (existente.activa && entradaArco !== null) {
      await cliente.supresionProspecto.updateMany({
        where: { id: existente.id },
        data: {
          historial: agregarEntradaJson(
            existente.historial,
            entradaArco,
          ) as unknown as Prisma.InputJsonValue,
        },
      })
    }

    return {
      id: existente.id,
      clave: datos.clave,
      creada: false,
      reactivada: false,
    }
  }

  const historialCreacion = [
    {
      accion: "CREADA",
      por: entrada.creadaPor,
      en: ahora.toISOString(),
      motivo: entrada.motivo,
      origen: entrada.origen,
    },
    ...(entradaArco !== null ? [entradaArco] : []),
  ] as unknown as Prisma.InputJsonValue

  const datosCreacion: Prisma.SupresionProspectoCreateInput = {
    ambito: datos.ambito,
    clave: datos.clave,
    emailHash: datos.emailHash,
    emailEnmascarado: datos.emailEnmascarado,
    dominioNegocio: datos.dominioNegocio,
    motivo: entrada.motivo,
    origen: entrada.origen,
    activa: true,
    notas: normalizarNotas(entrada.notas),
    historial: historialCreacion,
    creadaPor: entrada.creadaPor,
    creadaPorNombre: entrada.creadaPorNombre ?? null,
  }

  if (existente === null) {
    const fila = await cliente.supresionProspecto.upsert({
      where: { clave: datos.clave },
      // La pre-lectura no encontro la fila. Si otra operacion la creo entre
      // ambas consultas, reescribir la misma clave no cambia su estado.
      create: datosCreacion,
      update: { clave: datos.clave },
      select: { id: true },
    })

    return {
      id: fila.id,
      clave: datos.clave,
      creada: true,
      reactivada: false,
    }
  }

  // Fila revocada: se reactiva conservando sus datos originales.
  const historialReactivacion = agregarEntradaHistorial(existente.historial, {
    accion: "REACTIVADA",
    por: entrada.creadaPor,
    en: ahora.toISOString(),
    motivo: entrada.motivo,
  })

  const historial =
    entradaArco !== null
      ? agregarEntradaJson(historialReactivacion, entradaArco)
      : historialReactivacion

  const fila = await cliente.supresionProspecto.upsert({
    where: { clave: datos.clave },
    create: datosCreacion,
    update: {
      activa: true,
      revocadaPor: null,
      revocadaEn: null,
      motivoRevocacion: null,
      historial: historial as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  })

  return {
    id: fila.id,
    clave: datos.clave,
    creada: false,
    reactivada: true,
  }
}

export interface EntradaAplicarSupresion {
  ambito: "EMAIL" | "DOMINIO"
  email?: string | null
  dominioNegocio?: string | null
  /** Obligatorio para `EMAIL`; se usa para comparar el email actual. */
  secreto?: string | null
  motivo: MotivoSupresion
  por: string
  en?: Date
}

export interface ResultadoAplicarSupresion {
  prospectosSuprimidos: number
  enviosCancelados: number
}

interface ProspectoAfectado {
  id: string
  email: string | null
  historial: Prisma.JsonValue | null
}

async function cancelarYSuprimir(
  cliente: ClienteSupresiones,
  filas: ProspectoAfectado[],
  entrada: EntradaAplicarSupresion,
  ahora: Date,
): Promise<ResultadoAplicarSupresion> {
  if (filas.length === 0) {
    return { prospectosSuprimidos: 0, enviosCancelados: 0 }
  }

  const ids = filas.map((fila) => fila.id)

  const cancelados = await cliente.envioPropuesta.updateMany({
    where: {
      prospectoId: { in: ids },
      estado: { in: ["BORRADOR", "APROBADO"] },
    },
    data: {
      estado: "CANCELADO",
      motivoCancelacion: "SUPRESION",
    },
  })

  // Cada prospecto conserva su historial: se agrega una entrada sin valores
  // (solo accion, motivo, quien y cuando). No se guarda email, dominio ni
  // notas de la supresion.
  let prospectosSuprimidos = 0
  for (const fila of filas) {
    const historial = agregarEntradaHistorial(fila.historial, {
      accion: "SUPRESION",
      motivo: entrada.motivo,
      por: entrada.por,
      en: ahora.toISOString(),
    })

    const actualizado = await cliente.prospecto.updateMany({
      where: { id: fila.id, estado: { not: "SUPRIMIDO" } },
      data: {
        estado: "SUPRIMIDO",
        historial: historial as unknown as Prisma.InputJsonValue,
        ultimaInteraccionEn: ahora,
        actualizadoPor: entrada.por,
      },
    })

    prospectosSuprimidos += actualizado.count
  }

  return {
    prospectosSuprimidos,
    enviosCancelados: cancelados.count,
  }
}

/**
 * Aplica una supresion ya creada a los prospectos existentes:
 * - cancela los envios BORRADOR/APROBADO afectados;
 * - marca `SUPRIMIDO` y agrega historial sin PII;
 * - no borra prospectos, no toca el CRM y no envia emails.
 *
 * EMAIL: solo el prospecto con el email normalizado exacto (y hash
 * coincidente). Un prospecto que cambio de direccion conserva su ficha y su
 * email nuevo.
 *
 * DOMINIO: todos los prospectos con `dominioNormalizado` igual al dominio
 * suprimido. Es el criterio conservador: la supresion alcanza a la empresa,
 * aunque el contacto cargado use un proveedor publico.
 */
export async function aplicarSupresionAProspectos(
  entrada: EntradaAplicarSupresion,
  opciones: OpcionesCliente = {},
): Promise<ResultadoAplicarSupresion> {
  const cliente = opciones.cliente ?? prisma
  const ahora = entrada.en ?? new Date()

  if (entrada.ambito === "EMAIL") {
    const email = normalizarEmail(entrada.email ?? "")
    if (email === null) throw new ErrorSupresion("EMAIL")

    const secreto = entrada.secreto
    if (typeof secreto !== "string" || secreto.trim().length === 0) {
      throw new ErrorSupresion("SECRETO")
    }

    const emailHash = hashEmail(email, secreto)
    const filas = await cliente.prospecto.findMany({
      where: { email },
      select: { id: true, email: true, historial: true },
    })

    // La consulta ya busca por email exacto; el hash vuelve a verificar que el
    // email almacenado (normalizado) corresponde al suprimido.
    const coincidentes = filas.filter((fila) => {
      const actual = fila.email ? normalizarEmail(fila.email) : null
      return actual !== null && hashEmail(actual, secreto) === emailHash
    })

    return cancelarYSuprimir(cliente, coincidentes, entrada, ahora)
  }

  const dominio = dominioSuprimible(entrada.dominioNegocio)
  if (dominio === null) throw new ErrorSupresion("DOMINIO")

  const filas = await cliente.prospecto.findMany({
    where: { dominioNormalizado: dominio },
    select: { id: true, email: true, historial: true },
  })

  return cancelarYSuprimir(cliente, filas, entrada, ahora)
}

export interface EntradaRevocarSupresion {
  id: string
  motivo: string
  por: string
  en?: Date
}

export type ResultadoRevocarSupresion =
  | { ok: true; id: string; activa: false }
  | { ok: false; motivo: "NO_ENCONTRADO" | "YA_REVOCADA" }

/**
 * Revoca una supresion como excepcion explicita. Deja `activa = false`,
 * registra quien/cuando/motivo y agrega una entrada al historial de la fila.
 * No reabre prospectos, no reactiva envios y no permite usar esta accion como
 * flujo normal: la UI la presenta como excepcion.
 */
export async function revocarSupresion(
  entrada: EntradaRevocarSupresion,
  opciones: OpcionesCliente = {},
): Promise<ResultadoRevocarSupresion> {
  const cliente = opciones.cliente ?? prisma

  const motivo = entrada.motivo.trim()
  if (motivo.length === 0) {
    throw new Error("El motivo de revocacion es obligatorio.")
  }

  const fila = await cliente.supresionProspecto.findUnique({
    where: { id: entrada.id },
    select: { id: true, activa: true, historial: true },
  })

  if (!fila) return { ok: false, motivo: "NO_ENCONTRADO" }
  if (!fila.activa) return { ok: false, motivo: "YA_REVOCADA" }

  const ahora = entrada.en ?? new Date()
  const previo: Prisma.JsonArray = Array.isArray(fila.historial)
    ? fila.historial
    : []
  const historial = [
    ...previo,
    {
      accion: "REVOCADA",
      por: entrada.por,
      en: ahora.toISOString(),
      motivo,
    },
  ].slice(-MAX_HISTORIAL_PROSPECTO)

  // `activa: true` en el where evita pisar una revocacion concurrente.
  const actualizada = await cliente.supresionProspecto.updateMany({
    where: { id: fila.id, activa: true },
    data: {
      activa: false,
      revocadaPor: entrada.por,
      revocadaEn: ahora,
      motivoRevocacion: motivo,
      historial: historial as unknown as Prisma.InputJsonValue,
    },
  })

  if (actualizada.count === 0) {
    return { ok: false, motivo: "YA_REVOCADA" }
  }

  return { ok: true, id: fila.id, activa: false }
}

export interface EntradaPurgarSupresion {
  id: string
  motivo: string
  por: string
}

export type ResultadoPurgarSupresion =
  | { ok: true; id: string; ambito: AmbitoSupresion }
  | { ok: false; motivo: "NO_ENCONTRADO" | "ACTIVA" }

/**
 * Purga manual (excepcion administrativa) de una supresion **ya revocada**.
 *
 * - Hard delete de la fila `SupresionProspecto`; no toca prospectos, envios ni
 *   historial de prospecto.
 * - Una supresion activa no se puede purgar: primero hay que revocarla.
 * - `deleteMany` con `activa: false` evita borrar una fila que se reactivo
 *   entre la lectura y el borrado.
 * - No persiste el motivo: el llamador loguea solo id, ambito, adminId,
 *   longitud y hash SHA-256 del motivo. Nunca el texto libre (puede contener
 *   PII). Una auditoria durable del motivo requeriria una tabla dedicada,
 *   fuera del alcance de T-20.
 */
export async function purgarSupresion(
  entrada: EntradaPurgarSupresion,
  opciones: OpcionesCliente = {},
): Promise<ResultadoPurgarSupresion> {
  const cliente = opciones.cliente ?? prisma

  const motivo = entrada.motivo.trim()
  if (motivo.length === 0) {
    throw new Error("El motivo de purga es obligatorio.")
  }

  const fila = await cliente.supresionProspecto.findUnique({
    where: { id: entrada.id },
    select: { id: true, activa: true, ambito: true },
  })

  if (!fila) return { ok: false, motivo: "NO_ENCONTRADO" }
  if (fila.activa) return { ok: false, motivo: "ACTIVA" }

  const eliminadas = await cliente.supresionProspecto.deleteMany({
    where: { id: fila.id, activa: false },
  })

  // Si otra operacion la reactivo o la purgo primero, no se borro nada.
  if (eliminadas.count === 0) return { ok: false, motivo: "NO_ENCONTRADO" }

  return { ok: true, id: fila.id, ambito: fila.ambito }
}
