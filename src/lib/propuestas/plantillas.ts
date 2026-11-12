/**
 * T-08 (AC-22, AC-32; RF-34, RF-37): plantillas deterministas y render seguro.
 *
 * Reglas del plan §4.5:
 * - Variables con lista blanca global; `variablesPermitidas` solo puede
 *   declarar un subconjunto, nunca ampliar la lista.
 * - El asunto se limpia de CR/LF y prefijos falsos (`Re:`, `Fwd:`, `Fw:`),
 *   se colapsan espacios y se limita a 120 caracteres.
 * - El cuerpo es texto plano: se escapa todo al generar HTML. No se permite
 *   HTML arbitrario de la plantilla ni de los datos.
 * - `hallazgoPrincipal` sale solo de la auditoria; si no hay auditoria se usa
 *   un texto honesto, sin inventar metricas.
 *
 * Modulo puro: no toca Prisma, red, entorno, emails ni proveedores.
 */

export const VARIABLES_PLANTILLA = [
  "nombreNegocio",
  "ciudad",
  "rubro",
  "sitioWeb",
  "contactoNombre",
  "saludo",
  "hallazgoPrincipal",
  "score",
  "remitenteNombre",
  "anio",
] as const

export type VariablePlantilla = (typeof VARIABLES_PLANTILLA)[number]

export const MAX_ASUNTO = 120
export const PREFIJO_PUBLICIDAD = "[publicidad]"
export const HALLAZGO_SIN_AUDITORIA = "No pudimos revisar tu sitio todavía"
export const REMITENTE_NOMBRE_POR_DEFECTO = "PixelArch"

const CONJUNTO_VARIABLES = new Set<string>(VARIABLES_PLANTILLA)

const RE_VARIABLE = /\{\{([^{}]*)\}\}/g
const RE_NOMBRE_VARIABLE = /^[A-Za-z][A-Za-z0-9]*$/
const RE_PREFIJO_FALSO = /^(?:re|fwd|fw)\s*:\s*/i
const RE_PUBLICIDAD = /^\[\s*publicidad\s*\]\s*/i

export type CodigoErrorPlantilla =
  | "ASUNTO_VACIO"
  | "ASUNTO_LARGO"
  | "CUERPO_VACIO"
  | "FORMATO"
  | "VARIABLE_DESCONOCIDA"
  | "VARIABLE_NO_PERMITIDA"
  | "VARIABLES_PERMITIDAS"
  | "VERSION"

/**
 * Entrada invalida. El mensaje solo incluye el codigo fijo: nunca el contenido
 * de la plantilla, que podria contener datos del prospecto.
 */
export class PlantillaInvalidaError extends Error {
  readonly codigo: CodigoErrorPlantilla

  constructor(codigo: CodigoErrorPlantilla) {
    super(`Plantilla invalida (${codigo}).`)
    this.name = "PlantillaInvalidaError"
    this.codigo = codigo
  }
}

export interface EntradaPlantilla {
  asunto: string
  cuerpo: string
  /** Subconjunto de la lista blanca usada por esta plantilla. */
  variablesPermitidas?: readonly string[] | null
  /** Version de la plantilla; si falta se asume 1. */
  version?: number | null
}

export interface PlantillaValidada {
  asunto: string
  cuerpo: string
  variablesUsadas: VariablePlantilla[]
  /** Lista canonica: solo las variables realmente usadas. */
  variablesPermitidas: VariablePlantilla[]
  version: number
}

export interface HallazgoAuditoria {
  type?: string | null
  text?: string | null
}

export interface EntradaDatosPlantilla {
  nombreNegocio?: string | null
  ciudad?: string | null
  rubro?: string | null
  sitioWeb?: string | null
  contactoNombre?: string | null
  score?: number | null
  remitenteNombre?: string | null
  anio?: number | null
  auditoria?: { findings?: readonly HallazgoAuditoria[] | null } | null
}

/** Datos ya normalizados y listos para sustituir; todas las variables son texto. */
export interface DatosPlantilla {
  nombreNegocio: string
  ciudad: string
  rubro: string
  sitioWeb: string
  contactoNombre: string
  saludo: string
  hallazgoPrincipal: string
  score: string
  remitenteNombre: string
  anio: string
}

export interface SalidaPlantilla {
  asunto: string
  cuerpoTexto: string
  cuerpoHtml: string
  variablesUsadas: VariablePlantilla[]
  version: number
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function longitudCaracteres(texto: string): number {
  return Array.from(texto).length
}

/**
 * Limpia un asunto: quita CR/LF (evita inyeccion de headers), colapsa
 * espacios y elimina prefijos falsos de respuesta/reenvio. No inventa texto:
 * si queda vacio lanza `ASUNTO_VACIO`.
 */
export function normalizarAsunto(asunto: string): string {
  if (typeof asunto !== "string") {
    throw new PlantillaInvalidaError("ASUNTO_VACIO")
  }

  let limpio = asunto
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  let anterior = ""
  while (limpio !== anterior) {
    anterior = limpio
    limpio = limpio.replace(RE_PREFIJO_FALSO, "").trim()
  }

  if (limpio.length === 0) {
    throw new PlantillaInvalidaError("ASUNTO_VACIO")
  }

  return limpio
}

/**
 * Asunto final de un email. Aplica el prefijo `[publicidad]` una sola vez
 * cuando la configuracion lo pide y valida el maximo sobre el resultado.
 */
export function prepararAsunto(
  asunto: string,
  etiquetaPublicidad = false,
): string {
  let limpio = normalizarAsunto(asunto)

  if (etiquetaPublicidad && !RE_PUBLICIDAD.test(limpio)) {
    limpio = `${PREFIJO_PUBLICIDAD} ${limpio}`
  }

  if (longitudCaracteres(limpio) > MAX_ASUNTO) {
    throw new PlantillaInvalidaError("ASUNTO_LARGO")
  }

  return limpio
}

/**
 * Extrae los nombres de variable de un texto en orden de aparicion, sin
 * duplicados. Un placeholder mal formado (`{{`, `}}`, nombre invalido) lanza
 * `FORMATO`; las variables desconocidas se validan contra la lista blanca en
 * `validarPlantilla`.
 */
export function variablesDePlantilla(texto: string): string[] {
  if (typeof texto !== "string") {
    throw new PlantillaInvalidaError("FORMATO")
  }

  const encontradas: string[] = []
  const sinVariables = texto.replace(RE_VARIABLE, (_match, contenido: string) => {
    const nombre = contenido.trim()
    if (!RE_NOMBRE_VARIABLE.test(nombre)) {
      throw new PlantillaInvalidaError("FORMATO")
    }
    if (!encontradas.includes(nombre)) encontradas.push(nombre)
    return ""
  })

  if (sinVariables.includes("{{") || sinVariables.includes("}}")) {
    throw new PlantillaInvalidaError("FORMATO")
  }

  return encontradas
}

function variablesUsadas(textos: string[]): VariablePlantilla[] {
  const usadas: VariablePlantilla[] = []

  for (const texto of textos) {
    for (const nombre of variablesDePlantilla(texto)) {
      if (!CONJUNTO_VARIABLES.has(nombre)) {
        throw new PlantillaInvalidaError("VARIABLE_DESCONOCIDA")
      }

      const variable = nombre as VariablePlantilla
      if (!usadas.includes(variable)) usadas.push(variable)
    }
  }

  return usadas
}

function variablesDeclaradas(
  valor: readonly string[] | null | undefined,
): VariablePlantilla[] | null {
  if (valor === undefined || valor === null) return null
  if (!Array.isArray(valor)) {
    throw new PlantillaInvalidaError("VARIABLES_PERMITIDAS")
  }

  const declaradas: VariablePlantilla[] = []

  for (const item of valor) {
    if (typeof item !== "string") {
      throw new PlantillaInvalidaError("VARIABLES_PERMITIDAS")
    }

    const nombre = item.trim()
    if (!CONJUNTO_VARIABLES.has(nombre)) {
      throw new PlantillaInvalidaError("VARIABLE_DESCONOCIDA")
    }

    const variable = nombre as VariablePlantilla
    if (!declaradas.includes(variable)) declaradas.push(variable)
  }

  return declaradas
}

function versionPlantilla(valor: unknown): number {
  if (valor === undefined || valor === null) return 1
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 1) {
    throw new PlantillaInvalidaError("VERSION")
  }
  return valor
}

/**
 * Valida asunto, cuerpo, variables y version. Devuelve la lista canonica de
 * variables usadas (que es la que se puede persistir como `variablesPermitidas`).
 */
export function validarPlantilla(input: EntradaPlantilla): PlantillaValidada {
  if (!input || typeof input !== "object") {
    throw new PlantillaInvalidaError("CUERPO_VACIO")
  }

  const asunto = normalizarAsunto(input.asunto)
  if (longitudCaracteres(asunto) > MAX_ASUNTO) {
    throw new PlantillaInvalidaError("ASUNTO_LARGO")
  }

  const cuerpo = textoNoVacio(input.cuerpo)
  if (cuerpo === null) {
    throw new PlantillaInvalidaError("CUERPO_VACIO")
  }

  const usadas = variablesUsadas([asunto, cuerpo])
  const declaradas = variablesDeclaradas(input.variablesPermitidas)

  if (declaradas !== null) {
    for (const variable of usadas) {
      if (!declaradas.includes(variable)) {
        throw new PlantillaInvalidaError("VARIABLE_NO_PERMITIDA")
      }
    }
  }

  return {
    asunto,
    cuerpo,
    variablesUsadas: usadas,
    variablesPermitidas: usadas,
    version: versionPlantilla(input.version),
  }
}

function textoPlano(valor: unknown): string {
  if (typeof valor !== "string") return ""
  return valor.trim()
}

function hallazgoDeAuditoria(
  auditoria: EntradaDatosPlantilla["auditoria"],
): string {
  const findings = auditoria?.findings
  if (!Array.isArray(findings)) return HALLAZGO_SIN_AUDITORIA

  for (const tipo of ["fail", "warn", "ok"] as const) {
    const encontrado = findings.find((finding) => {
      if (!finding || typeof finding !== "object") return false
      if (finding.type !== tipo) return false
      return textoPlano(finding.text).length > 0
    })

    if (encontrado) {
      return textoPlano(encontrado.text)
    }
  }

  return HALLAZGO_SIN_AUDITORIA
}

function scoreTexto(valor: unknown): string {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return ""
  if (valor < 0 || valor > 100) return ""
  return String(valor)
}

function anioTexto(valor: unknown): string {
  if (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 2000 &&
    valor <= 2100
  ) {
    return String(valor)
  }

  return String(new Date().getUTCFullYear())
}

/**
 * Normaliza los datos verificados del prospecto. Los campos faltantes quedan
 * vacios: no se completa un email, un nombre ni metricas que no existan.
 */
export function construirDatosPlantilla(
  input?: EntradaDatosPlantilla | null,
): DatosPlantilla {
  const datos = input && typeof input === "object" ? input : {}
  const contactoNombre = textoPlano(datos.contactoNombre)

  return {
    nombreNegocio: textoPlano(datos.nombreNegocio),
    ciudad: textoPlano(datos.ciudad),
    rubro: textoPlano(datos.rubro),
    sitioWeb: textoPlano(datos.sitioWeb),
    contactoNombre,
    saludo: contactoNombre.length > 0 ? `Hola ${contactoNombre}` : "Hola",
    hallazgoPrincipal: hallazgoDeAuditoria(datos.auditoria),
    score: scoreTexto(datos.score),
    remitenteNombre:
      textoPlano(datos.remitenteNombre) || REMITENTE_NOMBRE_POR_DEFECTO,
    anio: anioTexto(datos.anio),
  }
}

function valorVariable(nombre: string, datos: DatosPlantilla): string {
  const valor = datos[nombre as keyof DatosPlantilla]
  return typeof valor === "string" ? valor : ""
}

function sustituirVariables(texto: string, datos: DatosPlantilla): string {
  return texto.replace(RE_VARIABLE, (_match, contenido: string) => {
    return valorVariable(contenido.trim(), datos)
  })
}

/** Escape de texto para HTML, incluido el contenido de la plantilla. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Convierte texto plano a HTML seguro: doble salto -> parrafo, salto simple ->
 * `<br />`. Todo el texto se escapa antes; no se interpreta HTML embebido.
 */
export function textoAHtmlSeguro(texto: string): string {
  if (typeof texto !== "string") return ""

  const normalizado = texto.replace(/\r\n?/g, "\n").trim()
  if (normalizado.length === 0) return ""

  return normalizado
    .split(/\n{2,}/)
    .map((parrafo) => {
      const limpio = parrafo.trim()
      if (limpio.length === 0) return ""
      return `<p>${escaparHtml(limpio).replace(/\n/g, "<br />")}</p>`
    })
    .filter((parrafo) => parrafo.length > 0)
    .join("")
}

/**
 * Render determinista de una plantilla con datos verificados. No agrega CTAs,
 * enlaces, metricas ni HTML de la plantilla: solo sustituye variables y escapa.
 * El footer legal y el enlace de baja se materializan al aprobar (`email.ts`).
 */
export function renderPlantilla(
  plantilla: EntradaPlantilla,
  datos?: EntradaDatosPlantilla | null,
): SalidaPlantilla {
  const valida = validarPlantilla(plantilla)
  const valores = construirDatosPlantilla(datos)

  const asunto = prepararAsunto(
    sustituirVariables(valida.asunto, valores),
    false,
  )
  const cuerpoTexto = sustituirVariables(valida.cuerpo, valores).trim()

  if (cuerpoTexto.length === 0) {
    throw new PlantillaInvalidaError("CUERPO_VACIO")
  }

  return {
    asunto,
    cuerpoTexto,
    cuerpoHtml: textoAHtmlSeguro(cuerpoTexto),
    variablesUsadas: valida.variablesUsadas,
    version: valida.version,
  }
}
