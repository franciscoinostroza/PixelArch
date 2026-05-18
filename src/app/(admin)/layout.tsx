import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { redirect } from "next/navigation"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: string } | undefined)?.role

  if (role !== "admin") redirect("/portal")

  const admin = userId
    ? await prisma.cliente.findUnique({
        where: { clerkUserId: userId },
        select: { nombre: true, email: true },
      })
    : null

  const alertasVencidos = await prisma.suscripcion.count({
    where: { estado: "PAST_DUE" },
  })

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar
        nombreAdmin={admin?.nombre}
        emailAdmin={admin?.email}
        alertasActivas={alertasVencidos}
      />
      <main className="flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  )
}
