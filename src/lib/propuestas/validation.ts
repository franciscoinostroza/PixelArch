/**
 * T-12 (AC-7, AC-14; RF-9, RF-12) y T-14 (AC-13, AC-14, AC-19; RF-18, RF-22):
 * esquemas Zod de los bodies del portal.
 *
 * Se comparten entre cliente y servidor:
 * - `campanaCreateSchema` es el contrato de `POST /api/propuestas/campanas`.
 *   Hace trim, exige un UUID de idempotencia y deja los opcionales vacios como
 *   `undefined` para no guardar cadenas en blanco.
 * - `campanaFormSchema` es la variante del formulario (sin `idempotencyKey`,
 *   que se genera en el cliente una sola vez por montaje y sin defaults para
 *   que el tipo de entrada y salida coincida con react-hook-form).
 * - `prospectoCreateSchema` es el contrato del alta manual: exige campana,
 *   nombre y nota, y valida URLs/email. No existe un body de importacion
 *   masiva: el endpoint acepta un unico prospecto por request.
 * - `prospectoPatchSchema` limita la correccion a los campos permitidos y
 *   exige un motivo; `prospectoDescartarSchema` exige el motivo del descarte.
 *
 * Los opcionales vacios se convierten en `undefined` para no guardar cadenas
 * en blanco. No se adivinan emails ni se completan dominios.
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

/* ------------------------------------------------------------------ */
/* T-14 (AC-13, AC-14, AC-19; RF-18, RF-22): prospectos manuales       */
/* ------------------------------------------------------------------ */

export const PROSPECTO_CAMPANA_ID_MAX = 128
export const PROSPECTO_NOMBRE_MAX = 120
export const PROSPECTO_URL_MAX = 2048
export const PROSPECTO_EMAIL_MAX = 254
export const PROSPECTO_TELEFONO_MAX = 40
export const PROSPECTO_CIUDAD_MAX = 120
export const PROSPECTO_RUBRO_MAX = 120
export const PROSPECTO_CONTACTO_MAX = 120
export const PROSPECTO_NOTA_MAX = 1000
export const PROSPECTO_MOTIVO_MAX = 500

/** Campos que una correccion puede tocar. Nunca se aplican por lista. */
export const PROSPECTO_CAMPOS_CORREGIBLES = [
  "nombreNegocio",
  "sitioWeb",
  "email",
  "telefono",
  "ciudad",
  "rubro",
  "contactoNombre",
  "contactoCargo",
  "fuenteUrl",
  "emailFuenteUrl",
] as const

function urlOpcional(max: number, etiqueta: string) {
  return z
    .string(`${etiqueta} debe ser texto.`)
    .trim()
    .max(max, `${etiqueta} no puede superar ${max} caracteres.`)
    .nullish()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
    .pipe(
      z
        .httpUrl(`${etiqueta} debe ser una URL http o https valida.`)
        .optional(),
    )
}

function emailOpcional() {
  return z
    .string("El email debe ser texto.")
    .trim()
    .max(
      PROSPECTO_EMAIL_MAX,
      `El email no puede superar ${PROSPECTO_EMAIL_MAX} caracteres.`,
    )
    .nullish()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
    .pipe(z.email("El email no es valido.").optional())
}

const nombreNegocioSchema = z
  .string("El nombre del negocio es obligatorio.")
  .trim()
  .min(1, "El nombre del negocio es obligatorio.")
  .max(
    PROSPECTO_NOMBRE_MAX,
    `El nombre del negocio no puede superar ${PROSPECTO_NOMBRE_MAX} caracteres.`,
  )

const notaSchema = z
  .string("La nota es obligatoria.")
  .trim()
  .min(1, "La nota es obligatoria.")
  .max(
    PROSPECTO_NOTA_MAX,
    `La nota no puede superar ${PROSPECTO_NOTA_MAX} caracteres.`,
  )

const motivoSchema = z
  .string("El motivo es obligatorio.")
  .trim()
  .min(1, "El motivo es obligatorio.")
  .max(
    PROSPECTO_MOTIVO_MAX,
    `El motivo no puede superar ${PROSPECTO_MOTIVO_MAX} caracteres.`,
  )

/**
 * Alta manual de un unico prospecto. El servidor ademas exige al menos una
 * fuente (`fuenteUrl` o `emailFuenteUrl`) y reglas de procedencia del email
 * que no dependen solo del formato.
 */
export const prospectoCreateSchema = z.object({
  campanaId: z
    .string("La campana es obligatoria.")
    .trim()
    .min(1, "La campana es obligatoria.")
    .max(
      PROSPECTO_CAMPANA_ID_MAX,
      `La campana no puede superar ${PROSPECTO_CAMPANA_ID_MAX} caracteres.`,
    ),
  nombreNegocio: nombreNegocioSchema,
  sitioWeb: urlOpcional(PROSPECTO_URL_MAX, "El sitio web"),
  email: emailOpcional(),
  telefono: textoOpcional(PROSPECTO_TELEFONO_MAX, "El telefono"),
  ciudad: textoOpcional(PROSPECTO_CIUDAD_MAX, "La ciudad"),
  rubro: textoOpcional(PROSPECTO_RUBRO_MAX, "El rubro"),
  fuenteUrl: urlOpcional(PROSPECTO_URL_MAX, "La fuente"),
  emailFuenteUrl: urlOpcional(PROSPECTO_URL_MAX, "La fuente del email"),
  nota: notaSchema,
})

export type ProspectoCreateInput = z.infer<typeof prospectoCreateSchema>

/**
 * Correccion de datos ya cargados. Solo se aceptan los campos de
 * `PROSPECTO_CAMPOS_CORREGIBLES`; el motivo es obligatorio y se registra en
 * el historial sin guardar los valores anteriores ni los nuevos.
 */
export const prospectoPatchSchema = z
  .object({
    nombreNegocio: textoOpcional(
      PROSPECTO_NOMBRE_MAX,
      "El nombre del negocio",
    ),
    sitioWeb: urlOpcional(PROSPECTO_URL_MAX, "El sitio web"),
    email: emailOpcional(),
    telefono: textoOpcional(PROSPECTO_TELEFONO_MAX, "El telefono"),
    ciudad: textoOpcional(PROSPECTO_CIUDAD_MAX, "La ciudad"),
    rubro: textoOpcional(PROSPECTO_RUBRO_MAX, "El rubro"),
    contactoNombre: textoOpcional(
      PROSPECTO_CONTACTO_MAX,
      "El nombre del contacto",
    ),
    contactoCargo: textoOpcional(
      PROSPECTO_CONTACTO_MAX,
      "El cargo del contacto",
    ),
    fuenteUrl: urlOpcional(PROSPECTO_URL_MAX, "La fuente"),
    emailFuenteUrl: urlOpcional(PROSPECTO_URL_MAX, "La fuente del email"),
    motivo: motivoSchema,
  })
  .refine(
    (valor) =>
      PROSPECTO_CAMPOS_CORREGIBLES.some(
        (campo) => valor[campo] !== undefined,
      ),
    {
      message: "Indica al menos un dato para corregir.",
      path: [],
    },
  )

export type ProspectoPatchInput = z.infer<typeof prospectoPatchSchema>

/** Descarte con motivo obligatorio. No borra datos ni supresiones. */
export const prospectoDescartarSchema = z.object({
  motivo: motivoSchema,
})

export type ProspectoDescartarInput = z.infer<
  typeof prospectoDescartarSchema
>
