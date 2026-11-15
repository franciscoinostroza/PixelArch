import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EyeOff } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  datosPlantillaDesdeProspecto,
  type CampanaParaPlantilla,
  type ProspectoParaPlantilla,
} from "@/lib/propuestas/envios"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import {
  PlantillaInvalidaError,
  renderPlantilla,
  type SalidaPlantilla,
} from "@/lib/propuestas/plantillas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import {
  PlantillaForm,
  type PlantillaEditable,
} from "@/components/propuestas/plantilla-form"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { StatusPill } from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Plantilla",
  robots: { index: false, follow: false },
}

/**
 * T-16 (AC-22; RF-34, RF-37): editor/versionado y vista previa real.
 *
 * La vista previa usa un prospecto real con email (nunca datos inventados) y
 * el mismo `renderPlantilla` del borrador. Si no hay prospectos con email se
 * muestra un estado vacío. El HTML de la vista previa sale de
 * `textoAHtmlSeguro`: todo el texto está escapado y no se interpreta HTML
 * arbitrario. No se envía nada ni se llama a un proveedor.
 *
 * FASE 3b "PixelArch Console": cabecera con eyebrow único, editor y vista
 * previa en paneles, con el score del prospecto una sola vez en la región de
 * vista previa.
 */

const CLASE_ENLACE =
  "break-all underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function variablesDe(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((item): item is string => typeof item === "string")
}

function cargarPlantilla(id: string) {
  return prisma.plantillaPropuesta.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      idioma: true,
      asunto: true,
      cuerpo: true,
      variablesPermitidas: true,
      version: true,
      activa: true,
      creadaPorNombre: true,
      actualizadoEn: true,
    },
  })
}

function cargarProspectoPrevia() {
  return prisma.prospecto.findFirst({
    where: {
      email: { not: null },
      estado: { notIn: ["SUPRIMIDO", "DESCARTADO"] },
    },
    orderBy: [{ score: "desc" }, { creadoEn: "desc" }],
    select: {
      id: true,
      nombreNegocio: true,
      ciudad: true,
      rubro: true,
      sitioWeb: true,
      contactoNombre: true,
      score: true,
      auditoriaResumen: true,
      campanaOrigen: { select: { rubro: true, zona: true } },
    },
  })
}

export default async function PlantillaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let plantilla: Awaited<ReturnType<typeof cargarPlantilla>>
  let prospecto: Awaited<ReturnType<typeof cargarProspectoPrevia>>

  try {
    const [plantillaCargada, prospectoCargado] = await Promise.all([
      cargarPlantilla(id),
      cargarProspectoPrevia(),
    ])
    plantilla = plantillaCargada
    prospecto = prospectoCargado
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

  if (!plantilla) notFound()

  const variables = variablesDe(plantilla.variablesPermitidas)
  const editable: PlantillaEditable = {
    id: plantilla.id,
    nombre: plantilla.nombre,
    idioma: plantilla.idioma,
    asunto: plantilla.asunto,
    cuerpo: plantilla.cuerpo,
    variablesPermitidas: variables,
    version: plantilla.version,
  }

  let previa: SalidaPlantilla | null = null
  let errorPrevia: string | null = null

  if (prospecto) {
    try {
      const datos = datosPlantillaDesdeProspecto(
        prospecto as ProspectoParaPlantilla,
        prospecto.campanaOrigen as CampanaParaPlantilla,
        { remitenteNombre: configPropuestas().fromNombre },
      )
      previa = renderPlantilla(
        {
          asunto: plantilla.asunto,
          cuerpo: plantilla.cuerpo,
          variablesPermitidas: variables,
          version: plantilla.version,
        },
        datos,
      )
    } catch (error) {
      if (error instanceof PlantillaInvalidaError) {
        errorPrevia =
          "La versión guardada no se puede renderizar con los datos reales del prospecto. Revisá el asunto y las variables antes de usarla."
      } else {
        throw error
      }
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={`Plantilla · v${plantilla.version} · ${
          plantilla.activa ? "activa" : "inactiva"
        }`}
        title={plantilla.nombre}
        description={
          <>
            <p>
              Guardar crea una versión nueva y desactiva esta. Los borradores ya
              creados conservan su snapshot y no se envían desde acá.
            </p>
            <p className="mt-3">
              <Link href="/propuestas/plantillas" className={CLASE_ENLACE}>
                Volver a plantillas
              </Link>
            </p>
            <p className="mt-2 text-xs text-text-dim">
              Última actualización:{" "}
              {formatearFechaHoraPortal(plantilla.actualizadoEn)}
              {plantilla.creadaPorNombre
                ? ` · ${plantilla.creadaPorNombre}`
                : ""}
            </p>
          </>
        }
        status={<StatusPill>{plantilla.idioma}</StatusPill>}
      />

      <div className="p-split">
        <Panel
          aria-label="Editor de la plantilla"
          title="Editar y versionar"
        >
          <PlantillaForm plantilla={editable} />
        </Panel>

        <Panel
          aria-label="Vista previa con un prospecto real"
          title="Vista previa con un prospecto real"
        >
          {!prospecto ? (
            <div role="status" className="p-empty">
              <span className="p-empty-icon" aria-hidden="true">
                <EyeOff size={20} />
              </span>
              <p className="p-empty-description">
                No hay ningún prospecto con email para previsualizar. Cargá o
                analizá un prospecto primero; la vista previa no inventa datos.
              </p>
            </div>
          ) : errorPrevia ? (
            <p role="alert" className="p-banner p-banner--danger">
              <span>{errorPrevia}</span>
            </p>
          ) : previa ? (
            <>
              <dl className="p-meta-grid">
                <div>
                  <dt className="p-detail-term">Prospecto usado</dt>
                  <dd className="p-detail-value">
                    <Link
                      href={`/propuestas/prospectos/${encodeURIComponent(
                        prospecto.id,
                      )}`}
                      className={CLASE_ENLACE}
                    >
                      {prospecto.nombreNegocio}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="p-detail-term">Score del prospecto</dt>
                  <dd className="p-detail-value">
                    {prospecto.score === null ? (
                      "Sin score"
                    ) : (
                      <span className="p-score-chip">
                        {`${prospecto.score}/100`}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 rounded-lg border border-border bg-bg/40 p-4">
                <p className="p-detail-term">Asunto</p>
                <p className="mt-1 break-words text-sm font-medium text-text">
                  {previa.asunto}
                </p>

                <p className="p-detail-term mt-4">Cuerpo (texto)</p>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text">
                  {previa.cuerpoTexto}
                </div>

                <p className="p-detail-term mt-4">
                  Cuerpo (HTML escapado)
                </p>
                <div
                  className="mt-1 text-sm leading-6 text-text"
                  // El HTML sale de `textoAHtmlSeguro`: todo el texto está
                  // escapado y no se interpreta HTML de la plantilla.
                  dangerouslySetInnerHTML={{ __html: previa.cuerpoHtml }}
                />
              </div>

              <p className="mt-4 text-xs leading-5 text-text-dim">
                La vista previa no incluye el footer legal ni el token de baja:
                se materializan al aprobar. Generar o editar no envía emails.
              </p>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}
