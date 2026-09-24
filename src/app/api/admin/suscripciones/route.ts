import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { pauseDeploy, resumeDeploy } from "@/lib/deploy"
import { logger } from "@/lib/logger"
import { siguienteVencimiento } from "@/lib/pagos"

export async function PATCH(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(`admin-susc:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 })

  try {
    const body = await req.json()
    const { suscripcionId, accion } = body

    if (!suscripcionId) {
      return NextResponse.json({ error: "suscripcionId requerido" }, { status: 400 })
    }

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      select: { id: true, proximoPago: true, deploymentPlatform: true, platformServiceId: true },
    })
    if (!suscripcion) {
      return NextResponse.json({ error: "Suscripcion no encontrada" }, { status: 404 })
    }

    const now = new Date()

    switch (accion) {
      case "update-deploy": {
        const { deploymentId, deploymentPlatform, platformServiceId } = body
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { deploymentId: deploymentId || null, deploymentPlatform: deploymentPlatform || null, platformServiceId: platformServiceId || null },
        })
        break
      }

      case "pause-deploy": {
        if (suscripcion.deploymentPlatform && suscripcion.platformServiceId) {
          await pauseDeploy(suscripcion.deploymentPlatform, suscripcion.platformServiceId)
        }
        break
      }

      case "resume-deploy": {
        if (suscripcion.deploymentPlatform && suscripcion.platformServiceId) {
          await resumeDeploy(suscripcion.deploymentPlatform, suscripcion.platformServiceId)
        }
        break
      }

      case "activar": {
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: {
            estado: "ACTIVE",
            proximoPago: suscripcion.proximoPago ?? siguienteVencimiento(null, now),
            pastDueEn: null,
            canceladoEn: null,
            cancelAtPeriodEnd: false,
          },
        })
        break
      }

      case "pausar": {
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "PAUSED" },
        })
        if (body.pausarDeploy === true && suscripcion.deploymentPlatform && suscripcion.platformServiceId) {
          await pauseDeploy(suscripcion.deploymentPlatform, suscripcion.platformServiceId)
        }
        break
      }

      case "reactivar": {
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: {
            estado: "ACTIVE",
            canceladoEn: null,
            pastDueEn: null,
            proximoPago: suscripcion.proximoPago ?? siguienteVencimiento(null, now),
          },
        })
        if (body.reanudarDeploy !== false && suscripcion.deploymentPlatform && suscripcion.platformServiceId) {
          await resumeDeploy(suscripcion.deploymentPlatform, suscripcion.platformServiceId)
        }
        break
      }

      case "cancelar": {
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "CANCELED", canceladoEn: now },
        })
        if (body.pausarDeploy === true && suscripcion.deploymentPlatform && suscripcion.platformServiceId) {
          await pauseDeploy(suscripcion.deploymentPlatform, suscripcion.platformServiceId)
        }
        break
      }

      case "marcar-vencido": {
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { estado: "PAST_DUE", pastDueEn: now },
        })
        break
      }

      case "set-precio": {
        const precio = Number(body.precioCustom)
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { precioCustom: Number.isFinite(precio) && precio > 0 ? Math.round(precio) : null },
        })
        break
      }

      case "fijar-vencimiento": {
        const fecha = body.fecha ? new Date(body.fecha) : null
        if (!fecha || Number.isNaN(fecha.getTime())) {
          return NextResponse.json({ error: "Fecha invalida" }, { status: 400 })
        }
        await prisma.suscripcion.update({
          where: { id: suscripcionId },
          data: { proximoPago: fecha },
        })
        break
      }

      default:
        return NextResponse.json({ error: "Accion no valida" }, { status: 400 })
    }

    logger.info("Suscripcion accion ejecutada", { suscripcionId, accion, adminId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("suscripcion action error", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}