import { redirect } from "next/navigation"
import { auth, clerkClient } from "@clerk/nextjs/server"

export default async function RedirectPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const role = (user.publicMetadata as { role?: string } | undefined)?.role

  if (role === "admin") redirect("/admin/dashboard")
  redirect("/portal")
}
