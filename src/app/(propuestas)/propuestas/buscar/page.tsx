import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import {
  CampanaForm,
  type PlantillaOpcion,
} from "@/components/propuestas/campana-form"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Buscar prospectos",
  robots: { index: false, follow: false },
}

/**
 * T-12 (AC-7; RF-9): alta de campana de prospeccion.
 *
 * La pagina solo crea la campana en BORRADOR; no ejecuta Places, no visita
 * webs y no envia nada. Si el esquema aditivo no esta aplicado, falla cerrado
 * con un estado operativo y no renderiza el formulario.
 */
async function cargarPlantillasActivas(): Promise<PlantillaOpcion[] | null> {
  try {
    return await prisma.plantillaPropuesta.findMany({
      where: { activa: true },
      select: { id: true, nombre: true, version: true },
      orderBy: [{ nombre: "asc" }, { version: "desc" }],
    })
  } catch (error) {
    if (esErrorTablaFaltante(error)) return null
    throw error
  }
}

export default async function BuscarProspectosPage() {
  const plantillas = await cargarPlantillasActivas()

  if (plantillas === null) {
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
          Buscar prospectos
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Definí la consulta, la zona y el rubro de la búsqueda. La campaña
          queda en borrador hasta que decidas ejecutarla.
        </p>
      </header>

      <div
        role="note"
        aria-label="Aviso sobre la creación de campañas"
        className="mb-8 max-w-[70ch] rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"
      >
        <p className="text-sm font-medium text-text">
          Crear una campaña no busca ni envía nada.
        </p>
        <p className="mt-1 text-sm leading-6 text-text-dim">
          Solo guarda la configuración de la búsqueda en estado{" "}
          <span className="font-mono text-xs">BORRADOR</span>. La búsqueda en
          Google Places se ejecuta después, de forma explícita, y ningún email
          sale sin aprobación y confirmación humanas.
        </p>
      </div>

      <CampanaForm plantillas={plantillas} />
    </div>
  )
}
