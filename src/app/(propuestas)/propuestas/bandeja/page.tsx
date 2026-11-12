import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"

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

function colorEstado(estado: string): string {
  return estado === "APROBADO"
    ? "border-violet/30 bg-violet-soft text-text"
    : "border-cyan/30 bg-cyan/5 text-cyan"
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
      <header className="mb-8 max-w-[70ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Portal interno
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-text">
          Bandeja de borradores
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Borradores y envíos aprobados pendientes, priorizados por el score
          del prospecto. Esta bandeja no aprueba ni envía: cada mensaje se
          revisa en su ficha, uno por uno. No hay acciones masivas.
        </p>
      </header>

      {ordenados.length === 0 ? (
        <section
          role="status"
          aria-label="Bandeja vacía"
          className="rounded-xl border border-border bg-panel p-8"
        >
          <h2 className="font-display text-2xl font-semibold text-text">
            No hay borradores pendientes
          </h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-6 text-text-dim">
            Cuando generes un borrador desde la ficha de un prospecto, va a
            aparecer acá hasta que lo apruebes o lo descartes.
          </p>
        </section>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-text-dim">
            {borradores.length} en borrador · {aprobados.length} aprobados sin
            enviar.
          </p>

          <ul className="space-y-3">
            {ordenados.map((envio) => (
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
                    <p className="mt-1 break-words text-sm leading-6 text-text-dim">
                      {envio.asunto}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${colorEstado(
                        envio.estado,
                      )}`}
                    >
                      {envio.estado}
                    </span>
                    <span className="rounded-full border border-border bg-bg/40 px-3 py-1 font-mono text-[0.68rem] text-text-dim">
                      score{" "}
                      {envio.prospecto.score === null
                        ? "—"
                        : `${envio.prospecto.score}/100`}
                    </span>
                  </div>
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
                      Prospecto
                    </dt>
                    <dd className="mt-1 text-sm text-text">
                      {[envio.prospecto.rubro, envio.prospecto.ciudad]
                        .filter((valor): valor is string => Boolean(valor))
                        .join(" · ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Mensaje
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-text">
                      secuencia {envio.secuencia} · versión {envio.version}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                      Actualizado
                    </dt>
                    <dd className="mt-1 text-sm text-text">
                      {formatearFechaHoraPortal(envio.actualizadoEn)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4">
                  <Link
                    href={`/propuestas/prospectos/${encodeURIComponent(
                      envio.prospecto.id,
                    )}`}
                    className="inline-flex rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim transition-colors hover:bg-white/5 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
                  >
                    Revisar en la ficha del prospecto
                  </Link>
                </p>
              </li>
            ))}
          </ul>

          <p
            role="note"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-text"
          >
            La bandeja es solo lectura. No hay aprobación ni envío por lote:
            cada mensaje se revisa y se aprueba desde su ficha, y el envío
            sigue siendo una confirmación separada.
          </p>
        </div>
      )}
    </div>
  )
}
