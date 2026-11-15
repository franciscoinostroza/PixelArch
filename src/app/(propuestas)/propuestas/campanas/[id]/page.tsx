import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Copy, Gauge, Globe, Users } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  estadoConsumoCampana,
  estadoCupos,
  type EstadoConsumo,
  type EstadoCupos,
} from "@/lib/propuestas/consumo"
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
import { CupoDia } from "@/components/propuestas/cupo-dia"
import {
  CampanaTabla,
  type ProspectoFila,
} from "@/components/propuestas/campana-tabla"
import { CampanaAcciones } from "@/components/propuestas/campana-acciones"
import { AltaProspecto } from "@/components/propuestas/prospecto-ficha"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { StatCard } from "@/components/propuestas/ui/stat-card"
import { TableShell } from "@/components/propuestas/ui/table-shell"
import {
  StatusPill,
  type StatusTone,
} from "@/components/propuestas/ui/status-pill"

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
 *
 * FASE 2 "PixelArch Console": cabecera con estado, acciones como panel, error
 * en panel de aviso, configuracion y contadores con primitivas, tabla del
 * portal y metricas de Places. Sin consultas ni logica nuevas.
 */

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
          email: true,
          telefono: true,
          ciudad: true,
          rubro: true,
          contactoNombre: true,
          contactoCargo: true,
          fuenteUrl: true,
          emailFuenteUrl: true,
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

const TONOS_ESTADO: Record<string, StatusTone> = {
  COMPLETADA: "mint",
  PARCIAL: "amber",
  FALLIDA: "red",
  CANCELADA: "neutral",
  EN_CURSO: "cyan",
  BORRADOR: "violet",
}

function tonoEstado(estado: string): StatusTone {
  return TONOS_ESTADO[estado] ?? "violet"
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

  let consumoCampana: EstadoConsumo
  let cuposGlobales: EstadoCupos
  try {
    const hoy = new Date()
    const [consumo, cupos] = await Promise.all([
      estadoConsumoCampana(campana.id, hoy, { cliente: prisma }),
      estadoCupos(hoy, { cliente: prisma }),
    ])
    consumoCampana = consumo
    cuposGlobales = cupos
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

  const config = configPropuestas()
  const disponibilidad = {
    places: config.places.disponible,
    resend: config.resend.disponible,
    secreto: config.secreto !== null,
  }

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
      <PageHeader
        eyebrow="Campaña de prospección"
        title={campana.nombre}
        description="La búsqueda se ejecuta de forma explícita y una sola vez por campaña. Ningún email sale desde esta pantalla."
        status={
          <StatusPill tone={tonoEstado(campana.estado)}>
            {campana.estado}
          </StatusPill>
        }
      />

      <div className="mb-8">
        <CampanaAcciones
          key={campana.id}
          campanaId={campana.id}
          estado={campana.estado}
        />
      </div>

      {ultimoError && (
        <Panel
          tone="warn"
          role="note"
          aria-label="Último error de la campaña"
          title="Último error (sanitizado)"
          className="mb-8"
        >
          <p className="text-sm leading-6 text-text">{ultimoError}</p>
        </Panel>
      )}

      <Panel
        aria-label="Datos de la campaña"
        title="Configuración"
        className="mb-8"
      >
        <dl className="p-detail-grid">
          <div className="p-detail-span">
            <dt className="p-detail-term">Consulta</dt>
            <dd className="p-detail-value break-words">{campana.consulta}</dd>
          </div>
          <div>
            <dt className="p-detail-term">Zona</dt>
            <dd className="p-detail-value">{campana.zona ?? "—"}</dd>
          </div>
          <div>
            <dt className="p-detail-term">Rubro</dt>
            <dd className="p-detail-value">{campana.rubro ?? "—"}</dd>
          </div>
          <div>
            <dt className="p-detail-term">Límite por corrida</dt>
            <dd className="p-detail-value">{campana.limiteCorrida}</dd>
          </div>
          <div>
            <dt className="p-detail-term">Plantilla</dt>
            <dd className="p-detail-value">
              {campana.plantilla
                ? `${campana.plantilla.nombre} (v${campana.plantilla.version})`
                : "Sin plantilla"}
            </dd>
          </div>
          <div>
            <dt className="p-detail-term">Creada por</dt>
            <dd className="p-detail-value">
              {campana.creadaPorNombre ?? "Admin"}
            </dd>
          </div>
          <div>
            <dt className="p-detail-term">Creada</dt>
            <dd className="p-detail-value">
              <time dateTime={campana.creadoEn.toISOString()}>
                {formatearFechaHoraPortal(campana.creadoEn)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="p-detail-term">Iniciada</dt>
            <dd className="p-detail-value">{fechaHora(campana.iniciadaEn)}</dd>
          </div>
          <div>
            <dt className="p-detail-term">Finalizada</dt>
            <dd className="p-detail-value">
              {fechaHora(campana.finalizadaEn)}
            </dd>
          </div>
        </dl>
      </Panel>

      <section aria-label="Contadores de la campaña" className="mb-8">
        <div className="p-stat-grid">
          <StatCard
            label="Prospectos"
            value={totalProspectos}
            accent="violet"
            icon={<Users size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Con sitio web"
            value={conWeb}
            accent="cyan"
            icon={<Globe size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Posibles duplicados"
            value={posiblesDuplicados}
            accent="amber"
            icon={<Copy size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Sin score"
            value={sinScore}
            accent="red"
            icon={<Gauge size={18} aria-hidden="true" />}
          />
        </div>
      </section>

      <section aria-label="Prospectos de la campaña" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">
              Prospectos
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-dim">
              Datos del portal, con su fuente. El alta manual, la corrección y
              el descarte se registran con motivo; el análisis se ejecuta desde
              la ficha de cada prospecto con el botón Analizar.
            </p>
          </div>
        </div>
        <div className="mb-4">
          <AltaProspecto campanaId={campana.id} />
        </div>
        <CampanaTabla prospectos={prospectos} />
      </section>

      <section aria-label="Cupos y consumo" className="mb-8">
        <div className="p-quota-grid">
          <CupoDia
            estado={consumoCampana}
            titulo="Consumo de la campaña (hoy)"
            variante="compacto"
            disponibilidad={disponibilidad}
            excluir={["GOOGLE_PLACES"]}
            mostrarPresupuesto={false}
            mostrarPie={false}
          />
          <CupoDia
            estado={cuposGlobales}
            titulo="Cupos globales del día"
            variante="compacto"
            disponibilidad={disponibilidad}
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-text-dim">
          El consumo de Google Places de la campaña se detalla abajo para no
          duplicar sus contadores.
        </p>
      </section>

      <Panel
        aria-label="Consumo de Google Places"
        title="Consumo de Google Places"
        description="Cada corrida reserva 1 llamada y 1 unidad. El tope diario lo aplica la configuración del servidor; no se encola consumo."
      >
        {campana.consumos.length === 0 ? (
          <p role="status" className="p-quota-note">
            Todavía no hay consumo de Places registrado para esta campaña.
          </p>
        ) : (
          <>
            <dl className="p-detail-metrics">
              <div className="p-detail-metric">
                <dt className="p-detail-term">Llamadas</dt>
                <dd className="p-detail-metric-value">{totalLlamadas}</dd>
              </div>
              <div className="p-detail-metric">
                <dt className="p-detail-term">Unidades</dt>
                <dd className="p-detail-metric-value">{totalUnidades}</dd>
              </div>
              <div className="p-detail-metric">
                <dt className="p-detail-term">Costo estimado</dt>
                <dd className="p-detail-metric-value">
                  {totalCostoCentavos > 0
                    ? formatearMonto(totalCostoCentavos, "usd")
                    : "Sin costo estimado"}
                </dd>
              </div>
            </dl>

            <TableShell className="p-detail-table">
              <caption className="sr-only">
                Consumo diario de Google Places de la campaña
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Llamadas</th>
                  <th scope="col">Unidades</th>
                  <th scope="col">Costo</th>
                </tr>
              </thead>
              <tbody>
                {campana.consumos.map((consumo) => (
                  <tr key={consumo.id}>
                    <th scope="row" className="p-table-rowhead">
                      <time dateTime={consumo.fecha.toISOString()}>
                        {formatearFechaPortal(consumo.fecha)}
                      </time>
                    </th>
                    <td>{consumo.llamadas}</td>
                    <td>{consumo.unidades}</td>
                    <td>
                      {consumo.costoCentavos > 0
                        ? formatearMonto(consumo.costoCentavos, "usd")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </>
        )}
      </Panel>
    </div>
  )
}
