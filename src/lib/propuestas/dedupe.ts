/**
 * T-05 (AC-14; RF-14, RF-22): deduplicacion de prospectos.
 *
 * Reglas:
 * - `placeId` exacto -> reutilizar el prospecto existente.
 * - email normalizado exacto -> reutilizar.
 * - dominio de negocio igual con `placeId` distinto -> POSIBLE_DUPLICADO
 *   (sucursal u otra ficha del mismo negocio). Nunca se fusiona solo.
 * - Los proveedores de email publico (Gmail/Hotmail/...) y los sufijos
 *   publicos (`com.ar`, `co.uk`) no son dominio de negocio y no deduplican.
 *
 * Modulo puro: no toca Prisma, red ni entorno.
 */

import { dominioNegocio, normalizarEmail } from "./normalizar"

export type ResultadoDedupe =
  | { tipo: "NUEVO" }
  | { tipo: "REUTILIZAR"; prospectoId: string; motivo: "PLACE_ID" | "EMAIL" }
  | { tipo: "POSIBLE_DUPLICADO"; prospectoId: string; motivo: "DOMINIO" }

export interface EntradaDedupe {
  placeId?: string | null
  email?: string | null
  /** Host o URL del sitio del negocio. Se reduce al dominio registrable. */
  dominioNormalizado?: string | null
}

export interface ExistenteDedupe {
  id: string
  placeId?: string | null
  email?: string | null
  dominioNormalizado?: string | null
}

function limpiarPlaceId(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function idValido(existente: ExistenteDedupe): boolean {
  return typeof existente.id === "string" && existente.id.trim().length > 0
}

/**
 * Evalua un candidato contra los prospectos ya guardados. El orden de las
 * señales es `placeId` -> email -> dominio; la primera coincidencia gana. Si
 * hay varios dominios coincidentes, se devuelve el primero del arreglo para
 * que el resultado sea determinista.
 */
export function evaluarDedupe(
  input: EntradaDedupe,
  existentes: ExistenteDedupe[],
): ResultadoDedupe {
  const lista = Array.isArray(existentes)
    ? existentes.filter((existente) => existente && idValido(existente))
    : []

  const placeId = limpiarPlaceId(input?.placeId)
  const email = input?.email ? normalizarEmail(input.email) : null
  const dominio = input?.dominioNormalizado
    ? dominioNegocio(input.dominioNormalizado)
    : null

  if (placeId !== null) {
    const porPlaceId = lista.find(
      (existente) => limpiarPlaceId(existente.placeId) === placeId,
    )
    if (porPlaceId) {
      return {
        tipo: "REUTILIZAR",
        prospectoId: porPlaceId.id,
        motivo: "PLACE_ID",
      }
    }
  }

  if (email !== null) {
    const porEmail = lista.find(
      (existente) =>
        normalizarEmail(existente.email ?? "") === email,
    )
    if (porEmail) {
      return {
        tipo: "REUTILIZAR",
        prospectoId: porEmail.id,
        motivo: "EMAIL",
      }
    }
  }

  if (dominio !== null) {
    const porDominio = lista.find((existente) => {
      const dominioExistente = existente.dominioNormalizado
        ? dominioNegocio(existente.dominioNormalizado)
        : null
      return dominioExistente !== null && dominioExistente === dominio
    })

    if (porDominio) {
      return {
        tipo: "POSIBLE_DUPLICADO",
        prospectoId: porDominio.id,
        motivo: "DOMINIO",
      }
    }
  }

  return { tipo: "NUEVO" }
}
