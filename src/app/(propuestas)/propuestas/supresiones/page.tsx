import type { Metadata } from "next"
import { Globe2, Mail, ShieldOff, TriangleAlert } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo, EstadoVacio } from "@/components/propuestas/estado-vacio"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { StatCard } from "@/components/propuestas/ui/stat-card"
import { StatusPill } from "@/components/propuestas/ui/status-pill"
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
 *
 * FASE 4b "PixelArch Console": cabecera común, resumen en StatCards y tarjetas
 * de panel para cada supresión. El alta manual vive dentro de un panel; no se
 * agregan acciones ni se modifica la lógica.
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
      <PageHeader
        eyebrow="Portal interno"
        title="Supresiones"
        description="Lista global de emails y dominios de negocio que no deben volver a recibir propuestas. Se guarda un hash, un email enmascarado o el dominio, con motivo, origen, fecha y estado. No se muestran datos del CRM ni emails completos."
      />

      <section aria-label="Supresiones registradas" className="mb-8">
        <h2 className="mb-3 font-display text-xl font-semibold text-text">
          Registradas ({supresiones.length})
        </h2>

        {supresiones.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay supresiones"
            descripcion="Cuando registres una baja, un rebote duro, una queja o una supresión manual, va a aparecer acá con su motivo, origen y fecha."
          />
        ) : (
          <>
            <div className="p-stats-3">
              <StatCard
                label="Activas"
                value={activas}
                hint="Bloquean futuros envíos"
                accent="mint"
                icon={<ShieldOff size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Por email"
                value={porEmail}
                hint="Clave por hash HMAC"
                accent="cyan"
                icon={<Mail size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Por dominio"
                value={porDominio}
                hint="Dominios de negocio"
                accent="violet"
                icon={<Globe2 size={18} aria-hidden="true" />}
              />
            </div>

            <p className="mt-3 text-sm text-text-dim">
              {activas} activas · {porEmail} por email · {porDominio} por
              dominio. La lista muestra hasta 200 registros, primero los
              activos.
            </p>

            <ul className="p-list mt-4">
              {supresiones.map((fila) => {
                const etiqueta = etiquetaContacto(fila)

                return (
                  <li key={fila.id} className="p-panel p-list-item">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="p-panel-eyebrow">
                          {fila.ambito === "DOMINIO"
                            ? "Dominio de negocio"
                            : "Email"}
                        </p>
                        <h3 className="mt-1 font-display text-lg font-semibold text-text">
                          {etiqueta}
                        </h3>
                        <p className="mt-1 break-all font-mono text-xs text-text-dim">
                          {claveCorta(fila.clave)}
                        </p>
                      </div>
                      <StatusPill tone={fila.activa ? "mint" : "neutral"}>
                        {fila.activa ? "Activa" : "Revocada"}
                      </StatusPill>
                    </div>

                    <dl className="p-meta-grid mt-4">
                      <div>
                        <dt className="p-detail-term">Ámbito</dt>
                        <dd className="p-detail-value font-mono text-xs">
                          {fila.ambito}
                        </dd>
                      </div>
                      <div>
                        <dt className="p-detail-term">Motivo</dt>
                        <dd className="p-detail-value">
                          {ETIQUETAS_MOTIVO[fila.motivo] ?? fila.motivo}
                        </dd>
                      </div>
                      <div>
                        <dt className="p-detail-term">Origen</dt>
                        <dd className="p-detail-value font-mono text-xs">
                          {fila.origen}
                        </dd>
                      </div>
                      <div>
                        <dt className="p-detail-term">Registrada</dt>
                        <dd className="p-detail-value">
                          {formatearFechaHoraPortal(fila.creadaEn)}
                        </dd>
                      </div>
                    </dl>

                    {fila.creadaPorNombre && (
                      <p className="mt-3 text-xs text-text-dim">
                        Registrada por {fila.creadaPorNombre}
                      </p>
                    )}

                    {!fila.activa && (
                      <>
                        <div className="p-banner mt-3">
                          <div className="p-banner-body">
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

      <div role="note" className="p-banner p-banner--warn mb-8">
        <TriangleAlert
          aria-hidden="true"
          size={16}
          className="p-banner-icon"
        />
        <div className="p-banner-body">
          <p>
            La supresión es global y permanente hasta una excepción. Bloquea
            futuros envíos aunque se borre el prospecto o la campaña, y la
            revocación no reabre prospectos ni envíos: solo deja de bloquear al
            contacto. La purga es una excepción administrativa que solo aplica a
            supresiones ya revocadas; no hay acciones masivas desde esta página.
            El texto del motivo de la purga no se guarda: solo queda un registro
            operativo sin datos personales.
          </p>
        </div>
      </div>

      <Panel aria-label="Alta manual de supresión" title="Nueva supresión">
        <SupresionForm />
      </Panel>
    </div>
  )
}
