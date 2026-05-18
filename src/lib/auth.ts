import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export async function getCurrentCliente() {
  const { userId } = await auth()
  if (!userId) return null

  return prisma.cliente.findUnique({
    where: { clerkUserId: userId },
  })
}

export async function requireAdmin() {
  const { userId, sessionClaims } = await auth()
  if (!userId) return null

  const role = sessionClaims?.role as string | undefined
  if (role !== "admin") return null

  return prisma.cliente.findUnique({
    where: { clerkUserId: userId },
  })
}
