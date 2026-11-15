import type { Metadata } from "next"
import Link from "next/link"
import { FileText } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { PlantillaForm } from "@/components/propuestas/plantilla-form"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { StatusPill } from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Plantillas",
  robots: { index: false, follow: false },
}

/**
 * T-16 (AC-22; RF-34, RF-37): lista de plantillas activas + alta.
 *
 * Server component de solo lectura salvo el formulario cliente. Muestra la
 * versión activa de cada plantilla y sus variables permitidas. Si el esquema
 * aditivo no está aplicado, falla cerrado sin datos ni formularios.
 *
 * FASE 3b "PixelArch Console": cabecera y tarjetas de panel con variables como
 * chips; el alta vive en un panel "Nueva plantilla".
 */

const CLASE_ENLACE =
  "underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function variablesDe(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((item): item is string => typeof item === "string")
}

function cargarPlantillasActivas() {
  return prisma.plantillaPropuesta.findMany({
    where: { activa: true },
    select: {
      id: true,
      nombre: true,
      idioma: true,
      asunto: true,
      variablesPermitidas: true,
      version: true,
      actualizadoEn: true,
    },
    orderBy: [{ nombre: "asc" }, { version: "desc" }],
    take: 100,
  })
}

export default async function PlantillasPage() {
  let plantillas: Awaited<ReturnType<typeof cargarPlantillasActivas>>

  try {
    plantillas = await cargarPlantillasActivas()
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return (
        <EstadoOperativo
          codigo={CODIGO_ESQUEMA_NO_APLICADO}
          titulo="Esquema no aplicado"
          descripcion="El portal queda deshabilitado hasta que se aplique el esquema de propuestas. No se muestran datos ni formularios."
          fecha={new Date()}
        />
      )
    }
    throw error
  }

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Plantillas"
        description="Redacción determinista con variables de lista blanca y datos verificados. Editar una plantilla crea una versión nueva: no hay HTML arbitrario, LLM ni envíos desde esta página."
      />

      <section aria-label="Plantillas activas" className="mb-8">
        <h2 className="mb-3 font-display text-xl font-semibold text-text">
          Activas ({plantillas.length})
        </h2>

        {plantillas.length === 0 ? (
          <div role="status" className="p-empty">
            <span className="p-empty-icon" aria-hidden="true">
              <FileText size={20} />
            </span>
            <p className="p-empty-description">
              Todavía no hay plantillas activas. Creá la primera con el
              formulario de abajo; no se envía ningún email.
            </p>
          </div>
        ) : (
          <ul className="p-list">
            {plantillas.map((plantilla) => {
              const variables = variablesDe(plantilla.variablesPermitidas)

              return (
                <li
                  key={plantilla.id}
                  className="p-panel p-template-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-semibold text-text">
                        <Link
                          href={`/propuestas/plantillas/${encodeURIComponent(
                            plantilla.id,
                          )}`}
                          className={CLASE_ENLACE}
                        >
                          {plantilla.nombre}
                        </Link>
                      </h3>
                      <p className="mt-1 break-words text-sm leading-6 text-text-dim">
                        {plantilla.asunto}
                      </p>
                    </div>
                    <StatusPill tone="violet">
                      {`v${plantilla.version} · ${plantilla.idioma}`}
                    </StatusPill>
                  </div>

                  <dl className="p-meta-grid mt-4">
                    <div>
                      <dt className="p-detail-term">Variables permitidas</dt>
                      <dd className="p-detail-value flex flex-wrap items-center gap-1.5">
                        {variables.length === 0 ? (
                          <span className="text-text-dim">Sin variables</span>
                        ) : (
                          variables.map((variable) => (
                            <code key={variable} className="p-code">
                              {`{{${variable}}}`}
                            </code>
                          ))
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Actualizada</dt>
                      <dd className="p-detail-value">
                        {formatearFechaHoraPortal(plantilla.actualizadoEn)}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Panel aria-label="Alta de plantilla" title="Nueva plantilla">
        <PlantillaForm />
      </Panel>
    </div>
  )
}
