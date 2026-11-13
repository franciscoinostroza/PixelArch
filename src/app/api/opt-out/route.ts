/**
 * POST /api/opt-out (T-19; AC-16, AC-33, AC-34, AC-35; RF-51, RF-52, RF-56).
 *
 * Baja publica one-click. Es la unica API publica de escritura del portal y no
 * requiere sesion:
 *
 * - Rate limit 10/min por IP y 5/min por token. La clave del token es su
 *   SHA-256, nunca el token en claro (`node:crypto`).
 * - Acepta el token por query (`?token=...`, formato de `List-Unsubscribe`) o
 *   por body JSON `{ token }`. Un POST one-click sin body tambien funciona.
 * - Un token ausente, malformado o con firma invalida responde igual que uno
 *   valido: 200 generico, sin mutar y sin revelar si el email/prospecto existia.
 * - Con token valido crea/actualiza la supresion global `EMAIL:<hash>` con
 *   motivo `OPT_OUT` y origen `ENLACE`, cancela solo los envios
 *   BORRADOR/APROBADO cuyo destinatario coincide con el hash del token (si el
 *   prospecto cambio de email, los pendientes del email nuevo no se tocan) y
 *   marca `SUPRIMIDO` solo si el email actual del prospecto coincide con ese
 *   hash. Si no coincide (o el prospecto ya no existe), la supresion global
 *   sigue bloqueando el email del token.
 * - Idempotente por `clave` de supresion. No hay PII, email ni token en la
 *   respuesta ni en los logs. GET no muta.
 * - Si falta el secreto/configuracion se falla cerrado con la misma respuesta
 *   generica, para no revelar el estado de la configuracion ni del token.
 */

import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { configPropuestas } from "@/lib/propuestas/config"
import { sanitizarError } from "@/lib/propuestas/errores"
import { normalizarEmail } from "@/lib/propuestas/normalizar"
import { agregarEntradaHistorial } from "@/lib/propuestas/prospectos"
import {
  claveSupresionEmail,
  emailEnmascarado,
  hashEmail,
  verificarTokenBaja,
} from "@/lib/propuestas/supresion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LIMITE_IP = 10
const LIMITE_TOKEN = 5
const VENTANA_MS = 60_000
const MAX_BODY = 4096

/** Headers comunes: la respuesta nunca se cachea ni se indexa. */
const HEADERS_SEGUROS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
}

function respuestaGenerica(
  status: 200 | 202 = 200,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { ok: true },
    { status, headers: { ...HEADERS_SEGUROS, ...headers } },
  )
}

function respuestaRateLimit(segundos: number): NextResponse {
  const { mensaje } = sanitizarError(null, { codigo: "RATE_LIMIT" })

  return NextResponse.json(
    { error: mensaje, codigo: "RATE_LIMIT" },
    {
      status: 429,
      headers: {
        ...HEADERS_SEGUROS,
        "Retry-After": String(segundos),
      },
    },
  )
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  if (primera && primera.length > 0) return primera

  const real = req.headers.get("x-real-ip")?.trim()
  return real && real.length > 0 ? real : "unknown"
}

function tokenLimpio(valor: unknown): string | null {
  if (typeof valor !== "string") return null

  const token = valor.trim()
  return token.length > 0 ? token : null
}

function tokenDeQuery(req: Request): string | null {
  try {
    return tokenLimpio(new URL(req.url).searchParams.get("token"))
  } catch {
    return null
  }
}

/**
 * `true` si la ultima entrada del historial ya es un opt-out. Evita inflar el
 * historial cuando el destinatario confirma dos veces el mismo enlace.
 */
function ultimaEntradaEsOptOut(historial: unknown): boolean {
  if (!Array.isArray(historial) || historial.length === 0) return false

  const ultima = historial[historial.length - 1]
  if (!ultima || typeof ultima !== "object" || Array.isArray(ultima)) {
    return false
  }

  return (ultima as { accion?: unknown }).accion === "OPT_OUT"
}

/**
 * El body JSON es opcional: el one-click de `List-Unsubscribe` usa el token en
 * la query. Cualquier body que no sea JSON valido o que exceda el limite se
 * ignora (la solicitud sigue siendo generica y no muta nada).
 */
async function tokenDeBody(req: Request): Promise<string | null> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase()
  if (!contentType.includes("application/json")) return null

  const declarado = Number(req.headers.get("content-length") ?? "")
  if (Number.isFinite(declarado) && declarado > MAX_BODY) return null

  try {
    const texto = await req.text()
    if (texto.length === 0 || texto.length > MAX_BODY) return null

    const data: unknown = JSON.parse(texto)
    if (!data || typeof data !== "object" || Array.isArray(data)) return null

    return tokenLimpio((data as { token?: unknown }).token)
  } catch {
    return null
  }
}

/** GET no lee ni muta: la baja solo se confirma con POST. */
export function GET(): NextResponse {
  return NextResponse.json(
    { error: "Método no permitido." },
    {
      status: 405,
      headers: { ...HEADERS_SEGUROS, Allow: "POST" },
    },
  )
}

export async function POST(req: Request): Promise<NextResponse> {
  const limiteIp = rateLimitDetalle(
    `opt-out:ip:${ipDe(req)}`,
    LIMITE_IP,
    VENTANA_MS,
  )
  if (!limiteIp.permitido) {
    return respuestaRateLimit(limiteIp.retryAfterSegundos)
  }

  const token = tokenDeQuery(req) ?? (await tokenDeBody(req))

  if (token !== null) {
    // La ventana por token usa solo un hash: el token en claro nunca se guarda
    // como clave de rate limit.
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex")
    const limiteToken = rateLimitDetalle(
      `opt-out:token:${tokenHash}`,
      LIMITE_TOKEN,
      VENTANA_MS,
    )
    if (!limiteToken.permitido) {
      return respuestaRateLimit(limiteToken.retryAfterSegundos)
    }
  }

  const secreto = configPropuestas().secreto

  // Sin secreto no se puede verificar el HMAC ni calcular el hash de supresion:
  // se responde igual que cualquier solicitud bien formada y no se muta nada.
  if (secreto === null) {
    logger.warn("Baja publica sin configuracion", { codigo: "NO_CONFIGURADO" })
    return respuestaGenerica(202)
  }

  if (token === null) return respuestaGenerica()

  const verificacion = verificarTokenBaja(token, secreto)
  if (!verificacion.ok) return respuestaGenerica()

  const { prospectoId, emailHash } = verificacion
  const clave = claveSupresionEmail(emailHash)

  try {
    const prospecto = await prisma.prospecto.findUnique({
      where: { id: prospectoId },
      select: { id: true, email: true, estado: true, historial: true },
    })

    const emailActual = prospecto?.email ? normalizarEmail(prospecto.email) : null
    const coincide =
      emailActual !== null && hashEmail(emailActual, secreto) === emailHash
    const enmascarado =
      coincide && prospecto?.email ? emailEnmascarado(prospecto.email) : null

    const ahora = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.supresionProspecto.upsert({
        where: { clave },
        create: {
          ambito: "EMAIL",
          clave,
          emailHash,
          emailEnmascarado:
            enmascarado !== null && enmascarado.length > 0 ? enmascarado : null,
          motivo: "OPT_OUT",
          origen: "ENLACE",
          activa: true,
        },
        // Repetir la baja es idempotente: no se pisa el motivo original ni se
        // duplica la fila; una supresion revocada vuelve a quedar activa.
        update: {
          activa: true,
          revocadaPor: null,
          revocadaEn: null,
          motivoRevocacion: null,
        },
      })

      // T-19: la baja cancela solo los pendientes del email del token. Se
      // comparan los destinatarios normalizados contra `emailHash` (HMAC) y se
      // actualizan unicamente los ids coincidentes: si el prospecto cambio de
      // direccion, los envios pendientes del email nuevo no se tocan. El email
      // en claro no se guarda ni se loguea.
      const pendientes = await tx.envioPropuesta.findMany({
        where: {
          prospectoId,
          estado: { in: ["BORRADOR", "APROBADO"] },
        },
        select: { id: true, destinatario: true },
      })

      const idsACancelar = pendientes
        .filter((envio) => {
          const destinatario = normalizarEmail(envio.destinatario)
          if (destinatario === null) return false
          return hashEmail(destinatario, secreto) === emailHash
        })
        .map((envio) => envio.id)

      // Sin coincidencias no se ejecuta el updateMany: no hay envios que
      // cancelar (incluye el caso de un prospecto inexistente).
      const cancelados =
        idsACancelar.length > 0
          ? await tx.envioPropuesta.updateMany({
              where: {
                id: { in: idsACancelar },
                estado: { in: ["BORRADOR", "APROBADO"] },
              },
              data: {
                estado: "CANCELADO",
                motivoCancelacion: "SUPRESION",
              },
            })
          : { count: 0 }

      if (!prospecto) return

      const canceladosCount = cancelados?.count ?? 0
      const cambiaEstado = coincide && prospecto.estado !== "SUPRIMIDO"
      const yaRegistrado = ultimaEntradaEsOptOut(prospecto.historial)

      // Repetir el mismo POST no vuelve a escribir si no hay transicion de
      // estado, envios cancelados ni una entrada de opt-out pendiente.
      if (!cambiaEstado && canceladosCount === 0 && yaRegistrado) return

      const historial = yaRegistrado
        ? prospecto.historial
        : agregarEntradaHistorial(prospecto.historial, {
            accion: "OPT_OUT",
            por: "ENLACE",
            en: ahora.toISOString(),
            motivo: "ENLACE",
          })

      if (coincide) {
        await tx.prospecto.updateMany({
          where: { id: prospecto.id, estado: { not: "SUPRIMIDO" } },
          data: {
            estado: "SUPRIMIDO",
            historial: historial as unknown as Prisma.InputJsonValue,
            ultimaInteraccionEn: ahora,
            actualizadoPor: "ENLACE",
          },
        })
      } else {
        // El token corresponde a un email anterior: se conserva la ficha y su
        // email actual. La supresion global ya bloquea la direccion del token.
        await tx.prospecto.updateMany({
          where: { id: prospecto.id },
          data: {
            historial: historial as unknown as Prisma.InputJsonValue,
            ultimaInteraccionEn: ahora,
            actualizadoPor: "ENLACE",
          },
        })
      }
    })

    logger.info("Baja publica procesada", {
      prospectoId,
      suprimido: coincide,
    })

    return respuestaGenerica()
  } catch (error) {
    // Un fallo de base no debe distinguir un token valido de uno invalido: se
    // responde igual y se registra solo el codigo sanitizado (sin PII).
    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error procesando baja publica", {
      codigo: sanitizado.codigo,
      prospectoId,
    })

    return respuestaGenerica()
  }
}
