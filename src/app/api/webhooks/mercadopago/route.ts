import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago"
import type { EstadoEnlace, Pasarela, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { obtenerPagoMp, type PagoMp } from "@/lib/mercadopago"
import {
  MOTIVO_INVALIDACION_OTRO_PAGO,
  grupoCobroDeHito,
  grupoCobroDeSuscripcion,
  normalizarMeses,
  mapearEstadoPagoMp,
  tituloLink,
  vencimientoConMeses,
} from "@/lib/mp-utils"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { sendPaymentReceipt } from "@/lib/notifications"
import {
  registrarEventoPasarela,
  type ResultadoEventoPasarela,
} from "@/lib/paypal/events"
import { calcularExpiracionEnlace, generarTokenEnlace } from "@/lib/paypal/utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EVENTO_TIPO = "MERCADOPAGO.PAYMENT"
const MOTIVO_DUPLICADO = "DUPLICADO"
const MOTIVO_ENLACE_INVALIDADO = "ENLACE_INVALIDADO"
const MOTIVO_ENLACE_PAGADO = "ENLACE_PAGADO"
const MOTIVO_HITO_PAGADO = "HITO_PAGADO"

/**
 * T-18 (AC-13, AC-20): el webhook MP resuelve el `EnlacePago` que origino la
 * preferencia (metadata `enlaceId`) o, en links legacy, por el
 * `externalReference` del concepto. El pago se registra con la misma
 * trazabilidad que PayPal (`pasarela`, `origen`, desglose, `enlacePagoId`) y,
 * si MP gana, invalida los links PayPal hermanos del `grupoCobroId`. Un pago
 * posterior para un cobro ya ganado no crea otro `Pago`: queda como intento
 * descartado en `EventoPasarela` con `REQUIERE_ACCION`.
 */

interface EnlaceMp {
  id: string
  clienteId: string
  hitoId: string | null
  suscripcionId: string | null
  pasarela: Pasarela
  concepto: string
  montoAcordado: number
  total: number
  moneda: string
  meses: number | null
  estado: EstadoEnlace
  grupoCobroId: string
  externalId: string | null
}

const SELECT_ENLACE = {
  id: true,
  clienteId: true,
  hitoId: true,
  suscripcionId: true,
  pasarela: true,
  concepto: true,
  montoAcordado: true,
  total: true,
  moneda: true,
  meses: true,
  estado: true,
  grupoCobroId: true,
  externalId: true,
} satisfies Prisma.EnlacePagoSelect

type EstadoMp = "SUCCEEDED" | "FAILED"

/** Conflicto de carrera dentro de la transaccion; fuerza el rollback. */
class ConflictoMp extends Error {
  readonly motivo: string

  constructor(motivo: string) {
    super(motivo)
    this.name = "ConflictoMp"
    this.motivo = motivo
  }
}

interface TrazaMp {
  eventoId: string
  resultado: ResultadoEventoPasarela
  motivo?: string | null
  externalId?: string | null
  enlacePagoId?: string | null
  pagoId?: string | null
  monto?: number | null
  moneda?: string | null
  requiereAccion?: boolean
}

/**
 * La trazabilidad nunca cambia el resultado del cobro: si falla el registro del
 * evento, se loguea sin PII y el pago sigue su curso.
 */
async function trazarEventoMp(params: TrazaMp): Promise<void> {
  try {
    await registrarEventoPasarela({
      eventoId: params.eventoId,
      pasarela: "MERCADOPAGO",
      tipo: EVENTO_TIPO,
      resultado: params.resultado,
      motivo: params.motivo ?? null,
      externalId: params.externalId ?? null,
      enlacePagoId: params.enlacePagoId ?? null,
      pagoId: params.pagoId ?? null,
      monto: params.monto ?? null,
      moneda: params.moneda ?? null,
      requiereAccion: params.requiereAccion,
    })
  } catch {
    logger.warn("No se pudo registrar el evento de Mercado Pago", {
      eventoId: params.eventoId,
      resultado: params.resultado,
      externalId: params.externalId ?? null,
      enlacePagoId: params.enlacePagoId ?? null,
      pagoId: params.pagoId ?? null,
    })
  }
}

async function descartarIntento(params: {
  pagoMp: PagoMp
  motivo: string
  enlacePagoId: string | null
  pagoId?: string | null
  monto: number
}): Promise<void> {
  await trazarEventoMp({
    eventoId: `MERCADOPAGO:DESCARTADO:${params.pagoMp.id}`,
    resultado: "REQUIERE_ACCION",
    motivo: params.motivo,
    externalId: params.pagoMp.id,
    enlacePagoId: params.enlacePagoId,
    pagoId: params.pagoId ?? null,
    monto: params.monto,
    moneda: "ars",
    requiereAccion: true,
  })

  logger.warn("Intento de pago MP descartado", {
    paymentId: params.pagoMp.id,
    motivo: params.motivo,
    enlacePagoId: params.enlacePagoId,
  })
}

/**
 * Busca el enlace MERCADOPAGO del cobro. Primero usa el `enlaceId` de la
 * metadata (validando que sea MERCADOPAGO y pertenezca al mismo
 * `grupoCobroId`) y, si no existe o no coincide, cae al link del concepto
 * (legacy). El enlace de otra pasarela nunca se resuelve aca: un `enlaceId` de
 * PayPal no puede recibir un pago/monto en ARS.
 */
async function buscarEnlaceMp(
  enlacePorId: EnlaceMp | null,
  grupoCobroId: string,
  concepto: "hito" | "soporte",
  conceptoId: string
): Promise<EnlaceMp | null> {
  if (
    enlacePorId &&
    enlacePorId.pasarela === "MERCADOPAGO" &&
    enlacePorId.grupoCobroId === grupoCobroId &&
    (concepto === "hito"
      ? enlacePorId.hitoId === conceptoId
      : enlacePorId.suscripcionId === conceptoId)
  ) {
    return enlacePorId
  }

  return prisma.enlacePago.findFirst({
    where: { grupoCobroId, pasarela: "MERCADOPAGO" },
    orderBy: { creadoEn: "desc" },
    select: SELECT_ENLACE,
  })
}

/** `enlaceId` usable solo si es de Mercado Pago (nunca PayPal/otra pasarela). */
function esEnlaceMp(enlace: EnlaceMp | null): enlace is EnlaceMp {
  return enlace?.pasarela === "MERCADOPAGO"
}

/** Error de constraint unica de Prisma (P2002). */
function esErrorUnico(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  )
}

/**
 * Si dos webhooks del mismo pago entran a la vez, el segundo choca con la
 * constraint unica de `Pago.externalId` (P2002). Ese caso es un duplicado, no
 * un error de procesamiento: se traza y se responde 200.
 */
async function responderDuplicadoPorCarrera(params: {
  pagoMp: PagoMp
  montoArsCents: number
}): Promise<Response | null> {
  const existente = await prisma.pago.findUnique({
    where: { externalId: params.pagoMp.id },
    select: { id: true, enlacePagoId: true },
  })
  if (!existente) return null

  await trazarEventoMp({
    eventoId: `MERCADOPAGO:DUPLICADO:${params.pagoMp.id}`,
    resultado: "DUPLICADO",
    motivo: MOTIVO_DUPLICADO,
    externalId: params.pagoMp.id,
    enlacePagoId: existente.enlacePagoId,
    pagoId: existente.id,
    monto: params.montoArsCents,
    moneda: "ars",
  })

  return NextResponse.json({ ok: true, duplicate: true })
}

async function marcarEnlacePagado(
  tx: Prisma.TransactionClient,
  enlace: Pick<EnlaceMp, "id" | "moneda">,
  monto: number
): Promise<void> {
  const data: Prisma.EnlacePagoUpdateManyMutationInput = { estado: "PAGADO" }

  // Los links legacy adoptados por T-07 solo tenian un monto de referencia en
  // USD. Al confirmarse el pago MP se corrige el snapshot con el monto real en
  // ARS; un link MP nuevo ya nace en ARS y conserva su snapshot.
  if (enlace.moneda !== "ars") {
    data.montoAcordado = monto
    data.comision = 0
    data.total = monto
    data.moneda = "ars"
    data.feeBps = 0
    data.feeFixedCents = 0
  }

  // CAS por estado: si otro pago consumio el link entre la lectura y esta
  // escritura, el count es 0 y la transaccion completa se revierte.
  const actualizado = await tx.enlacePago.updateMany({
    where: {
      id: enlace.id,
      estado: { notIn: ["INVALIDADO", "PAGADO"] },
    },
    data,
  })
  if (actualizado.count !== 1) {
    throw new ConflictoMp(MOTIVO_ENLACE_PAGADO)
  }
}

/**
 * Adopta el link MP legacy que no tenia `EnlacePago` (plan §4.2): se crea la
 * fila MERCADOPAGO ya PAGADA, con el monto real en ARS, el grupo del concepto y
 * la URL legacy. No modifica el hito/soporte ni llama a Mercado Pago.
 */
async function adoptarEnlaceLegacy(
  tx: Prisma.TransactionClient,
  input: {
    clienteId: string
    hitoId: string | null
    suscripcionId: string | null
    grupoCobroId: string
    concepto: string
    monto: number
    meses: number | null
    url: string | null
    expiraEn: Date | null
    ahora: Date
  }
): Promise<string> {
  const creado = await tx.enlacePago.create({
    data: {
      token: generarTokenEnlace(),
      clienteId: input.clienteId,
      hitoId: input.hitoId,
      suscripcionId: input.suscripcionId,
      pasarela: "MERCADOPAGO",
      concepto: input.concepto,
      descripcion: "Link existente de Mercado Pago",
      montoAcordado: input.monto,
      comision: 0,
      total: input.monto,
      moneda: "ars",
      meses: input.meses,
      feeBps: 0,
      feeFixedCents: 0,
      url: input.url,
      checkoutUrl: input.url,
      externalId: null,
      estado: "PAGADO",
      grupoCobroId: input.grupoCobroId,
      expiraEn: input.expiraEn ?? calcularExpiracionEnlace(input.ahora),
    },
    select: { id: true },
  })
  return creado.id
}

/**
 * Primer pago gana (AC-13): al confirmar un pago MP se invalidan los links
 * PayPal ACTIVOS del mismo `grupoCobroId`. El link MP ganador se marca PAGADO
 * por separado. No se toca el hito/soporte de los links descartados.
 */
async function invalidarPaypalHermanos(
  tx: Prisma.TransactionClient,
  grupoCobroId: string,
  ganadorId: string | null,
  ahora: Date
): Promise<void> {
  const where: Prisma.EnlacePagoWhereInput = {
    grupoCobroId,
    pasarela: "PAYPAL",
    estado: "ACTIVO",
  }
  if (ganadorId) where.id = { not: ganadorId }

  await tx.enlacePago.updateMany({
    where,
    data: {
      estado: "INVALIDADO",
      invalidadoEn: ahora,
      motivoInvalido: MOTIVO_INVALIDACION_OTRO_PAGO,
    },
  })
}

async function procesarHito(params: {
  pagoMp: PagoMp
  externalReference: string
  enlacePorId: EnlaceMp | null
  estado: EstadoMp
  montoArsCents: number
  cotizacion: number | null
}): Promise<Response> {
  const { pagoMp, externalReference, enlacePorId, estado, montoArsCents, cotizacion } =
    params

  const hito = await prisma.hito.findUnique({
    where: { id: externalReference },
    include: { proyecto: { include: { cliente: true } } },
  })
  if (!hito) {
    logger.warn("Webhook MP hito no encontrado", {
      paymentId: pagoMp.id,
      hitoId: externalReference,
    })
    return NextResponse.json({ ok: true, ignored: true })
  }

  const grupoCobroId = grupoCobroDeHito(hito.id)
  const enlace = await buscarEnlaceMp(
    enlacePorId,
    grupoCobroId,
    "hito",
    hito.id
  )

  if (enlace?.estado === "INVALIDADO" || enlace?.estado === "PAGADO") {
    await descartarIntento({
      pagoMp,
      motivo:
        enlace.estado === "INVALIDADO"
          ? MOTIVO_ENLACE_INVALIDADO
          : MOTIVO_ENLACE_PAGADO,
      enlacePagoId: enlace.id,
      monto: montoArsCents,
    })
    return NextResponse.json({ ok: true, discarded: true })
  }

  if (hito.estado === "PAGADO") {
    await descartarIntento({
      pagoMp,
      motivo: MOTIVO_HITO_PAGADO,
      enlacePagoId: enlace?.id ?? null,
      monto: montoArsCents,
    })
    return NextResponse.json({ ok: true, discarded: true })
  }

  // Primer pago exitoso gana: un segundo cobro del mismo hito no se registra.
  const ganador = await prisma.pago.findFirst({
    where: { hitoId: hito.id, estadoPago: "SUCCEEDED" },
    select: { id: true, enlacePagoId: true },
  })
  if (ganador) {
    await descartarIntento({
      pagoMp,
      motivo: MOTIVO_INVALIDACION_OTRO_PAGO,
      enlacePagoId: enlace?.id ?? null,
      pagoId: ganador.id,
      monto: montoArsCents,
    })
    return NextResponse.json({ ok: true, discarded: true })
  }

  const ahora = new Date()
  const descripcion = `${hito.proyecto.titulo} — ${hito.titulo}`
  let resultado: { pagoId: string; enlaceId: string | null }

  try {
    resultado = await prisma.$transaction(async (tx) => {
      let enlaceId = enlace?.id ?? null

      if (estado === "SUCCEEDED") {
        if (enlace) {
          await marcarEnlacePagado(tx, enlace, montoArsCents)
        } else {
          enlaceId = await adoptarEnlaceLegacy(tx, {
            clienteId: hito.proyecto.clienteId,
            hitoId: hito.id,
            suscripcionId: null,
            grupoCobroId,
            concepto: descripcion,
            monto: montoArsCents,
            meses: null,
            url: hito.mpLink,
            expiraEn: hito.mpLinkExpira,
            ahora,
          })
        }
      }

      const pago = await tx.pago.create({
        data: {
          clienteId: hito.proyecto.clienteId,
          hitoId: hito.id,
          enlacePagoId: enlaceId,
          externalId: pagoMp.id,
          monto: montoArsCents,
          montoAcordado: montoArsCents,
          comision: 0,
          montoEsperado: montoArsCents,
          meses: null,
          moneda: "ars",
          cotizacion,
          metodo: "MERCADOPAGO",
          pasarela: "MERCADOPAGO",
          origen: "AUTOMATICO",
          nota: `Link MP · ${hito.titulo}`,
          registradoPor: "Mercado Pago",
          estadoPago: estado,
        },
        select: { id: true },
      })

      if (estado === "SUCCEEDED") {
        const actualizado = await tx.hito.updateMany({
          where: { id: hito.id, estado: "PENDIENTE" },
          data: {
            estado: "PAGADO",
            pagadoEn: ahora,
            mpLink: null,
            mpPreferenceId: null,
            mpLinkExpira: null,
          },
        })
        if (actualizado.count !== 1) {
          throw new ConflictoMp(MOTIVO_HITO_PAGADO)
        }

        await invalidarPaypalHermanos(tx, grupoCobroId, enlaceId, ahora)
      }

      return { pagoId: pago.id, enlaceId }
    })
  } catch (error) {
    if (error instanceof ConflictoMp) {
      await descartarIntento({
        pagoMp,
        motivo: error.motivo,
        enlacePagoId: enlace?.id ?? null,
        monto: montoArsCents,
      })
      return NextResponse.json({ ok: true, discarded: true })
    }
    if (esErrorUnico(error)) {
      const duplicado = await responderDuplicadoPorCarrera({ pagoMp, montoArsCents })
      if (duplicado) return duplicado
    }
    throw error
  }

  await trazarEventoMp({
    eventoId: `MERCADOPAGO:PAGO:${pagoMp.id}`,
    resultado: "PROCESADO",
    externalId: pagoMp.id,
    enlacePagoId: resultado.enlaceId,
    pagoId: resultado.pagoId,
    monto: montoArsCents,
    moneda: "ars",
  })

  if (estado === "SUCCEEDED") {
    await sendPaymentReceipt(
      hito.proyecto.cliente.email,
      hito.proyecto.cliente.nombre,
      montoArsCents,
      "ars",
      descripcion
    )
  }

  logger.info("Webhook MP de hito procesado", {
    paymentId: pagoMp.id,
    hitoId: hito.id,
    enlacePagoId: resultado.enlaceId,
    estado,
    montoArsCents,
  })

  return NextResponse.json({ ok: true })
}

async function procesarSoporte(params: {
  pagoMp: PagoMp
  externalReference: string
  enlacePorId: EnlaceMp | null
  estado: EstadoMp
  montoArsCents: number
  cotizacion: number | null
}): Promise<Response> {
  const { pagoMp, externalReference, enlacePorId, estado, montoArsCents, cotizacion } =
    params

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { id: externalReference },
    include: { cliente: true, servicio: true },
  })
  if (!suscripcion) {
    logger.warn("Webhook MP sin suscripcion asociada", {
      paymentId: pagoMp.id,
      externalReference,
    })
    return NextResponse.json({ ok: true, ignored: true })
  }

  const grupoCobroId = grupoCobroDeSuscripcion(suscripcion.id)
  const enlace = await buscarEnlaceMp(
    enlacePorId,
    grupoCobroId,
    "soporte",
    suscripcion.id
  )

  if (enlace?.estado === "INVALIDADO" || enlace?.estado === "PAGADO") {
    await descartarIntento({
      pagoMp,
      motivo:
        enlace.estado === "INVALIDADO"
          ? MOTIVO_ENLACE_INVALIDADO
          : MOTIVO_ENLACE_PAGADO,
      enlacePagoId: enlace.id,
      monto: montoArsCents,
    })
    return NextResponse.json({ ok: true, discarded: true })
  }

  // El pago de soporte puede repetirse en meses distintos: el link se consume
  // una vez por capture y el `externalId` evita duplicar el mismo pago.
  const meses = normalizarMeses(pagoMp.meses)
  const nota =
    meses > 0
      ? `Link MP · ${meses} ${meses === 1 ? "mes" : "meses"}`
      : "Link MP · solo registro"

  const ahora = new Date()
  const descripcion = tituloLink(suscripcion.servicio.nombre, meses)
  let resultado: { pagoId: string; enlaceId: string | null }

  try {
    resultado = await prisma.$transaction(async (tx) => {
      let enlaceId = enlace?.id ?? null

      if (estado === "SUCCEEDED") {
        if (enlace) {
          await marcarEnlacePagado(tx, enlace, montoArsCents)
        } else {
          enlaceId = await adoptarEnlaceLegacy(tx, {
            clienteId: suscripcion.clienteId,
            hitoId: null,
            suscripcionId: suscripcion.id,
            grupoCobroId,
            concepto: descripcion,
            monto: montoArsCents,
            meses: meses > 0 ? meses : null,
            url: suscripcion.mpLink,
            expiraEn: suscripcion.mpLinkExpira,
            ahora,
          })
        }
      }

      const pago = await tx.pago.create({
        data: {
          clienteId: suscripcion.clienteId,
          suscripcionId: suscripcion.id,
          enlacePagoId: enlaceId,
          externalId: pagoMp.id,
          monto: montoArsCents,
          montoAcordado: montoArsCents,
          comision: 0,
          montoEsperado: montoArsCents,
          meses: meses > 0 ? meses : null,
          moneda: "ars",
          cotizacion,
          metodo: "MERCADOPAGO",
          pasarela: "MERCADOPAGO",
          origen: "AUTOMATICO",
          nota,
          registradoPor: "Mercado Pago",
          estadoPago: estado,
        },
        select: { id: true },
      })

      if (estado === "SUCCEEDED" && meses > 0) {
        await tx.suscripcion.update({
          where: { id: suscripcion.id },
          data: {
            estado: "ACTIVE",
            proximoPago: vencimientoConMeses(
              suscripcion.proximoPago,
              meses,
              ahora
            ),
            pastDueEn: null,
            canceladoEn: null,
          },
        })
      }

      if (estado === "SUCCEEDED") {
        await invalidarPaypalHermanos(tx, grupoCobroId, enlaceId, ahora)
      }

      return { pagoId: pago.id, enlaceId }
    })
  } catch (error) {
    if (error instanceof ConflictoMp) {
      await descartarIntento({
        pagoMp,
        motivo: error.motivo,
        enlacePagoId: enlace?.id ?? null,
        monto: montoArsCents,
      })
      return NextResponse.json({ ok: true, discarded: true })
    }
    if (esErrorUnico(error)) {
      const duplicado = await responderDuplicadoPorCarrera({ pagoMp, montoArsCents })
      if (duplicado) return duplicado
    }
    throw error
  }

  await trazarEventoMp({
    eventoId: `MERCADOPAGO:PAGO:${pagoMp.id}`,
    resultado: "PROCESADO",
    externalId: pagoMp.id,
    enlacePagoId: resultado.enlaceId,
    pagoId: resultado.pagoId,
    monto: montoArsCents,
    moneda: "ars",
  })

  if (estado === "SUCCEEDED") {
    await sendPaymentReceipt(
      suscripcion.cliente.email,
      suscripcion.cliente.nombre,
      montoArsCents,
      "ars",
      suscripcion.servicio.nombre
    )
  }

  logger.info("Webhook MP procesado", {
    paymentId: pagoMp.id,
    status: pagoMp.status,
    suscripcionId: suscripcion.id,
    enlacePagoId: resultado.enlaceId,
    meses,
    estado,
  })

  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = process.env.MP_WEBHOOK_SECRET

    let body: { type?: string; action?: string; data?: { id?: string } } = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
    }

    const dataId = url.searchParams.get("data.id") || body?.data?.id || ""

    if (!secret) {
      // En produccion no se procesa un webhook sin firma: sin el secreto no se
      // puede verificar el origen y un tercero podria simular un pago.
      if (process.env.NODE_ENV === "production") {
        logger.error("Webhook MP rechazado: MP_WEBHOOK_SECRET no configurada")
        return NextResponse.json({ error: "Webhook no configurado" }, { status: 503 })
      }
      logger.warn("MP_WEBHOOK_SECRET no configurada: webhook sin validacion de firma")
    } else {
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.headers.get("x-signature") || "",
          xRequestId: req.headers.get("x-request-id") || "",
          dataId,
          secret,
        })
      } catch (e) {
        if (e instanceof InvalidWebhookSignatureError) {
          logger.warn("Webhook MP con firma invalida", { dataId })
          return NextResponse.json({ error: "Firma invalida" }, { status: 401 })
        }
        throw e
      }
    }

    if (body.type !== "payment" || !dataId) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const pagoMp = await obtenerPagoMp(dataId)
    if (!pagoMp) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const estado = mapearEstadoPagoMp(pagoMp.status)
    if (!estado) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    // Idempotencia por `Pago.externalId` (payment id de MP): un reintento del
    // mismo webhook no crea un segundo pago ni vuelve a acreditar meses.
    const yaRegistrado = await prisma.pago.findUnique({
      where: { externalId: pagoMp.id },
      select: { id: true, enlacePagoId: true },
    })
    if (yaRegistrado) {
      await trazarEventoMp({
        eventoId: `MERCADOPAGO:DUPLICADO:${pagoMp.id}`,
        resultado: "DUPLICADO",
        motivo: MOTIVO_DUPLICADO,
        externalId: pagoMp.id,
        enlacePagoId: yaRegistrado.enlacePagoId,
        pagoId: yaRegistrado.id,
      })
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const montoArsCents = Math.round((pagoMp.transactionAmount ?? 0) * 100)
    if (!Number.isFinite(montoArsCents) || montoArsCents <= 0) {
      logger.warn("Webhook MP sin monto valido", { paymentId: pagoMp.id })
      return NextResponse.json({ ok: true, ignored: true })
    }

    const cotizacion = await getDolarVentaBancoNacion()

    // `enlaceId` de la metadata (T-18) o, en links legacy, el concepto del
    // `externalReference`. Solo se acepta un enlace MERCADOPAGO: un enlaceId de
    // otra pasarela (por ejemplo PayPal) se ignora y nunca recibe el monto ARS.
    const enlacePorIdRaw = pagoMp.enlaceId
      ? await prisma.enlacePago.findUnique({
          where: { id: pagoMp.enlaceId },
          select: SELECT_ENLACE,
        })
      : null
    const enlacePorId = esEnlaceMp(enlacePorIdRaw) ? enlacePorIdRaw : null

    let externalReference = pagoMp.externalReference?.trim() || null
    let tipo = pagoMp.tipo?.trim() || null

    if (!externalReference && enlacePorId) {
      if (enlacePorId.hitoId) {
        externalReference = enlacePorId.hitoId
        tipo = "hito"
      } else if (enlacePorId.suscripcionId) {
        externalReference = enlacePorId.suscripcionId
        tipo = "soporte"
      }
    }

    if (!externalReference) {
      logger.warn("Webhook MP sin external_reference ni enlace asociado", {
        paymentId: pagoMp.id,
      })
      return NextResponse.json({ ok: true, ignored: true })
    }

    const parametros = {
      pagoMp,
      externalReference,
      enlacePorId,
      estado,
      montoArsCents,
      cotizacion,
    }

    if (tipo === "hito") {
      return await procesarHito(parametros)
    }

    return await procesarSoporte(parametros)
  } catch (error) {
    // Error de procesamiento (no un evento ignorado): 500 para que Mercado Pago
    // reintente. No se responde 200, que daria el reintento por consumido.
    Sentry.captureException(error)
    logger.error("Error en webhook MP", { error: String(error) })
    return NextResponse.json(
      { error: "Error procesando el webhook" },
      { status: 500 }
    )
  }
}
