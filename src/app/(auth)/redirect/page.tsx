import { redirect } from "next/navigation"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { esRolStaff, rutaInicioRol } from "@/lib/roles"

export default async function RedirectPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: unknown } | undefined)?.role

  if (esRolStaff(role)) redirect(rutaInicioRol(role))
  redirect("/")
}
