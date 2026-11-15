import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Ban,
  FileText,
  Inbox,
  Mail,
  MapPin,
  Megaphone,
  Search,
  Send,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  estadoCupos,
  type EstadoCupos,
} from "@/lib/propuestas/consumo"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaPortal } from "@/lib/propuestas/fechas"
import {
  EstadoOperativo,
  EstadoVacio,
} from "@/components/propuestas/estado-vacio"
import { CupoDia } from "@/components/propuestas/cupo-dia"
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
  title: "Panel de propuestas",
  robots: { index: false, follow: false },
}

/**
 * T-02 (AC-1, AC-3, AC-6; RF-1, RF-4): dashboard del portal.
 *
 * T-21 (AC-38, AC-39; RF-57, RF-58): agrega los cupos globales del dia
 * (`estadoCupos`) con costo, aviso 80% y bloqueo 100%. Solo lectura: no
 * reserva, no encola y no llama a proveedores. Si el esquema falta, se
 * conserva el estado operativo y no se muestran datos ni formularios.
 *
 * T-28 (AC-48, AC-49; RF-1, RF-2, RF-5, RF-6, RF-8): reemplaza el estado
 * vacio fijo por datos reales del portal: KPIs (campanas, prospectos,
 * pendientes y envios de hoy), campanas recientes y cola de revision. Las
 * consultas son de solo lectura y usan exclusivamente modelos del portal; si
 * falta el esquema en cualquiera, falla cerrado con `EstadoOperativo`.
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

/** Medianoche UTC del dia actual (corte de "envios de hoy"). */
function inicioDiaUtc(): Date {
  const ahora = new Date()
  return new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()),
  )
}

function cargarResumen(desde: Date) {
  return Promise.all([
    prisma.campanaProspeccion.count(),
    prisma.prospecto.count(),
    prisma.envioPropuesta.count({
      where: { estado: { in: ["BORRADOR", "APROBADO"] } },
    }),
    prisma.envioPropuesta.count({
      where: { estado: "ENVIADO", enviadoEn: { gte: desde } },
    }),
    prisma.campanaProspeccion.findMany({
      orderBy: { creadoEn: "desc" },
      take: 5,
      select: {
        id: true,
        nombre: true,
        estado: true,
        creadoEn: true,
        _count: { select: { prospectos: true } },
      },
    }),
    prisma.envioPropuesta.findMany({
      where: { estado: { in: ["BORRADOR", "APROBADO"] } },
      orderBy: { actualizadoEn: "desc" },
      take: 5,
      select: {
        id: true,
        estado: true,
        asunto: true,
        actualizadoEn: true,
        prospecto: {
          select: { id: true, nombreNegocio: true, score: true },
        },
      },
    }),
  ] as const)
}

interface PiezaOperativa {
  nombre: string
  disponible: boolean
  Icono: LucideIcon
}

const ATAJOS: ReadonlyArray<{
  href: string
  titulo: string
  descripcion: string
  Icono: LucideIcon
}> = [
  {
    href: "/propuestas/buscar",
    titulo: "Buscar",
    descripcion: "Creá una campaña de prospección.",
    Icono: Search,
  },
  {
    href: "/propuestas/bandeja",
    titulo: "Bandeja",
    descripcion: "Revisá borradores y aprobados pendientes.",
    Icono: Inbox,
  },
  {
    href: "/propuestas/plantillas",
    titulo: "Plantillas",
    descripcion: "Versiones y vista previa de mensajes.",
    Icono: FileText,
  },
  {
    href: "/propuestas/envios",
    titulo: "Envíos",
    descripcion: "Historial y estados de cada envío.",
    Icono: Send,
  },
]

const TONOS_CAMPANA: Record<string, StatusTone> = {
  COMPLETADA: "mint",
  PARCIAL: "amber",
  FALLIDA: "red",
  CANCELADA: "neutral",
  EN_CURSO: "cyan",
  BORRADOR: "violet",
}

function tonoCampana(estado: string): StatusTone {
  return TONOS_CAMPANA[estado] ?? "violet"
}

function tonoEnvio(estado: string): StatusTone {
  return estado === "APROBADO" ? "violet" : "cyan"
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

  let resumen: Awaited<ReturnType<typeof cargarResumen>>
  try {
    resumen = await cargarResumen(inicioDiaUtc())
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

  const [
    campanasTotal,
    prospectosTotal,
    pendientesTotal,
    enviosHoy,
    campanasRecientes,
    colaRevision,
  ] = resumen

  let cupos: EstadoCupos
  try {
    cupos = await estadoCupos(new Date(), { cliente: prisma })
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

  const config = configPropuestas()

  const piezas: readonly PiezaOperativa[] = [
    {
      nombre: "Google Places",
      disponible: config.places.disponible,
      Icono: MapPin,
    },
    {
      nombre: "Email",
      disponible: config.resend.disponible,
      Icono: Mail,
    },
    {
      nombre: "Supresión",
      disponible: config.supresion.disponible,
      Icono: Ban,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Propuestas"
        description="Prospección asistida, borradores y envíos con aprobación manual. Este portal está separado del CRM."
      />

      <section
        aria-label="Estado operativo del portal"
        className="p-status-strip mb-8"
      >
        {piezas.map((pieza) => {
          const Icono = pieza.Icono

          return (
            <div
              key={pieza.nombre}
              className="p-status-item"
              data-estado={
                pieza.disponible ? "CONFIGURADO" : "NO_CONFIGURADO"
              }
            >
              <span className="p-status-icon" aria-hidden="true">
                <Icono size={15} />
              </span>
              <span className="p-status-name">{pieza.nombre}</span>
              <StatusPill tone={pieza.disponible ? "mint" : "amber"}>
                {pieza.disponible ? "Configurado" : "No configurado"}
              </StatusPill>
            </div>
          )
        })}

        <div className="p-status-meta">
          <StatusPill tone="violet">
            <ShieldCheck size={12} aria-hidden="true" />
            Aprobación manual · el envío se confirma aparte
          </StatusPill>
        </div>
      </section>

      <div className="mb-8">
        <CupoDia
          estado={cupos}
          disponibilidad={{
            places: config.places.disponible,
            resend: config.resend.disponible,
            secreto: config.secreto !== null,
          }}
        />
      </div>

      <section aria-label="Métricas del portal" className="mb-8">
        <div className="p-stat-grid">
          <StatCard
            label="Campañas"
            value={campanasTotal}
            accent="violet"
            icon={<Megaphone size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Prospectos"
            value={prospectosTotal}
            accent="cyan"
            icon={<Users size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Pendientes"
            value={pendientesTotal}
            hint="Borradores y aprobados sin enviar"
            accent="amber"
            icon={<Inbox size={18} aria-hidden="true" />}
          />
          <StatCard
            label="Envíos hoy"
            value={enviosHoy}
            hint="Enviados desde las 00:00 UTC"
            accent="mint"
            icon={<Send size={18} aria-hidden="true" />}
          />
        </div>
      </section>

      {campanasTotal === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay campañas"
          descripcion="Cuando crees la primera búsqueda vas a ver acá el estado de las campañas, la cola de revisión y el consumo del día."
          accion={
            <Link href="/propuestas/buscar" className="p-btn p-btn--primary">
              Crear primera búsqueda
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <Panel
          aria-label="Campañas recientes"
          title="Campañas recientes"
          description="Las últimas cinco búsquedas del portal y sus prospectos."
          actions={
            <Link
              href="/propuestas/campanas"
              className="p-btn p-btn--ghost p-btn--sm"
            >
              Ver todas
            </Link>
          }
          className="mb-8"
        >
          {campanasRecientes.length === 0 ? (
            <p role="status" className="p-quota-note">
              No hay campañas recientes para mostrar.
            </p>
          ) : (
            <TableShell>
              <caption className="sr-only">Campañas recientes</caption>
              <thead>
                <tr>
                  <th scope="col">Campaña</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Prospectos</th>
                  <th scope="col">Creada</th>
                </tr>
              </thead>
              <tbody>
                {campanasRecientes.map((campana) => (
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
                      <StatusPill tone={tonoCampana(campana.estado)}>
                        {campana.estado}
                      </StatusPill>
                    </td>
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
          )}
        </Panel>
      )}

      <Panel
        aria-label="Cola de revisión"
        title="Cola de revisión"
        description="Borradores y aprobados pendientes, ordenados por última actualización. Cada mensaje se revisa en la ficha de su prospecto."
        className="mb-8"
      >
        {colaRevision.length === 0 ? (
          <p role="status" className="p-quota-note">
            No hay borradores pendientes
          </p>
        ) : (
          <TableShell>
            <caption className="sr-only">
              Borradores y aprobados pendientes de revisión
            </caption>
            <thead>
              <tr>
                <th scope="col">Prospecto</th>
                <th scope="col">Asunto</th>
                <th scope="col">Estado</th>
                <th scope="col">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {colaRevision.map((envio) => (
                <tr key={envio.id}>
                  <th scope="row" className="p-table-rowhead">
                    <Link
                      href={`/propuestas/prospectos/${encodeURIComponent(
                        envio.prospecto.id,
                      )}`}
                      className="p-table-link"
                    >
                      {envio.prospecto.nombreNegocio}
                    </Link>
                  </th>
                  <td className="p-table-cell-consulta">{envio.asunto}</td>
                  <td>
                    <StatusPill tone={tonoEnvio(envio.estado)}>
                      {envio.estado}
                    </StatusPill>
                  </td>
                  <td>
                    <time dateTime={envio.actualizadoEn.toISOString()}>
                      {formatearFechaPortal(envio.actualizadoEn)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Panel>

      <Panel title="Atajos">
        <div className="p-shortcut-grid">
          {ATAJOS.map((atajo) => {
            const Icono = atajo.Icono

            return (
              <Link
                key={atajo.href}
                href={atajo.href}
                className="p-shortcut"
              >
                <span className="p-shortcut-icon" aria-hidden="true">
                  <Icono size={17} />
                </span>
                <span className="p-shortcut-copy">
                  <span className="p-shortcut-title">{atajo.titulo}</span>
                  <span className="p-shortcut-description">
                    {atajo.descripcion}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
