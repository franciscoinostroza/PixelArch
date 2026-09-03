"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Wrench, CreditCard, ExternalLink, Menu, X } from "lucide-react"

const sections = [
  {
    label: "Principal",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Gestión",
    items: [
      { href: "/admin/clientes", label: "Clientes", icon: Users },
      { href: "/admin/servicios", label: "Productos", icon: Wrench },
      { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
    ],
  },
]

interface SidebarProps {
  alertasActivas?: number
}

function SidebarNav({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname()
  return (
    <>
      {sections.map((sec) => (
        <div key={sec.label}>
          <p className="a-sec">{sec.label}</p>
          {sec.items.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== "/admin/dashboard" && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavClick}
                className={cn("a-nav", isActive && "on")}
              >
                <Icon size={16} className="a-ic" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            )
          })}
        </div>
      ))}
      <div className="a-spacer" />
      <div className="a-side-foot">
        <Link href="/portal" onClick={onNavClick} className="a-nav">
          <ExternalLink size={15} className="a-ic" aria-hidden="true" />
          <span>Portal Cliente</span>
        </Link>
      </div>
    </>
  )
}

export function AdminSidebar({ alertasActivas = 0 }: SidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="a-burger"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar sidebar" : "Abrir sidebar"}
        aria-expanded={open}
      >
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
      </button>

      <aside className="a-side">
        <Link href="/admin/dashboard" className="a-logo">
          <span className="a-mark" aria-hidden="true" />
          <span>Pixel<span style={{ color: "#8b5cf6" }}>Arch</span></span>
        </Link>
        <SidebarNav />
      </aside>

      {open && (
        <aside
          className="a-side"
          style={{ display: "flex", zIndex: 40, background: "rgba(17,14,26,0.96)" }}
          aria-label="Menú de navegación"
        >
          <div className="flex items-center justify-between">
            <Link href="/admin/dashboard" className="a-logo" onClick={() => setOpen(false)}>
              <span className="a-mark" aria-hidden="true" />
              <span>Pixel<span style={{ color: "#8b5cf6" }}>Arch</span></span>
            </Link>
          </div>
          <SidebarNav onNavClick={() => setOpen(false)} />
        </aside>
      )}
    </>
  )
}
