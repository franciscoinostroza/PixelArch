import type { Metadata } from "next"
import Link from "next/link"
import { Inbox, Lock } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { EmptyState } from "@/components/propuestas/ui/empty-state"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { StatusPill, type StatusTone } from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Bandeja de borradores",
  robots: { index: false, follow: false },
}

/**
 * T-16 (AC-22, AC-24; RF-34, RF-38): bandeja de borradores pendientes.
 *
 * Lista solo envíos BORRADOR/APROBADO de todo el portal, ordenados por score
 * del prospecto (desc) y fecha. Es solo lectura: no hay aprobación, envío ni
 * acción en lote. Cada fila enlaza a la ficha del prospecto, no a datos
 * personales en la URL. Si el esquema no está aplicado, falla cerrado.
 *
 * FASE 3b "PixelArch Console": cabecera y estado vacío con primitivas,
 * tarjetas de panel con score, metadatos y enlace de revisión. Sin botones ni
 * acciones masivas.
 */

const CLASE_ENLACE =
  "underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function cargarPendientes() {
  return prisma.envioPropuesta.findMany({
    where: { estado: { in: ["BORRADOR", "APROBADO"] } },
    select: {
      id: true,
      estado: true,
      secuencia: true,
      version: true,
      asunto: true,
      actualizadoEn: true,
      prospecto: {
        select: {
          id: true,
          nombreNegocio: true,
          ciudad: true,
          rubro: true,
          score: true,
          estado: true,
        },
      },
      campana: { select: { id: true, nombre: true } },
    },
    orderBy: { actualizadoEn: "desc" },
    take: 200,
  })
}

function tonoEstado(estado: string): StatusTone {
  return estado === "APROBADO" ? "violet" : "cyan"
}

export default async function BandejaPage() {
  let envios: Awaited<ReturnType<typeof cargarPendientes>>

  try {
    envios = await cargarPendientes()
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

  const ordenados = [...envios].sort((a, b) => {
    const scoreA = a.prospecto.score ?? -1
    const scoreB = b.prospecto.score ?? -1
    if (scoreA !== scoreB) return scoreB - scoreA
    return b.actualizadoEn.getTime() - a.actualizadoEn.getTime()
  })

  const borradores = ordenados.filter((envio) => envio.estado === "BORRADOR")
  const aprobados = ordenados.filter((envio) => envio.estado === "APROBADO")

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Bandeja de borradores"
        description="Borradores y envíos aprobados pendientes, priorizados por el score del prospecto. Esta bandeja no aprueba ni envía: cada mensaje se revisa en su ficha, uno por uno. No hay acciones masivas."
      />

      {ordenados.length === 0 ? (
        <EmptyState
          role="status"
          aria-label="Bandeja vacía"
          icon={<Inbox size={20} aria-hidden="true" />}
          title="No hay borradores pendientes"
          description="Cuando generes un borrador desde la ficha de un prospecto, va a aparecer acá hasta que lo apruebes o lo descartes."
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-text-dim">
            {`${borradores.length} en borrador · ${aprobados.length} aprobados sin enviar.`}
          </p>

          <ul className="p-list">
            {ordenados.map((envio) => {
              const score = envio.prospecto.score

              return (
                <li key={envio.id} className="p-panel p-list-item">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-semibold text-text">
                        <Link
                          href={`/propuestas/prospectos/${encodeURIComponent(
                            envio.prospecto.id,
                          )}`}
                          className={CLASE_ENLACE}
                        >
                          {envio.prospecto.nombreNegocio}
                        </Link>
                      </h2>
                      <p className="mt-1 break-words text-sm leading-6 text-text-dim">
                        {envio.asunto}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={tonoEstado(envio.estado)}>
                        {envio.estado}
                      </StatusPill>
                      <span
                        className="p-score-chip"
                        role="img"
                        aria-label={
                          score === null
                            ? "Sin score"
                            : `Score ${score} de 100`
                        }
                      >
                        {score === null ? "—" : `${score}/100`}
                      </span>
                    </div>
                  </div>

                  <dl className="p-meta-grid mt-4">
                    <div>
                      <dt className="p-detail-term">Campaña</dt>
                      <dd className="p-detail-value">
                        <Link
                          href={`/propuestas/campanas/${encodeURIComponent(
                            envio.campana.id,
                          )}`}
                          className={CLASE_ENLACE}
                        >
                          {envio.campana.nombre}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Prospecto</dt>
                      <dd className="p-detail-value">
                        {[envio.prospecto.rubro, envio.prospecto.ciudad]
                          .filter((valor): valor is string => Boolean(valor))
                          .join(" · ") || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Mensaje</dt>
                      <dd className="p-detail-value">
                        <span className="p-code">{`secuencia ${envio.secuencia} · versión ${envio.version}`}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Actualizado</dt>
                      <dd className="p-detail-value">
                        {formatearFechaHoraPortal(envio.actualizadoEn)}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4">
                    <Link
                      href={`/propuestas/prospectos/${encodeURIComponent(
                        envio.prospecto.id,
                      )}`}
                      className="p-btn p-btn--ghost p-btn--sm"
                    >
                      Revisar en la ficha del prospecto
                    </Link>
                  </p>
                </li>
              )
            })}
          </ul>

          <div role="note" className="p-banner p-banner--warn">
            <Lock aria-hidden="true" size={16} className="p-banner-icon" />
            <div className="p-banner-body">
              <p className="p-banner-title">La bandeja es solo lectura.</p>
              <p className="mt-1">
                No hay aprobación ni envío por lote: cada mensaje se revisa y
                se aprueba desde su ficha, y el envío sigue siendo una
                confirmación separada.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
