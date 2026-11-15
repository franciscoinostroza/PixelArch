import type { ReactNode } from "react"
import type { AdminPropuestas } from "@/lib/propuestas/auth"
import { PortalSidebar } from "@/components/propuestas/portal-sidebar"

interface PortalShellProps {
  admin: AdminPropuestas
  children: ReactNode
}

/**
 * T-02 (AC-3; RF-1): shell propio del portal, separado del layout del CRM.
 * No renderiza navegacion de clientes, cobros, pagos, servicios ni blog.
 *
 * FASE 1 "PixelArch Console": wrapper `.p-portal` con shell, sidebar y main
 * propios, sin depender de utilidades del CRM.
 */
export function PortalShell({ admin, children }: PortalShellProps) {
  return (
    <div className="p-portal">
      <a href="#portal-main" className="p-skip-link">
        Saltar al contenido
      </a>
      <div className="p-shell">
        <PortalSidebar adminNombre={admin.nombre} />
        <main id="portal-main" tabIndex={-1} className="p-main">
          <div className="p-main-inner">{children}</div>
        </main>
      </div>
    </div>
  )
}
