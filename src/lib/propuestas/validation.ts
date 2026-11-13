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

/* ------------------------------------------------------------------ */
/* T-16 (AC-22, AC-23, AC-24; RF-34..RF-39): plantillas y borradores   */
/* ------------------------------------------------------------------ */

export const PLANTILLA_NOMBRE_MAX = 120
export const PLANTILLA_ASUNTO_MAX = 120
export const PLANTILLA_CUERPO_MAX = 10_000
export const PLANTILLA_VARIABLE_MAX = 40
export const PLANTILLA_VARIABLES_MAX = 50
export const PLANTILLA_IDIOMAS = ["es", "en"] as const
export const ENVIO_ASUNTO_MAX = 120
export const ENVIO_CUERPO_MAX = 10_000

const plantillaNombreSchema = z
  .string("El nombre de la plantilla es obligatorio.")
  .trim()
  .min(1, "El nombre de la plantilla es obligatorio.")
  .max(
    PLANTILLA_NOMBRE_MAX,
    `El nombre no puede superar ${PLANTILLA_NOMBRE_MAX} caracteres.`,
  )

const plantillaIdiomaSchema = z.enum(
  PLANTILLA_IDIOMAS,
  "El idioma debe ser es o en.",
)

const plantillaAsuntoSchema = z
  .string("El asunto es obligatorio.")
  .trim()
  .min(1, "El asunto es obligatorio.")
  .max(
    PLANTILLA_ASUNTO_MAX,
    `El asunto no puede superar ${PLANTILLA_ASUNTO_MAX} caracteres.`,
  )

const plantillaCuerpoSchema = z
  .string("El cuerpo es obligatorio.")
  .trim()
  .min(1, "El cuerpo es obligatorio.")
  .max(
    PLANTILLA_CUERPO_MAX,
    `El cuerpo no puede superar ${PLANTILLA_CUERPO_MAX} caracteres.`,
  )

const plantillaVariableSchema = z
  .string("La variable debe ser texto.")
  .trim()
  .min(1, "La variable no puede estar vacía.")
  .max(
    PLANTILLA_VARIABLE_MAX,
    `La variable no puede superar ${PLANTILLA_VARIABLE_MAX} caracteres.`,
  )

const plantillaVariablesSchema = z
  .array(plantillaVariableSchema)
  .max(
    PLANTILLA_VARIABLES_MAX,
    `No se pueden declarar más de ${PLANTILLA_VARIABLES_MAX} variables.`,
  )

/**
 * Contrato de `POST /api/propuestas/plantillas`. `variablesPermitidas` solo
 * declara el subconjunto usado; el servidor valida la lista blanca y guarda la
 * lista canónica de variables realmente usadas.
 */
export const plantillaCreateSchema = z.object({
  nombre: plantillaNombreSchema,
  idioma: plantillaIdiomaSchema.default("es"),
  asunto: plantillaAsuntoSchema,
  cuerpo: plantillaCuerpoSchema,
  variablesPermitidas: plantillaVariablesSchema.optional(),
})

export type PlantillaCreateInput = z.infer<typeof plantillaCreateSchema>

/**
 * Contrato de `PATCH /api/propuestas/plantillas/[id]`: siempre crea una
 * versión nueva con el mismo nombre. El nombre no se edita en esta ruta.
 */
export const plantillaPatchSchema = z.object({
  idioma: plantillaIdiomaSchema.default("es"),
  asunto: plantillaAsuntoSchema,
  cuerpo: plantillaCuerpoSchema,
  variablesPermitidas: plantillaVariablesSchema.optional(),
})

export type PlantillaPatchInput = z.infer<typeof plantillaPatchSchema>

/** Variante del formulario (incluye el nombre y no transforma el tipo). */
export const plantillaFormSchema = z.object({
  nombre: plantillaNombreSchema,
  idioma: plantillaIdiomaSchema,
  asunto: plantillaAsuntoSchema,
  cuerpo: plantillaCuerpoSchema,
  variablesPermitidas: plantillaVariablesSchema,
})

export type PlantillaFormValues = z.infer<typeof plantillaFormSchema>

/**
 * `POST /api/propuestas/prospectos/[id]/borrador`. En v1 solo se acepta
 * `PLANTILLA`; `LLM` existe en el contrato para responder 503 sin escribir.
 */
export const borradorCreateSchema = z.object({
  modo: z.enum(["PLANTILLA", "LLM"]).default("PLANTILLA"),
  plantillaId: textoOpcional(
    CAMPANA_PLANTILLA_ID_MAX,
    "La plantilla",
  ),
})

export type BorradorCreateInput = z.infer<typeof borradorCreateSchema>

/** `PATCH /api/propuestas/envios/[id]`: edición de asunto y cuerpo texto. */
export const envioEdicionSchema = z.object({
  asunto: z
    .string("El asunto es obligatorio.")
    .trim()
    .min(1, "El asunto es obligatorio.")
    .max(
      ENVIO_ASUNTO_MAX,
      `El asunto no puede superar ${ENVIO_ASUNTO_MAX} caracteres.`,
    ),
  cuerpoTexto: z
    .string("El cuerpo es obligatorio.")
    .trim()
    .min(1, "El cuerpo es obligatorio.")
    .max(
      ENVIO_CUERPO_MAX,
      `El cuerpo no puede superar ${ENVIO_CUERPO_MAX} caracteres.`,
    ),
})

export type EnvioEdicionInput = z.infer<typeof envioEdicionSchema>

/* ------------------------------------------------------------------ */
/* T-18 (AC-26, AC-28..AC-31; RF-43..RF-50): envio, resultado y        */
/* reconciliacion manual                                               */
/* ------------------------------------------------------------------ */

/**
 * `POST /api/propuestas/envios/[id]/enviar`. Contrato exacto: solo la segunda
 * confirmacion explicita del admin. Cualquier otro campo o valor se rechaza con
 * 400 y no se llama a Resend.
 */
export const envioEnviarSchema = z
  .object({
    confirmacion: z.literal("ENVIAR"),
  })
  .strict()

export type EnvioEnviarInput = z.infer<typeof envioEnviarSchema>

export const ENVIO_RESULTADOS = [
  "RESPONDIDO",
  "REBOTE_DURO",
  "QUEJA",
] as const

export const ENVIO_DETALLE_MAX = 500

/**
 * `POST /api/propuestas/envios/[id]/resultado`: registro manual del resultado.
 * No hay webhook de Resend en v1; un rebote duro o una queja suprimen el email.
 */
export const envioResultadoSchema = z
  .object({
    tipo: z.enum(ENVIO_RESULTADOS, "El resultado no es valido."),
    detalle: textoOpcional(ENVIO_DETALLE_MAX, "El detalle"),
  })
  .strict()

export type EnvioResultadoInput = z.infer<typeof envioResultadoSchema>

/**
 * `POST /api/propuestas/envios/[id]/reconciliar`: solo para desbloquear un
 * envio que quedo ENVIANDO. Exige la nota del admin que verifico el estado en
 * Resend; no consulta al proveedor ni reintenta.
 */
export const envioReconciliarSchema = z
  .object({
    nota: motivoSchema,
  })
  .strict()

export type EnvioReconciliarInput = z.infer<typeof envioReconciliarSchema>

/* ------------------------------------------------------------------ */
/* T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56): supresiones */
/* ------------------------------------------------------------------ */

export const SUPRESION_AMBITOS = ["EMAIL", "DOMINIO"] as const

export const SUPRESION_MOTIVOS = [
  "OPT_OUT",
  "REBOTE_DURO",
  "QUEJA",
  "MANUAL",
  "SOLICITUD_ARCO",
] as const

export const SUPRESION_EMAIL_MAX = PROSPECTO_EMAIL_MAX
export const SUPRESION_DOMINIO_MAX = 253
export const SUPRESION_NOTAS_MAX = 500

const supresionEmailSchema = z
  .string("El email es obligatorio.")
  .trim()
  .min(1, "El email es obligatorio.")
  .max(
    SUPRESION_EMAIL_MAX,
    `El email no puede superar ${SUPRESION_EMAIL_MAX} caracteres.`,
  )
  .pipe(z.email("El email no es válido."))

const supresionDominioSchema = z
  .string("El dominio es obligatorio.")
  .trim()
  .min(1, "El dominio es obligatorio.")
  .max(
    SUPRESION_DOMINIO_MAX,
    `El dominio no puede superar ${SUPRESION_DOMINIO_MAX} caracteres.`,
  )

const supresionMotivoSchema = z.enum(
  SUPRESION_MOTIVOS,
  "El motivo no es válido.",
)

/**
 * `POST /api/propuestas/supresiones`: alta manual idempotente. El ámbito
 * decide el dato obligatorio; unión discriminada para que no se pueda enviar
 * email y dominio a la vez ni omitir el que corresponde. El servidor además
 * rechaza dominios de proveedores públicos o plataformas multiinquilino.
 */
export const supresionCreateSchema = z.discriminatedUnion("ambito", [
  z
    .object({
      ambito: z.literal("EMAIL"),
      email: supresionEmailSchema,
      motivo: supresionMotivoSchema,
      notas: textoOpcional(SUPRESION_NOTAS_MAX, "Las notas"),
    })
    .strict(),
  z
    .object({
      ambito: z.literal("DOMINIO"),
      dominioNegocio: supresionDominioSchema,
      motivo: supresionMotivoSchema,
      notas: textoOpcional(SUPRESION_NOTAS_MAX, "Las notas"),
    })
    .strict(),
])

export type SupresionCreateInput = z.infer<typeof supresionCreateSchema>

/**
 * `POST /api/propuestas/supresiones/[id]/revocar`: excepción explícita. El
 * motivo es obligatorio y se registra; no reabre prospectos.
 */
export const supresionRevocarSchema = z
  .object({
    motivo: motivoSchema,
  })
  .strict()

export type SupresionRevocarInput = z.infer<typeof supresionRevocarSchema>

/**
 * Variante del formulario: ambos campos opcionales en el tipo de entrada y una
 * validación condicional según el ámbito. El servidor vuelve a validar con
 * `supresionCreateSchema` y con las reglas de dominio de `supresion.ts`.
 */
export const supresionFormSchema = z
  .object({
    ambito: z.enum(SUPRESION_AMBITOS, "El ámbito no es válido."),
    email: textoOpcionalForm(SUPRESION_EMAIL_MAX, "El email"),
    dominioNegocio: textoOpcionalForm(SUPRESION_DOMINIO_MAX, "El dominio"),
    motivo: supresionMotivoSchema,
    notas: textoOpcionalForm(SUPRESION_NOTAS_MAX, "Las notas"),
  })
  .superRefine((valor, ctx) => {
    if (valor.ambito === "EMAIL") {
      if (!valor.email) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "El email es obligatorio.",
        })
      } else if (!z.email().safeParse(valor.email).success) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "El email no es válido.",
        })
      }
      return
    }

    if (!valor.dominioNegocio) {
      ctx.addIssue({
        code: "custom",
        path: ["dominioNegocio"],
        message: "El dominio es obligatorio.",
      })
    }
  })

export type SupresionFormValues = z.infer<typeof supresionFormSchema>

/* ------------------------------------------------------------------ */
/* T-22 (AC-37, AC-40; RF-30, RF-65): retención y ARCO                 */
/* ------------------------------------------------------------------ */

export const ARCO_TIPOS = ["EXPORTAR", "ELIMINAR", "RECTIFICAR"] as const
export const ARCO_CAMBIOS_MAX = 20

/**
 * `POST /api/propuestas/arco/[prospectoId]`.
 *
 * - EXPORTAR no necesita más datos: devuelve la descarga JSON.
 * - ELIMINAR puede llevar `motivo` y una confirmación explícita (`confirmado`).
 *   La supresión `SOLICITUD_ARCO` se crea en el servidor si hay email.
 * - RECTIFICAR exige `cambios` no vacío y `motivo`. Los campos se revalidan
 *   con `prospectoPatchSchema` para reutilizar las reglas de T-14.
 */
export const arcoAccionSchema = z
  .object({
    tipo: z.enum(ARCO_TIPOS, "El tipo de solicitud no es válido."),
    cambios: z
      .record(
        z.string().max(40),
        z.string().max(PROSPECTO_URL_MAX),
      )
      .refine(
        (valor) => Object.keys(valor).length <= ARCO_CAMBIOS_MAX,
        `No se pueden rectificar más de ${ARCO_CAMBIOS_MAX} campos.`,
      )
      .optional(),
    motivo: textoOpcional(PROSPECTO_MOTIVO_MAX, "El motivo"),
    confirmado: z.literal(true).optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    if (valor.tipo !== "RECTIFICAR") return

    if (!valor.cambios || Object.keys(valor.cambios).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["cambios"],
        message: "Indicá al menos un dato para rectificar.",
      })
    }

    if (!valor.motivo) {
      ctx.addIssue({
        code: "custom",
        path: ["motivo"],
        message: "El motivo es obligatorio.",
      })
    }
  })

export type ArcoAccionInput = z.infer<typeof arcoAccionSchema>
