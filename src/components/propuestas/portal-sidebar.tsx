"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const SECCIONES = [
  { href: "/propuestas", label: "Panel", exacta: true },
  { href: "/propuestas/buscar", label: "Buscar", exacta: false },
  { href: "/propuestas/bandeja", label: "Bandeja", exacta: false },
  { href: "/propuestas/plantillas", label: "Plantillas", exacta: false },
  { href: "/propuestas/envios", label: "Envíos", exacta: false },
  { href: "/propuestas/supresiones", label: "Supresiones", exacta: false },
] as const

function esActiva(pathname: string, href: string, exacta: boolean): boolean {
  if (exacta) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function PortalSidebar({ adminNombre }: { adminNombre: string }) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  return (
    <aside className="border-b border-border bg-panel/80 p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/propuestas"
          className="flex items-center gap-2 text-base font-semibold text-text"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 rounded-md bg-gradient-to-br from-violet to-cyan"
          />
          <span>
            PixelArch <span className="text-violet">Propuestas</span>
          </span>
        </Link>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-dim lg:hidden"
          aria-expanded={abierto}
          aria-controls="portal-nav"
          onClick={() => setAbierto((valor) => !valor)}
        >
          Menú
        </button>
      </div>

      <nav
        id="portal-nav"
        aria-label="Secciones del portal"
        className={cn("mt-6 space-y-1", !abierto && "hidden lg:block")}
      >
        {SECCIONES.map((seccion) => {
          const activa = esActiva(pathname, seccion.href, seccion.exacta)
          return (
            <Link
              key={seccion.href}
              href={seccion.href}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-white/5 hover:text-text",
                activa && "bg-violet-soft text-text",
              )}
            >
              {seccion.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-8 border-t border-border pt-4 lg:mt-auto">
        <p className="text-sm font-medium text-text">{adminNombre}</p>
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
          Administrador
        </p>
        <Link
          href="/admin/dashboard"
          className="mt-3 inline-flex text-xs text-text-dim underline-offset-4 hover:text-text hover:underline"
        >
          Volver al CRM
        </Link>
      </div>
    </aside>
  )
}
