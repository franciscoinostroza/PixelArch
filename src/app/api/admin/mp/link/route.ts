import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { crearLinkDePago } from "@/lib/mercadopago"
import {
  grupoCobroDeHito,
  grupoCobroDeSuscripcion,
  normalizarMeses,
  tituloLink,
} from "@/lib/mp-utils"
import { calcularExpiracionEnlace, generarTokenEnlace } from "@/lib/paypal/utils"

/** Estados que no admiten reutilizacion ni reactivacion. */
const ESTADOS_TERMINALES = ["PAGADO", "INVALIDADO", "VENCIDO"] as const

/**
 * Estados de un enlace MP que se pueden reutilizar (AC-13, AC-20).
 *
 * Decision sobre `FALLIDO`: no se reutiliza. Esa fila conserva el error del
 * intento que no llego a crear la preferencia; el reintento crea una fila
 * nueva para que el historial muestre cada fallo y nunca se reviva un enlace
 * que Mercado Pago rechazo. `INVALIDADO` y `VENCIDO` tampoco se reutilizan: se
 * crea una fila nueva y la anterior queda intacta con su historial.
 */
const ESTADOS_REUTILIZABLES = ["CREANDO", "ACTIVO"] as const

const SELECT_ENLACE_REUTILIZABLE = {
  id: true,
  estado: true,
  url: true,
  checkoutUrl: true,
  externalId: true,
  expiraEn: true,
  montoAcordado: true,
  comision: true,
  total: true,
  moneda: true,
  meses: true,
  feeBps: true,
  feeFixedCents: true,
  concepto: true,
  generadoPor: true,
  generadoPorNombre: true,
  ultimoError: true,
} satisfies Prisma.EnlacePagoSelect

type EnlaceReutilizable = Prisma.EnlacePagoGetPayload<{
  select: typeof SELECT_ENLACE_REUTILIZABLE
}>

/** Snapshot para devolver la fila a su estado anterior si MP falla. */
type SnapshotEnlace = Omit<EnlaceReutilizable, "id">

interface EnlacePreparado {
  id: string
  /** `null` si la fila se creo en este intento (no habia nada que restaurar). */
  anterior: SnapshotEnlace | null
}

interface PrepararEnlaceInput {
  clienteId: string
  hitoId: string | null
  suscripcionId: string | null
  grupoCobroId: string
  concepto: string
  montoArsCents: number
  meses: number | null
  expiraEn: Date
  generadoPor: string
  generadoPorNombre: string | null
}

interface PreferenciaMpInput {
  externalReference: string
  titulo: string
  metadata: Record<string, unknown>
}

/**
 * Prepara el `EnlacePago` de Mercado Pago del concepto.
 *
 * Se reutiliza solo una fila MERCADOPAGO del mismo `grupoCobroId` en estado
 * `CREANDO`/`ACTIVO` (por ejemplo, el link legacy adoptado por T-07) para no
 * duplicar enlaces ni perder el grupo que comparte con PayPal. El token,
 * `url`, `checkoutUrl` y `externalId` anteriores **no se borran** antes de
 * confirmar la preferencia: si Mercado Pago falla se restaura el snapshot.
 */
async function prepararEnlace(input: PrepararEnlaceInput): Promise<EnlacePreparado> {
  const existente = await prisma.enlacePago.findFirst({
    where: {
      grupoCobroId: input.grupoCobroId,
      pasarela: "MERCADOPAGO",
      estado: { in: [...ESTADOS_REUTILIZABLES] },
    },
    orderBy: { creadoEn: "desc" },
    select: SELECT_ENLACE_REUTILIZABLE,
  })

  const datos = {
    clienteId: input.clienteId,
    hitoId: input.hitoId,
    suscripcionId: input.suscripcionId,
    pasarela: "MERCADOPAGO" as const,
    concepto: input.concepto,
    montoAcordado: input.montoArsCents,
    comision: 0,
    total: input.montoArsCents,
    moneda: "ars",
    meses: input.meses,
    feeBps: 0,
    feeFixedCents: 0,
    estado: "CREANDO" as const,
    grupoCobroId: input.grupoCobroId,
    expiraEn: input.expiraEn,
    generadoPor: input.generadoPor,
    generadoPorNombre: input.generadoPorNombre,
    ultimoError: null,
  }

  if (existente) {
    // Reserva condicionada: si el webhook u otro proceso cambio el estado entre
    // la lectura y esta escritura (count 0), no se revive la fila; se crea una
    // nueva conservando la anterior.
    const reservado = await prisma.enlacePago.updateMany({
      where: {
        id: existente.id,
        estado: { in: [...ESTADOS_REUTILIZABLES] },
      },
      data: datos,
    })

    if (reservado.count === 1) {
      const { id, ...anterior } = existente
      return { id, anterior }
    }
  }

  const creado = await prisma.enlacePago.create({
    data: {
      token: generarTokenEnlace(),
      ...datos,
      url: null,
      checkoutUrl: null,
      externalId: null,
    },
    select: { id: true },
  })
  return { id: creado.id, anterior: null }
}

/** Restaura la fila previa (o la marca FALLIDO si era nueva) sin revivirla. */
async function descartarEnlace(
  preparado: EnlacePreparado,
  mensaje: string
): Promise<void> {
  const where = {
    id: preparado.id,
    estado: { notIn: [...ESTADOS_TERMINALES] },
  }

  if (preparado.anterior) {
    await prisma.enlacePago.updateMany({
      where,
      data: preparado.anterior,
    })
    return
  }

  await prisma.enlacePago.updateMany({
    where,
    data: { estado: "FALLIDO", ultimoError: mensaje },
  })
}

/** Confirma la preferencia creada, siempre que el enlace siga vigente. */
async function confirmarEnlace(
  preparado: EnlacePreparado,
  link: { url: string; preferenceId: string },
  expiraEn: Date
): Promise<boolean> {
  const confirmado = await prisma.enlacePago.updateMany({
    where: {
      id: preparado.id,
      estado: { notIn: [...ESTADOS_TERMINALES] },
    },
    data: {
      externalId: link.preferenceId,
      url: link.url,
      checkoutUrl: link.url,
      estado: "ACTIVO",
      expiraEn,
      ultimoError: null,
    },
  })
  return confirmado.count === 1
}

type ResultadoGeneracion =
  | { ok: true; enlaceId: string; link: { url: string; preferenceId: string } }
  | { ok: false; enlaceId: string | null; motivo: "NO_CONFIGURADO" | "CONFLICTO" }

/**
 * Genera la preferencia y confirma el enlace. Si Mercado Pago falla, restaura
 * el snapshot anterior; si el enlace fue pagado/invalidado durante la creacion,
 * no se pisa ese estado.
 */
async function generarEnlaceMp(
  input: PrepararEnlaceInput,
  preferencia: PreferenciaMpInput
): Promise<ResultadoGeneracion> {
  const preparado = await prepararEnlace(input)

  let link: { url: string; preferenceId: string } | null = null
  try {
    link = await crearLinkDePago({
      externalReference: preferencia.externalReference,
      titulo: preferencia.titulo,
      montoArsCents: input.montoArsCents,
      metadata: { ...preferencia.metadata, enlaceId: preparado.id },
      expiraEn: input.expiraEn,
    })
  } catch (error) {
    await descartarEnlace(preparado, "No se pudo generar el link de Mercado Pago.")
    throw error
  }

  if (!link) {
    await descartarEnlace(preparado, "Mercado Pago no esta configurado.")
    return { ok: false, enlaceId: preparado.id, motivo: "NO_CONFIGURADO" }
  }

  const confirmado = await confirmarEnlace(preparado, link, input.expiraEn)
  if (!confirmado) {
    return { ok: false, enlaceId: preparado.id, motivo: "CONFLICTO" }
  }

  return { ok: true, enlaceId: preparado.id, link }
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-mp-link:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  let body: { suscripcionId?: string; hitoId?: string; meses?: unknown; montoArsCents?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
  }

  const { suscripcionId, hitoId } = body
  const montoArsCents = Math.round(Number(body.montoArsCents))

  if (!suscripcionId && !hitoId) {
    return NextResponse.json({ error: "suscripcionId o hitoId requerido" }, { status: 400 })
  }
  if (!Number.isFinite(montoArsCents) || montoArsCents <= 0) {
    return NextResponse.json({ error: "Monto invalido" }, { status: 400 })
  }

  let enlaceId: string | null = null
  let linkUrl: string | null = null

  // `requireStaff` busca el Cliente por `clerkUserId`, asi que `clerkUserId` es
  // siempre el userId de Clerk (T-08); nunca se persiste el id del Cliente.
  const generadoPor = admin.clerkUserId ?? admin.id

  try {
    const expiraEn = calcularExpiracionEnlace()

    if (hitoId) {
      const hito = await prisma.hito.findUnique({
        where: { id: hitoId },
        include: { proyecto: { include: { servicio: { select: { nombre: true } } } } },
      })
      if (!hito) return NextResponse.json({ error: "Hito no encontrado" }, { status: 404 })

      const concepto = `${hito.proyecto.titulo} — ${hito.titulo}`
      const generado = await generarEnlaceMp(
        {
          clienteId: hito.proyecto.clienteId,
          hitoId: hito.id,
          suscripcionId: null,
          grupoCobroId: grupoCobroDeHito(hito.id),
          concepto,
          montoArsCents,
          meses: null,
          expiraEn,
          generadoPor,
          generadoPorNombre: admin.nombre,
        },
        { externalReference: hito.id, titulo: concepto, metadata: { tipo: "hito" } }
      )

      if (!generado.ok) {
        return respuestaGeneracion(generado.motivo)
      }

      enlaceId = generado.enlaceId
      linkUrl = generado.link.url
      await prisma.hito.update({
        where: { id: hito.id },
        data: {
          mpLink: generado.link.url,
          mpPreferenceId: generado.link.preferenceId,
          mpLinkExpira: expiraEn,
        },
      })
    } else {
      const meses = normalizarMeses(body.meses)
      const suscripcion = await prisma.suscripcion.findUnique({
        where: { id: suscripcionId },
        include: { servicio: { select: { nombre: true } } },
      })
      if (!suscripcion) {
        return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
      }

      const concepto = tituloLink(suscripcion.servicio.nombre, meses)
      const generado = await generarEnlaceMp(
        {
          clienteId: suscripcion.clienteId,
          hitoId: null,
          suscripcionId: suscripcion.id,
          grupoCobroId: grupoCobroDeSuscripcion(suscripcion.id),
          concepto,
          montoArsCents,
          meses: meses > 0 ? meses : null,
          expiraEn,
          generadoPor,
          generadoPorNombre: admin.nombre,
        },
        {
          externalReference: suscripcion.id,
          titulo: concepto,
          metadata: { tipo: "soporte", meses },
        }
      )

      if (!generado.ok) {
        return respuestaGeneracion(generado.motivo)
      }

      enlaceId = generado.enlaceId
      linkUrl = generado.link.url
      await prisma.suscripcion.update({
        where: { id: suscripcion.id },
        data: {
          mpLink: generado.link.url,
          mpPreferenceId: generado.link.preferenceId,
          mpLinkExpira: expiraEn,
          mpLinkMeses: meses,
        },
      })
    }

    logger.info("Link de pago MP generado", {
      suscripcionId: suscripcionId || null,
      hitoId: hitoId || null,
      enlaceId,
      montoArsCents,
      staffId: generadoPor,
    })

    return NextResponse.json({ ok: true, url: linkUrl })
  } catch (error) {
    logger.error("Error generando link MP", {
      error: String(error),
      suscripcionId,
      hitoId,
      enlaceId,
    })
    return NextResponse.json({ error: "Error al generar el link de pago" }, { status: 500 })
  }
}

/**
 * Respuesta de error comun cuando la generacion no pudo confirmar el enlace.
 * `CONFLICTO` significa que otro proceso (por ejemplo el webhook) pago o
 * invalido el enlace durante la creacion: no se revive ni se toca el concepto.
 */
function respuestaGeneracion(
  motivo: "NO_CONFIGURADO" | "CONFLICTO"
): NextResponse {
  if (motivo === "CONFLICTO") {
    return NextResponse.json(
      { error: "El enlace cambio de estado durante la generacion. Reintenta." },
      { status: 409 }
    )
  }

  return NextResponse.json(
    { error: "Mercado Pago no está configurado (falta MP_ACCESS_TOKEN)" },
    { status: 503 }
  )
}
