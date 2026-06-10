import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  if (req.headers.get("x-revalidate-secret") !== process.env.SANITY_REVALIDATE_SECRET) {
    logger.warn("Revalidate attempt with invalid secret")
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    revalidatePath("/", "layout")
    logger.info("Revalidation triggered")
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error("Error en revalidation", { error: String(error) })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
