import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { emailEnmascarado } from "@/lib/propuestas/supresion"
import { EstadoOperativo, EstadoVacio } from "@/components/propuestas/estado-vacio"

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

function colorEstado(estado: string): string {
  switch (estado) {
    case "ENVIADO":
    case "RESPONDIDO":
      return "border-mint/30 bg-mint/5 text-mint"
    case "ENVIANDO":
      return "border-cyan/30 bg-cyan/5 text-cyan"
    case "APROBADO":
      return "border-violet/30 bg-violet-soft text-text"
    case "FALLIDO":
    case "REBOTADO":
    case "QUEJA":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    default:
      return "border-border bg-bg/40 text-text-dim"
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
      <header className="mb-8 max-w-[70ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Portal interno
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-text">
          Historial de envíos
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Estado, message ID, error saneado y fechas de cada envío. El
          destinatario se muestra enmascarado y cada fila enlaza a la ficha del
          prospecto. No hay acciones masivas: el envío y el reintento son
          acciones manuales desde la ficha.
        </p>
      </header>

      {envios.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay envíos"
          descripcion="Cuando confirmes el envío de una propuesta aprobada, su estado y message ID van a aparecer acá."
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-text-dim">
            {envios.length} envíos en el historial · {enviados} enviados ·{" "}
            {fallidos} con fallo o supresión.
          </p>

          <ul className="space-y-3">
            {envios.map((envio) => {
              const destinatario = emailEnmascarado(envio.destinatario)

              return (
                <li
                  key={envio.id}
                  className="rounded-xl border border-border bg-panel p-5"
                >
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
                      <p className="mt-1 text-sm leading-6 text-text-dim">
                        {destinatario.length > 0
                          ? destinatario
                          : "Destinatario no disponible"}{" "}
                        · v{envio.version} · secuencia {envio.secuencia}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${colorEstado(
                        envio.estado,
                      )}`}
                    >
                      {envio.estado}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Campaña
                      </dt>
                      <dd className="mt-1 text-sm text-text">
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
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Message ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs text-text">
                        {envio.proveedorMessageId ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Aprobado
                      </dt>
                      <dd className="mt-1 text-sm text-text">
                        {envio.aprobadoEn
                          ? formatearFechaHoraPortal(envio.aprobadoEn)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                        Enviado
                      </dt>
                      <dd className="mt-1 text-sm text-text">
                        {envio.enviadoEn
                          ? formatearFechaHoraPortal(envio.enviadoEn)
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  {envio.error && (
                    <p
                      role="alert"
                      className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm leading-6 text-red-300"
                    >
                      Error saneado:{" "}
                      <span className="font-mono text-xs">{envio.error}</span>
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Link
                      href={`/propuestas/prospectos/${encodeURIComponent(
                        envio.prospecto.id,
                      )}`}
                      className="inline-flex rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim transition-colors hover:bg-white/5 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
                    >
                      Ver en la ficha del prospecto
                    </Link>
                    <span className="font-mono text-[0.68rem] text-text-faint">
                      Actualizado{" "}
                      {formatearFechaHoraPortal(envio.actualizadoEn)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          <p
            role="note"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-text"
          >
            El historial es de solo lectura. No hay reenvío, reintento ni
            acciones por lote: un fallo se reintenta manualmente creando una
            versión nueva desde la ficha, y siempre requiere una nueva
            aprobación.
          </p>
        </div>
      )}
    </div>
  )
}
