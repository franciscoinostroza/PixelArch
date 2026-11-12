import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
  sanitizarError,
} from "@/lib/propuestas/errores"
import {
  formatearFechaHoraPortal,
  formatearFechaPortal,
} from "@/lib/propuestas/fechas"
import { formatearMonto } from "@/lib/pagos"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import {
  CampanaTabla,
  type ProspectoFila,
} from "@/components/propuestas/campana-tabla"
import { CampanaAcciones } from "@/components/propuestas/campana-acciones"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Detalle de campaña",
  robots: { index: false, follow: false },
}

/**
 * T-13 (AC-8, AC-11, AC-12, AC-14; RF-10..RF-12, RF-16, RF-17): detalle de
 * una campana de prospeccion.
 *
 * Server component de solo lectura + acciones explicitas. Consulta la campana
 * con sus prospectos, plantilla y consumo de Google Places; nunca lee datos
 * del CRM. Si el esquema aditivo no esta aplicado, falla cerrado con un estado
 * operativo y no renderiza acciones.
 */

const CLASE_SECCION = "rounded-xl border border-border bg-panel p-5"
const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_VALOR = "mt-1 text-sm leading-6 text-text"

function cargarCampana(id: string) {
  return prisma.campanaProspeccion.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      consulta: true,
      zona: true,
      rubro: true,
      estado: true,
      limiteCorrida: true,
      creadaPorNombre: true,
      ultimoError: true,
      creadoEn: true,
      iniciadaEn: true,
      finalizadaEn: true,
      plantilla: { select: { nombre: true, version: true } },
      prospectos: {
        orderBy: { creadoEn: "desc" },
        select: {
          id: true,
          nombreNegocio: true,
          sitioWeb: true,
          ciudad: true,
          estado: true,
          posibleDuplicadoDeId: true,
          score: true,
        },
      },
      consumos: {
        where: { proveedor: "GOOGLE_PLACES" },
        orderBy: { fecha: "desc" },
        select: {
          id: true,
          fecha: true,
          llamadas: true,
          unidades: true,
          costoCentavos: true,
        },
      },
    },
  })
}

function colorEstado(estado: string): string {
  switch (estado) {
    case "COMPLETADA":
      return "border-mint/30 bg-mint/5 text-mint"
    case "PARCIAL":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300"
    case "FALLIDA":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    case "CANCELADA":
      return "border-border bg-bg/40 text-text-dim"
    case "EN_CURSO":
      return "border-cyan/30 bg-cyan/5 text-cyan"
    default:
      return "border-violet/30 bg-violet-soft text-text"
  }
}

function fechaHora(fecha: Date | null): string {
  return fecha ? formatearFechaHoraPortal(fecha) : "—"
}

export default async function CampanaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let campana: Awaited<ReturnType<typeof cargarCampana>> | null
  try {
    campana = await cargarCampana(id)
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return (
        <EstadoOperativo
          codigo={CODIGO_ESQUEMA_NO_APLICADO}
          titulo="Esquema no aplicado"
          descripcion="El portal queda deshabilitado hasta que se aplique el esquema de propuestas. No se muestran datos ni acciones."
          fecha={new Date()}
        />
      )
    }
    throw error
  }

  if (!campana) notFound()

  const prospectos: ProspectoFila[] = campana.prospectos
  const totalProspectos = prospectos.length
  const conWeb = prospectos.filter(
    (prospecto) => prospecto.sitioWeb !== null,
  ).length
  const posiblesDuplicados = prospectos.filter(
    (prospecto) => prospecto.posibleDuplicadoDeId !== null,
  ).length
  const sinScore = prospectos.filter(
    (prospecto) => prospecto.score === null,
  ).length

  const totalLlamadas = campana.consumos.reduce(
    (total, consumo) => total + consumo.llamadas,
    0,
  )
  const totalUnidades = campana.consumos.reduce(
    (total, consumo) => total + consumo.unidades,
    0,
  )
  const totalCostoCentavos = campana.consumos.reduce(
    (total, consumo) => total + consumo.costoCentavos,
    0,
  )

  // Defensa adicional: el valor guardado se escribe ya sanitizado, pero se
  // vuelve a redactar antes de renderizar (emails/URLs/secretos).
  const ultimoError = campana.ultimoError
    ? sanitizarError(null, {
        codigo: "DESCONOCIDO",
        mensaje: campana.ultimoError,
      }).mensaje
    : null

  return (
    <div>
      <header className="mb-8 max-w-[75ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Campaña de prospección
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <h1 className="font-display text-3xl font-semibold text-text">
            {campana.nombre}
          </h1>
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] ${colorEstado(
              campana.estado,
            )}`}
          >
            {campana.estado}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          La búsqueda se ejecuta de forma explícita y una sola vez por campaña.
          Ningún email sale desde esta pantalla.
        </p>
      </header>

      <div className="mb-8">
        <CampanaAcciones
          key={campana.id}
          campanaId={campana.id}
          estado={campana.estado}
        />
      </div>

      {ultimoError && (
        <div
          role="note"
          aria-label="Último error de la campaña"
          className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <p className={CLASE_DEFINICION}>Último error (sanitizado)</p>
          <p className="mt-1 text-sm leading-6 text-text">{ultimoError}</p>
        </div>
      )}

      <section aria-label="Datos de la campaña" className={`${CLASE_SECCION} mb-8`}>
        <h2 className="font-display text-xl font-semibold text-text">
          Configuración
        </h2>
        <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className={CLASE_DEFINICION}>Consulta</dt>
            <dd className={`${CLASE_VALOR} break-words`}>{campana.consulta}</dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Zona</dt>
            <dd className={CLASE_VALOR}>{campana.zona ?? "—"}</dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Rubro</dt>
            <dd className={CLASE_VALOR}>{campana.rubro ?? "—"}</dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Límite por corrida</dt>
            <dd className={CLASE_VALOR}>{campana.limiteCorrida}</dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Plantilla</dt>
            <dd className={CLASE_VALOR}>
              {campana.plantilla
                ? `${campana.plantilla.nombre} (v${campana.plantilla.version})`
                : "Sin plantilla"}
            </dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Creada por</dt>
            <dd className={CLASE_VALOR}>
              {campana.creadaPorNombre ?? "Admin"}
            </dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Creada</dt>
            <dd className={CLASE_VALOR}>
              <time dateTime={campana.creadoEn.toISOString()}>
                {formatearFechaHoraPortal(campana.creadoEn)}
              </time>
            </dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Iniciada</dt>
            <dd className={CLASE_VALOR}>{fechaHora(campana.iniciadaEn)}</dd>
          </div>
          <div>
            <dt className={CLASE_DEFINICION}>Finalizada</dt>
            <dd className={CLASE_VALOR}>{fechaHora(campana.finalizadaEn)}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Contadores de la campaña" className="mb-8">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Prospectos</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-text">
              {totalProspectos}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Con sitio web</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-text">
              {conWeb}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Posibles duplicados</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-text">
              {posiblesDuplicados}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Sin score</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-text">
              {sinScore}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Prospectos de la campaña" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">
              Prospectos
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-dim">
              Datos del portal, con su fuente. El análisis y el descarte se
              habilitan en las próximas tareas.
            </p>
          </div>
        </div>
        <CampanaTabla prospectos={prospectos} />
      </section>

      <section
        aria-label="Consumo de Google Places"
        className={CLASE_SECCION}
      >
        <h2 className="font-display text-xl font-semibold text-text">
          Consumo de Google Places
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-dim">
          Cada corrida reserva 1 llamada y 1 unidad. El tope diario lo aplica
          la configuración del servidor; no se encola consumo.
        </p>

        {campana.consumos.length === 0 ? (
          <p role="status" className="mt-4 text-sm text-text-dim">
            Todavía no hay consumo de Places registrado para esta campaña.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg/40 p-3">
                <dt className={CLASE_DEFINICION}>Llamadas</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {totalLlamadas}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-bg/40 p-3">
                <dt className={CLASE_DEFINICION}>Unidades</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {totalUnidades}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-bg/40 p-3">
                <dt className={CLASE_DEFINICION}>Costo estimado</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {totalCostoCentavos > 0
                    ? formatearMonto(totalCostoCentavos, "usd")
                    : "Sin costo estimado"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">
                  Consumo diario de Google Places de la campaña
                </caption>
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Fecha
                    </th>
                    <th scope="col" className="py-2 pr-4 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Llamadas
                    </th>
                    <th scope="col" className="py-2 pr-4 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Unidades
                    </th>
                    <th scope="col" className="py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Costo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {campana.consumos.map((consumo) => (
                    <tr key={consumo.id} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-text">
                        <time dateTime={consumo.fecha.toISOString()}>
                          {formatearFechaPortal(consumo.fecha)}
                        </time>
                      </th>
                      <td className="py-2 pr-4 text-text-dim">
                        {consumo.llamadas}
                      </td>
                      <td className="py-2 pr-4 text-text-dim">
                        {consumo.unidades}
                      </td>
                      <td className="py-2 text-text-dim">
                        {consumo.costoCentavos > 0
                          ? formatearMonto(consumo.costoCentavos, "usd")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
