import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
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
 */

const CLASE_SECCION = "rounded-xl border border-border bg-panel p-5"
const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
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
      <header className="mb-8 max-w-[75ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Plantilla · v{plantilla.version}
          {plantilla.activa ? " · activa" : " · inactiva"}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold text-text">
            {plantilla.nombre}
          </h1>
          <span className="rounded-full border border-border bg-bg/40 px-3 py-1 font-mono text-xs text-text-dim">
            {plantilla.idioma}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Guardar crea una versión nueva y desactiva esta. Los borradores ya
          creados conservan su snapshot y no se envían desde acá.
        </p>
        <p className="mt-3">
          <Link href="/propuestas/plantillas" className={CLASE_ENLACE}>
            Volver a plantillas
          </Link>
        </p>
        <p className="mt-2 text-xs text-text-faint">
          Última actualización:{" "}
          {formatearFechaHoraPortal(plantilla.actualizadoEn)}
          {plantilla.creadaPorNombre
            ? ` · ${plantilla.creadaPorNombre}`
            : ""}
        </p>
      </header>

      <section aria-label="Editor de la plantilla" className="mb-10">
        <h2 className="mb-3 font-display text-xl font-semibold text-text">
          Editar y versionar
        </h2>
        <PlantillaForm plantilla={editable} />
      </section>

      <section
        aria-label="Vista previa con un prospecto real"
        className={CLASE_SECCION}
      >
        <h2 className="font-display text-xl font-semibold text-text">
          Vista previa con un prospecto real
        </h2>

        {!prospecto ? (
          <p
            role="status"
            className="mt-3 text-sm leading-6 text-text-dim"
          >
            No hay ningún prospecto con email para previsualizar. Cargá o
            analizá un prospecto primero; la vista previa no inventa datos.
          </p>
        ) : errorPrevia ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
          >
            {errorPrevia}
          </p>
        ) : previa ? (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className={CLASE_DEFINICION}>Prospecto usado</dt>
                <dd className="mt-1 text-sm text-text">
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
                <dt className={CLASE_DEFINICION}>Score del prospecto</dt>
                <dd className="mt-1 text-sm text-text">
                  {prospecto.score === null
                    ? "Sin score"
                    : `${prospecto.score}/100`}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-lg border border-border bg-bg/40 p-4">
              <p className={CLASE_DEFINICION}>Asunto</p>
              <p className="mt-1 break-words text-sm font-medium text-text">
                {previa.asunto}
              </p>

              <p className={`${CLASE_DEFINICION} mt-4`}>
                Cuerpo (texto)
              </p>
              <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text">
                {previa.cuerpoTexto}
              </div>

              <p className={`${CLASE_DEFINICION} mt-4`}>
                Cuerpo (HTML escapado)
              </p>
              <div
                className="mt-1 text-sm leading-6 text-text"
                // El HTML sale de `textoAHtmlSeguro`: todo el texto está
                // escapado y no se interpreta HTML de la plantilla.
                dangerouslySetInnerHTML={{ __html: previa.cuerpoHtml }}
              />
            </div>

            <p className="mt-4 text-xs leading-5 text-text-faint">
              La vista previa no incluye el footer legal ni el token de baja:
              se materializan al aprobar. Generar o editar no envía emails.
            </p>
          </>
        ) : null}
      </section>
    </div>
  )
}
