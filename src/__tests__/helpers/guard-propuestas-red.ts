/**
 * T-23 (AC-41, AC-44; RF-59, RF-60, RF-61): guard de red de la suite para el
 * portal de propuestas.
 *
 * La suite **nunca** debe llamar de verdad a Google Places, Resend ni a un
 * proveedor LLM (plan.md §6.1, AC-44). Todo `fetch` a esos hosts debe estar
 * mockeado con `vi.stubGlobal("fetch", ...)`. Este guard solo envuelve el
 * `fetch` global; no intercepta SDKs ni clientes HTTP alternativos. Si un test
 * se olvida de mockear, falla de inmediato con un mensaje accionable en vez de
 * salir a la red.
 *
 * El guard es idempotente y convive con `guard-paypal-red.ts`: ambos envuelven
 * `fetch` y delegan en el wrapper anterior, por lo que el orden de instalacion
 * no cambia el resultado.
 */

const HOSTS_BLOQUEADOS = [
  "places.googleapis.com",
  "api.resend.com",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.mistral.ai",
  "api.cohere.ai",
] as const

function esHostDe(hostname: string, dominio: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return host === dominio || host.endsWith(`.${dominio}`)
}

/**
 * `true` para los hosts exactos y sus subdominios. Se compara el sufijo
 * completo para no bloquear dominios parecidos (`notopenai.com`,
 * `places.googleapis.com.evil.example`).
 */
export function esHostPropuestasBloqueado(hostname: string): boolean {
  return HOSTS_BLOQUEADOS.some((host) => esHostDe(hostname, host))
}

function urlDeEntrada(entrada: unknown): URL | null {
  if (typeof entrada === "string") {
    try {
      return new URL(entrada)
    } catch {
      return null
    }
  }

  if (typeof URL !== "undefined" && entrada instanceof URL) return entrada

  if (typeof entrada === "object" && entrada !== null && "url" in entrada) {
    const url = (entrada as { url?: unknown }).url
    if (typeof url === "string") {
      try {
        return new URL(url)
      } catch {
        return null
      }
    }
  }

  return null
}

/** `true` si la entrada de `fetch` apunta a un proveedor del portal. */
export function esUrlPropuestasBloqueada(entrada: unknown): boolean {
  const url = urlDeEntrada(entrada)
  return url ? esHostPropuestasBloqueado(url.hostname) : false
}

/**
 * Destino seguro para el mensaje: host + path, sin query string, hash ni
 * credenciales. Si la entrada no es una URL, se recorta antes de `?`/`#` y se
 * ocultan credenciales embebidas.
 */
function destinoSeguro(entrada: unknown): string {
  const url = urlDeEntrada(entrada)
  if (url) return `${url.origin}${url.pathname}`

  if (typeof entrada === "string") {
    const sinQuery = entrada.split("?")[0]?.split("#")[0] ?? ""
    return sinQuery.replace(/\/\/[^/@\s]+@/, "//[REDACTED]@")
  }

  if (typeof entrada === "object" && entrada !== null && "url" in entrada) {
    return "[Request]"
  }

  return String(entrada)
}

/** Mensaje de fallo del guard: host/path, sin query ni credenciales. */
export function mensajeRedPropuestas(entrada: unknown): string {
  const destino = destinoSeguro(entrada)

  return [
    `La suite intento llamar a un proveedor real del portal de propuestas: ${destino}.`,
    "No se permiten llamadas reales a Google Places, Resend ni LLM en los tests (plan.md §6.1, AC-44).",
    'Mockea la llamada con vi.stubGlobal("fetch", ...) y vuelve a intentarlo.',
    "El guard solo envuelve fetch: si usas otro cliente HTTP o un SDK, mockealo explicitamente.",
  ].join(" ")
}

type FetchConGuard = typeof fetch & {
  __pixelarchGuardRedPropuestas?: true
}

/**
 * Instala (una sola vez) el guard sobre `fetch`. Es idempotente: llamarlo de
 * nuevo no duplica el wrapper. `vi.stubGlobal("fetch", mock)` reemplaza el
 * guard durante el test y `vi.unstubAllGlobals()` restaura el wrapper.
 */
export function instalarGuardRedPropuestas(): void {
  const actual = (globalThis as { fetch?: typeof fetch }).fetch

  if (
    typeof actual === "function" &&
    (actual as FetchConGuard).__pixelarchGuardRedPropuestas
  ) {
    return
  }

  const guard = (async (
    entrada: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    if (esUrlPropuestasBloqueada(entrada)) {
      throw new Error(mensajeRedPropuestas(entrada))
    }

    if (typeof actual !== "function") {
      throw new Error(
        "fetch no esta disponible en este entorno de tests; mockea fetch con vi.stubGlobal.",
      )
    }

    return actual(entrada, init)
  }) as FetchConGuard

  guard.__pixelarchGuardRedPropuestas = true
  ;(globalThis as { fetch?: typeof fetch }).fetch = guard
}
