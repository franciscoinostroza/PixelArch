import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import SpaceCanvas from "@/components/layout/space-canvas"

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
    <div className="relative flex min-h-screen">
      <SpaceCanvas />

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

      <div className="relative z-10 flex w-full">
        <AdminSidebar alertasActivas={alertasVencidos} />
        <main className="min-w-0 flex-1 overflow-x-hidden px-6 py-12 lg:pl-[250px] lg:pr-10" style={{ position: "relative" }}>
          {children}
        </main>
      </div>
    </div>
  )
}
