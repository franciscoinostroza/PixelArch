/**
 * T-02 (AC-6; RF-64): deteccion de esquema no aplicado.
 *
 * El portal es aditivo y se despliega antes o despues de `db push`. Si falta
 * una tabla, la pagina debe fallar cerrado con un estado operativo y sin
 * formularios ni datos. T-04 completa este modulo con los codigos de error y
 * `sanitizarError`.
 */
export const CODIGO_ESQUEMA_NO_APLICADO = "ESQUEMA_NO_APLICADO"

interface ErrorConCodigo {
  code?: unknown
  meta?: { code?: unknown; message?: unknown }
  message?: unknown
}

/**
 * Prisma reporta una tabla faltante como P2021; una consulta raw puede
 * reportarla como P2010 con `meta.code = "42P01"` o con el mensaje de
 * PostgreSQL. Se aceptan las tres formas para no mostrar datos a medias.
 */
export function esErrorTablaFaltante(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const candidato = error as ErrorConCodigo

  if (candidato.code === "P2021" || candidato.code === "42P01") return true
  if (candidato.meta?.code === "P2021" || candidato.meta?.code === "42P01") {
    return true
  }

  const mensaje =
    typeof candidato.message === "string" ? candidato.message : ""
  return /relation .* does not exist|table .* does not exist|no existe la relaci[oó]n/i.test(
    mensaje,
  )
}
