import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { paddle } from "@/lib/payments"
import { sendPaymentFailed, sendSubscriptionCanceled } from "@/lib/notifications"

export const dynamic = "force-dynamic"

async function stopDeploy(deploymentId: string, platform: string) {
  try {
    if (platform === "railway") {
      const token = process.env.RAILWAY_API_TOKEN
      if (!token) return console.log("RAILWAY_API_TOKEN no configurado")
      await fetch(`https://backboard.railway.app/graphql/v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          query: `mutation { serviceDelete(id: "${deploymentId}") }`,
        }),
      })
    } else if (platform === "vercel") {
      const token = process.env.VERCEL_API_TOKEN
      if (!token) return console.log("VERCEL_API_TOKEN no configurado")
      const res = await fetch(`https://api.vercel.com/v9/projects/${deploymentId}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) console.error("Vercel pause error:", await res.text())
    }
  } catch (e) {
    console.error(`Error deteniendo deploy ${deploymentId}:`, e)
  }
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret")
  if (secret !== process.env.SANITY_REVALIDATE_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const now = new Date()
  const haceDias = (dias: number) => new Date(now.getTime() - dias * 86400000)
  const corteEn = haceDias(30)
  const advertenciaEn = haceDias(23)

  const aCortar = await prisma.suscripcion.findMany({
    where: {
      estado: "PAST_DUE",
      actualizadoEn: { lte: corteEn },
    },
    include: { cliente: true, servicio: true },
  })

  const aAdvertir = await prisma.suscripcion.findMany({
    where: {
      estado: "PAST_DUE",
      actualizadoEn: { lte: advertenciaEn, gt: corteEn },
    },
    include: { cliente: true, servicio: true },
  })

  let cortadas = 0
  let advertidas = 0
  let deployDetenidos = 0

  for (const s of aCortar) {
    try {
      if (s.paddleSubscriptionId) {
        await paddle().subscriptions.cancel(s.paddleSubscriptionId)
      }
      await prisma.suscripcion.update({
        where: { id: s.id },
        data: { estado: "CANCELED", canceladoEn: new Date() },
      })

      if (s.deploymentId && s.deploymentPlatform) {
        await stopDeploy(s.deploymentId, s.deploymentPlatform)
        deployDetenidos++
      }

      await sendSubscriptionCanceled(s.cliente.email, s.cliente.nombre, s.servicio.nombre)
      cortadas++
    } catch (e) {
      console.error(`Error cortando ${s.id}:`, e)
    }
  }

  for (const s of aAdvertir) {
    try {
      await sendPaymentFailed(s.cliente.email, s.cliente.nombre, s.servicio.nombre)
      advertidas++
    } catch (e) {
      console.error(`Error advirtiendo ${s.id}:`, e)
    }
  }

  return NextResponse.json({
    ok: true,
    cortadas,
    advertidas,
    deployDetenidos,
    timestamp: now.toISOString(),
  })
}
