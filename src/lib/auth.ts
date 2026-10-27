import { auth, clerkClient } from "@clerk/nextjs/server"
import type { Cliente } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { esRolStaff, type StaffRole } from "@/lib/roles"

export interface StaffUser {
  userId: string
  nombre: string
  rol: StaffRole
  esAdmin: boolean
  cliente: Cliente | null
}

export async function requireStaff(): Promise<StaffUser | null> {
  const { userId } = await auth()
  if (!userId) return null

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: unknown } | undefined)?.role

  if (!esRolStaff(role)) return null

  const cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
  })

  const nombre =
    cliente?.nombre ||
    user.fullName ||
    user.firstName ||
    (role === "admin" ? "Admin" : "Asistente")

  return {
    userId,
    nombre,
    rol: role,
    esAdmin: role === "admin",
    cliente,
  }
}

export async function requireAdmin() {
  const staff = await requireStaff()
  if (!staff || staff.rol !== "admin") return null

  return (
    staff.cliente ?? {
      id: staff.userId,
      clerkUserId: staff.userId,
      nombre: "Admin",
      email: "",
      activo: true,
    }
  )
}
