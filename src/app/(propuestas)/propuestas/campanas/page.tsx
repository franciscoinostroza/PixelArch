import type { Metadata } from "next"
import Link from "next/link"
import { Megaphone, Plus } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { EmptyState } from "@/components/propuestas/ui/empty-state"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { TableShell } from "@/components/propuestas/ui/table-shell"
import {
  StatusPill,
  type StatusTone,
} from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Campañas",
  robots: { index: false, follow: false },
}

/**
 * T-28 (AC-46, AC-49; RF-1, RF-2, RF-5, RF-6, RF-8): listado de campanas.
 *
 * Server component de solo lectura. Consulta unicamente el modelo del portal
 * `CampanaProspeccion` y su conteo de prospectos; nunca lee datos del CRM ni
 * llama a Places/Resend. Si el esquema aditivo no esta aplicado, falla cerrado
 * con el estado operativo y no renderiza datos.
 */

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

function cargarCampanas() {
  return prisma.campanaProspeccion.findMany({
    select: {
      id: true,
      nombre: true,
      consulta: true,
      zona: true,
      rubro: true,
      estado: true,
      creadoEn: true,
      actualizadoEn: true,
      _count: { select: { prospectos: true } },
    },
    orderBy: { creadoEn: "desc" },
    take: 100,
  })
}

const ENLACE_NUEVA_CAMPANA = (
  <Link href="/propuestas/buscar" className="p-btn p-btn--primary">
    <Plus size={15} aria-hidden="true" />
    Nueva campaña
  </Link>
)

export default async function CampanasPage() {
  let campanas: Awaited<ReturnType<typeof cargarCampanas>>

  try {
    campanas = await cargarCampanas()
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

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Campañas"
        description="Búsquedas de prospección del portal, con su estado, alcance y cantidad de prospectos. El alta no busca ni envía: la corrida se ejecuta a mano desde cada campaña."
        actions={ENLACE_NUEVA_CAMPANA}
      />

      {campanas.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={20} aria-hidden="true" />}
          title="Todavía no hay campañas"
          description="Creá la primera búsqueda para empezar a generar prospectos con Places y revisar borradores uno por uno."
          action={
            <Link href="/propuestas/buscar" className="p-btn p-btn--primary">
              Crear primera campaña
            </Link>
          }
        />
      ) : (
        <Panel
          aria-label="Listado de campañas"
          title="Todas las campañas"
          description={`${campanas.length} ${
            campanas.length === 1 ? "campaña" : "campañas"
          } · ordenadas por fecha de creación.`}
        >
          <TableShell>
            <caption className="sr-only">
              Campañas de prospección del portal
            </caption>
            <thead>
              <tr>
                <th scope="col">Campaña</th>
                <th scope="col">Estado</th>
                <th scope="col">Consulta</th>
                <th scope="col">Zona</th>
                <th scope="col">Rubro</th>
                <th scope="col">Prospectos</th>
                <th scope="col">Creada</th>
              </tr>
            </thead>
            <tbody>
              {campanas.map((campana) => (
                <tr key={campana.id}>
                  <th scope="row" className="p-table-rowhead">
                    <Link
                      href={`/propuestas/campanas/${encodeURIComponent(
                        campana.id,
                      )}`}
                      className="p-table-link"
                    >
                      {campana.nombre}
                    </Link>
                  </th>
                  <td>
                    <StatusPill tone={tonoEstado(campana.estado)}>
                      {campana.estado}
                    </StatusPill>
                  </td>
                  <td className="p-table-cell-consulta">{campana.consulta}</td>
                  <td>{campana.zona ?? "—"}</td>
                  <td>{campana.rubro ?? "—"}</td>
                  <td>{campana._count.prospectos}</td>
                  <td>
                    <time dateTime={campana.creadoEn.toISOString()}>
                      {formatearFechaPortal(campana.creadoEn)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}
    </div>
  )
}
