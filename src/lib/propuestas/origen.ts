import { normalizarUrlPublica } from "./config"

/**
 * T-04 (AC-42; RF-8, RF-63): verificacion de origen para mutaciones.
 *
 * Las APIs internas del portal usan cookies de Clerk. Se compara el header
 * `Origin` (que el navegador no permite falsificar desde otra pagina) contra
 * la URL publica configurada. Ante duda se rechaza: sin `Origin`, con URL
 * publica invalida o con un origen distinto, la mutacion no se procesa.
 */
export function origenPermitido(
  req: Request,
  urlPublica: string | null | undefined,
): boolean {
  try {
    const base = normalizarUrlPublica(urlPublica)
    if (base === null) return false

    const origen = req.headers.get("origin")
    if (!origen) return false

    const origenUrl = new URL(origen)
    if (origenUrl.username || origenUrl.password) return false
    if (origenUrl.search || origenUrl.hash) return false

    return origenUrl.origin === base
  } catch {
    return false
  }
}
