/**
 * Limite en memoria del webhook PayPal (H-7).
 *
 * Dos capas por origen (IP normalizada por la ruta):
 * - solicitudes: ventana fija de 1 minuto;
 * - fallos de autenticidad: ventana de 10 minutos que se limpia con un evento
 *   verificado.
 *
 * El limitador es best-effort: vive en el proceso, no es distribuido y se
 * reinicia con el deploy. No persiste la IP ni la loguea. El mapa de claves
 * esta acotado para que un tercero no pueda hacer crecer la memoria sin tope.
 */

export const WEBHOOK_SOLICITUDES_MAX = 300
export const WEBHOOK_SOLICITUDES_VENTANA_MS = 60_000
export const WEBHOOK_FALLOS_MAX = 20
export const WEBHOOK_FALLOS_VENTANA_MS = 10 * 60_000
export const WEBHOOK_CUERPO_MAX_BYTES = 256 * 1024
export const WEBHOOK_MAX_CLAVES = 10_000

export type ResultadoLimiteWebhook =
  | { permitido: true }
  | {
      permitido: false
      motivo: "SOLICITUDES" | "FALLOS"
      retryAfterSegundos: number
    }

export interface LimitadorWebhook {
  permitir(clave: string): ResultadoLimiteWebhook
  registrarFallo(clave: string): void
  registrarExito(clave: string): void
}

interface EntradaLimite {
  count: number
  resetAt: number
}

interface OpcionesLimitador {
  ahora?: () => number
  solicitudesMax?: number
  solicitudesVentanaMs?: number
  fallosMax?: number
  fallosVentanaMs?: number
  maxClaves?: number
}

function segundosRestantes(
  resetAt: number,
  ahora: number,
  ventanaMs: number
): number {
  const maximo = Math.max(1, Math.ceil(ventanaMs / 1000))
  const restantes = Math.ceil((resetAt - ahora) / 1000)
  return Math.min(Math.max(restantes, 1), maximo)
}

function limpiarExpirados(mapa: Map<string, EntradaLimite>, ahora: number): void {
  for (const [clave, entrada] of mapa) {
    if (ahora > entrada.resetAt) mapa.delete(clave)
  }
}

function acotarMapa(
  mapa: Map<string, EntradaLimite>,
  clave: string,
  ahora: number,
  maxClaves: number
): void {
  if (mapa.has(clave) || mapa.size < maxClaves) return

  limpiarExpirados(mapa, ahora)
  while (mapa.size >= maxClaves) {
    const masAntigua = mapa.keys().next().value
    if (masAntigua === undefined) break
    mapa.delete(masAntigua)
  }
}

export function crearLimitadorWebhook(
  opciones: OpcionesLimitador = {}
): LimitadorWebhook {
  const ahora = opciones.ahora ?? Date.now
  const solicitudesMax = opciones.solicitudesMax ?? WEBHOOK_SOLICITUDES_MAX
  const solicitudesVentanaMs =
    opciones.solicitudesVentanaMs ?? WEBHOOK_SOLICITUDES_VENTANA_MS
  const fallosMax = opciones.fallosMax ?? WEBHOOK_FALLOS_MAX
  const fallosVentanaMs = opciones.fallosVentanaMs ?? WEBHOOK_FALLOS_VENTANA_MS
  const maxClaves = opciones.maxClaves ?? WEBHOOK_MAX_CLAVES

  const solicitudes = new Map<string, EntradaLimite>()
  const fallos = new Map<string, EntradaLimite>()

  return {
    permitir(clave) {
      const ahoraMs = ahora()

      const fallo = fallos.get(clave)
      if (fallo && ahoraMs <= fallo.resetAt) {
        if (fallo.count >= fallosMax) {
          return {
            permitido: false,
            motivo: "FALLOS",
            retryAfterSegundos: segundosRestantes(
              fallo.resetAt,
              ahoraMs,
              fallosVentanaMs
            ),
          }
        }
      } else if (fallo) {
        fallos.delete(clave)
      }

      const solicitud = solicitudes.get(clave)
      if (!solicitud || ahoraMs > solicitud.resetAt) {
        acotarMapa(solicitudes, clave, ahoraMs, maxClaves)
        solicitudes.set(clave, {
          count: 1,
          resetAt: ahoraMs + solicitudesVentanaMs,
        })
        return { permitido: true }
      }

      if (solicitud.count >= solicitudesMax) {
        return {
          permitido: false,
          motivo: "SOLICITUDES",
          retryAfterSegundos: segundosRestantes(
            solicitud.resetAt,
            ahoraMs,
            solicitudesVentanaMs
          ),
        }
      }

      solicitud.count++
      return { permitido: true }
    },

    registrarFallo(clave) {
      const ahoraMs = ahora()
      const entrada = fallos.get(clave)

      if (!entrada || ahoraMs > entrada.resetAt) {
        acotarMapa(fallos, clave, ahoraMs, maxClaves)
        fallos.set(clave, {
          count: 1,
          resetAt: ahoraMs + fallosVentanaMs,
        })
        return
      }

      entrada.count = Math.min(entrada.count + 1, fallosMax)
    },

    registrarExito(clave) {
      fallos.delete(clave)
    },
  }
}

let instanciaActual = crearLimitadorWebhook()

/**
 * Fachada estable sobre el singleton. `reiniciarLimitadorWebhookPaypal` cambia
 * la instancia interna sin romper las importaciones de la ruta.
 */
export const limitadorWebhookPaypal: LimitadorWebhook = {
  permitir(clave) {
    return instanciaActual.permitir(clave)
  },
  registrarFallo(clave) {
    instanciaActual.registrarFallo(clave)
  },
  registrarExito(clave) {
    instanciaActual.registrarExito(clave)
  },
}

export function reiniciarLimitadorWebhookPaypal(): void {
  instanciaActual = crearLimitadorWebhook()
}

export function cuerpoExcedeLimite(
  contentLength: string | null,
  cuerpo: string | null
): boolean {
  if (contentLength !== null) {
    const valor = contentLength.trim()
    if (/^\d+$/.test(valor)) {
      const bytes = Number(valor)
      if (bytes > WEBHOOK_CUERPO_MAX_BYTES) return true
    }
  }

  if (cuerpo !== null) {
    return Buffer.byteLength(cuerpo, "utf8") > WEBHOOK_CUERPO_MAX_BYTES
  }

  return false
}
