/**
 * T-14 (AC-13, AC-15, AC-19; RF-18, RF-22, RF-23): supresion del prospecto
 * manual.
 *
 * Modulo server-only (Prisma). No lee ni escribe el CRM y no hace red.
 * Centraliza la comprobacion que comparten el alta y la correccion para no
 * duplicar reglas:
 * - con email y sin secreto se falla cerrado (`NO_CONFIGURADO`), porque no se
 *   puede calcular el hash global;
 * - sin email solo se evalua la supresion por dominio de negocio;
 * - nunca se consulta un proveedor publico ni un dominio multiinquilino.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  dominioSuprimible,
  evaluarContactabilidad,
  hashEmail,
  type SupresionEvaluable,
} from "./supresion"

export type ResultadoSupresion =
  | { suprimido: false }
  | { suprimido: true; codigo: "NO_CONFIGURADO" | "SUPRIMIDO" }

/**
 * Reune las supresiones activas que podrian afectar al prospecto: el hash del
 * email y los dominios de negocio suprimibles del sitio y del propio email.
 */
export async function buscarSupresiones(
  emailHash: string | null,
  dominios: string[],
): Promise<SupresionEvaluable[]> {
  const condiciones: Prisma.SupresionProspectoWhereInput[] = []

  if (emailHash !== null) {
    condiciones.push({ ambito: "EMAIL", emailHash })
  }
  for (const dominio of dominios) {
    condiciones.push({ ambito: "DOMINIO", dominioNegocio: dominio })
  }

  if (condiciones.length === 0) return []

  const filas = await prisma.supresionProspecto.findMany({
    where: { activa: true, OR: condiciones },
    select: { ambito: true, emailHash: true, dominioNegocio: true },
    take: 50,
  })

  const supresiones: SupresionEvaluable[] = []
  for (const fila of filas) {
    if (fila.ambito === "EMAIL" && fila.emailHash) {
      supresiones.push({ ambito: "EMAIL", emailHash: fila.emailHash })
    } else if (fila.ambito === "DOMINIO" && fila.dominioNegocio) {
      supresiones.push({
        ambito: "DOMINIO",
        dominioNegocio: fila.dominioNegocio,
      })
    }
  }

  return supresiones
}

/**
 * Comprueba la supresion antes de crear o cambiar un email. Con email y sin
 * secreto se falla cerrado (503): no se puede garantizar el bloqueo por hash.
 */
export async function comprobarSupresion(input: {
  email: string | null
  secreto: string | null
  dominioSitio: string | null
}): Promise<ResultadoSupresion> {
  const dominios = new Set<string>()

  const dominioDelSitio = dominioSuprimible(input.dominioSitio)
  if (dominioDelSitio !== null) dominios.add(dominioDelSitio)

  const dominioDelEmail = input.email
    ? dominioSuprimible(input.email)
    : null
  if (dominioDelEmail !== null) dominios.add(dominioDelEmail)

  if (input.email === null) {
    if (dominios.size === 0) return { suprimido: false }

    const filas = await prisma.supresionProspecto.findMany({
      where: {
        activa: true,
        ambito: "DOMINIO",
        dominioNegocio: { in: [...dominios] },
      },
      select: { id: true },
      take: 1,
    })

    return filas.length > 0
      ? { suprimido: true, codigo: "SUPRIMIDO" }
      : { suprimido: false }
  }

  if (input.secreto === null) {
    return { suprimido: true, codigo: "NO_CONFIGURADO" }
  }

  const emailHash = hashEmail(input.email, input.secreto)
  const supresiones = await buscarSupresiones(emailHash, [...dominios])

  const resultado = evaluarContactabilidad(
    {
      email: input.email,
      dominioNegocio: input.dominioSitio,
      supresiones,
    },
    input.secreto,
  )

  if (
    !resultado.contactable &&
    (resultado.motivo === "SUPRIMIDO_EMAIL" ||
      resultado.motivo === "SUPRIMIDO_DOMINIO")
  ) {
    return { suprimido: true, codigo: "SUPRIMIDO" }
  }

  return { suprimido: false }
}
