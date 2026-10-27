/**
 * T-33 (AC-21): guard de red de la suite.
 *
 * La suite **nunca** llama a PayPal de verdad (plan.md §6.1). Todo `fetch` a
 * `*.paypal.com` (API REST `api-m*.paypal.com`, `api.paypal.com`,
 * `api.sandbox.paypal.com`, `www.paypal.com`, etc.) debe estar mockeado con
 * `vi.stubGlobal("fetch", ...)`. Este guard envuelve solo el `fetch` global:
 * no intercepta otros clientes HTTP, SDKs ni llamadas directas a `undici`; los
 * tests deben seguir mockeando `fetch` aunque usen un wrapper. Si un test se
 * olvida, falla de inmediato con un mensaje accionable en vez de salir a la
 * red desde CI.
 *
 * La validacion de punta a punta contra el sandbox de PayPal **no** se corre en
 * la suite: se ejecuta fuera de CI, en el entorno Railway staging con Postgres
 * separado, siguiendo el checklist de plan.md §7.7 (`specs/001-paypal-pagos`).
 * Local/ngrok sirve solo para desarrollo y no reemplaza esa validacion.
 */

const DOMINIO_PAYPAL = "paypal.com"

/**
 * `true` para `paypal.com` y cualquier subdominio (`api.paypal.com`,
 * `api-m.sandbox.paypal.com`, `www.paypal.com`, ...). Se compara el sufijo
 * completo para no bloquear dominios parecidos (`paypal.com.evil.example`,
 * `notpaypal.com`, `paypal.test`).
 */
export function esHostPaypal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return host === DOMINIO_PAYPAL || host.endsWith(`.${DOMINIO_PAYPAL}`)
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

/** `true` si la entrada de `fetch` apunta a cualquier host de PayPal. */
export function esUrlPaypal(entrada: unknown): boolean {
  const url = urlDeEntrada(entrada)
  return url ? esHostPaypal(url.hostname) : false
}

/** Mensaje de fallo del guard: no incluye query string ni credenciales. */
export function mensajeRedPaypal(entrada: unknown): string {
  const url = urlDeEntrada(entrada)
  const destino = url ? `${url.origin}${url.pathname}` : String(entrada)

  return [
    `La suite intento llamar a PayPal por red: ${destino}.`,
    "No se permiten llamadas reales a *.paypal.com en los tests (plan.md §6.1).",
    'Mockea la llamada con vi.stubGlobal("fetch", ...) y vuelve a intentarlo.',
    "El guard solo envuelve fetch: si usas otro cliente HTTP, mockealo explicitamente.",
    "La validacion sandbox final se corre fuera de CI, en Railway staging con Postgres separado (plan.md §7.7).",
  ].join(" ")
}

type FetchConGuard = typeof fetch & { __pixelarchGuardPaypalRed?: true }

/**
 * Instala (una sola vez) el guard sobre `fetch`. Es idempotente: llamarlo de
 * nuevo no duplica el wrapper. `vi.stubGlobal("fetch", mock)` reemplaza el
 * guard durante el test y `vi.unstubAllGlobals()` restaura el wrapper.
 */
export function instalarGuardRedPaypal(): void {
  const actual = (globalThis as { fetch?: typeof fetch }).fetch

  if (typeof actual === "function" && (actual as FetchConGuard).__pixelarchGuardPaypalRed) {
    return
  }

  const guard = (async (
    entrada: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    if (esUrlPaypal(entrada)) {
      throw new Error(mensajeRedPaypal(entrada))
    }

    if (typeof actual !== "function") {
      throw new Error(
        "fetch no esta disponible en este entorno de tests; mockea fetch con vi.stubGlobal."
      )
    }

    return actual(entrada, init)
  }) as FetchConGuard

  guard.__pixelarchGuardPaypalRed = true
  ;(globalThis as { fetch?: typeof fetch }).fetch = guard
}
