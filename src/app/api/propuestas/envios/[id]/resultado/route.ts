/**
 * POST /api/propuestas/envios/[id]/resultado (T-18; AC-29, AC-31, AC-36;
 * RF-43, RF-49, RF-50, RF-56).
 *
 * Registro manual del resultado de un email ya enviado. v1 no usa webhooks de
 * Resend; el admin registra la respuesta, el rebote duro o la queja.
 *
 * - `RESPONDIDO`: envio `RESPONDIDO` y prospecto `RESPONDIO`.
 * - `REBOTE_DURO` / `QUEJA`: envio `REBOTADO` / `QUEJA`, supresion global
 *   `EMAIL` por hash del **destinatario enviado** (idempotente por clave),
 *   cancelacion de los BORRADOR/APROBADO pendientes del prospecto y marca
 *   `SUPRIMIDO` solo si el email actual del prospecto coincide con ese
 *   destinatario. Si el prospecto cambio de email, se conserva su ficha y el
 *   email nuevo; el rebote solo suprime la direccion que reboto.
 * - Sin retry automatico, sin llamadas a Resend y sin PII en logs.
 *
 * Solo se acepta un envio `ENVIADO` o ya en el mismo estado final (repeticion
 * idempotente). Cualquier otro estado responde 409 sin escribir. Si el envio
 * ya esta en el estado final pedido, la repeticion no escribe nada: no
 * reactiva una supresion revocada, no cancela borradores nuevos y no agrega
 * historial.
 */

import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import { normalizarEmail } from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import { agregarEntradaHistorial } from "@/lib/propuestas/prospectos"
import { crearSupresion } from "@/lib/propuestas/supresiones"
import { normalizarEstadoEnvio } from "@/lib/propuestas/transiciones"
import { envioResultadoSchema } from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const VENTANA_MS = 60_000

const ESTADOS_COHERENTES: Record<
  "RESPONDIDO" | "REBOTE_DURO" | "QUEJA",
  { final: "RESPONDIDO" | "REBOTADO" | "QUEJA"; permitidos: string[] }
> = {
  RESPONDIDO: { final: "RESPONDIDO", permitidos: ["ENVIADO", "RESPONDIDO"] },
  REBOTE_DURO: { final: "REBOTADO", permitidos: ["ENVIADO", "REBOTADO"] },
  QUEJA: { final: "QUEJA", permitidos: ["ENVIADO", "QUEJA"] },
}

class ResultadoAbortado extends Error {
  constructor() {
    super("Resultado abortado.")
    this.name = "ResultadoAbortado"
  }
}

function json(
  cuerpo: unknown,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(cuerpo, {
    status,
    headers: { ...NO_STORE, ...headers },
  })
}

function errorJson(
  status: number,
  codigo: CodigoError,
  headers: Record<string, string> = {},
): NextResponse {
  const { mensaje } = sanitizarError(null, { codigo })
  return json({ error: mensaje, codigo }, status, headers)
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

/** Redaccion de `detalle`: sin emails, URLs con token, credenciales ni secretos. */
function detalleSanitizado(detalle: string | undefined): string | null {
  if (typeof detalle !== "string") return null
  const limpio = detalle.trim()
  if (limpio.length === 0) return null

  const sanitizado = sanitizarError(limpio, {
    codigo: "VALIDACION",
    mensaje: limpio,
  })

  return sanitizado.mensaje.length > 0 ? sanitizado.mensaje : null
}

function cargarEnvio(id: string) {
  return prisma.envioPropuesta.findUnique({
    where: { id },
    select: {
      id: true,
      prospectoId: true,
      destinatario: true,
      estado: true,
    },
  })
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: { id: true, email: true, estado: true, historial: true },
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await resolverAdminPropuestas()
  if (!admin.ok) {
    return admin.motivo === "SIN_SESION"
      ? errorJson(401, "NO_AUTORIZADO")
      : errorJson(403, "PROHIBIDO")
  }

  const config = configPropuestas()

  if (config.urlPublica !== null && !origenPermitido(req, config.urlPublica)) {
    return errorJson(403, "ORIGEN_INVALIDO")
  }

  const limiteAdmin = rateLimitDetalle(
    `propuestas:${admin.admin.userId}`,
    LIMITE_ADMIN,
    VENTANA_MS,
  )
  if (!limiteAdmin.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteAdmin.retryAfterSegundos),
    })
  }

  const limiteIp = rateLimitDetalle(
    `propuestas:ip:${ipDe(req)}`,
    LIMITE_IP,
    VENTANA_MS,
  )
  if (!limiteIp.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteIp.retryAfterSegundos),
    })
  }

  const { id } = await params
  const adminId = admin.admin.userId

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = envioResultadoSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  const { tipo } = parsed.data
  const detalle = detalleSanitizado(parsed.data.detalle)
  const coherencia = ESTADOS_COHERENTES[tipo]

  try {
    const envio = await cargarEnvio(id)
    if (!envio) return errorJson(404, "NO_ENCONTRADO")

    const estadoActual = normalizarEstadoEnvio(envio.estado)
    if (estadoActual === null || !coherencia.permitidos.includes(estadoActual)) {
      logger.info("Resultado rechazado por estado", {
        envioId: id,
        adminId,
        estado: envio.estado,
      })
      return errorJson(409, "ESTADO")
    }

    const prospecto = await cargarProspecto(envio.prospectoId)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    const ahora = new Date()
    // Repeticion idempotente: el envio ya esta en el estado final pedido.
    // No se vuelve a escribir nada: ni transicion, ni supresion, ni
    // cancelacion de pendientes, ni historial. En particular, repetir un
    // rebote/queja no reactiva una supresion revocada despues.
    const yaFinal = estadoActual === coherencia.final

    if (yaFinal) {
      logger.info("Resultado repetido sin cambios", {
        envioId: envio.id,
        adminId,
        resultado: coherencia.final,
      })

      return tipo === "RESPONDIDO"
        ? json({ estado: "RESPONDIDO", suprimido: false }, 200)
        : json({ estado: coherencia.final, suprimido: true }, 200)
    }

    if (tipo === "RESPONDIDO") {
      await prisma.$transaction(async (tx) => {
        const actualizado = await tx.envioPropuesta.updateMany({
          where: { id: envio.id, estado: "ENVIADO" },
          data: { estado: "RESPONDIDO" },
        })
        if (actualizado.count === 0) throw new ResultadoAbortado()

        await tx.prospecto.updateMany({
          where: { id: prospecto.id, estado: "ENVIADO" },
          data: {
            estado: "RESPONDIO",
            ultimaInteraccionEn: ahora,
            actualizadoPor: adminId,
          },
        })
      })

      logger.info("Resultado respondido registrado", {
        envioId: envio.id,
        prospectoId: prospecto.id,
        adminId,
      })

      return json({ estado: "RESPONDIDO", suprimido: false }, 200)
    }

    // Rebote duro o queja: la supresion es **siempre** por el destinatario
    // enviado, no por el email actual del prospecto. Si el prospecto cambio de
    // direccion despues del envio, se suprime la direccion que reboto y se
    // conserva la ficha con su email nuevo.
    const destinatario = normalizarEmail(envio.destinatario)
    if (destinatario === null) {
      return errorJson(409, "SIN_EMAIL")
    }

    if (config.secreto === null) {
      return errorJson(503, "NO_CONFIGURADO")
    }

    // T-20: la supresion se crea con el mismo helper que el alta manual
    // (misma clave `EMAIL:<hash>`, mismo hash/enmascarado e idempotencia).
    // El destinatario es el del envio, no el email actual del prospecto.
    const secreto = config.secreto
    const motivo = tipo === "REBOTE_DURO" ? "REBOTE_DURO" : "QUEJA"

    const emailActual = normalizarEmail(prospecto.email ?? "")
    const coincide = emailActual !== null && emailActual === destinatario

    // Solo el primer registro deja entrada de historial. No se guarda el
    // detalle libre (puede contener datos personales), solo el tipo de
    // resultado.
    const historial = agregarEntradaHistorial(prospecto.historial, {
      accion: "RESULTADO_ENVIO",
      motivo,
      por: adminId,
      en: ahora.toISOString(),
    })

    await prisma.$transaction(async (tx) => {
      const actualizado = await tx.envioPropuesta.updateMany({
        where: { id: envio.id, estado: "ENVIADO" },
        data: { estado: coherencia.final },
      })
      if (actualizado.count === 0) throw new ResultadoAbortado()

      // Un resultado nuevo (envio ENVIADO) puede crear la supresion o, si la
      // fila estaba revocada, reactivarla dejando entrada REACTIVADA. Una
      // repeticion yaFinal retorna antes y nunca llega a este punto.
      await crearSupresion(
        {
          ambito: "EMAIL",
          email: destinatario,
          motivo,
          origen: "MANUAL",
          notas: detalle,
          creadaPor: adminId,
          creadaPorNombre: admin.admin.nombre,
          secreto,
        },
        { cliente: tx },
      )

      await tx.envioPropuesta.updateMany({
        where: {
          prospectoId: prospecto.id,
          estado: { in: ["BORRADOR", "APROBADO"] },
        },
        data: {
          estado: "CANCELADO",
          motivoCancelacion: "SUPRESION",
        },
      })

      if (coincide) {
        await tx.prospecto.updateMany({
          where: { id: prospecto.id, estado: { not: "SUPRIMIDO" } },
          data: {
            estado: "SUPRIMIDO",
            historial: historial as unknown as Prisma.InputJsonValue,
            ultimaInteraccionEn: ahora,
            actualizadoPor: adminId,
          },
        })
      } else {
        // El email nuevo no reboto: no se marca SUPRIMIDO. Se deja
        // trazabilidad del resultado y se conserva el email actual.
        await tx.prospecto.updateMany({
          where: { id: prospecto.id },
          data: {
            historial: historial as unknown as Prisma.InputJsonValue,
            ultimaInteraccionEn: ahora,
            actualizadoPor: adminId,
          },
        })
      }
    })

    logger.info("Resultado de supresion registrado", {
      envioId: envio.id,
      prospectoId: prospecto.id,
      adminId,
      resultado: coherencia.final,
      prospectoSuprimido: coincide,
    })

    return json({ estado: coherencia.final, suprimido: true }, 200)
  } catch (error) {
    if (error instanceof ResultadoAbortado) {
      logger.info("Resultado abortado por estado", { envioId: id, adminId })
      return errorJson(409, "ESTADO")
    }

    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error registrando resultado de envio", {
      codigo: sanitizado.codigo,
      envioId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
