/**
 * T-12 (AC-7, AC-14; RF-9, RF-12): esquemas Zod de los bodies del portal.
 *
 * Se comparten entre cliente y servidor:
 * - `campanaCreateSchema` es el contrato de `POST /api/propuestas/campanas`.
 *   Hace trim, exige un UUID de idempotencia y deja los opcionales vacios como
 *   `undefined` para no guardar cadenas en blanco.
 * - `campanaFormSchema` es la variante del formulario (sin `idempotencyKey`,
 *   que se genera en el cliente una sola vez por montaje y sin defaults para
 *   que el tipo de entrada y salida coincida con react-hook-form).
 *
 * El archivo queda preparado para sumar en tareas futuras los esquemas de
 * prospectos, envios, plantillas y supresiones. No se implementan aqui.
 */

import { z } from "zod"

export const CAMPANA_NOMBRE_MAX = 120
export const CAMPANA_CONSULTA_MAX = 500
export const CAMPANA_ZONA_MAX = 120
export const CAMPANA_RUBRO_MAX = 120
export const CAMPANA_PLANTILLA_ID_MAX = 128
export const CAMPANA_LIMITE_MIN = 1
export const CAMPANA_LIMITE_MAX = 20
export const CAMPANA_LIMITE_DEFAULT = 20

const nombreSchema = z
  .string("El nombre es obligatorio.")
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(
    CAMPANA_NOMBRE_MAX,
    `El nombre no puede superar ${CAMPANA_NOMBRE_MAX} caracteres.`,
  )

const consultaSchema = z
  .string("La consulta es obligatoria.")
  .trim()
  .min(1, "La consulta es obligatoria.")
  .max(
    CAMPANA_CONSULTA_MAX,
    `La consulta no puede superar ${CAMPANA_CONSULTA_MAX} caracteres.`,
  )

const limiteCorridaSchema = z
  .number("El limite por corrida es obligatorio.")
  .int("El limite por corrida debe ser un entero.")
  .min(
    CAMPANA_LIMITE_MIN,
    `El limite por corrida debe ser al menos ${CAMPANA_LIMITE_MIN}.`,
  )
  .max(
    CAMPANA_LIMITE_MAX,
    `El limite por corrida no puede superar ${CAMPANA_LIMITE_MAX}.`,
  )

/** Opcional de servidor: trim, maximo y cadena vacia convertida en undefined. */
function textoOpcional(max: number, etiqueta: string) {
  return z
    .string(`${etiqueta} debe ser texto.`)
    .trim()
    .max(max, `${etiqueta} no puede superar ${max} caracteres.`)
    .nullish()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
}

/** Opcional de formulario: mismo maximo, sin transformar el tipo de entrada. */
function textoOpcionalForm(max: number, etiqueta: string) {
  return z
    .string(`${etiqueta} debe ser texto.`)
    .trim()
    .max(max, `${etiqueta} no puede superar ${max} caracteres.`)
    .optional()
}

const zonaSchema = textoOpcional(CAMPANA_ZONA_MAX, "La zona")
const rubroSchema = textoOpcional(CAMPANA_RUBRO_MAX, "El rubro")
const plantillaIdSchema = textoOpcional(
  CAMPANA_PLANTILLA_ID_MAX,
  "La plantilla",
)

export const campanaCreateSchema = z.object({
  nombre: nombreSchema,
  consulta: consultaSchema,
  zona: zonaSchema,
  rubro: rubroSchema,
  limiteCorrida: limiteCorridaSchema.default(CAMPANA_LIMITE_DEFAULT),
  plantillaId: plantillaIdSchema,
  idempotencyKey: z.uuid("El identificador de idempotencia debe ser un UUID."),
})

export type CampanaCreateInput = z.infer<typeof campanaCreateSchema>

export const campanaFormSchema = z.object({
  nombre: nombreSchema,
  consulta: consultaSchema,
  zona: textoOpcionalForm(CAMPANA_ZONA_MAX, "La zona"),
  rubro: textoOpcionalForm(CAMPANA_RUBRO_MAX, "El rubro"),
  limiteCorrida: limiteCorridaSchema,
  plantillaId: textoOpcionalForm(CAMPANA_PLANTILLA_ID_MAX, "La plantilla"),
})

export type CampanaFormValues = z.infer<typeof campanaFormSchema>

/**
 * T-13 (AC-8, AC-11, AC-12; RF-12): confirmacion explicita de una accion de
 * campana (ejecutar o cancelar). El body debe traer exactamente
 * `{ confirmado: true }`; cualquier otro valor se rechaza con 400 y no se
 * procesa la mutacion.
 */
export const campanaAccionSchema = z.object({
  confirmado: z.literal(true),
})

export type CampanaAccionInput = z.infer<typeof campanaAccionSchema>
