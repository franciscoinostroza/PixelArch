import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  const alertasVencidos = await prisma.suscripcion.count({
    where: { estado: "PAST_DUE" },
  })

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar alertasActivas={alertasVencidos} />
      <main className="flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  )
}
