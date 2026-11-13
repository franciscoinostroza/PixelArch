/**
 * T-22 (AC-37, AC-40; RF-30, RF-65): atención de solicitudes ARCO.
 *
 * - `exportarProspecto` es puro: arma un JSON estable con los datos del
 *   prospecto, fuentes/fechas, resumen de auditoría, envíos (estado/fechas/
 *   messageId) e historial. Excluye tokens de baja, hashes de contenido,
 *   idempotency keys, notas internas y cualquier dato del CRM. Del historial
 *   solo conserva acción, fecha y nombres de campos: nunca motivos libres ni
 *   ids de administradores.
 * - `eliminarProspecto` crea una supresión `SOLICITUD_ARCO` (si hay email)
 *   antes de borrar la ficha. El borrado en cascada elimina borradores/envíos;
 *   la supresión no tiene relación con `Prospecto` y permanece. El motivo de la
 *   solicitud no se guarda en claro: la supresión conserva en su `historial`
 *   una entrada `SOLICITUD_ARCO` con `motivoHash` (SHA-256), `motivoLongitud`,
 *   autor y fecha, incluso si la supresión ya existía activa. Sin email no se
 *   inventa una supresión: el log operativo sanitizado (mismo hash/longitud,
 *   sin texto) es el único rastro; una evidencia durable requeriría esquema
 *   nuevo, fuera del alcance de T-22.
 * - `rectificarProspecto` reutiliza las reglas de T-14 (mismos campos
 *   permitidos, fuente obligatoria al cambiar email, control de supresión y
 *   duplicados) y registra el motivo en `historial` sin tocar estado, campaña
 *   ni score. Además deja una entrada en `arcoHistorial`.
 *
 * Módulo server-only: usa Prisma para la supresión/borrado/rectificación, pero
 * no hace red, no envía emails y no toca el CRM. No registra PII.
 */

import type { Prisma } from "@prisma/client"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "./errores"
import {
  dominioNegocio,
  normalizarEmail,
} from "./normalizar"
import {
  agregarEntradaHistorial,
  MAX_HISTORIAL_PROSPECTO,
  normalizarSitioManual,
} from "./prospectos"
import { comprobarSupresion } from "./prospectos-supresion"
import { configPropuestas } from "./config"
import { ErrorSupresion } from "./supresion"
import { crearSupresion } from "./supresiones"
import type { ProspectoPatchInput } from "./validation"

/** Tope de entradas conservadas en `Prospecto.arcoHistorial`. */
export const MAX_ARCO_HISTORIAL = 50

export type AccionArco = "EXPORTACION" | "ELIMINACION" | "RECTIFICACION"

/** Error tipado de ARCO con código y mensaje ya sanitizados. */
export class ErrorArco extends Error {
  readonly codigo: CodigoError

  constructor(codigo: CodigoError) {
    super(sanitizarError(null, { codigo }).mensaje)
    this.name = "ErrorArco"
    this.codigo = codigo
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0
    ? valor.trim()
    : null
}

function isoDe(valor: Date | string | null | undefined): string | null {
  if (valor instanceof Date) {
    return Number.isFinite(valor.getTime()) ? valor.toISOString() : null
  }

  if (typeof valor === "string") {
    const fecha = new Date(valor)
    return Number.isFinite(fecha.getTime()) ? fecha.toISOString() : null
  }

  return null
}

interface EntradaHistorialExportada {
  accion: string
  en: string | null
  campos: string[]
}

interface EntradaArcoExportada {
  accion: string
  en: string | null
}

function camposDe(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []

  const vistos = new Set<string>()
  const salida: string[] = []

  for (const item of valor) {
    if (typeof item !== "string") continue
    const campo = item.trim()
    if (campo.length === 0 || campo.length > 40 || vistos.has(campo)) continue
    vistos.add(campo)
    salida.push(campo)
    if (salida.length >= 30) break
  }

  return salida
}

/**
 * Historial del prospecto sin PII: solo acción, fecha y nombres de campos.
 * `motivo` y `por` se omiten a propósito (pueden contener datos internos).
 */
function sanearHistorial(valor: unknown): EntradaHistorialExportada[] {
  if (!Array.isArray(valor)) return []

  const salida: EntradaHistorialExportada[] = []

  for (const item of valor) {
    if (!esObjeto(item)) continue
    const accion = textoDe(item.accion)
    if (accion === null) continue

    salida.push({
      accion,
      en: textoDe(item.en),
      campos: camposDe(item.campos),
    })
  }

  return salida.slice(-MAX_HISTORIAL_PROSPECTO)
}

/** Historial ARCO exportado: acción y fecha, sin ids de administradores. */
function sanearArcoHistorial(valor: unknown): EntradaArcoExportada[] {
  if (!Array.isArray(valor)) return []

  const salida: EntradaArcoExportada[] = []

  for (const item of valor) {
    if (!esObjeto(item)) continue
    const accion = textoDe(item.accion)
    if (accion === null) continue

    salida.push({ accion, en: textoDe(item.en) })
  }

  return salida.slice(-MAX_ARCO_HISTORIAL)
}

export interface EnvioArcoExportable {
  id: string
  secuencia: number
  version: number
  estado: string
  creadoEn: Date | null
  aprobadoEn: Date | null
  enviadoEn: Date | null
  proveedorMessageId: string | null
  /**
   * Campos que puede traer una fila Prisma y que la exportación excluye a
   * propósito (tokens, hashes, cuerpos y claves de idempotencia).
   */
  tokenBaja?: string | null
  hashContenido?: string | null
  aprobadoHash?: string | null
  idempotencyKey?: string | null
  cuerpoHtml?: string | null
  cuerpoTexto?: string | null
}

export interface ProspectoArcoExportable {
  id: string
  nombreNegocio: string
  sitioWeb: string | null
  dominioNormalizado: string | null
  ciudad: string | null
  rubro: string | null
  placeId: string | null
  email: string | null
  telefono: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  emailFuenteUrl: string | null
  emailFechaFuente: Date | null
  fuenteTipo: string | null
  fuenteUrl: string | null
  fechaFuente: Date | null
  estado: string
  score: number | null
  scoreDetalle: unknown
  auditoriaResumen: unknown
  auditoriaEstado: string | null
  auditoriaFecha: Date | null
  baseLegal: string | null
  notaLegal: string | null
  motivoSinEnriquecer: string | null
  historial: unknown
  arcoHistorial: unknown
  creadoEn: Date | null
  actualizadoEn: Date | null
  ultimaInteraccionEn: Date | null
  ultimoEnvioEn: Date | null
  campanaOrigen: {
    id: string
    nombre: string
    estado: string
  }
  envios: EnvioArcoExportable[]
  /** Notas internas: la exportación las excluye siempre. */
  notas?: string | null
  /** Campos internos de una fila Prisma completa; no se exportan. */
  posibleDuplicadoDeId?: string | null
  actualizadoPor?: string | null
}

export interface ExportacionProspecto {
  tipo: "EXPORTAR"
  formato: "pixelarch-propuestas-arco-v1"
  prospecto: {
    id: string
    nombreNegocio: string
    sitioWeb: string | null
    dominioNormalizado: string | null
    ciudad: string | null
    rubro: string | null
    placeId: string | null
    contacto: {
      email: string | null
      telefono: string | null
      contactoNombre: string | null
      contactoCargo: string | null
    }
    fuentes: {
      fuenteTipo: string | null
      fuenteUrl: string | null
      fechaFuente: string | null
      emailFuenteUrl: string | null
      emailFechaFuente: string | null
    }
    estado: string
    score: number | null
    scoreDetalle: unknown
    auditoria: {
      estado: string | null
      fecha: string | null
      resumen: unknown
    }
    baseLegal: string | null
    notaLegal: string | null
    motivoSinEnriquecer: string | null
    campana: {
      id: string
      nombre: string
      estado: string
    }
    fechas: {
      creadoEn: string | null
      actualizadoEn: string | null
      ultimaInteraccionEn: string | null
      ultimoEnvioEn: string | null
    }
    envios: Array<{
      id: string
      secuencia: number
      version: number
      estado: string
      creadoEn: string | null
      aprobadoEn: string | null
      enviadoEn: string | null
      messageId: string | null
    }>
    historial: EntradaHistorialExportada[]
    arco: EntradaArcoExportada[]
  }
}

/**
 * Construye la exportación ARCO de un prospecto. La lista de campos es una
 * allowlist: no hay `notas`, `tokenBaja`, `hashContenido`, `aprobadoHash`,
 * `idempotencyKey`, `emailHash` ni datos del CRM.
 */
export function exportarProspecto(
  prospecto: ProspectoArcoExportable,
): ExportacionProspecto {
  return {
    tipo: "EXPORTAR",
    formato: "pixelarch-propuestas-arco-v1",
    prospecto: {
      id: prospecto.id,
      nombreNegocio: prospecto.nombreNegocio,
      sitioWeb: prospecto.sitioWeb,
      dominioNormalizado: prospecto.dominioNormalizado,
      ciudad: prospecto.ciudad,
      rubro: prospecto.rubro,
      placeId: prospecto.placeId,
      contacto: {
        email: prospecto.email,
        telefono: prospecto.telefono,
        contactoNombre: prospecto.contactoNombre,
        contactoCargo: prospecto.contactoCargo,
      },
      fuentes: {
        fuenteTipo: prospecto.fuenteTipo,
        fuenteUrl: prospecto.fuenteUrl,
        fechaFuente: isoDe(prospecto.fechaFuente),
        emailFuenteUrl: prospecto.emailFuenteUrl,
        emailFechaFuente: isoDe(prospecto.emailFechaFuente),
      },
      estado: prospecto.estado,
      score: prospecto.score,
      scoreDetalle: prospecto.scoreDetalle,
      auditoria: {
        estado: prospecto.auditoriaEstado,
        fecha: isoDe(prospecto.auditoriaFecha),
        resumen: prospecto.auditoriaResumen,
      },
      baseLegal: prospecto.baseLegal,
      notaLegal: prospecto.notaLegal,
      motivoSinEnriquecer: prospecto.motivoSinEnriquecer,
      campana: {
        id: prospecto.campanaOrigen.id,
        nombre: prospecto.campanaOrigen.nombre,
        estado: prospecto.campanaOrigen.estado,
      },
      fechas: {
        creadoEn: isoDe(prospecto.creadoEn),
        actualizadoEn: isoDe(prospecto.actualizadoEn),
        ultimaInteraccionEn: isoDe(prospecto.ultimaInteraccionEn),
        ultimoEnvioEn: isoDe(prospecto.ultimoEnvioEn),
      },
      envios: prospecto.envios.map((envio) => ({
        id: envio.id,
        secuencia: envio.secuencia,
        version: envio.version,
        estado: envio.estado,
        creadoEn: isoDe(envio.creadoEn),
        aprobadoEn: isoDe(envio.aprobadoEn),
        enviadoEn: isoDe(envio.enviadoEn),
        messageId: envio.proveedorMessageId,
      })),
      historial: sanearHistorial(prospecto.historial),
      arco: sanearArcoHistorial(prospecto.arcoHistorial),
    },
  }
}

/* ------------------------------------------------------------------ */
/* Cliente inyectable                                                  */
/* ------------------------------------------------------------------ */

export interface ClienteArco {
  prospecto: {
    findUnique: <T = unknown>(args: unknown) => Promise<T | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
}

export interface ClienteArcoConTransaccion extends ClienteArco {
  $transaction: <T>(fn: (tx: ClienteArco) => Promise<T>) => Promise<T>
}

export type ClienteArcoInyectable = ClienteArco | ClienteArcoConTransaccion

export interface OpcionesClienteArco {
  /** Cliente Prisma, transacción o doble de tests. */
  cliente?: ClienteArcoInyectable
}

function esTransaccion(
  cliente: ClienteArcoInyectable,
): cliente is ClienteArcoConTransaccion {
  return (
    typeof (cliente as ClienteArcoConTransaccion).$transaction === "function"
  )
}

function crearEjecutor(
  opciones: OpcionesClienteArco,
): <T>(fn: (tx: ClienteArco) => Promise<T>) => Promise<T> {
  const inyectado = opciones.cliente

  if (inyectado === undefined) {
    return <T>(fn: (tx: ClienteArco) => Promise<T>) =>
      (prisma as unknown as ClienteArcoConTransaccion).$transaction(fn)
  }

  if (esTransaccion(inyectado)) {
    return <T>(fn: (tx: ClienteArco) => Promise<T>) =>
      inyectado.$transaction(fn)
  }

  return <T>(fn: (tx: ClienteArco) => Promise<T>) => fn(inyectado)
}

function resolverCliente(opciones: OpcionesClienteArco): ClienteArco {
  return (
    (opciones.cliente as ClienteArco | undefined) ??
    (prisma as unknown as ClienteArco)
  )
}

/* ------------------------------------------------------------------ */
/* Historial ARCO                                                      */
/* ------------------------------------------------------------------ */

export interface EntradaArcoHistorial {
  accion: AccionArco
  por: string
  en: string
  campos?: readonly string[]
}

/**
 * Agrega una entrada al `arcoHistorial` conservando las anteriores y
 * acotando el tamaño. No guarda motivos libres ni datos de contacto.
 */
export function agregarEntradaArco(
  actual: unknown,
  entrada: EntradaArcoHistorial,
): EntradaArcoHistorial[] {
  const previas = Array.isArray(actual)
    ? actual.filter(
        (item): item is EntradaArcoHistorial =>
          esObjeto(item) &&
          typeof item.accion === "string" &&
          typeof item.por === "string" &&
          typeof item.en === "string",
      )
    : []

  return [...previas, entrada].slice(-MAX_ARCO_HISTORIAL)
}

/**
 * Registra una acción ARCO en `Prospecto.arcoHistorial`, con quién y cuándo.
 * Devuelve `false` si el prospecto ya no existe. No escribe PII.
 */
export async function registrarAccionArco(
  entrada: {
    id: string
    accion: AccionArco
    por: string
    en?: Date
    campos?: readonly string[]
    /**
     * Historial ya leído por el llamador. Si se pasa (aunque sea `null`), evita
     * una segunda lectura y registra la acción con la versión cargada.
     */
    historialActual?: unknown
  },
  opciones: OpcionesClienteArco = {},
): Promise<boolean> {
  const cliente = resolverCliente(opciones)

  let actual = entrada.historialActual

  if (actual === undefined) {
    const prospecto = await cliente.prospecto.findUnique<{
      arcoHistorial: unknown
    }>({
      where: { id: entrada.id },
      select: { arcoHistorial: true },
    })

    if (!prospecto) return false
    actual = prospecto.arcoHistorial
  }

  const ahora = entrada.en ?? new Date()
  const historial = agregarEntradaArco(actual, {
    accion: entrada.accion,
    por: entrada.por,
    en: ahora.toISOString(),
    campos: entrada.campos,
  })

  const actualizado = await cliente.prospecto.updateMany({
    where: { id: entrada.id },
    data: {
      arcoHistorial: historial as unknown as Prisma.InputJsonValue,
    },
  })

  return actualizado.count > 0
}

/* ------------------------------------------------------------------ */
/* Eliminación                                                         */
/* ------------------------------------------------------------------ */

export interface EntradaEliminarProspecto {
  id: string
  /** Admin que atiende la solicitud. */
  por: string
  porNombre?: string | null
  /**
   * Motivo o referencia de la solicitud. Nunca se guarda ni se loguea en
   * claro: solo su hash SHA-256 y su longitud quedan como evidencia.
   */
  motivo?: string | null
  /** HMAC obligatorio solo si el prospecto tiene email. */
  secreto?: string | null
  /** Fecha de la acción (por defecto, ahora). */
  en?: Date
}

export interface SupresionCreadaArco {
  id: string
  creada: boolean
  reactivada: boolean
}

export type ResultadoEliminarProspecto =
  | {
      ok: true
      eliminado: true
      supresion: SupresionCreadaArco | null
    }
  | {
      ok: false
      motivo: "NO_ENCONTRADO" | "NO_CONFIGURADO" | "VALIDACION"
    }

/**
 * Elimina una ficha por solicitud ARCO.
 *
 * Orden dentro de la transacción:
 * 1. lee el email actual (nunca lo loguea);
 * 2. si hay email, crea/reactiva la supresión `SOLICITUD_ARCO` con
 *    `crearSupresion` (hash HMAC, sin email en claro) y agrega al historial de
 *    la supresión la entrada durable `SOLICITUD_ARCO` con `motivoHash`
 *    (SHA-256 del motivo), `motivoLongitud`, `por` y `en`. La entrada se agrega
 *    también cuando la supresión ya existía activa; no se pisan
 *    `motivo`/`origen`/`creadaPor`/`creadaEn`;
 * 3. borra el prospecto con `deleteMany`; la cascada del esquema elimina
 *    borradores/envíos y deja `ConsumoProveedor.prospectoId` en null;
 * 4. la supresión no se borra: no tiene relación con `Prospecto`.
 *
 * Sin secreto y con email falla cerrado (`NO_CONFIGURADO`). Sin email no hay
 * nada que suprimir: la ficha se borra igual y **no se inventa una supresión**.
 * En ese caso el log operativo sanitizado (`motivoHash`, `motivoLongitud`,
 * `por`) es el único rastro de la solicitud; una evidencia durable sin email
 * requeriría un esquema dedicado, fuera del alcance de T-22.
 */
export async function eliminarProspecto(
  entrada: EntradaEliminarProspecto,
  opciones: OpcionesClienteArco = {},
): Promise<ResultadoEliminarProspecto> {
  const ejecutar = crearEjecutor(opciones)
  const ahora = entrada.en ?? new Date()
  const motivo =
    typeof entrada.motivo === "string" ? entrada.motivo.trim() : ""
  const motivoHash =
    motivo.length > 0
      ? createHash("sha256").update(motivo, "utf8").digest("hex")
      : null
  const motivoLongitud = motivo.length

  try {
    const resultado = await ejecutar(
      async (cliente): Promise<ResultadoEliminarProspecto> => {
        const prospecto = await cliente.prospecto.findUnique<{
          id: string
          email: string | null
        }>({
          where: { id: entrada.id },
          select: { id: true, email: true },
        })

        if (!prospecto) return { ok: false, motivo: "NO_ENCONTRADO" }

        let supresion: SupresionCreadaArco | null = null

        if (prospecto.email) {
          if (!entrada.secreto) {
            return { ok: false, motivo: "NO_CONFIGURADO" }
          }

          try {
            const creada = await crearSupresion(
              {
                ambito: "EMAIL",
                email: prospecto.email,
                motivo: "SOLICITUD_ARCO",
                origen: "ARCO",
                notas: "Solicitud de eliminacion ARCO",
                creadaPor: entrada.por,
                creadaPorNombre: entrada.porNombre ?? null,
                secreto: entrada.secreto,
              },
              {
                cliente: cliente as unknown as Prisma.TransactionClient,
                registroArco: {
                  motivoHash,
                  motivoLongitud,
                  por: entrada.por,
                  en: ahora,
                },
              },
            )

            supresion = {
              id: creada.id,
              creada: creada.creada,
              reactivada: creada.reactivada,
            }
          } catch (error) {
            if (error instanceof ErrorSupresion) {
              return {
                ok: false,
                motivo:
                  error.codigo === "SECRETO"
                    ? "NO_CONFIGURADO"
                    : "VALIDACION",
              }
            }

            throw error
          }
        }

        const borrado = await cliente.prospecto.deleteMany({
          where: { id: prospecto.id },
        })

        if (borrado.count === 0) {
          return { ok: false, motivo: "NO_ENCONTRADO" }
        }

        return { ok: true, eliminado: true, supresion }
      },
    )

    if (resultado.ok) {
      // Evidencia operativa sin PII, después del commit: solo ids internos,
      // booleanos de la supresión conservada y hash/longitud del motivo. El
      // texto libre del motivo nunca se loguea.
      logger.info("ARCO eliminacion", {
        prospectoId: entrada.id,
        adminId: entrada.por,
        por: entrada.por,
        motivoHash,
        motivoLongitud,
        supresionId: resultado.supresion?.id ?? null,
        supresionCreada: resultado.supresion?.creada ?? false,
        supresionReactivada: resultado.supresion?.reactivada ?? false,
      })
    }

    return resultado
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      throw new ErrorArco("ESQUEMA_NO_APLICADO")
    }

    throw error
  }
}

/* ------------------------------------------------------------------ */
/* Rectificación                                                       */
/* ------------------------------------------------------------------ */

export type CambiosRectificacion = Omit<ProspectoPatchInput, "motivo">

export interface EntradaRectificarProspecto {
  id: string
  cambios: CambiosRectificacion
  /** Obligatorio: queda en `historial` (regla T-14). */
  motivo: string
  por: string
  /** Necesario solo si cambia el email y hay que comprobar supresión. */
  secreto?: string | null
  en?: Date
}

export type ResultadoRectificarProspecto =
  | { ok: true; id: string; campos: string[] }
  | {
      ok: false
      motivo:
        | "NO_ENCONTRADO"
        | "SUPRIMIDO"
        | "VALIDACION"
        | "NO_CONFIGURADO"
        | "DUPLICADO"
        | "SIN_CAMBIOS"
    }

interface ProspectoRectificable {
  id: string
  estado: string
  nombreNegocio: string
  sitioWeb: string | null
  dominioNormalizado: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  rubro: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
  historial: unknown
  arcoHistorial: unknown
}

/**
 * Aplica una rectificación ARCO con las mismas reglas que el PATCH de T-14:
 * - solo campos permitidos;
 * - sitio normalizado y sin redes/agregadores/proveedores públicos;
 * - cambio de email exige fuente, normaliza, comprueba supresión y evita
 *   duplicados exactos;
 * - no toca estado, campaña, score ni `scoreDetalle`;
 * - `historial` guarda acción, nombres de campos, motivo, autor y fecha (sin
 *   valores); `arcoHistorial` agrega la acción RECTIFICACION.
 */
export async function rectificarProspecto(
  entrada: EntradaRectificarProspecto,
  opciones: OpcionesClienteArco = {},
): Promise<ResultadoRectificarProspecto> {
  const cliente = resolverCliente(opciones)
  const cambios = entrada.cambios
  const ahora = entrada.en ?? new Date()
  const motivo = typeof entrada.motivo === "string" ? entrada.motivo.trim() : ""

  if (motivo.length === 0) return { ok: false, motivo: "VALIDACION" }
  if (!cambios || typeof cambios !== "object") {
    return { ok: false, motivo: "VALIDACION" }
  }

  try {
    const prospecto = await cliente.prospecto.findUnique<ProspectoRectificable>(
      {
        where: { id: entrada.id },
        select: {
          id: true,
          estado: true,
          nombreNegocio: true,
          sitioWeb: true,
          dominioNormalizado: true,
          email: true,
          telefono: true,
          ciudad: true,
          rubro: true,
          contactoNombre: true,
          contactoCargo: true,
          fuenteUrl: true,
          emailFuenteUrl: true,
          historial: true,
          arcoHistorial: true,
        },
      },
    )

    if (!prospecto) return { ok: false, motivo: "NO_ENCONTRADO" }
    if (prospecto.estado === "SUPRIMIDO") {
      return { ok: false, motivo: "SUPRIMIDO" }
    }

    const data: Prisma.ProspectoUpdateManyMutationInput = {}
    const campos: string[] = []

    const dominioActual =
      prospecto.dominioNormalizado ??
      (prospecto.sitioWeb
        ? dominioNegocio(prospecto.sitioWeb)
        : null)
    let dominioNuevo = dominioActual

    if (cambios.sitioWeb !== undefined) {
      const sitio = normalizarSitioManual(cambios.sitioWeb)
      if (sitio === null) return { ok: false, motivo: "VALIDACION" }

      if (
        sitio.sitioWeb !== prospecto.sitioWeb ||
        sitio.dominio !== prospecto.dominioNormalizado
      ) {
        data.sitioWeb = sitio.sitioWeb
        data.dominioNormalizado = sitio.dominio
        dominioNuevo = sitio.dominio
        campos.push("sitioWeb")
      }
    }

    const emailActual = prospecto.email
      ? normalizarEmail(prospecto.email)
      : null

    if (cambios.email !== undefined) {
      const emailNuevo = normalizarEmail(cambios.email)
      if (emailNuevo === null) return { ok: false, motivo: "VALIDACION" }

      if (emailNuevo !== emailActual) {
        const fuenteEmail =
          cambios.emailFuenteUrl ??
          prospecto.emailFuenteUrl ??
          cambios.fuenteUrl ??
          prospecto.fuenteUrl

        if (!fuenteEmail) return { ok: false, motivo: "VALIDACION" }

        const config = configPropuestas()
        const supresion = await comprobarSupresion({
          email: emailNuevo,
          secreto: config.supresion.disponible ? config.secreto : null,
          dominioSitio: dominioNuevo,
        })

        if (supresion.suprimido) {
          return {
            ok: false,
            motivo:
              supresion.codigo === "NO_CONFIGURADO"
                ? "NO_CONFIGURADO"
                : "SUPRIMIDO",
          }
        }

        const duplicado = await cliente.prospecto.findUnique<{ id: string }>({
          where: { email: emailNuevo },
          select: { id: true },
        })

        if (duplicado && duplicado.id !== prospecto.id) {
          return { ok: false, motivo: "DUPLICADO" }
        }

        data.email = emailNuevo
        data.emailFechaFuente = ahora
        campos.push("email")
      }
    }

    if (
      cambios.nombreNegocio !== undefined &&
      cambios.nombreNegocio !== prospecto.nombreNegocio
    ) {
      data.nombreNegocio = cambios.nombreNegocio
      campos.push("nombreNegocio")
    }

    if (
      cambios.telefono !== undefined &&
      cambios.telefono !== prospecto.telefono
    ) {
      data.telefono = cambios.telefono
      campos.push("telefono")
    }

    if (cambios.ciudad !== undefined && cambios.ciudad !== prospecto.ciudad) {
      data.ciudad = cambios.ciudad
      campos.push("ciudad")
    }

    if (cambios.rubro !== undefined && cambios.rubro !== prospecto.rubro) {
      data.rubro = cambios.rubro
      campos.push("rubro")
    }

    if (
      cambios.contactoNombre !== undefined &&
      cambios.contactoNombre !== prospecto.contactoNombre
    ) {
      data.contactoNombre = cambios.contactoNombre
      campos.push("contactoNombre")
    }

    if (
      cambios.contactoCargo !== undefined &&
      cambios.contactoCargo !== prospecto.contactoCargo
    ) {
      data.contactoCargo = cambios.contactoCargo
      campos.push("contactoCargo")
    }

    if (
      cambios.fuenteUrl !== undefined &&
      cambios.fuenteUrl !== prospecto.fuenteUrl
    ) {
      data.fuenteUrl = cambios.fuenteUrl
      campos.push("fuenteUrl")
    }

    if (
      cambios.emailFuenteUrl !== undefined &&
      cambios.emailFuenteUrl !== prospecto.emailFuenteUrl
    ) {
      data.emailFuenteUrl = cambios.emailFuenteUrl
      campos.push("emailFuenteUrl")
    }

    if (campos.length === 0) return { ok: false, motivo: "SIN_CAMBIOS" }

    const historial = agregarEntradaHistorial(prospecto.historial, {
      accion: "CORRECCION",
      campos,
      motivo,
      por: entrada.por,
      en: ahora.toISOString(),
    })

    const arcoHistorial = agregarEntradaArco(prospecto.arcoHistorial, {
      accion: "RECTIFICACION",
      por: entrada.por,
      en: ahora.toISOString(),
      campos,
    })

    data.historial = historial as unknown as Prisma.InputJsonValue
    data.arcoHistorial = arcoHistorial as unknown as Prisma.InputJsonValue
    data.actualizadoPor = entrada.por
    data.ultimaInteraccionEn = ahora

    const actualizado = await cliente.prospecto.updateMany({
      where: { id: entrada.id, estado: { not: "SUPRIMIDO" } },
      data,
    })

    if (actualizado.count === 0) {
      const actual = await cliente.prospecto.findUnique<{ estado: string }>({
        where: { id: entrada.id },
        select: { estado: true },
      })

      if (!actual) return { ok: false, motivo: "NO_ENCONTRADO" }
      if (actual.estado === "SUPRIMIDO") {
        return { ok: false, motivo: "SUPRIMIDO" }
      }
      return { ok: false, motivo: "VALIDACION" }
    }

    return { ok: true, id: entrada.id, campos }
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      throw new ErrorArco("ESQUEMA_NO_APLICADO")
    }

    throw error
  }
}
