"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { AdminUserButton } from "@/components/layout/admin-user-button"
import { rutaInicioRol, type StaffRole } from "@/lib/roles"

const ICONS: Record<string, string> = {
  dashboard: "▦",
  clientes: "◎",
  cobros: "◷",
  servicios: "⚒",
  pagos: "◫",
  blog: "📝",
}

interface NavItem {
  key: string
  href: string
  label: string
  soloAdmin: boolean
}

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Principal",
    items: [{ key: "dashboard", href: "/admin/dashboard", label: "Dashboard", soloAdmin: true }],
  },
  {
    label: "Gestión",
    items: [
      { key: "clientes", href: "/admin/clientes", label: "Clientes", soloAdmin: false },
      { key: "cobros", href: "/admin/cobros", label: "Cobros", soloAdmin: false },
      { key: "servicios", href: "/admin/servicios", label: "Productos", soloAdmin: true },
      { key: "pagos", href: "/admin/pagos", label: "Pagos", soloAdmin: false },
      { key: "blog", href: "/admin/blog", label: "Blog", soloAdmin: true },
    ],
  },
]

interface SidebarProps {
  alertasActivas?: number
  rol?: StaffRole
}

function SidebarNav({
  onNavClick,
  alertasActivas = 0,
  rol = "admin",
}: {
  onNavClick?: () => void
  alertasActivas?: number
  rol?: StaffRole
}) {
  const pathname = usePathname()
  return (
    <>
      {sections.map((sec) => {
        const items = sec.items.filter((item) => rol === "admin" || !item.soloAdmin)
        if (items.length === 0) return null

        return (
          <div key={sec.label}>
            <p className="a-sec">{sec.label}</p>
            {items.map(({ key, href, label }) => {
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
                  {key === "cobros" && alertasActivas > 0 && (
                    <span className="a-nav-badge">{alertasActivas}</span>
                  )}
                </Link>
              )
            })}
          </div>
        )
      })}
      <div className="a-spacer" />
      <div className="a-side-foot">
        <AdminUserButton />
      </div>
    </>
  )
}

export function AdminSidebar({ alertasActivas = 0, rol = "admin" }: SidebarProps) {
  const [open, setOpen] = useState(true)

  const handleNavClick = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setOpen(false)
    }
  }

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
        <Link href={rutaInicioRol(rol)} className="a-logo">
          <span className="a-mark" aria-hidden="true" />
          <span>Pixel<b>Arch</b></span>
        </Link>
        <SidebarNav onNavClick={handleNavClick} alertasActivas={alertasActivas} rol={rol} />
      </aside>
    </>
  )
}
