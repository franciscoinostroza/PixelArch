"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Wrench, CreditCard, Menu, X, AlertTriangle, ExternalLink } from "lucide-react"

const sections = [
  {
    label: "Principal",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Gestion",
    items: [
      { href: "/admin/clientes", label: "Clientes", icon: Users },
      { href: "/admin/servicios", label: "Servicios", icon: Wrench },
      { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
    ],
  },
]

interface SidebarProps {
  nombreAdmin?: string
  emailAdmin?: string
  alertasActivas?: number
}

export function AdminSidebar({ nombreAdmin, emailAdmin, alertasActivas = 0 }: SidebarProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const iniciales = nombreAdmin
    ? nombreAdmin.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "PA"

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/admin/dashboard" className="px-4 pt-6 pb-4">
        <p className="font-display text-lg font-bold text-text">
          Pixel<span className="text-accent">Arch</span>
        </p>
      </Link>

      {sections.map((sec) => (
        <div key={sec.label} className="mt-2">
          <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-[#4a5568] font-mono">
            {sec.label}
          </p>
          {sec.items.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== "/admin/dashboard" && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  "mx-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-mono transition-colors",
                  isActive
                    ? "bg-accent/12 text-[#a78bfa]"
                    : "text-muted hover:bg-card-bg hover:text-text"
                )}
              >
                <Icon size={15} className="w-[18px] text-center shrink-0" />
                <span className="flex-1">{label}</span>
                {href === "/admin/pagos" && alertasActivas > 0 && (
                  <span className="rounded-full bg-red-500/20 px-1.5 py-px text-[10px] text-red-300 font-mono">
                    {alertasActivas}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}

      <div className="mt-auto border-t border-border pt-3 pb-4 px-2">
        {mounted && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-accent/20 font-display text-xs font-bold text-[#a78bfa]">
              {iniciales}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-text truncate">{nombreAdmin || "Admin"}</p>
              <p className="text-[10px] text-[#4a5568] truncate">{emailAdmin || ""}</p>
            </div>
          </div>
        )}
        <Link
          href="/portal"
          className="mx-2 mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-muted hover:bg-card-bg hover:text-text transition-colors font-mono"
        >
          <ExternalLink size={13} />
          Portal Cliente
        </Link>
      </div>
    </div>
  )

  return (
    <>
      <button
        className="fixed top-3 left-3 z-50 rounded-lg border border-border bg-bg2 p-2 text-muted hover:text-text lg:hidden"
        onClick={() => setOpen(!open)}
      >
        <Menu size={20} />
      </button>

      <aside className="hidden lg:flex h-screen w-[220px] flex-col border-r border-border bg-bg2 shrink-0">
        {sidebar}
      </aside>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col border-r border-border bg-bg2 lg:hidden">
            <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
              <p className="font-display text-lg font-bold text-text">
                Pixel<span className="text-accent">Arch</span>
              </p>
              <button className="text-muted hover:text-text" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {sidebar.props.children.slice(1)}
          </aside>
        </>
      )}
    </>
  )
}
