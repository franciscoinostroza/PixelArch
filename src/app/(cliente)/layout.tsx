import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PortalNav } from "@/components/ui/portal-nav"
import { UserChip } from "@/components/ui/user-chip"
import { prisma } from "@/lib/prisma"

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const cliente = userId
    ? await prisma.cliente.findUnique({
        where: { clerkUserId: userId },
        select: { nombre: true },
      })
    : null

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg2">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/portal"
            className="font-display text-lg font-bold text-text"
          >
            Pixel<span className="text-accent">Arch</span>
          </Link>
          <PortalNav />
          <UserChip nombre={cliente?.nombre} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  )
}
