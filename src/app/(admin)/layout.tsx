import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role

  if (role !== "admin") redirect("/portal")

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar />
      <main className="flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  )
}
