/**
 * T-07 (AC-21; RF-33): score v1 determinista y explicable.
 *
 * Reglas del plan §4.4:
 * - Total 100, sin fecha, sin azar y sin LLM.
 * - Los datos faltantes suman 0 y agregan un motivo; nunca se inventan.
 * - El desglose conserva puntos, maximo y motivos por componente.
 *
 * Modulo puro: no toca Prisma, red, entorno ni proveedores. Solo usa
 * normalizacion local de T-05 para validar email, sitio y dominio.
 */

import {
  esHostNoProspectable,
  normalizarDominio,
  normalizarEmail,
} from "./normalizar"

export const SCORE_VERSION = "v1" as const
export type VersionScore = typeof SCORE_VERSION

/**
 * Unico estado de auditoria que habilita el bonus de sitio y el calculo
 * tecnico. T-09 debe guardar este valor al completar una auditoria.
 */
export const AUDITORIA_ESTADO_OK = "OK" as const

export type ClaveComponenteScore =
  | "CONTACTO_PROFESIONAL"
  | "SITIO_PROPIO"
  | "OPORTUNIDAD_TECNICA"
  | "ENCAJE_CAMPANA"
  | "COMPLETITUD"

export interface ScoreComponente {
  clave: ClaveComponenteScore
  etiqueta: string
  puntos: number
  maximo: number
  motivos: string[]
}

export interface ScoreResultado {
  total: number
  componentes: ScoreComponente[]
  version: VersionScore
}

export interface PuntajesAuditoria {
  velocidad?: number | null
  ssl?: number | null
  seo?: number | null
  seguridad?: number | null
}

export interface AuditoriaScore {
  /** Solo `OK` habilita el bonus de sitio y el calculo tecnico. */
  estado?: string | null
  scores?: PuntajesAuditoria | null
}

export interface CampanaScore {
  rubro?: string | null
  zona?: string | null
  /** Alias de `zona` para llamadas que ya normalizan la campana. */
  ciudad?: string | null
}

export interface EntradaScore {
  email?: string | null
  emailFuenteUrl?: string | null
  fuenteUrl?: string | null
  sitioWeb?: string | null
  telefono?: string | null
  ciudad?: string | null
  rubro?: string | null
  campana?: CampanaScore | null
  auditoria?: AuditoriaScore | null
}

const MAX_CONTACTO = 30
const MAX_SITIO = 20
const MAX_OPORTUNIDAD = 20
const MAX_ENCAJE = 15
const MAX_COMPLETITUD = 15

const ETIQUETAS: Record<ClaveComponenteScore, string> = {
  CONTACTO_PROFESIONAL: "Contacto profesional",
  SITIO_PROPIO: "Sitio propio",
  OPORTUNIDAD_TECNICA: "Oportunidad tecnica",
  ENCAJE_CAMPANA: "Encaje de campana",
  COMPLETITUD: "Completitud",
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function limitar(valor: number, maximo: number): number {
  if (!Number.isFinite(valor)) return 0
  return Math.max(0, Math.min(maximo, Math.round(valor)))
}

/** Valida una URL http(s) publica sin credenciales, usada como fuente. */
function esUrlHttp(valor: unknown): boolean {
  const raw = textoNoVacio(valor)
  if (raw === null) return false

  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (url.username || url.password) return false
    if (!url.hostname.includes(".")) return false
    return true
  } catch {
    return false
  }
}

function esHttps(valor: unknown): boolean {
  const raw = textoNoVacio(valor)
  if (raw === null) return false

  try {
    return new URL(raw).protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Texto comparable determinista: minusculas, sin acentos, sin puntuacion y
 * con espacios colapsados. No usa locale ni fecha.
 */
function normalizarComparable(valor: unknown): string | null {
  const raw = textoNoVacio(valor)
  if (raw === null) return null

  const normalizado = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  return normalizado.length > 0 ? normalizado : null
}

/** Solo un telefono con forma telefonica y 6-15 digitos suma completitud. */
function telefonoValido(valor: unknown): boolean {
  const raw = textoNoVacio(valor)
  if (raw === null) return false
  if (!/^[+\d().\s-]+$/.test(raw)) return false

  const digitos = raw.replace(/\D/g, "")
  return digitos.length >= 6 && digitos.length <= 15
}

/** Sitio propio: dominio valido, no social/marketplace/agregador/link-in-bio. */
function sitioPropio(valor: unknown): boolean {
  const host = normalizarDominio(
    typeof valor === "string" ? valor : "",
  )
  if (host === null) return false
  return !esHostNoProspectable(host)
}

function auditoriaOk(valor: unknown): boolean {
  const estado = textoNoVacio(valor)
  return estado !== null && estado.toUpperCase() === AUDITORIA_ESTADO_OK
}

function scoreNumerico(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null
  return Math.max(0, Math.min(100, Math.round(valor)))
}

function componente(
  clave: ClaveComponenteScore,
  maximo: number,
  puntos: number,
  motivos: string[],
): ScoreComponente {
  return {
    clave,
    etiqueta: ETIQUETAS[clave],
    puntos: limitar(puntos, maximo),
    maximo,
    motivos,
  }
}

function evaluarContacto(input: EntradaScore): ScoreComponente {
  const motivos: string[] = []
  const email = normalizarEmail(
    typeof input.email === "string" ? input.email : "",
  )

  if (email === null) {
    motivos.push("Sin email profesional publicado.")
    return componente("CONTACTO_PROFESIONAL", MAX_CONTACTO, 0, motivos)
  }

  // La fuente del email puede ser especifica o la fuente general del prospecto.
  if (!esUrlHttp(input.emailFuenteUrl) && !esUrlHttp(input.fuenteUrl)) {
    motivos.push("El email no tiene fuente registrada.")
    return componente("CONTACTO_PROFESIONAL", MAX_CONTACTO, 0, motivos)
  }

  motivos.push("Email profesional con fuente registrada.")
  return componente("CONTACTO_PROFESIONAL", MAX_CONTACTO, 30, motivos)
}

function evaluarSitio(input: EntradaScore): ScoreComponente {
  const motivos: string[] = []

  if (!sitioPropio(input.sitioWeb)) {
    motivos.push("Sin sitio web propio.")
    return componente("SITIO_PROPIO", MAX_SITIO, 0, motivos)
  }

  let puntos = 10
  motivos.push("Sitio web propio disponible.")

  if (esHttps(input.sitioWeb)) {
    puntos += 5
    motivos.push("El sitio usa HTTPS.")
  }

  if (auditoriaOk(input.auditoria?.estado)) {
    puntos += 5
    motivos.push("La auditoria web termino correctamente.")
  }

  return componente("SITIO_PROPIO", MAX_SITIO, puntos, motivos)
}

function evaluarOportunidad(input: EntradaScore): ScoreComponente {
  const motivos: string[] = []
  const auditoria = input.auditoria

  if (!auditoria || typeof auditoria !== "object") {
    motivos.push("No hay auditoria web disponible.")
    return componente("OPORTUNIDAD_TECNICA", MAX_OPORTUNIDAD, 0, motivos)
  }

  if (!auditoriaOk(auditoria.estado)) {
    motivos.push("La auditoria web no termino correctamente.")
    return componente("OPORTUNIDAD_TECNICA", MAX_OPORTUNIDAD, 0, motivos)
  }

  const scores = auditoria.scores
  const valores = [
    scoreNumerico(scores?.velocidad),
    scoreNumerico(scores?.ssl),
    scoreNumerico(scores?.seo),
    scoreNumerico(scores?.seguridad),
  ]

  // Faltar uno de los cuatro puntajes no se completa con 0: la oportunidad
  // queda en 0 y se explica el motivo (AC-21, datos faltantes no se inventan).
  if (valores.some((valor) => valor === null)) {
    motivos.push("La auditoria no tiene los cuatro puntajes completos.")
    return componente("OPORTUNIDAD_TECNICA", MAX_OPORTUNIDAD, 0, motivos)
  }

  const completos = valores as number[]
  const promedio =
    completos.reduce((total, valor) => total + valor, 0) / completos.length
  const puntos = limitar(
    Math.round(MAX_OPORTUNIDAD * (1 - promedio / 100)),
    MAX_OPORTUNIDAD,
  )

  motivos.push(
    puntos > 0
      ? "La auditoria detecta margen de mejora tecnica."
      : "La auditoria no detecta margen de mejora tecnica.",
  )

  return componente("OPORTUNIDAD_TECNICA", MAX_OPORTUNIDAD, puntos, motivos)
}

function evaluarEncaje(input: EntradaScore): ScoreComponente {
  const motivos: string[] = []
  const campana =
    input.campana && typeof input.campana === "object" ? input.campana : null

  const rubroCampana = normalizarComparable(campana?.rubro)
  const zonaCampana =
    normalizarComparable(campana?.zona) ??
    normalizarComparable(campana?.ciudad)
  const rubroProspecto = normalizarComparable(input.rubro)
  const ciudadProspecto = normalizarComparable(input.ciudad)

  let puntos = 0

  if (rubroCampana === null) {
    motivos.push("La campana no define rubro (sin criterio).")
  } else if (rubroProspecto === null) {
    motivos.push("Falta el rubro del prospecto.")
  } else if (rubroProspecto === rubroCampana) {
    puntos += 8
    motivos.push("El rubro coincide con la campana.")
  } else {
    motivos.push("El rubro no coincide con la campana.")
  }

  if (zonaCampana === null) {
    motivos.push("La campana no define zona (sin criterio).")
  } else if (ciudadProspecto === null) {
    motivos.push("Falta la ciudad del prospecto.")
  } else if (ciudadProspecto === zonaCampana) {
    puntos += 7
    motivos.push("La zona coincide con la campana.")
  } else {
    motivos.push("La zona no coincide con la campana.")
  }

  return componente("ENCAJE_CAMPANA", MAX_ENCAJE, puntos, motivos)
}

function evaluarCompletitud(input: EntradaScore): ScoreComponente {
  const motivos: string[] = []
  let puntos = 0

  if (sitioPropio(input.sitioWeb)) {
    puntos += 5
    motivos.push("El sitio web suma completitud.")
  } else {
    motivos.push("Falta el sitio web del prospecto.")
  }

  if (normalizarComparable(input.ciudad) !== null) {
    puntos += 5
    motivos.push("La ciudad suma completitud.")
  } else {
    motivos.push("Falta la ciudad del prospecto.")
  }

  if (telefonoValido(input.telefono)) {
    puntos += 5
    motivos.push("El telefono suma completitud.")
  } else {
    motivos.push("Falta el telefono del prospecto.")
  }

  return componente("COMPLETITUD", MAX_COMPLETITUD, puntos, motivos)
}

function componentesEnCero(motivo: string): ScoreComponente[] {
  return (
    [
      ["CONTACTO_PROFESIONAL", MAX_CONTACTO],
      ["SITIO_PROPIO", MAX_SITIO],
      ["OPORTUNIDAD_TECNICA", MAX_OPORTUNIDAD],
      ["ENCAJE_CAMPANA", MAX_ENCAJE],
      ["COMPLETITUD", MAX_COMPLETITUD],
    ] as const
  ).map(([clave, maximo]) =>
    componente(clave, maximo, 0, [motivo]),
  )
}

/**
 * Calcula el score v1. Nunca lanza: una entrada malformada devuelve un
 * resultado en cero con un motivo (fallar cerrado) y conserva la forma del
 * desglose para que la UI pueda explicarlo.
 */
export function calcularScore(
  input?: EntradaScore | null,
): ScoreResultado {
  try {
    const datos: EntradaScore =
      input && typeof input === "object" ? input : {}

    const componentes = [
      evaluarContacto(datos),
      evaluarSitio(datos),
      evaluarOportunidad(datos),
      evaluarEncaje(datos),
      evaluarCompletitud(datos),
    ]

    const total = limitar(
      componentes.reduce((suma, item) => suma + item.puntos, 0),
      100,
    )

    return { total, componentes, version: SCORE_VERSION }
  } catch {
    const motivo = "No se pudo calcular el score."
    return {
      total: 0,
      componentes: componentesEnCero(motivo),
      version: SCORE_VERSION,
    }
  }
}
