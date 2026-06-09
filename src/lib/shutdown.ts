import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

export function registerShutdown() {
  const shutdown = async (signal: string) => {
    logger.info(`Señal ${signal} recibida. Iniciando shutdown...`)

    const timeout = setTimeout(() => {
      logger.error("Shutdown forzado por timeout")
      process.exit(1)
    }, 10_000)

    try {
      await prisma.$disconnect()
      logger.info("Prisma desconectado")
    } catch (e) {
      logger.error("Error desconectando Prisma", { error: String(e) })
    }

    clearTimeout(timeout)
    logger.info("Shutdown completado")
    process.exit(0)
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}
