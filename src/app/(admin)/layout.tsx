import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import StaticAmbience from "@/components/layout/static-ambience"
import "./admin.css"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()
  if (!admin) redirect("/admin")

  const en7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const [alertasSoportes, alertasHitos] = await Promise.all([
    prisma.suscripcion.count({
      where: {
        OR: [
          { estado: "PAST_DUE" },
          { estado: "ACTIVE", proximoPago: { lte: en7dias } },
        ],
      },
    }),
    prisma.hito.count({
      where: { estado: "PENDIENTE", vencimiento: { not: null, lte: en7dias } },
    }),
  ])
  const alertasCobros = alertasSoportes + alertasHitos

  return (
    <div className="relative min-h-screen">
      <StaticAmbience />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-40 top-[-10%] z-[1] h-[500px] w-[500px] rounded-full blur-[130px]"
        style={{ background: "rgba(139,92,246,0.16)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-40 bottom-[-10%] z-[1] h-[400px] w-[400px] rounded-full blur-[130px]"
        style={{ background: "rgba(34,211,238,0.10)" }}
      />

      <div className="relative z-10 a-shell">
        <AdminSidebar alertasActivas={alertasCobros} />
        <main className="a-main">{children}</main>
      </div>
    </div>
  )
}
