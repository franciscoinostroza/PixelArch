import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export async function getCurrentCliente() {
  const { userId } = await auth()
  if (!userId) return null

  return prisma.cliente.findUnique({
    where: { clerkUserId: userId },
  })
}

export async function requireAdmin() {
  const { userId } = await auth()
  if (!userId) return null

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: string } | undefined)?.role

  if (role !== "admin") return null

  return prisma.cliente.findUnique({
    where: { clerkUserId: userId },
  })
}
