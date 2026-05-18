"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Wrench, CreditCard, LogOut, Menu, X } from "lucide-react"

const links = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const sidebar = (
    <>
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
            onClick={() => setOpen(false)}
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
    </>
  )

  return (
    <>
      <button
        className="fixed top-3 left-3 z-50 rounded-lg border border-border bg-bg2 p-2 text-muted hover:text-text lg:hidden"
        onClick={() => setOpen(!open)}
      >
        <Menu size={20} />
      </button>

      <aside className="hidden lg:flex h-screen w-64 flex-col border-r border-border bg-bg2">
        {sidebar}
      </aside>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-bg2 lg:hidden">
            <div className="flex h-16 items-center justify-between border-b border-border px-6">
              <Link href="/admin/dashboard" className="font-display text-lg font-bold text-text">
                PixelArch
              </Link>
              <button className="text-muted hover:text-text" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>
            {sidebar.props.children.slice(1)}
          </aside>
        </>
      )}
    </>
  )
}
