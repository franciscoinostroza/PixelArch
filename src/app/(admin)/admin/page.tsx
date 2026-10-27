import { requireStaff } from "@/lib/auth"
import { rutaInicioRol } from "@/lib/roles"
import { redirect } from "next/navigation"

export default async function AdminIndexPage() {
  const staff = await requireStaff()
  if (!staff) redirect("/")

  redirect(rutaInicioRol(staff.rol))
}
