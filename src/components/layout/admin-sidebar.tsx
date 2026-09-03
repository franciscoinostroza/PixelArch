"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const ICONS: Record<string, string> = {
  dashboard: "▦",
  clientes: "◎",
  servicios: "⚒",
  pagos: "◫",
}

const sections = [
  {
    label: "Principal",
    items: [{ key: "dashboard", href: "/admin/dashboard", label: "Dashboard" }],
  },
  {
    label: "Gestión",
    items: [
      { key: "clientes", href: "/admin/clientes", label: "Clientes" },
      { key: "servicios", href: "/admin/servicios", label: "Productos" },
      { key: "pagos", href: "/admin/pagos", label: "Pagos" },
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
          {sec.items.map(({ key, href, label }) => {
            const isActive = pathname === href || (href !== "/admin/dashboard" && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavClick}
                aria-current={isActive ? "page" : undefined}
                className={cn("a-nav", isActive && "on")}
              >
                <span className="a-ic" aria-hidden="true">{ICONS[key]}</span>
                {label}
              </Link>
            )
          })}
        </div>
      ))}
      <div className="a-spacer" />
      <div className="a-side-foot">
        <Link href="/portal" onClick={onNavClick} className="a-nav">
          <span className="a-ic" aria-hidden="true">↗</span>
          Portal Cliente
        </Link>
      </div>
    </>
  )
}

export function AdminSidebar({ alertasActivas = 0 }: SidebarProps) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button
        className="a-menu"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={open}
      >
        ☰
      </button>

      <aside className={cn("a-side", !open && "a-hidden")} id="admin-sidebar" aria-label="Menú principal">
        <Link href="/admin/dashboard" className="a-logo">
          <span className="a-mark" aria-hidden="true" />
          <span>Pixel<b>Arch</b></span>
        </Link>
        <SidebarNav onNavClick={() => setOpen(false)} />
      </aside>
    </>
  )
}