"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, Wrench, CreditCard, Menu, X, ExternalLink } from "lucide-react"

const sections = [
  {
    label: "Principal",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
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
        <div key={sec.label} className="mt-2">
          <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-text-faint font-mono">
            {sec.label}
          </p>
          {sec.items.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== "/admin/dashboard" && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavClick}
                className={cn(
                  "mx-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-display transition-colors",
                  isActive
                    ? "bg-violet/12 text-violet"
                    : "text-text-dim hover:bg-panel hover:text-text"
                )}
              >
                <Icon size={15} className="w-[18px] text-center shrink-0" aria-hidden="true" />
                <span className="flex-1">{label}</span>
              </Link>
            )
          })}
        </div>
      ))}
      <div className="mt-auto border-t border-border pt-3 pb-4 px-2">
        <Link
          href="/portal"
          onClick={onNavClick}
          className="mx-2 mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-text-dim hover:bg-panel hover:text-text transition-colors font-display"
        >
          <ExternalLink size={13} />
          Portal Cliente
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
        className="fixed top-3 left-3 z-50 rounded-lg border border-border bg-panel p-2 text-text-dim hover:text-text lg:hidden"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar sidebar" : "Abrir sidebar"}
        aria-expanded={open}
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      <aside className="hidden lg:flex h-screen w-[220px] flex-col border-r border-border bg-panel shrink-0">
        <div className="flex h-full flex-col">
          <Link href="/admin/dashboard" className="px-4 pt-6 pb-4 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#adminLogoGrad)"/>
              <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#adminLogoGrad)" opacity=".5"/>
              <defs>
                <linearGradient id="adminLogoGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#8b5cf6"/>
                  <stop offset="1" stopColor="#22d3ee"/>
                </linearGradient>
              </defs>
            </svg>
            <span className="font-display text-lg font-bold text-text" style={{ position: "relative", display: "inline-block", paddingBottom: "2px", overflow: "hidden" }}>
              Pixel<span className="text-violet">Arch</span>
              <span aria-hidden="true" style={{
                position: "absolute", left: "-45%", bottom: 0, width: "45%", height: "2px",
                background: "linear-gradient(90deg,transparent,#22d3ee,#8b5cf6,transparent)",
                animation: "logo-scan 3.2s ease-in-out infinite",
                pointerEvents: "none",
              }} />
            </span>
          </Link>
          <SidebarNav />
        </div>
      </aside>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col border-r border-border bg-panel lg:hidden">
            <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
                  <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#adminLogoGrad2)"/>
                  <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#adminLogoGrad2)" opacity=".5"/>
                  <defs>
                    <linearGradient id="adminLogoGrad2" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#8b5cf6"/>
                      <stop offset="1" stopColor="#22d3ee"/>
                    </linearGradient>
                  </defs>
                </svg>
                <span className="font-display text-lg font-bold text-text">
                  Pixel<span className="text-violet">Arch</span>
                </span>
              </div>
              <button className="text-text-dim hover:text-text" onClick={() => setOpen(false)} aria-label="Cerrar sidebar">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex h-full flex-col">
              <SidebarNav onNavClick={() => setOpen(false)} />
            </div>
          </aside>
        </>
      )}
    </>
  )
}
