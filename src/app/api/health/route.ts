import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  let dbStatus = "untested"
  if (process.env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`
      dbStatus = "ok"
    } catch {
      dbStatus = "error"
    }
  }

  return NextResponse.json({
    status: dbStatus === "error" ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    db: dbStatus,
  })
}
