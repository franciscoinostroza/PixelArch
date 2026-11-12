/**
 * T-16 (AC-22, AC-23, AC-24; RF-34..RF-39): helpers de borradores y envíos.
 *
 * Este módulo es server-only por `node:crypto`, pero no hace red, no toca
 * Prisma ni proveedores. Reúne lo que comparten el borrador determinista, la
 * edición versionada y las tareas posteriores (aprobación/envío):
 * - hash SHA-256 estable del contenido de un envío;
 * - datos verificados del prospecto para `renderPlantilla`, sin inventar;
 * - validación del contenido ya renderizado (asunto/cuerpo/HTML seguro);
 * - siguiente versión de un envío.
 *
 * No incluye footer legal ni token de baja: eso se materializa al aprobar
 * (`email.ts`, T-17). No se guardan ni loguean asuntos, cuerpos, destinatarios
 * ni secretos desde aquí.
 */

import { createHash } from "node:crypto"

import {
  MAX_ASUNTO,
  PlantillaInvalidaError,
  normalizarAsunto,
  textoAHtmlSeguro,
  variablesDePlantilla,
  type EntradaDatosPlantilla,
} from "./plantillas"

export type CodigoErrorEnvio =
  | "ASUNTO"
  | "CUERPO"
  | "VARIABLES"
  | "DESTINATARIO"
  | "SECUENCIA"
  | "PLANTILLA"
  | "HASH"

/**
 * Error de contenido de envío. El mensaje solo expone el código fijo: nunca el
 * texto del asunto/cuerpo ni datos del prospecto.
 */
export class EnvioInvalidoError extends Error {
  readonly codigo: CodigoErrorEnvio

  constructor(codigo: CodigoErrorEnvio) {
    super(`Envio invalido (${codigo}).`)
    this.name = "EnvioInvalidoError"
    this.codigo = codigo
  }
}

/* ------------------------------------------------------------------ */
/* Hash determinista del contenido                                     */
/* ------------------------------------------------------------------ */

export interface EntradaHashEnvio {
  asunto: string
  cuerpoTexto: string
  cuerpoHtml: string
  destinatario: string
  plantillaId?: string | null
  plantillaVersion?: number | null
  secuencia: number
}

function textoHash(valor: unknown, codigo: CodigoErrorEnvio): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new EnvioInvalidoError(codigo)
  }
  return valor
}

function identificadorHash(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new EnvioInvalidoError("PLANTILLA")
  }
  return valor.trim()
}

function versionHash(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 1) {
    throw new EnvioInvalidoError("PLANTILLA")
  }
  return valor
}

/**
 * SHA-256 hex determinista sobre el contenido completo del envío. Se usa un
 * arreglo canónico con orden fijo (nunca `JSON.stringify` de un objeto armado
 * por el llamador) para que T-16, T-17 y T-18 calculen el mismo hash.
 *
 * El hash no es un secreto: no incluye tokens ni datos del CRM. Aun así, no se
 * loguea el contenido que lo origina.
 */
export function hashContenidoEnvio(input: EntradaHashEnvio): string {
  if (!input || typeof input !== "object") {
    throw new EnvioInvalidoError("HASH")
  }

  const asunto = textoHash(input.asunto, "ASUNTO")
  const cuerpoTexto = textoHash(input.cuerpoTexto, "CUERPO")
  const cuerpoHtml = textoHash(input.cuerpoHtml, "CUERPO")
  const destinatario = textoHash(input.destinatario, "DESTINATARIO")

  if (
    typeof input.secuencia !== "number" ||
    !Number.isSafeInteger(input.secuencia) ||
    input.secuencia < 1
  ) {
    throw new EnvioInvalidoError("SECUENCIA")
  }

  const canonico = JSON.stringify([
    "propuesta-envio-v1",
    asunto,
    cuerpoTexto,
    cuerpoHtml,
    destinatario,
    identificadorHash(input.plantillaId),
    versionHash(input.plantillaVersion),
    input.secuencia,
  ])

  return createHash("sha256").update(canonico, "utf8").digest("hex")
}

/* ------------------------------------------------------------------ */
/* Datos verificados para la plantilla                                 */
/* ------------------------------------------------------------------ */

export interface ProspectoParaPlantilla {
  nombreNegocio: string
  ciudad?: string | null
  rubro?: string | null
  sitioWeb?: string | null
  contactoNombre?: string | null
  score?: number | null
  auditoriaResumen?: unknown
}

export interface CampanaParaPlantilla {
  rubro?: string | null
  zona?: string | null
}

export interface OpcionesDatosPlantilla {
  remitenteNombre?: string | null
  /** Año para `{{anio}}`; si falta, `construirDatosPlantilla` usa el actual. */
  anio?: number | null
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function hallazgosDeAuditoria(
  valor: unknown,
): { type: string | null; text: string | null }[] | null {
  if (!esObjeto(valor) || !Array.isArray(valor.findings)) return null

  return valor.findings.map((finding) => {
    if (!esObjeto(finding)) return { type: null, text: null }
    return {
      type: typeof finding.type === "string" ? finding.type : null,
      text: typeof finding.text === "string" ? finding.text : null,
    }
  })
}

/**
 * Construye los datos que consume `renderPlantilla` a partir de la ficha real
 * del prospecto y de la campaña de origen. Solo completa ciudad/rubro con los
 * criterios declarados de la campaña cuando la ficha no los tiene: no inventa
 * contacto, email, métricas ni hallazgos. Si no hay auditoría o no tiene
 * `findings`, `plantillas.ts` usa el texto honesto de "sin auditoría".
 */
export function datosPlantillaDesdeProspecto(
  prospecto: ProspectoParaPlantilla,
  campana?: CampanaParaPlantilla | null,
  opciones: OpcionesDatosPlantilla = {},
): EntradaDatosPlantilla {
  const findings = hallazgosDeAuditoria(prospecto.auditoriaResumen)

  return {
    nombreNegocio: textoNoVacio(prospecto.nombreNegocio) ?? "",
    ciudad:
      textoNoVacio(prospecto.ciudad) ?? textoNoVacio(campana?.zona),
    rubro: textoNoVacio(prospecto.rubro) ?? textoNoVacio(campana?.rubro),
    sitioWeb: textoNoVacio(prospecto.sitioWeb),
    contactoNombre: textoNoVacio(prospecto.contactoNombre),
    score:
      typeof prospecto.score === "number" &&
      Number.isInteger(prospecto.score)
        ? prospecto.score
        : null,
    remitenteNombre: textoNoVacio(opciones.remitenteNombre),
    anio:
      typeof opciones.anio === "number" &&
      Number.isInteger(opciones.anio) &&
      opciones.anio >= 2000 &&
      opciones.anio <= 2100
        ? opciones.anio
        : null,
    auditoria: findings === null ? null : { findings },
  }
}

/* ------------------------------------------------------------------ */
/* Contenido ya renderizado                                            */
/* ------------------------------------------------------------------ */

export interface ContenidoEnvioValidado {
  asunto: string
  cuerpoTexto: string
  cuerpoHtml: string
}

function contieneVariables(texto: string): boolean {
  try {
    return variablesDePlantilla(texto).length > 0
  } catch {
    // Placeholders mal formados (`{{`, `}}`) también son contenido inválido:
    // el texto del borrador debe ser final, sin variables pendientes.
    return true
  }
}

/**
 * Valida el asunto y el cuerpo de un envío ya renderizado:
 * - el asunto se limpia de CR/LF y prefijos falsos `Re:`/`Fwd:`/`Fw:`;
 * - el asunto no supera 120 caracteres y el cuerpo no queda vacío;
 * - no quedan variables de plantilla (`{{...}}`);
 * - el HTML se genera con `textoAHtmlSeguro` (todo escapado, sin HTML
 *   arbitrario del admin ni del prospecto).
 */
export function validarContenidoEnvio(
  asunto: unknown,
  cuerpoTexto: unknown,
): ContenidoEnvioValidado {
  if (typeof asunto !== "string" || typeof cuerpoTexto !== "string") {
    throw new EnvioInvalidoError("CUERPO")
  }

  let asuntoLimpio: string
  try {
    asuntoLimpio = normalizarAsunto(asunto)
  } catch (error) {
    if (error instanceof PlantillaInvalidaError) {
      throw new EnvioInvalidoError("ASUNTO")
    }
    throw error
  }

  if (Array.from(asuntoLimpio).length > MAX_ASUNTO) {
    throw new EnvioInvalidoError("ASUNTO")
  }

  const cuerpo = cuerpoTexto.replace(/\r\n?/g, "\n").trim()
  if (cuerpo.length === 0) {
    throw new EnvioInvalidoError("CUERPO")
  }

  if (contieneVariables(asuntoLimpio) || contieneVariables(cuerpo)) {
    throw new EnvioInvalidoError("VARIABLES")
  }

  return {
    asunto: asuntoLimpio,
    cuerpoTexto: cuerpo,
    cuerpoHtml: textoAHtmlSeguro(cuerpo),
  }
}

/* ------------------------------------------------------------------ */
/* Versionado                                                          */
/* ------------------------------------------------------------------ */

/**
 * Siguiente número de versión para un envío. Usa el máximo válido + 1 y nunca
 * programa ni envía nada. Comparte la semántica de `siguienteSecuencia` (T-07).
 */
export function siguienteVersionEnvio(
  versiones: readonly (number | null | undefined)[] | null | undefined,
): number {
  if (!Array.isArray(versiones)) return 1

  let maximo = 0
  for (const valor of versiones) {
    if (
      typeof valor !== "number" ||
      !Number.isSafeInteger(valor) ||
      valor < 1
    ) {
      continue
    }
    if (valor > maximo) maximo = valor
  }

  return maximo + 1
}

/** Motivo fijo guardado al cancelar un envío aprobado por una edición. */
export const MOTIVO_CANCELACION_EDICION = "EDITADO"
