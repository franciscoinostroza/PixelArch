import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo, EstadoVacio } from "@/components/propuestas/estado-vacio"
import {
  SupresionForm,
  SupresionPurgarForm,
  SupresionRevocarForm,
} from "@/components/propuestas/supresion-form"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Supresiones",
  robots: { index: false, follow: false },
}

/**
 * T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56): lista de
 * supresiones globales + alta manual y revocación excepcional.
 *
 * - Solo muestra hash/clave, email enmascarado o dominio de negocio; nunca el
 *   email completo ni datos del CRM.
 * - La supresión es permanente hasta una excepción explícita con motivo. La
 *   purga manual es una excepción administrativa que solo aparece en filas ya
 *   revocadas; no hay acciones masivas. Revocar y purgar no reabren prospectos
 *   ni envíos.
 * - Si el esquema no está aplicado, falla cerrado sin datos ni formularios.
 */

const ETIQUETAS_MOTIVO: Record<string, string> = {
  OPT_OUT: "Opt-out",
  REBOTE_DURO: "Rebote duro",
  QUEJA: "Queja",
  MANUAL: "Manual",
  SOLICITUD_ARCO: "Solicitud ARCO",
}

function cargarSupresiones() {
  return prisma.supresionProspecto.findMany({
    select: {
      id: true,
      ambito: true,
      clave: true,
      emailEnmascarado: true,
      dominioNegocio: true,
      motivo: true,
      origen: true,
      activa: true,
      creadaPorNombre: true,
      creadaEn: true,
      revocadaEn: true,
      motivoRevocacion: true,
    },
    orderBy: [{ activa: "desc" }, { creadaEn: "desc" }],
    take: 200,
  })
}

function claveCorta(clave: string): string {
  if (clave.length <= 32) return clave
  return `${clave.slice(0, 28)}…`
}

function etiquetaContacto(fila: {
  ambito: string
  emailEnmascarado: string | null
  dominioNegocio: string | null
}): string {
  if (fila.ambito === "DOMINIO") {
    return fila.dominioNegocio ?? "Dominio no disponible"
  }
  return fila.emailEnmascarado ?? "Email enmascarado no disponible"
}

export default async function SupresionesPage() {
  let supresiones: Awaited<ReturnType<typeof cargarSupresiones>>

  try {
    supresiones = await cargarSupresiones()
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

  const activas = supresiones.filter((fila) => fila.activa).length
  const porEmail = supresiones.filter(
    (fila) => fila.ambito === "EMAIL",
  ).length
  const porDominio = supresiones.filter(
    (fila) => fila.ambito === "DOMINIO",
  ).length

  return (
    <div>
      <header className="mb-8 max-w-[70ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Portal interno
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-text">
          Supresiones
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          Lista global de emails y dominios de negocio que no deben volver a
          recibir propuestas. Se guarda un hash, un email enmascarado o el
          dominio, con motivo, origen, fecha y estado. No se muestran datos del
          CRM ni emails completos.
        </p>
      </header>

      <section aria-label="Supresiones registradas" className="mb-10">
        <h2 className="font-display text-xl font-semibold text-text">
          Registradas ({supresiones.length})
        </h2>

        {supresiones.length === 0 ? (
          <div className="mt-3">
            <EstadoVacio
              titulo="Todavía no hay supresiones"
              descripcion="Cuando registres una baja, un rebote duro, una queja o una supresión manual, va a aparecer acá con su motivo, origen y fecha."
            />
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-text-dim">
              {activas} activas · {porEmail} por email · {porDominio} por
              dominio. La lista muestra hasta 200 registros, primero los
              activos.
            </p>

            <ul className="mt-4 space-y-3">
              {supresiones.map((fila) => {
                const etiqueta = etiquetaContacto(fila)

                return (
                  <li
                    key={fila.id}
                    className="rounded-xl border border-border bg-panel p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-semibold text-text">
                          {etiqueta}
                        </h3>
                        <p className="mt-1 break-all font-mono text-xs text-text-dim">
                          {claveCorta(fila.clave)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${
                          fila.activa
                            ? "border-mint/30 bg-mint/5 text-mint"
                            : "border-border bg-bg/40 text-text-dim"
                        }`}
                      >
                        {fila.activa ? "Activa" : "Revocada"}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                          Ámbito
                        </dt>
                        <dd className="mt-1 font-mono text-xs text-text">
                          {fila.ambito}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                          Motivo
                        </dt>
                        <dd className="mt-1 text-sm text-text">
                          {ETIQUETAS_MOTIVO[fila.motivo] ?? fila.motivo}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                          Origen
                        </dt>
                        <dd className="mt-1 font-mono text-xs text-text">
                          {fila.origen}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
                          Registrada
                        </dt>
                        <dd className="mt-1 text-sm text-text">
                          {formatearFechaHoraPortal(fila.creadaEn)}
                        </dd>
                      </div>
                    </dl>

                    {fila.creadaPorNombre && (
                      <p className="mt-3 text-xs text-text-faint">
                        Registrada por {fila.creadaPorNombre}
                      </p>
                    )}

                    {!fila.activa && (
                      <>
                        <div className="mt-3 rounded-lg border border-border bg-bg/40 p-3 text-sm leading-6 text-text-dim">
                          <p>
                            Revocada{" "}
                            {fila.revocadaEn
                              ? formatearFechaHoraPortal(fila.revocadaEn)
                              : "sin fecha"}
                            .
                          </p>
                          {fila.motivoRevocacion && (
                            <p className="mt-1">
                              Motivo de la excepción: {fila.motivoRevocacion}
                            </p>
                          )}
                        </div>
                        <SupresionPurgarForm id={fila.id} etiqueta={etiqueta} />
                      </>
                    )}

                    {fila.activa && (
                      <SupresionRevocarForm id={fila.id} etiqueta={etiqueta} />
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <p
        role="note"
        className="mb-10 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-text"
      >
        La supresión es global y permanente hasta una excepción. Bloquea futuros
        envíos aunque se borre el prospecto o la campaña, y la revocación no
        reabre prospectos ni envíos: solo deja de bloquear al contacto. La purga
        es una excepción administrativa que solo aplica a supresiones ya
        revocadas; no hay acciones masivas desde esta página. El texto del
        motivo de la purga no se guarda: solo queda un registro operativo sin
        datos personales.
      </p>

      <section aria-label="Alta manual de supresión">
        <h2 className="mb-3 font-display text-xl font-semibold text-text">
          Nueva supresión
        </h2>
        <SupresionForm />
      </section>
    </div>
  )
}
