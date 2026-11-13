/**
 * T-07 (AC-24, AC-27, AC-31; RF-38, RF-42..45): estados, transiciones y
 * permisos de aprobacion/envio.
 *
 * Reglas del plan §4.2:
 * - Aprobar no envia: `puedeAprobar` solo valida que el snapshot sea enviable.
 * - Enviar exige una aprobacion vigente y hash del contenido sin cambios.
 * - Editar un envio APROBADO crea una version nueva e invalida la aprobacion.
 * - El maximo de mensajes se valida en el servidor; no hay cola ni scheduler.
 *
 * Este modulo es puro: no toca Prisma, red, entorno, emails ni proveedores.
 * La supresion se evalua con T-06 (`evaluarContactabilidad`) y aqui solo se
 * consume su resultado: no se reimplementan reglas de dominio ni de
 * proveedores publicos/multiinquilino.
 *
 * Fail-closed: una entrada ausente, incompleta o malformada devuelve `ok:false`
 * con motivos. Las funciones nunca lanzan y nunca incluyen PII ni secretos en
 * los motivos.
 */

import { normalizarEmail } from "./normalizar"
import type { ResultadoContactabilidad } from "./supresion"

export const ESTADOS_ENVIO = [
  "BORRADOR",
  "APROBADO",
  "ENVIANDO",
  "ENVIADO",
  "FALLIDO",
  "REBOTADO",
  "QUEJA",
  "RESPONDIDO",
  "CANCELADO",
] as const

export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number]

export const ESTADOS_PROSPECTO = [
  "NUEVO",
  "SIN_ENRIQUECER",
  "ENRIQUECIDO",
  "PUNTUADO",
  "BORRADOR",
  "APROBADO",
  "ENVIADO",
  "RESPONDIO",
  "DESCARTADO",
  "SUPRIMIDO",
] as const

export type EstadoProspecto = (typeof ESTADOS_PROSPECTO)[number]

export type ResultadoPermiso =
  | { ok: true }
  | { ok: false; motivos: string[] }

export interface ConfiguracionAprobacion {
  secreto?: boolean
  urlPublica?: boolean
  fromEmail?: boolean
  replyTo?: boolean
  textoLegal?: boolean
  baseLegal?: boolean
}

export interface ConfiguracionEnvio extends ConfiguracionAprobacion {
  envioHabilitado?: boolean
  resend?: boolean
}

export interface EntradaAprobacion {
  estadoEnvio?: string | null
  hashContenido?: string | null
  email?: string | null
  prospectoEstado?: string | null
  contactabilidad?: ResultadoContactabilidad | null
  plantilla?: {
    activa?: boolean | null
    version?: number | null
  } | null
  hayOtroEnvioPendiente?: boolean
  secuencia?: {
    numero?: number | null
    maximo?: number | null
  } | null
  config?: ConfiguracionAprobacion | null
}

export interface EntradaEnvio {
  estadoEnvio?: string | null
  aprobadoHash?: string | null
  snapshotHash?: string | null
  hashContenido?: string | null
  hashContenidoActual?: string | null
  destinatario?: string | null
  email?: string | null
  contactabilidad?: ResultadoContactabilidad | null
  cupo?: {
    permitido?: boolean
    restantes?: number | null
  } | null
  config?: ConfiguracionEnvio | null
}

export interface ResultadoEdicionEnvio {
  permitido: boolean
  crearVersion: boolean
  invalidarAprobacion: boolean
  motivos: string[]
}

export interface EntradaNuevoMensaje {
  secuencias?: readonly (number | null | undefined)[] | null
  maximo?: number | null
}

export type ResultadoNuevoMensaje =
  | { ok: true; secuencia: number }
  | { ok: false; secuencia: number; motivos: string[] }

const TRANSICIONES_ENVIO: Record<EstadoEnvio, readonly EstadoEnvio[]> = {
  BORRADOR: ["APROBADO", "CANCELADO"],
  APROBADO: ["ENVIANDO", "CANCELADO"],
  ENVIANDO: ["ENVIADO", "FALLIDO"],
  ENVIADO: ["REBOTADO", "QUEJA", "RESPONDIDO"],
  FALLIDO: [],
  REBOTADO: [],
  QUEJA: [],
  RESPONDIDO: [],
  CANCELADO: [],
}

/**
 * Transiciones del prospecto segun el plan §4.2. `DESCARTADO` y `SUPRIMIDO`
 * son terminales: revocar una supresion es una excepcion administrativa, no
 * una transicion normal.
 */
const TRANSICIONES_PROSPECTO: Record<
  EstadoProspecto,
  readonly EstadoProspecto[]
> = {
  NUEVO: ["SIN_ENRIQUECER", "ENRIQUECIDO", "DESCARTADO", "SUPRIMIDO"],
  SIN_ENRIQUECER: ["PUNTUADO", "DESCARTADO", "SUPRIMIDO"],
  ENRIQUECIDO: ["PUNTUADO", "DESCARTADO", "SUPRIMIDO"],
  PUNTUADO: ["BORRADOR", "DESCARTADO", "SUPRIMIDO"],
  BORRADOR: ["APROBADO", "DESCARTADO", "SUPRIMIDO"],
  APROBADO: ["ENVIADO", "DESCARTADO", "SUPRIMIDO"],
  // ENVIADO -> BORRADOR habilita el follow-up manual, no automatico: cada
  // mensaje nuevo exige su propio borrador y aprobacion; el maximo de mensajes
  // y la nueva aprobacion se validan en T-07/T-16/T-18.
  ENVIADO: ["BORRADOR", "RESPONDIO", "DESCARTADO", "SUPRIMIDO"],
  RESPONDIO: ["DESCARTADO", "SUPRIMIDO"],
  DESCARTADO: [],
  SUPRIMIDO: [],
}

function normalizarEstado<T extends string>(
  estados: readonly T[],
  valor: unknown,
): T | null {
  if (typeof valor !== "string") return null

  const limpio = valor.trim().toUpperCase()
  return (estados as readonly string[]).includes(limpio)
    ? (limpio as T)
    : null
}

export function normalizarEstadoEnvio(
  valor: unknown,
): EstadoEnvio | null {
  return normalizarEstado(ESTADOS_ENVIO, valor)
}

export function normalizarEstadoProspecto(
  valor: unknown,
): EstadoProspecto | null {
  return normalizarEstado(ESTADOS_PROSPECTO, valor)
}

/** `true` solo para `true` booleano: un string o un valor ausente falla cerrado. */
function esTrue(valor: unknown): boolean {
  return valor === true
}

function textoNoVacio(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function enteroPositivo(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor)) return null
  return valor >= 1 ? valor : null
}

function motivosContactabilidad(
  resultado: ResultadoContactabilidad | null | undefined,
): string[] {
  if (!resultado || typeof resultado !== "object") {
    return ["No se pudo verificar la contactabilidad del prospecto."]
  }

  if (resultado.contactable === true) return []

  switch (resultado.motivo) {
    case "SIN_EMAIL":
      return ["El prospecto no tiene un email de contacto."]
    case "SUPRIMIDO_EMAIL":
      return ["El email del prospecto esta suprimido."]
    case "SUPRIMIDO_DOMINIO":
      return ["El dominio del prospecto esta suprimido."]
    default:
      return ["El contacto no es contactable."]
  }
}

function motivosConfiguracionAprobacion(
  config: ConfiguracionAprobacion | null | undefined,
): string[] {
  const motivos: string[] = []

  if (!esTrue(config?.secreto)) {
    motivos.push("Falta PROPUESTAS_SECRETO o no es valido.")
  }
  if (!esTrue(config?.urlPublica)) {
    motivos.push("Falta NEXT_PUBLIC_URL https absoluta.")
  }
  if (!esTrue(config?.fromEmail)) {
    motivos.push("Falta PROPUESTAS_FROM_EMAIL o no es valido.")
  }
  if (!esTrue(config?.replyTo)) {
    motivos.push("Falta PROPUESTAS_REPLY_TO o no es valido.")
  }
  if (!esTrue(config?.textoLegal)) {
    motivos.push("Falta PROPUESTAS_TEXTO_LEGAL aprobado.")
  }
  if (!esTrue(config?.baseLegal)) {
    motivos.push("Falta PROPUESTAS_BASE_LEGAL aprobado.")
  }

  return motivos
}

function motivosConfiguracionEnvio(
  config: ConfiguracionEnvio | null | undefined,
): string[] {
  const motivos = motivosConfiguracionAprobacion(config)

  if (!esTrue(config?.envioHabilitado)) {
    motivos.push(
      "PROPUESTAS_ENVIO_HABILITADO no esta en true; el envio esta deshabilitado.",
    )
  }
  if (!esTrue(config?.resend)) {
    motivos.push("Falta RESEND_API_KEY; el envio esta deshabilitado.")
  }

  return motivos
}

function motivosSecuencia(
  secuencia: EntradaAprobacion["secuencia"],
): string[] {
  const maximo = enteroPositivo(secuencia?.maximo)
  if (maximo === null) {
    return ["El maximo de mensajes no esta configurado o es invalido."]
  }

  const numero = enteroPositivo(secuencia?.numero)
  if (numero === null) {
    return ["La secuencia del envio no es valida."]
  }

  if (numero > maximo) {
    return ["La secuencia supera el maximo de mensajes permitido."]
  }

  return []
}

/**
 * Guard de aprobacion (plan §4.2). Exige:
 * - estado BORRADOR y hash del borrador;
 * - email valido y contactable (T-06);
 * - prospecto no suprimido/descartado;
 * - plantilla activa con version;
 * - ningun otro envio APROBADO/ENVIANDO para la misma secuencia;
 * - secuencia dentro del maximo;
 * - secreto, URL publica, from/reply-to, texto y base legal configurados.
 *
 * No exige `PROPUESTAS_ENVIO_HABILITADO` ni la clave de Resend: aprobar no
 * envia. Esa revalidacion corresponde a `puedeEnviar`.
 */
export function puedeAprobar(
  input?: EntradaAprobacion | null,
): ResultadoPermiso {
  try {
    const datos: EntradaAprobacion =
      input && typeof input === "object" ? input : {}
    const motivos: string[] = []

    if (normalizarEstadoEnvio(datos.estadoEnvio) !== "BORRADOR") {
      motivos.push("El envio no esta en estado BORRADOR.")
    }

    if (textoNoVacio(datos.hashContenido) === null) {
      motivos.push("Falta el hash del borrador.")
    }

    const email = normalizarEmail(
      typeof datos.email === "string" ? datos.email : "",
    )
    if (email === null) {
      motivos.push("El prospecto no tiene un email de contacto valido.")
    } else {
      motivos.push(...motivosContactabilidad(datos.contactabilidad))
    }

    const estadoProspecto = normalizarEstadoProspecto(datos.prospectoEstado)
    if (estadoProspecto === null) {
      motivos.push("No se pudo verificar el estado del prospecto.")
    } else if (estadoProspecto === "SUPRIMIDO") {
      motivos.push("El prospecto esta suprimido.")
    } else if (estadoProspecto === "DESCARTADO") {
      motivos.push("El prospecto esta descartado.")
    }

    const plantilla = datos.plantilla
    const versionPlantilla = plantilla?.version
    if (
      !plantilla ||
      plantilla.activa !== true ||
      typeof versionPlantilla !== "number" ||
      !Number.isSafeInteger(versionPlantilla) ||
      versionPlantilla < 1
    ) {
      motivos.push("La plantilla no esta activa o no tiene version valida.")
    }

    if (datos.hayOtroEnvioPendiente === true) {
      motivos.push(
        "Ya existe un envio aprobado o en envio para esa secuencia.",
      )
    } else if (datos.hayOtroEnvioPendiente !== false) {
      motivos.push(
        "No se pudo verificar que no haya otro envio pendiente para la misma secuencia.",
      )
    }

    motivos.push(...motivosSecuencia(datos.secuencia))
    motivos.push(...motivosConfiguracionAprobacion(datos.config))

    return motivos.length === 0 ? { ok: true } : { ok: false, motivos }
  } catch {
    return { ok: false, motivos: ["No se pudo evaluar la aprobacion."] }
  }
}

/**
 * Guard de envio (plan §4.2). Exige:
 * - estado APROBADO y snapshot aprobado vigente;
 * - hash del borrador sin cambios desde la aprobacion;
 * - destinatario igual al email del prospecto, contactable;
 * - cupo diario disponible (sin cola);
 * - configuracion completa de envio: gate, Resend, secreto, URL, from,
 *   reply-to, texto legal y base legal.
 *
 * No llama a Resend; solo decide si la ruta puede hacerlo.
 */
export function puedeEnviar(input?: EntradaEnvio | null): ResultadoPermiso {
  try {
    const datos: EntradaEnvio =
      input && typeof input === "object" ? input : {}
    const motivos: string[] = []

    if (normalizarEstadoEnvio(datos.estadoEnvio) !== "APROBADO") {
      motivos.push("El envio no esta en estado APROBADO.")
    }

    const aprobadoHash = textoNoVacio(datos.aprobadoHash)
    const snapshotHash = textoNoVacio(datos.snapshotHash)
    if (aprobadoHash === null || snapshotHash === null) {
      motivos.push("Falta el hash del snapshot aprobado.")
    } else if (aprobadoHash !== snapshotHash) {
      motivos.push(
        "El snapshot aprobado no coincide con el contenido final.",
      )
    }

    const hashContenido = textoNoVacio(datos.hashContenido)
    const hashContenidoActual = textoNoVacio(datos.hashContenidoActual)
    if (hashContenido === null || hashContenidoActual === null) {
      motivos.push("Falta el hash del borrador.")
    } else if (hashContenido !== hashContenidoActual) {
      motivos.push("El contenido del borrador cambio desde la aprobacion.")
    }

    const email = normalizarEmail(
      typeof datos.email === "string" ? datos.email : "",
    )
    const destinatario = normalizarEmail(
      typeof datos.destinatario === "string" ? datos.destinatario : "",
    )

    if (email === null) {
      motivos.push("El prospecto no tiene un email de contacto valido.")
    } else if (destinatario === null || destinatario !== email) {
      motivos.push("El destinatario no coincide con el email del prospecto.")
    } else {
      motivos.push(...motivosContactabilidad(datos.contactabilidad))
    }

    if (!datos.cupo || typeof datos.cupo !== "object") {
      motivos.push("No se pudo verificar el cupo diario de envios.")
    } else if (datos.cupo.permitido !== true) {
      motivos.push("Se alcanzo el cupo diario de envios.")
    }

    motivos.push(...motivosConfiguracionEnvio(datos.config))

    return motivos.length === 0 ? { ok: true } : { ok: false, motivos }
  } catch {
    return { ok: false, motivos: ["No se pudo evaluar el envio."] }
  }
}

/**
 * Decide como tratar una edicion (AC-24 / RF-38):
 * - BORRADOR: se edita en sitio, sin version nueva.
 * - APROBADO: se crea version nueva y la aprobacion anterior queda invalidada;
 *   no se puede enviar hasta aprobar de nuevo.
 * - Cualquier otro estado: no editable.
 */
export function evaluarEdicionEnvio(
  estado: string | null | undefined,
): ResultadoEdicionEnvio {
  const normalizado = normalizarEstadoEnvio(estado)

  if (normalizado === "BORRADOR") {
    return {
      permitido: true,
      crearVersion: false,
      invalidarAprobacion: false,
      motivos: [],
    }
  }

  if (normalizado === "APROBADO") {
    return {
      permitido: true,
      crearVersion: true,
      invalidarAprobacion: true,
      motivos: [],
    }
  }

  return {
    permitido: false,
    crearVersion: false,
    invalidarAprobacion: false,
    motivos: ["El envio no se puede editar en su estado actual."],
  }
}

/**
 * Siguiente numero de secuencia manual para un prospecto. Ignora valores
 * invalidos y huecos: usa el maximo valido + 1. No programa nada.
 */
export function siguienteSecuencia(
  secuencias: readonly (number | null | undefined)[] | null | undefined,
): number {
  if (!Array.isArray(secuencias)) return 1

  let maximo = 0
  for (const valor of secuencias) {
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

/**
 * Valida que un mensaje nuevo (inicial o follow-up manual) respete el maximo
 * configurado. Cada mensaje exige su propio borrador y aprobacion; no hay
 * automatismo, cola ni envio por lote.
 */
export function evaluarNuevoMensaje(
  input?: EntradaNuevoMensaje | null,
): ResultadoNuevoMensaje {
  try {
    const datos: EntradaNuevoMensaje =
      input && typeof input === "object" ? input : {}
    const secuencia = siguienteSecuencia(datos.secuencias)
    const maximo = enteroPositivo(datos.maximo)

    if (maximo === null) {
      return {
        ok: false,
        secuencia,
        motivos: ["El maximo de mensajes no esta configurado o es invalido."],
      }
    }

    if (secuencia > maximo) {
      return {
        ok: false,
        secuencia,
        motivos: [
          `Se alcanzo el maximo de ${maximo} mensajes para el prospecto.`,
        ],
      }
    }

    return { ok: true, secuencia }
  } catch {
    return {
      ok: false,
      secuencia: 1,
      motivos: ["No se pudo evaluar la secuencia del mensaje."],
    }
  }
}

/** Consulta pura del mapa de transiciones de envio; estados invalidos fallan. */
export function transicionEnvioPermitida(
  desde: string | null | undefined,
  hacia: string | null | undefined,
): boolean {
  const origen = normalizarEstadoEnvio(desde)
  const destino = normalizarEstadoEnvio(hacia)
  if (origen === null || destino === null) return false

  return TRANSICIONES_ENVIO[origen].includes(destino)
}

/** Consulta pura del mapa de transiciones del prospecto. */
export function transicionProspectoPermitida(
  desde: string | null | undefined,
  hacia: string | null | undefined,
): boolean {
  const origen = normalizarEstadoProspecto(desde)
  const destino = normalizarEstadoProspecto(hacia)
  if (origen === null || destino === null) return false

  return TRANSICIONES_PROSPECTO[origen].includes(destino)
}
