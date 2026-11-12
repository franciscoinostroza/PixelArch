import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { PlantillaForm } from "@/components/propuestas/plantilla-form"

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
      <header className="mb-8 max-w-[70ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Portal interno
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-text">
          Plantillas
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Redacción determinista con variables de lista blanca y datos
          verificados. Editar una plantilla crea una versión nueva: no hay
          HTML arbitrario, LLM ni envíos desde esta página.
        </p>
      </header>

      <section aria-label="Plantillas activas" className="mb-10">
        <h2 className="font-display text-xl font-semibold text-text">
          Activas ({plantillas.length})
        </h2>

        {plantillas.length === 0 ? (
          <p
            role="status"
            className="mt-3 rounded-xl border border-border bg-panel p-5 text-sm leading-6 text-text-dim"
          >
            Todavía no hay plantillas activas. Creá la primera con el formulario
            de abajo; no se envía ningún email.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {plantillas.map((plantilla) => {
              const variables = variablesDe(plantilla.variablesPermitidas)

              return (
                <li
                  key={plantilla.id}
                  className="rounded-xl border border-border bg-panel p-5"
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
                    <span className="rounded-full border border-violet/30 bg-violet-soft px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] text-text">
                      v{plantilla.version} · {plantilla.idioma}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Variables permitidas
                      </dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {variables.length === 0 ? (
                          <span className="text-sm text-text-dim">
                            Sin variables
                          </span>
                        ) : (
                          variables.map((variable) => (
                            <code
                              key={variable}
                              className="rounded border border-border bg-bg/40 px-1.5 py-0.5 font-mono text-[0.7rem] text-text"
                            >
                              {`{{${variable}}}`}
                            </code>
                          ))
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Actualizada
                      </dt>
                      <dd className="mt-1 text-sm text-text">
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

      <section aria-label="Alta de plantilla">
        <h2 className="mb-3 font-display text-xl font-semibold text-text">
          Nueva plantilla
        </h2>
        <PlantillaForm />
      </section>
    </div>
  )
}
