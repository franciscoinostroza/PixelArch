import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { PortalShell } from "@/components/propuestas/portal-shell"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: {
    default: "Propuestas — PixelArch",
    template: "%s — PixelArch",
  },
  robots: { index: false, follow: false },
}

/**
 * T-02 (AC-1, AC-2, AC-3; RF-1, RF-2, RF-4): segunda barrera del portal.
 * Sin sesion se va al gate de Clerk; la asistente vuelve a su inicio del CRM y
 * cualquier otro rol al sitio publico. Nunca se renderiza contenido parcial.
 */
export default async function PropuestasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const resultado = await resolverAdminPropuestas()

  if (!resultado.ok) {
    if (resultado.motivo === "SIN_SESION") {
      redirect("/gate/admin?next=/propuestas")
    }
    redirect(resultado.esAsistente ? "/admin/cobros" : "/")
  }

  return <PortalShell admin={resultado.admin}>{children}</PortalShell>
}
