import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

export function registerShutdown() {
  const shutdown = async (signal: string) => {
    logger.info(`Señal ${signal} recibida. Iniciando shutdown...`)

    const timeout = setTimeout(() => {
      logger.error("Shutdown forzado por timeout")
      process.exit(1)
    }, 10_000)

    let exitCode = 0
    try {
      await prisma.$disconnect()
      logger.info("Prisma desconectado")
    } catch (e) {
      logger.error("Error desconectando Prisma", { error: String(e) })
      exitCode = 1
    }

    clearTimeout(timeout)
    logger.info("Shutdown completado")
    process.exit(exitCode)
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}
