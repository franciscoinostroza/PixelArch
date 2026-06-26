import { logger } from "@/lib/logger"

const RAILWAY_API = "https://backboard.railway.com/graphql/v2"
const VERCEL_API = "https://api.vercel.com"

async function railwayRequest(query: string) {
  const token = process.env.RAILWAY_API_TOKEN
  if (!token) {
    logger.warn("RAILWAY_API_TOKEN no configurado")
    return
  }
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text()
    logger.error("Error en Railway API", { status: res.status, body: text })
  }
}

async function vercelRequest(method: string, path: string, body?: unknown) {
  const token = process.env.VERCEL_API_TOKEN
  if (!token) {
    logger.warn("VERCEL_API_TOKEN no configurado")
    return
  }
  const res = await fetch(`${VERCEL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    logger.error("Error en Vercel API", { status: res.status, body: text })
  }
}

export async function pauseDeploy(platform: string, serviceId: string): Promise<void> {
  if (!serviceId || !platform) return

  if (platform === "railway") {
    await railwayRequest(`mutation { serviceInstanceUpdate(input: { serviceId: "${serviceId}", numReplicas: 0 }) { id } }`)
    logger.info("Deploy pausado en Railway", { serviceId })
  } else if (platform === "vercel") {
    await vercelRequest("POST", `/v1/projects/${serviceId}/scale`, { max: 0 })
    logger.info("Deploy pausado en Vercel", { serviceId })
  } else {
    logger.warn("Plataforma no soportada para pausar deploy", { platform })
  }
}

export async function resumeDeploy(platform: string, serviceId: string): Promise<void> {
  if (!serviceId || !platform) return

  if (platform === "railway") {
    await railwayRequest(`mutation { serviceInstanceUpdate(input: { serviceId: "${serviceId}", numReplicas: 1 }) { id } }`)
    logger.info("Deploy reanudado en Railway", { serviceId })
  } else if (platform === "vercel") {
    await vercelRequest("POST", `/v1/projects/${serviceId}/scale`, { max: 1 })
    logger.info("Deploy reanudado en Vercel", { serviceId })
  } else {
    logger.warn("Plataforma no soportada para reanudar deploy", { platform })
  }
}
