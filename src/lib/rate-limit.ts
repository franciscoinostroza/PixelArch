interface EntradaRateLimit {
  count: number
  resetAt: number
}

export interface ResultadoRateLimitDetalle {
  permitido: boolean
  restantes: number
  retryAfterSegundos: number
}

export interface EstadoRateLimit {
  excedido: boolean
  retryAfterSegundos: number
}

const store = new Map<string, EntradaRateLimit>()
const MAX_ENTRIES = 10_000

function segundosRestantes(resetAt: number, ahora: number): number {
  return Math.max(1, Math.ceil((resetAt - ahora) / 1000))
}

function limpiarExpirados(ahora: number): void {
  for (const [key, entry] of store) {
    if (ahora > entry.resetAt) store.delete(key)
  }
}

function asegurarEspacio(key: string, ahora: number): void {
  if (store.has(key) || store.size < MAX_ENTRIES) return

  limpiarExpirados(ahora)
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/**
 * Igual que `rateLimit`, pero devuelve los segundos restantes de la ventana
 * para construir un `Retry-After` real. Preserva la semantica historica de
 * `rateLimit`: la primera solicitud crea la ventana y se permiten `limit`.
 */
export function rateLimitDetalle(
  key: string,
  limit: number,
  windowMs: number
): ResultadoRateLimitDetalle {
  const ahora = Date.now()

  if (limit <= 0) {
    return { permitido: false, restantes: 0, retryAfterSegundos: 1 }
  }

  asegurarEspacio(key, ahora)
  const entry = store.get(key)

  if (!entry || ahora > entry.resetAt) {
    store.set(key, { count: 1, resetAt: ahora + windowMs })
    return { permitido: true, restantes: limit - 1, retryAfterSegundos: 0 }
  }

  if (entry.count >= limit) {
    return {
      permitido: false,
      restantes: 0,
      retryAfterSegundos: segundosRestantes(entry.resetAt, ahora),
    }
  }

  entry.count++
  return {
    permitido: true,
    restantes: limit - entry.count,
    retryAfterSegundos: 0,
  }
}

/**
 * Consulta una ventana sin incrementar el contador. Sirve para rechazar un
 * intento antes del trabajo costoso (por ejemplo, antes de validar una firma).
 */
export function rateLimitEstado(
  key: string,
  limit: number,
  windowMs: number
): EstadoRateLimit {
  const ahora = Date.now()
  const entry = store.get(key)

  if (!entry || ahora > entry.resetAt) {
    if (entry) store.delete(key)
    return { excedido: false, retryAfterSegundos: 0 }
  }

  if (entry.count >= limit) {
    const maximo = Math.max(1, Math.ceil(windowMs / 1000))
    return {
      excedido: true,
      retryAfterSegundos: Math.min(
        segundosRestantes(entry.resetAt, ahora),
        maximo
      ),
    }
  }

  return { excedido: false, retryAfterSegundos: 0 }
}

/** Borra una ventana (solo para limpiar fallos tras un exito o en tests). */
export function resetRateLimit(key: string): void {
  store.delete(key)
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  return rateLimitDetalle(key, limit, windowMs).permitido
}

setInterval(() => {
  limpiarExpirados(Date.now())
}, 60_000)
