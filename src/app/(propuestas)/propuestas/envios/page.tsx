import type { Metadata } from "next"
import Link from "next/link"
import { Lock, Mail, Send, TriangleAlert } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { emailEnmascarado } from "@/lib/propuestas/supresion"
import { EstadoOperativo, EstadoVacio } from "@/components/propuestas/estado-vacio"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { StatCard } from "@/components/propuestas/ui/stat-card"
import {
  StatusPill,
  type StatusTone,
} from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Historial de envíos",
  robots: { index: false, follow: false },
}

/**
 * T-18 (AC-26, AC-28, AC-29, AC-30; RF-43..RF-50): historial de envíos del
 * portal.
 *
 * Solo lectura: estados, message IDs, error saneado, destinatario enmascarado y
 * fechas. No hay acciones masivas, reenvios ni reintentos desde el listado; el
 * envío y el reintento viven en la ficha del prospecto. Si el esquema no esta
 * aplicado, falla cerrado sin mostrar datos.
 */

const CLASE_ENLACE =
  "underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function cargarEnvios() {
  return prisma.envioPropuesta.findMany({
    select: {
      id: true,
      estado: true,
      version: true,
      secuencia: true,
      destinatario: true,
      proveedorMessageId: true,
      error: true,
      creadoEn: true,
      actualizadoEn: true,
      aprobadoEn: true,
      enviadoEn: true,
      prospecto: {
        select: {
          id: true,
          nombreNegocio: true,
        },
      },
      campana: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
    orderBy: { actualizadoEn: "desc" },
    take: 100,
  })
}

function tonoEstado(estado: string): StatusTone {
  switch (estado) {
    case "ENVIADO":
    case "RESPONDIDO":
      return "mint"
    case "ENVIANDO":
      return "cyan"
    case "APROBADO":
      return "violet"
    case "FALLIDO":
    case "REBOTADO":
    case "QUEJA":
      return "red"
    default:
      return "neutral"
  }
}

export default async function EnviosPage() {
  let envios: Awaited<ReturnType<typeof cargarEnvios>>

  try {
    envios = await cargarEnvios()
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

  const enviados = envios.filter(
    (envio) => envio.estado === "ENVIADO" || envio.estado === "RESPONDIDO",
  ).length
  const fallidos = envios.filter(
    (envio) =>
      envio.estado === "FALLIDO" ||
      envio.estado === "REBOTADO" ||
      envio.estado === "QUEJA",
  ).length

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Historial de envíos"
        description="Estado, message ID, error saneado y fechas de cada envío. El destinatario se muestra enmascarado y cada fila enlaza a la ficha del prospecto. No hay acciones masivas: el envío y el reintento son acciones manuales desde la ficha."
      />

      {envios.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay envíos"
          descripcion="Cuando confirmes el envío de una propuesta aprobada, su estado y message ID van a aparecer acá."
        />
      ) : (
        <div className="space-y-6">
          <section aria-label="Resumen de envíos">
            <div className="p-stats-3">
              <StatCard
                label="Total"
                value={envios.length}
                hint="Envíos en el historial"
                accent="violet"
                icon={<Mail size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Enviados"
                value={enviados}
                hint="Enviados o respondidos"
                accent="mint"
                icon={<Send size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Con fallo o supresión"
                value={fallidos}
                hint="Fallo, rebote o queja"
                accent="red"
                icon={<TriangleAlert size={18} aria-hidden="true" />}
              />
            </div>
            <p className="mt-3 text-sm text-text-dim">
              {envios.length} envíos en el historial · {enviados} enviados ·{" "}
              {fallidos} con fallo o supresión.
            </p>
          </section>

          <ul className="p-list">
            {envios.map((envio) => {
              const destinatario = emailEnmascarado(envio.destinatario)

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
                        {destinatario.length > 0
                          ? destinatario
                          : "Destinatario no disponible"}{" "}
                        · v{envio.version} · secuencia {envio.secuencia}
                      </p>
                    </div>
                    <StatusPill tone={tonoEstado(envio.estado)}>
                      {envio.estado}
                    </StatusPill>
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
                      <dt className="p-detail-term">Message ID</dt>
                      <dd className="p-detail-value break-all">
                        {envio.proveedorMessageId ? (
                          <span className="p-code">
                            {envio.proveedorMessageId}
                          </span>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Aprobado</dt>
                      <dd className="p-detail-value">
                        {envio.aprobadoEn
                          ? formatearFechaHoraPortal(envio.aprobadoEn)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="p-detail-term">Enviado</dt>
                      <dd className="p-detail-value">
                        {envio.enviadoEn
                          ? formatearFechaHoraPortal(envio.enviadoEn)
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  {envio.error && (
                    <div role="alert" className="p-banner p-banner--danger mt-4">
                      <TriangleAlert
                        aria-hidden="true"
                        size={16}
                        className="p-banner-icon"
                      />
                      <div className="p-banner-body">
                        <p>
                          Error saneado:{" "}
                          <span className="font-mono text-xs">
                            {envio.error}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Link
                      href={`/propuestas/prospectos/${encodeURIComponent(
                        envio.prospecto.id,
                      )}`}
                      className="p-btn p-btn--ghost p-btn--sm"
                    >
                      Ver en la ficha del prospecto
                    </Link>
                    <span className="font-mono text-[0.68rem] text-text-dim">
                      Actualizado{" "}
                      {formatearFechaHoraPortal(envio.actualizadoEn)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          <div role="note" className="p-banner p-banner--warn">
            <Lock aria-hidden="true" size={16} className="p-banner-icon" />
            <div className="p-banner-body">
              <p className="p-banner-title">
                El historial es de solo lectura.
              </p>
              <p className="mt-1">
                No hay reenvío, reintento ni acciones por lote: un fallo se
                reintenta manualmente creando una versión nueva desde la ficha,
                y siempre requiere una nueva aprobación.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
