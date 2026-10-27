/**
 * Redaccion de PII y secretos para logs y Sentry (plan.md §5.4, AC-19).
 *
 * El redactor es puro y recursivo: no muta la entrada, preserva la estructura
 * de objetos/arrays y tolera ciclos, fechas, mapas, sets, errores y valores
 * primitivos raros. Las claves sensibles se reemplazan por `[REDACTED]` y en
 * los strings se redactan credenciales (`Bearer`/`Basic`), parametros de query
 * o asignaciones (`token=...`, `email: ...`, `nombre=Ana Perez`), emails y el
 * token del link publico de pago. En una asignacion sin comillas se redacta el
 * valor completo (hasta `)`, `]`, `}`, `,`, `;`, `&` o fin de linea), no solo
 * la primera palabra.
 */

export const REDACTED = "[REDACTED]"

/**
 * Claves que nunca deben llegar a logs, analitica ni Sentry. Se comparan
 * normalizadas (minusculas, sin separadores) para cubrir `email_address`,
 * `emailAddress`, `PayerID`, `access-token`, etc. sin tocar claves parecidas
 * pero no sensibles (`username`, `brand_name`, `status`).
 */
const CLAVES_SENSIBLES = new Set([
  "email",
  "emailaddress",
  "payeremail",
  "pagadoremail",
  "correo",
  "correoelectronico",
  "nombre",
  "name",
  "fullname",
  "givenname",
  "surname",
  "familyname",
  "firstname",
  "lastname",
  "apellido",
  "payername",
  "pagadornombre",
  "address",
  "addressline1",
  "addressline2",
  "adminarea1",
  "adminarea2",
  "postalcode",
  "phone",
  "phonenumber",
  "telefono",
  "numerotelefono",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "clientsecret",
  "secret",
  "password",
  "apikey",
  "xapikey",
  "cookie",
  "setcookie",
  "enlace",
  "payerid",
])

const ALTERNATIVAS_CLAVES = [
  "email_address",
  "emailAddress",
  "address_line_1",
  "address_line_2",
  "addressLine1",
  "addressLine2",
  "admin_area_1",
  "admin_area_2",
  "adminArea1",
  "adminArea2",
  "postal_code",
  "postalCode",
  "payer_email",
  "pagador_email",
  "payerEmail",
  "pagadorEmail",
  "given_name",
  "givenName",
  "full_name",
  "fullName",
  "family_name",
  "familyName",
  "first_name",
  "firstName",
  "last_name",
  "lastName",
  "payer_name",
  "payerName",
  "pagador_nombre",
  "pagadorNombre",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "id_token",
  "idToken",
  "client_secret",
  "clientSecret",
  "authorization",
  "surname",
  "address",
  "nombre",
  "email",
  "phone_number",
  "phoneNumber",
  "telefono",
  "numero_telefono",
  "numeroTelefono",
  "phone",
  "set_cookie",
  "setCookie",
  "set-cookie",
  "cookie",
  "x_api_key",
  "xApiKey",
  "x-api-key",
  "token",
  "enlace",
  "PayerID",
  "payer_id",
  "payerId",
  "name",
  "secret",
  "password",
  "api_key",
  "apiKey",
  "apikey",
].join("|")

// Solo se redactan valores con pinta de credencial (>= 6 caracteres) para no
// borrar texto util como "Basic plan".
const PATRON_AUTORIZACION = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi

// Valores entre comillas precedidos por una clave sensible, incluso si el
// string completo es un JSON serializado.
const PATRON_CLAVE_CITADA = new RegExp(
  `(["'])(${ALTERNATIVAS_CLAVES})\\1(\\s*:\\s*)(["'])(?:\\\\.|(?!\\4)[\\s\\S])*\\4`,
  "gi"
)

// Parametros de query string (?email=...&token=...).
const PATRON_QUERY = new RegExp(`([?&])(${ALTERNATIVAS_CLAVES})=([^&#\\s]*)`, "gi")

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Asignaciones en texto libre (token=..., email: ..., Authorization=...).
// Un valor sin comillas se consume completo hasta `)`, `]`, `}`, `,`, `;`,
// `&` o fin de linea. Si solo se consumiera la primera palabra,
// `nombre=Ana Perez` dejaria `Perez` visible en los logs.
const PATRON_ASIGNACION = new RegExp(
  `\\b(${ALTERNATIVAS_CLAVES})\\b(\\s*[:=]\\s*)(?!${escaparRegex(REDACTED)})("[^"]*"|'[^']*'|[^)\\]}\\r\\n,;&]+)`,
  "gi"
)

// Token opaco del link publico de pago: nunca se loguea la URL completa. Se
// preservan las rutas fijas (retorno, cancelado, estado) que no llevan token.
const PATRON_ENLACE_PAGO =
  /(\/pago\/paypal\/)(?!(?:retorno|cancelado|estado)(?:[/?#]|$))[A-Za-z0-9_-]{6,}/gi

const PATRON_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Indica si una clave (en cualquier casing/separadores) es sensible. */
export function esClaveSensible(clave: string): boolean {
  return CLAVES_SENSIBLES.has(normalizarClave(clave))
}

/**
 * Si el string es un JSON serializado de objeto/array, lo parsea y redacta
 * recursivamente (incluidos valores anidados como `{"name":{"first":"Ana"}}`).
 * Devuelve `null` cuando no es JSON para que el caller aplique los patrones
 * de texto libre.
 */
function redactarJsonSerializado(valor: string): string | null {
  const texto = valor.trim()
  if (!texto.startsWith("{") && !texto.startsWith("[")) return null

  let parseado: unknown
  try {
    parseado = JSON.parse(texto)
  } catch {
    return null
  }

  if (typeof parseado !== "object" || parseado === null) return null
  return JSON.stringify(redactar(parseado, new WeakMap()))
}

function redactarString(valor: string): string {
  const base = redactarJsonSerializado(valor) ?? valor
  return base
    .replace(PATRON_AUTORIZACION, (_coincidencia, esquema: string) => `${esquema} ${REDACTED}`)
    .replace(
      PATRON_CLAVE_CITADA,
      (
        _coincidencia,
        comilla: string,
        clave: string,
        separador: string,
        comillaValor: string
      ) => `${comilla}${clave}${comilla}${separador}${comillaValor}${REDACTED}${comillaValor}`
    )
    .replace(
      PATRON_QUERY,
      (_coincidencia, separador: string, clave: string) => `${separador}${clave}=${REDACTED}`
    )
    .replace(
      PATRON_ASIGNACION,
      (_coincidencia, clave: string, separador: string) => `${clave}${separador}${REDACTED}`
    )
    .replace(PATRON_ENLACE_PAGO, (_coincidencia, prefijo: string) => `${prefijo}${REDACTED}`)
    .replace(PATRON_EMAIL, REDACTED)
}

function esObjetoSimple(valor: object): boolean {
  const prototipo = Object.getPrototypeOf(valor)
  return prototipo === Object.prototype || prototipo === null
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function copiarPropiedades(
  origen: Record<string, unknown>,
  destino: Record<string, unknown>,
  vistos: WeakMap<object, unknown>,
  omitir: Set<string>
): void {
  for (const clave of Object.keys(origen)) {
    if (omitir.has(clave)) continue
    if (esClaveSensible(clave)) {
      destino[clave] = REDACTED
      continue
    }
    try {
      destino[clave] = redactar(origen[clave], vistos)
    } catch {
      // Getters/proxies que fallan al leerse: se preserva la clave sin valor.
      destino[clave] = REDACTED
    }
  }
}

function redactarHeaders(valor: Headers): Record<string, unknown> {
  const copia: Record<string, unknown> = {}
  valor.forEach((contenido, clave) => {
    copia[clave] = esClaveSensible(clave) ? REDACTED : redactarString(contenido)
  })
  return copia
}

function redactar(valor: unknown, vistos: WeakMap<object, unknown>): unknown {
  if (typeof valor === "string") return redactarString(valor)
  if (valor === null || typeof valor !== "object") return valor

  const previo = vistos.get(valor)
  if (previo !== undefined) return previo

  if (Array.isArray(valor)) {
    const copia: unknown[] = new Array(valor.length)
    vistos.set(valor, copia)
    for (let i = 0; i < valor.length; i++) {
      if (i in valor) copia[i] = redactar(valor[i], vistos)
    }
    return copia
  }

  if (valor instanceof Date) return new Date(valor.getTime())

  if (valor instanceof Error) {
    const copia: Record<string, unknown> = {}
    vistos.set(valor, copia)
    copia.name = redactarString(valor.name)
    copia.message = redactarString(valor.message)
    if (typeof valor.stack === "string") copia.stack = redactarString(valor.stack)
    copiarPropiedades(
      valor as unknown as Record<string, unknown>,
      copia,
      vistos,
      new Set(["name", "message", "stack"])
    )
    return copia
  }

  if (valor instanceof Map) {
    const copia = new Map<unknown, unknown>()
    vistos.set(valor, copia)
    for (const [clave, contenido] of valor) {
      if (typeof clave === "string") {
        const claveRedactada = redactarString(clave)
        copia.set(
          claveRedactada,
          esClaveSensible(clave) ? REDACTED : redactar(contenido, vistos)
        )
      } else {
        copia.set(redactar(clave, vistos), redactar(contenido, vistos))
      }
    }
    return copia
  }

  if (valor instanceof Set) {
    const copia = new Set<unknown>()
    vistos.set(valor, copia)
    for (const contenido of valor) {
      copia.add(redactar(contenido, vistos))
    }
    return copia
  }

  // URL, URLSearchParams y Headers se serializan redactados: devolverlos
  // intactos filtraria query strings, credenciales o headers sensibles.
  if (typeof URL !== "undefined" && valor instanceof URL) {
    return redactarString(valor.toString())
  }

  if (typeof URLSearchParams !== "undefined" && valor instanceof URLSearchParams) {
    return redactarString(valor.toString())
  }

  if (typeof Headers !== "undefined" && valor instanceof Headers) {
    return redactarHeaders(valor)
  }

  // Clases, promesas, typed arrays y otros objetos con comportamiento propio:
  // se preservan tal cual para no romper su semantica.
  if (!esRegistro(valor) || !esObjetoSimple(valor)) return valor

  const copia: Record<string, unknown> = {}
  vistos.set(valor, copia)
  copiarPropiedades(valor, copia, vistos, new Set())
  return copia
}

/**
 * Devuelve una copia redactada de `valor`. La entrada no se muta.
 * El tipo de retorno conserva la forma para comodidad del caller (Sentry),
 * aunque los valores sensibles pasan a ser strings `[REDACTED]`.
 */
export function redactSensitiveData<T>(valor: T): T {
  return redactar(valor, new WeakMap()) as T
}

/** Redacta un unico string (util para mensajes de error y URLs). */
export function redactSensitiveString(valor: string): string {
  return redactarString(valor)
}

const CAMPOS_EVENTO_SENTRY = [
  "extra",
  "contexts",
  "breadcrumbs",
  "request",
  "user",
  "tags",
  "exception",
  "logentry",
  "message",
  "transaction",
  "sdkProcessingMetadata",
] as const

type CampoEventoSentry = (typeof CAMPOS_EVENTO_SENTRY)[number]

/**
 * Redactor compartido por `beforeSend` de Sentry (server y edge). Cubre los
 * campos donde el SDK puede adjuntar PII o secretos: extras, contextos,
 * breadcrumbs, request, user, tags, exception, logentry, message, transaction
 * y `sdkProcessingMetadata`.
 */
export function redactSentryEvent<T extends Partial<Record<CampoEventoSentry, unknown>>>(
  evento: T
): T {
  const mutable: Partial<Record<CampoEventoSentry, unknown>> = evento
  for (const campo of CAMPOS_EVENTO_SENTRY) {
    const contenido = mutable[campo]
    if (contenido === undefined) continue
    mutable[campo] = redactSensitiveData(contenido)
  }
  return evento
}
