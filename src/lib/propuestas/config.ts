/**
 * T-04 (AC-42; RF-8, RF-46, RF-63): configuracion server-only del portal.
 *
 * Reglas:
 * - Se lee `process.env` en cada llamada: no hay cache entre requests.
 * - Nunca lanza. Cada pieza que falta queda deshabilitada con un motivo
 *   legible; no se inventan credenciales ni textos legales.
 * - Los valores de secretos no aparecen en motivos, advertencias ni logs.
 * - No se declara ninguna variable `NEXT_PUBLIC_*` nueva. La unica variable
 *   publica que se lee es `NEXT_PUBLIC_URL`, ya existente, para validar la URL
 *   absoluta HTTPS que usan los enlaces de baja.
 */

export interface PiezaConfig {
  disponible: boolean
  motivo: string | null
}

export interface CuposPropuestas {
  /** 0 = bloqueado (config invalida): no se permite ninguna llamada. */
  enviosDia: number
  placesDia: number
  fetchesDia: number
  auditoriasDia: number
  borradoresDia: number
}

export interface LimitesPropuestas {
  maxEnviosProspecto: number
  paginasPorProspecto: number
  /** 0 = retencion deshabilitada por config invalida; nunca purgar todo. */
  retencionMeses: number
}

export interface CostosPropuestas {
  placesCentavos: number
  resendCentavos: number
  presupuestoMensualCentavos: number
}

export interface ConfigPropuestas {
  places: PiezaConfig & { apiKey: string | null }
  resend: PiezaConfig
  supresion: PiezaConfig
  baja: PiezaConfig
  llm: PiezaConfig & { habilitado: boolean }
  envioHabilitado: boolean
  fromEmail: string | null
  fromNombre: string
  replyTo: string | null
  secreto: string | null
  urlPublica: string | null
  textoLegal: string | null
  baseLegal: string | null
  etiquetaPublicidad: boolean
  cupos: CuposPropuestas
  limites: LimitesPropuestas
  costos: CostosPropuestas
  advertencias: string[]
}

export interface EstadoEnvio {
  ok: boolean
  motivos: string[]
}

const MIN_SECRETO = 32
const MAX_EMAIL = 254
const MAX_TEXTO_LEGAL = 20_000
const MAX_NOMBRE_REMITENTE = 120

const PATRON_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

function leerEnv(key: string): string | null {
  try {
    const raw = process.env[key]
    if (typeof raw !== "string") return null
    const value = raw.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

function leerBooleano(key: string, fallback: boolean): boolean {
  const raw = leerEnv(key)
  if (raw === null) return fallback

  const normalizado = raw.toLowerCase()
  if (normalizado === "true") return true
  if (normalizado === "false") return false

  return fallback
}

function leerEnteroPositivo(
  key: string,
  fallback: number,
  advertencias: string[],
): number {
  const raw = leerEnv(key)
  if (raw === null) return fallback

  if (!/^\d+$/.test(raw)) {
    advertencias.push(
      `${key} invalida: debe ser un entero positivo. La accion queda bloqueada.`,
    )
    return 0
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    advertencias.push(
      `${key} invalida: debe ser un entero positivo. La accion queda bloqueada.`,
    )
    return 0
  }

  return value
}

function leerEnteroNoNegativo(
  key: string,
  fallback: number,
  advertencias: string[],
): number {
  const raw = leerEnv(key)
  if (raw === null) return fallback

  if (!/^\d+$/.test(raw)) {
    advertencias.push(`${key} invalida: se usa 0 (sin estimacion).`)
    return 0
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    advertencias.push(`${key} invalida: se usa 0 (sin estimacion).`)
    return 0
  }

  return value
}

function leerEmail(key: string): string | null {
  const raw = leerEnv(key)
  if (raw === null || raw.length > MAX_EMAIL) return null
  if (/[\r\n]/.test(raw)) return null
  if (!PATRON_EMAIL.test(raw)) return null
  return raw
}

/**
 * Normaliza la URL publica a un origen HTTPS absoluto, sin credenciales,
 * query ni hash. Devuelve null si no es utilizable (fallar cerrado).
 */
export function normalizarUrlPublica(
  valor: string | null | undefined,
): string | null {
  if (typeof valor !== "string") return null
  const raw = valor.trim()
  if (raw.length === 0) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return null
    if (url.username || url.password || url.search || url.hash) return null
    // El portal vive en la raiz del dominio: un path inesperado se rechaza en
    // vez de descartarlo en silencio y construir enlaces en otra ruta.
    if (url.pathname !== "/" && url.pathname !== "") return null
    return url.origin
  } catch {
    return null
  }
}

function leerTextoLegal(key: string): string | null {
  const raw = leerEnv(key)
  if (raw === null || raw.length > MAX_TEXTO_LEGAL) return null
  return raw
}

function leerNombreRemitente(): string {
  const raw = leerEnv("PROPUESTAS_FROM_NOMBRE")
  const limpio = (raw ?? "PixelArch")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_NOMBRE_REMITENTE)

  return limpio.length > 0 ? limpio : "PixelArch"
}

function leerSecreto(): string | null {
  const raw = leerEnv("PROPUESTAS_SECRETO")
  if (raw === null || raw.length < MIN_SECRETO) return null
  return raw
}

function motivoBaja(secreto: string | null, urlPublica: string | null): string | null {
  const faltantes: string[] = []

  if (secreto === null) {
    faltantes.push("PROPUESTAS_SECRETO (minimo 32 caracteres)")
  }
  if (urlPublica === null) {
    faltantes.push("NEXT_PUBLIC_URL https absoluta")
  }

  if (faltantes.length === 0) return null
  return `Baja publica deshabilitada: falta ${faltantes.join(" y ")}.`
}

function configDeshabilitada(advertencia: string): ConfigPropuestas {
  return {
    places: {
      disponible: false,
      motivo: "Busqueda deshabilitada: no se pudo leer la configuracion.",
      apiKey: null,
    },
    resend: {
      disponible: false,
      motivo: "Envio deshabilitado: no se pudo leer la configuracion.",
    },
    supresion: {
      disponible: false,
      motivo: "Supresion deshabilitada: no se pudo leer la configuracion.",
    },
    baja: {
      disponible: false,
      motivo: "Baja publica deshabilitada: no se pudo leer la configuracion.",
    },
    llm: {
      habilitado: false,
      disponible: false,
      motivo: "LLM no disponible: v1 usa plantillas deterministas.",
    },
    envioHabilitado: false,
    fromEmail: null,
    fromNombre: "PixelArch",
    replyTo: null,
    secreto: null,
    urlPublica: null,
    textoLegal: null,
    baseLegal: null,
    etiquetaPublicidad: true,
    cupos: {
      enviosDia: 0,
      placesDia: 0,
      fetchesDia: 0,
      auditoriasDia: 0,
      borradoresDia: 0,
    },
    limites: {
      maxEnviosProspecto: 0,
      paginasPorProspecto: 0,
      retencionMeses: 0,
    },
    costos: {
      placesCentavos: 0,
      resendCentavos: 0,
      presupuestoMensualCentavos: 0,
    },
    advertencias: [advertencia],
  }
}

function construirConfig(): ConfigPropuestas {
  const advertencias: string[] = []

  const placesApiKey = leerEnv("PROPUESTAS_PLACES_API_KEY")
  const resendApiKey = leerEnv("RESEND_API_KEY")
  const secreto = leerSecreto()
  const urlPublica = normalizarUrlPublica(process.env.NEXT_PUBLIC_URL)

  const fromEmail = leerEmail("PROPUESTAS_FROM_EMAIL")
  const replyTo = leerEmail("PROPUESTAS_REPLY_TO")
  const textoLegal = leerTextoLegal("PROPUESTAS_TEXTO_LEGAL")
  const baseLegal = leerTextoLegal("PROPUESTAS_BASE_LEGAL")
  const llmHabilitado = leerBooleano("PROPUESTAS_LLM_HABILITADO", false)

  const motivoBajaPublica = motivoBaja(secreto, urlPublica)

  return {
    places: {
      disponible: placesApiKey !== null,
      motivo:
        placesApiKey === null
          ? "Busqueda deshabilitada: falta PROPUESTAS_PLACES_API_KEY."
          : null,
      apiKey: placesApiKey,
    },
    resend: {
      disponible: resendApiKey !== null,
      motivo:
        resendApiKey === null
          ? "Envio deshabilitado: falta RESEND_API_KEY."
          : null,
    },
    supresion: {
      disponible: secreto !== null,
      motivo:
        secreto === null
          ? "Supresion deshabilitada: falta PROPUESTAS_SECRETO (minimo 32 caracteres)."
          : null,
    },
    baja: {
      disponible: motivoBajaPublica === null,
      motivo: motivoBajaPublica,
    },
    llm: {
      habilitado: llmHabilitado,
      disponible: false,
      motivo: llmHabilitado
        ? "LLM reservado para una mejora posterior: v1 usa plantillas deterministas."
        : "LLM no habilitado: v1 usa plantillas deterministas.",
    },
    envioHabilitado: leerBooleano("PROPUESTAS_ENVIO_HABILITADO", false),
    fromEmail,
    fromNombre: leerNombreRemitente(),
    replyTo,
    secreto,
    urlPublica,
    textoLegal,
    baseLegal,
    etiquetaPublicidad: leerBooleano("PROPUESTAS_ETIQUETA_PUBLICIDAD", true),
    cupos: {
      enviosDia: leerEnteroPositivo(
        "PROPUESTAS_CUPO_ENVIOS_DIA",
        20,
        advertencias,
      ),
      placesDia: leerEnteroPositivo(
        "PROPUESTAS_CUPO_PLACES_DIA",
        20,
        advertencias,
      ),
      fetchesDia: leerEnteroPositivo(
        "PROPUESTAS_CUPO_FETCHES_DIA",
        100,
        advertencias,
      ),
      auditoriasDia: leerEnteroPositivo(
        "PROPUESTAS_CUPO_AUDITORIAS_DIA",
        20,
        advertencias,
      ),
      borradoresDia: leerEnteroPositivo(
        "PROPUESTAS_CUPO_BORRADORES_DIA",
        20,
        advertencias,
      ),
    },
    limites: {
      maxEnviosProspecto: leerEnteroPositivo(
        "PROPUESTAS_MAX_ENVIOS_PROSPECTO",
        2,
        advertencias,
      ),
      paginasPorProspecto: leerEnteroPositivo(
        "PROPUESTAS_PAGINAS_POR_PROSPECTO",
        3,
        advertencias,
      ),
      retencionMeses: leerEnteroPositivo(
        "PROPUESTAS_RETENCION_MESES",
        12,
        advertencias,
      ),
    },
    costos: {
      placesCentavos: leerEnteroNoNegativo(
        "PROPUESTAS_COSTO_PLACES_CENTAVOS",
        0,
        advertencias,
      ),
      resendCentavos: leerEnteroNoNegativo(
        "PROPUESTAS_COSTO_RESEND_CENTAVOS",
        0,
        advertencias,
      ),
      presupuestoMensualCentavos: leerEnteroNoNegativo(
        "PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS",
        0,
        advertencias,
      ),
    },
    advertencias,
  }
}

export function configPropuestas(): ConfigPropuestas {
  try {
    return construirConfig()
  } catch {
    return configDeshabilitada(
      "No se pudo leer la configuracion del portal; las piezas quedan deshabilitadas.",
    )
  }
}

/**
 * Gate de aprobacion/envio. Aprobar y enviar exigen exactamente lo que el plan
 * §4.2/§4.7 marca: gate explicito, remitente y reply-to validos, secreto,
 * URL publica HTTPS, texto legal y base legal. Sin todo eso, `motivos` explica
 * que falta y no se llama a ningun proveedor.
 */
export function estadoEnvio(
  cfg: ConfigPropuestas = configPropuestas(),
): EstadoEnvio {
  const motivos: string[] = []

  if (!cfg.envioHabilitado) {
    motivos.push(
      "PROPUESTAS_ENVIO_HABILITADO no esta en true; el envio esta deshabilitado.",
    )
  }
  if (!cfg.resend.disponible) {
    motivos.push("Falta RESEND_API_KEY; el envio esta deshabilitado.")
  }
  if (cfg.fromEmail === null) {
    motivos.push("Falta PROPUESTAS_FROM_EMAIL o no es un email valido.")
  }
  if (cfg.replyTo === null) {
    motivos.push("Falta PROPUESTAS_REPLY_TO o no es un email valido.")
  }
  if (cfg.secreto === null) {
    motivos.push(
      "Falta PROPUESTAS_SECRETO o tiene menos de 32 caracteres.",
    )
  }
  if (cfg.urlPublica === null) {
    motivos.push(
      "Falta NEXT_PUBLIC_URL o no es una URL https absoluta valida.",
    )
  }
  if (cfg.textoLegal === null) {
    motivos.push("Falta PROPUESTAS_TEXTO_LEGAL aprobado.")
  }
  if (cfg.baseLegal === null) {
    motivos.push("Falta PROPUESTAS_BASE_LEGAL aprobado.")
  }

  return { ok: motivos.length === 0, motivos }
}
