import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import {
  EstadoOperativo,
  EstadoVacio,
} from "@/components/propuestas/estado-vacio"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Panel de propuestas",
  robots: { index: false, follow: false },
}

/**
 * T-02 (AC-1, AC-3, AC-6; RF-1, RF-4): dashboard vacio del portal.
 *
 * Antes de mostrar cualquier accion comprueba que el esquema aditivo este
 * aplicado. Si falta la tabla, falla cerrado con un estado operativo y no
 * renderiza formularios ni datos.
 */
async function esquemaDisponible(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "CampanaProspeccion" LIMIT 1`
    return true
  } catch (error) {
    if (esErrorTablaFaltante(error)) return false
    throw error
  }
}

export default async function PropuestasDashboardPage() {
  const disponible = await esquemaDisponible()

  if (!disponible) {
    return (
      <EstadoOperativo
        codigo={CODIGO_ESQUEMA_NO_APLICADO}
        titulo="Esquema no aplicado"
        descripcion="El portal queda deshabilitado hasta que se aplique el esquema de propuestas. No se muestran datos ni formularios."
        fecha={new Date()}
      />
    )
  }

  return (
    <div>
      <header className="mb-8 max-w-[65ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Portal interno
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-text">
          Propuestas
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Prospección asistida, borradores y envíos con aprobación manual. Este
          portal está separado del CRM.
        </p>
      </header>

      <EstadoVacio
        titulo="Todavía no hay campañas"
        descripcion="Cuando crees la primera búsqueda vas a ver acá el estado de las campañas, la cola de revisión y el consumo del día."
      />
    </div>
  )
}
