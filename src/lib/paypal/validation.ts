/**
 * Esquemas Zod de los bodies de las APIs de PayPal (T-08).
 *
 * `POST /api/admin/paypal/link` recibe exactamente uno de `hitoId` o
 * `suscripcionId`. `meses` solo aplica a soporte y, si se envia, debe ser un
 * entero entre 1 y 12. Los montos viajan en centavos USD enteros.
 *
 * Los campos opcionales aceptan `null` como equivalente a "no enviado" para
 * tolerar los formularios que limpian un valor. `idioma` y `regenerar` tienen
 * defaults explicitos (`es` y `false`).
 */

import { z } from "zod"

const idSchema = z.string().trim().min(1, "El identificador es obligatorio").max(100)
const textoOpcionalSchema = z.string().max(500).nullish()

export const paypalLinkBodySchema = z
  .object({
    hitoId: idSchema.nullish(),
    suscripcionId: idSchema.nullish(),
    montoAcordadoCents: z.number().int().positive().nullish(),
    meses: z.number().int().min(1).max(12).nullish(),
    descripcion: textoOpcionalSchema,
    notaInterna: z.string().max(2000).nullish(),
    idioma: z.enum(["es", "en"]).default("es"),
    regenerar: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    const tieneHito = body.hitoId !== null && body.hitoId !== undefined
    const tieneSuscripcion = body.suscripcionId !== null && body.suscripcionId !== undefined

    if (tieneHito === tieneSuscripcion) {
      ctx.addIssue({
        code: "custom",
        message: "Debe indicarse exactamente uno de hitoId o suscripcionId.",
        path: ["hitoId"],
      })
    }

    if (tieneHito && body.meses !== null && body.meses !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "meses solo aplica a un soporte mensual.",
        path: ["meses"],
      })
    }
  })

export type PaypalLinkBody = z.infer<typeof paypalLinkBodySchema>

/**
 * `POST /api/admin/paypal/enviar` (T-09): identifica el enlace y el canal de
 * envio. `idioma` es opcional y, si falta, se usa el del enlace o `es`.
 * `COPIA` no envia nada: solo devuelve el mensaje canonico y registra el envio.
 */
export const paypalEnviarBodySchema = z.object({
  enlaceId: idSchema,
  canal: z.enum(["EMAIL", "WHATSAPP", "COPIA"]),
  idioma: z.enum(["es", "en"]).nullish(),
})

export type PaypalEnviarBody = z.infer<typeof paypalEnviarBodySchema>

const PRISMA_INT_MAX = 2_147_483_647
const referenciaSchema = z.string().trim().min(1).max(128)

/**
 * `POST /api/admin/paypal/manual` (T-15): registro manual de un pago PayPal.
 *
 * - Exactamente uno de `hitoId`/`suscripcionId`; `meses` obligatorio (1..12)
 *   solo para soporte.
 * - Montos en centavos enteros y `montoAcordado + comision = total`.
 * - Al menos una referencia PayPal (`externalId` capture id y/o
 *   `paypalOrderId`) y evidencia textual/URL.
 * - `.strict()` rechaza campos no previstos, incluidos datos del pagador
 *   (`pagadorEmail`, `pagadorNombre`, etc.).
 */
export const paypalManualBodySchema = z
  .object({
    hitoId: idSchema.nullish(),
    suscripcionId: idSchema.nullish(),
    montoAcordadoCents: z.number().int().positive().max(PRISMA_INT_MAX),
    comisionCents: z.number().int().min(0).max(PRISMA_INT_MAX),
    totalCents: z.number().int().positive().max(PRISMA_INT_MAX),
    externalId: referenciaSchema.nullish(),
    paypalOrderId: referenciaSchema.nullish(),
    evidencia: z.string().trim().min(1).max(2_000),
    meses: z.number().int().min(1).max(12).nullish(),
    marcarHitoPagado: z.boolean().default(true),
    acreditarMeses: z.boolean().default(true),
    moneda: z
      .string()
      .trim()
      .refine((valor) => valor.toLowerCase() === "usd", {
        message: "PayPal solo acepta montos en USD.",
      })
      .nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const tieneHito = body.hitoId !== null && body.hitoId !== undefined
    const tieneSuscripcion =
      body.suscripcionId !== null && body.suscripcionId !== undefined

    if (tieneHito === tieneSuscripcion) {
      ctx.addIssue({
        code: "custom",
        message: "Debe indicarse exactamente uno de hitoId o suscripcionId.",
        path: ["hitoId"],
      })
    }

    if (tieneHito && body.meses !== null && body.meses !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "meses solo aplica a un soporte mensual.",
        path: ["meses"],
      })
    }

    if (tieneSuscripcion && (body.meses === null || body.meses === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Los meses del soporte son obligatorios (1..12).",
        path: ["meses"],
      })
    }

    if (body.montoAcordadoCents + body.comisionCents !== body.totalCents) {
      ctx.addIssue({
        code: "custom",
        message: "El total debe ser igual al monto acordado mas la comision.",
        path: ["totalCents"],
      })
    }

    if (
      (body.externalId === null || body.externalId === undefined) &&
      (body.paypalOrderId === null || body.paypalOrderId === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Se requiere externalId y/o paypalOrderId.",
        path: ["externalId"],
      })
    }
  })

export type PaypalManualBody = z.infer<typeof paypalManualBodySchema>

const PRISMA_INT_MAX_AJUSTE = 2_147_483_647
const textoAjusteSchema = z.string().trim().max(2_000).nullish()

/**
 * `POST /api/admin/paypal/ajustes` (T-16): registro manual de un reembolso o
 * contracargo. La decision es obligatoria y explicita (no hay automatismo):
 *
 * - Exige al menos `motivo` o `evidencia`; ambos son texto libre interno y no
 *   se bloquean por PII (AC-19 se cumple porque no se loguean).
 * - `NINGUNA` no toca el hito ni el soporte.
 * - `REVERTIR_HITO` exige que el pago tenga un hito (se valida contra la base).
 * - `DESCONTAR_MESES` exige `mesesDescontados` entre 1 y 12; el resto de las
 *   decisiones no pueden enviarlo.
 *
 * `.strict()` rechaza campos no previstos, incluidos datos del pagador
 * (`pagadorEmail`, `pagadorNombre`, etc.).
 */
export const paypalAjusteBodySchema = z
  .object({
    pagoId: idSchema,
    tipo: z.enum(["REEMBOLSO", "CONTRACARGO"]),
    montoCents: z.number().int().positive().max(PRISMA_INT_MAX_AJUSTE),
    motivo: textoAjusteSchema,
    evidencia: textoAjusteSchema,
    decision: z.enum(["NINGUNA", "REVERTIR_HITO", "DESCONTAR_MESES"]),
    mesesDescontados: z.number().int().min(1).max(12).nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.motivo && !body.evidencia) {
      ctx.addIssue({
        code: "custom",
        message: "Indica al menos un motivo o una evidencia.",
        path: ["motivo"],
      })
    }

    if (body.decision === "DESCONTAR_MESES") {
      if (
        body.mesesDescontados === null ||
        body.mesesDescontados === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Los meses a descontar son obligatorios (1..12).",
          path: ["mesesDescontados"],
        })
      }
      return
    }

    if (
      body.mesesDescontados !== null &&
      body.mesesDescontados !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "mesesDescontados solo aplica a la decision DESCONTAR_MESES.",
        path: ["mesesDescontados"],
      })
    }
  })

export type PaypalAjusteBody = z.infer<typeof paypalAjusteBodySchema>

/**
 * `POST /api/admin/paypal/revision` (T-17): el admin acepta o rechaza un pago
 * PayPal que quedo en `REVISION` por diferencia de monto o de moneda.
 *
 * - `accion` es obligatoria y explicita: no existe una resolucion automatica.
 * - `nota` es opcional como trazabilidad. No habilita aceptar una diferencia
 *   de moneda: un pago en moneda distinta de USD solo se puede rechazar y
 *   registrar manualmente (T-15).
 * - `.strict()` rechaza campos no previstos, incluidos datos del pagador
 *   (`pagadorEmail`, `pagadorNombre`, etc.).
 */
export const paypalRevisionBodySchema = z
  .object({
    pagoId: idSchema,
    accion: z.enum(["ACEPTAR", "RECHAZAR"]),
    nota: z.string().trim().max(2_000).nullish(),
  })
  .strict()

export type PaypalRevisionBody = z.infer<typeof paypalRevisionBodySchema>
