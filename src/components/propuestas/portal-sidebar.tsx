"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  FileText,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Menu,
  Search,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/propuestas/ui/status-pill"

interface SeccionPortal {
  href: string
  label: string
  exacta: boolean
  Icono: LucideIcon
}

const SECCIONES: readonly SeccionPortal[] = [
  { href: "/propuestas", label: "Panel", exacta: true, Icono: LayoutDashboard },
  {
    href: "/propuestas/campanas",
    label: "Campañas",
    exacta: false,
    Icono: Megaphone,
  },
  { href: "/propuestas/buscar", label: "Buscar", exacta: false, Icono: Search },
  { href: "/propuestas/bandeja", label: "Bandeja", exacta: false, Icono: Inbox },
  {
    href: "/propuestas/plantillas",
    label: "Plantillas",
    exacta: false,
    Icono: FileText,
  },
  {
    href: "/propuestas/envios",
    label: "Envíos",
    exacta: false,
    Icono: Send,
  },
  {
    href: "/propuestas/supresiones",
    label: "Supresiones",
    exacta: false,
    Icono: Ban,
  },
]

function esActiva(pathname: string, href: string, exacta: boolean): boolean {
  if (exacta) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Marca() {
  return (
    <span className="p-brand">
      <span aria-hidden="true" className="p-brand-mark" />
      <span className="p-brand-text">
        <span className="p-brand-word">PixelArch</span>
        <span className="p-brand-sub">Propuestas</span>
      </span>
    </span>
  )
}

export function PortalSidebar({ adminNombre }: { adminNombre: string }) {
  const pathname = usePathname()
  // El drawer queda atado al pathname actual: al navegar se cierra solo.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null)
  const abierto = abiertoEn === pathname

  const cerrar = () => setAbiertoEn(null)
  const alternar = () =>
    setAbiertoEn((actual) => (actual === pathname ? null : pathname))

  useEffect(() => {
    if (!abierto) return

    const alPresionar = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbiertoEn(null)
    }

    document.addEventListener("keydown", alPresionar)

    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = "hidden"

    // Si la ventana pasa a desktop con el drawer abierto, se cierra y se
    // libera el scroll. `matchMedia` puede no existir en jsdom.
    const consultaDesktop = window.matchMedia?.("(min-width: 900px)")
    const alCambiarVentana = () => {
      if (consultaDesktop?.matches) setAbiertoEn(null)
    }
    consultaDesktop?.addEventListener("change", alCambiarVentana)

    return () => {
      document.removeEventListener("keydown", alPresionar)
      consultaDesktop?.removeEventListener("change", alCambiarVentana)
      document.body.style.overflow = overflowPrevio
    }
  }, [abierto])

  return (
    <>
      <aside className={cn("p-sidebar", abierto && "is-open")}>
        <div className="p-sidebar-bar">
          <Link
            href="/propuestas"
            className="p-sidebar-brand-link"
            aria-label="PixelArch Propuestas"
          >
            <Marca />
          </Link>
          <button
            type="button"
            className="p-menu-btn"
            aria-expanded={abierto}
            aria-controls="portal-nav"
            onClick={alternar}
          >
            <Menu size={16} aria-hidden="true" />
            <span>Menú</span>
          </button>
        </div>

        <div className={cn("p-sidebar-drawer", abierto && "is-open")}>
          <Link
            href="/propuestas"
            className="p-sidebar-brand-link"
            aria-label="PixelArch Propuestas"
            onClick={cerrar}
          >
            <Marca />
          </Link>

          <nav
            id="portal-nav"
            aria-label="Secciones del portal"
            className="p-nav"
          >
            {SECCIONES.map((seccion) => {
              const activa = esActiva(pathname, seccion.href, seccion.exacta)
              const Icono = seccion.Icono

              return (
                <Link
                  key={seccion.href}
                  href={seccion.href}
                  aria-current={activa ? "page" : undefined}
                  className="p-nav-link"
                  onClick={cerrar}
                >
                  <Icono size={17} aria-hidden="true" className="p-nav-icon" />
                  <span>{seccion.label}</span>
                </Link>
              )
            })}
          </nav>

          <div className="p-sidebar-footer">
            <div className="p-sidebar-identity">
              <p className="p-sidebar-name">{adminNombre}</p>
              <p className="p-sidebar-role">Administrador</p>
            </div>

            <StatusPill tone="violet" className="p-sidebar-badge">
              <ShieldCheck size={12} aria-hidden="true" />
              Aprobación manual
            </StatusPill>

            <div className="p-sidebar-links">
              <Link href="/" className="p-sidebar-link" onClick={cerrar}>
                <ExternalLink size={13} aria-hidden="true" />
                Ver sitio
              </Link>
              <Link
                href="/admin/dashboard"
                className="p-sidebar-link"
                onClick={cerrar}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                Volver al CRM
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {abierto ? (
        <button
          type="button"
          className="p-overlay"
          aria-label="Cerrar navegación"
          onClick={cerrar}
        />
      ) : null}
    </>
  )
}
