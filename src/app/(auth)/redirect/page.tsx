import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

export default async function RedirectPage() {
  const { sessionClaims } = await auth()
  const role = sessionClaims?.role as string | undefined

  if (role === "admin") redirect("/admin/dashboard")
  redirect("/portal")
}
