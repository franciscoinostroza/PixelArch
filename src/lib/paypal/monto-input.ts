/**
 * Conversion entre centavos USD y el texto editable de los modales de PayPal
 * (T-25/T-26). Modulo **client-safe**: no importa Prisma, Node ni React.
 *
 * Acepta coma o punto como separador decimal y hasta dos decimales
 * ("100", "100,5", "100,50"), sin separador de miles y sin pasar por floats.
 */

/** Centavos -> texto editable con coma decimal ("106,56"). */
export function centavosAInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return ""
  const enteros = Math.floor(cents / 100)
  const decimales = String(cents % 100).padStart(2, "0")
  return `${enteros},${decimales}`
}

/**
 * Texto editable -> centavos. Devuelve `null` si el formato no es valido o si
 * el monto no esta permitido. `permitirCero` habilita el 0 (comisiones).
 */
export function parsearMontoUsd(
  valor: string,
  permitirCero = false
): number | null {
  const limpio = valor.trim()
  if (!/^\d{1,9}(?:[.,]\d{0,2})?$/.test(limpio)) return null

  const [enteros, decimales = ""] = limpio.split(/[.,]/)
  const cents = Number(enteros) * 100 + Number(`${decimales}00`.slice(0, 2))
  if (!Number.isSafeInteger(cents)) return null
  if (cents === 0) return permitirCero ? 0 : null
  return cents > 0 ? cents : null
}
