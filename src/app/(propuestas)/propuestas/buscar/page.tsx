import type { Metadata } from "next"
import { TriangleAlert } from "lucide-react"
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
import { PageHeader } from "@/components/propuestas/ui/page-header"

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
      <PageHeader
        eyebrow="Portal interno"
        title="Buscar prospectos"
        description="Definí la consulta, la zona y el rubro de la búsqueda. La campaña queda en borrador hasta que decidas ejecutarla."
      />

      <div
        role="note"
        aria-label="Aviso sobre la creación de campañas"
        className="p-banner p-banner--warn mb-8 max-w-[70ch]"
      >
        <TriangleAlert aria-hidden="true" size={16} className="p-banner-icon" />
        <div className="p-banner-body">
          <p className="p-banner-title">
            Crear una campaña no busca ni envía nada.
          </p>
          <p className="mt-1">
            Solo guarda la configuración de la búsqueda en estado{" "}
            <span className="font-mono text-xs">BORRADOR</span>. La búsqueda en
            Google Places se ejecuta después, de forma explícita, y ningún email
            sale sin aprobación y confirmación humanas.
          </p>
        </div>
      </div>

      <div className="p-form-shell">
        <CampanaForm plantillas={plantillas} />
      </div>
    </div>
  )
}
