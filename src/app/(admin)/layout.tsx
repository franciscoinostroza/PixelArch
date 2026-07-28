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
    <div className="flex min-h-screen bg-bg" style={{ position: "relative" }}>
      <div className="section-glow section-glow--violet" style={{ width: "500px", height: "500px", left: "-150px", top: "-10%", opacity: 0.5 }} aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "400px", height: "400px", right: "-120px", bottom: "-5%", opacity: 0.4 }} aria-hidden="true" />
      <AdminSidebar alertasActivas={alertasVencidos} />
      <main className="flex-1 overflow-x-hidden p-8" style={{ position: "relative", zIndex: 1 }}>{children}</main>
    </div>
  )
}
