"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Wrench, CreditCard, LogOut } from "lucide-react"
import { SignOutButton } from "@clerk/nextjs"

const links = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-bg2">
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/admin/dashboard" className="font-display text-lg font-bold text-text">
          PixelArch
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-mono transition-colors",
              pathname === href
                ? "bg-accent/10 text-accent"
                : "text-muted hover:bg-card-bg hover:text-text"
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <Link
          href="/portal"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-mono text-muted hover:bg-card-bg hover:text-text transition-colors"
        >
          <LogOut size={18} />
          Portal Cliente
        </Link>
      </div>
    </aside>
  )
}
