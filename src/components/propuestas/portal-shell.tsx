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
 */
export function PortalShell({ admin, children }: PortalShellProps) {
  return (
    <div className="min-h-screen bg-bg text-text lg:flex">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-violet focus:px-4 focus:py-2 focus:text-bg"
      >
        Saltar al contenido
      </a>
      <PortalSidebar adminNombre={admin.nombre} />
      <main
        id="portal-main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:ml-64 lg:px-10"
      >
        {children}
      </main>
    </div>
  )
}
