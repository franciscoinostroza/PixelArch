import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { ProspectoFicha } from "@/components/propuestas/prospecto-ficha"
import { ScoreDesglose } from "@/components/propuestas/score-desglose"
import { AnalizarProspecto } from "@/components/propuestas/analizar-prospecto-button"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Prospecto",
  robots: { index: false, follow: false },
}

/**
 * T-15 (AC-9, AC-10, AC-19, AC-20, AC-21; RF-13..RF-16, RF-31..RF-33): ficha
 * completa de un prospecto.
 *
 * Server component de solo lectura + boton cliente "Analizar" y el formulario
 * de correccion de T-14. Consulta solo los modelos del portal (Prospecto y
 * CampanaProspeccion) y nunca lee datos del CRM. Muestra:
 * - datos, procedencia y fechas por fuente (sitio, email, telefono);
 * - auditoria resumida (estado, fecha, scores y hallazgos), sin HTML;
 * - score total, componentes, puntos/maximo y motivos;
 * - estado, posible duplicado y enlace a la campana de origen.
 *
 * Si el esquema aditivo no esta aplicado, falla cerrado con un estado
 * operativo y no renderiza datos ni acciones. `noindex` en metadata.
 */

const CLASE_SECCION = "rounded-xl border border-border bg-panel p-5"
const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_VALOR = "mt-1 text-sm leading-6 text-text"
const CLASE_ENLACE =
  "break-all underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

interface HallazgoVista {
  type: string
  text: string
  codigo: string | null
}

interface ScoresVista {
  velocidad: number | null
  ssl: number | null
  seo: number | null
  seguridad: number | null
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function numeroDe(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.round(valor)
    : null
}

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0
    ? valor.trim()
    : null
}

function scoresDe(valor: unknown): ScoresVista | null {
  if (!esObjeto(valor) || !esObjeto(valor.scores)) return null

  return {
    velocidad: numeroDe(valor.scores.velocidad),
    ssl: numeroDe(valor.scores.ssl),
    seo: numeroDe(valor.scores.seo),
    seguridad: numeroDe(valor.scores.seguridad),
  }
}

function hallazgosDe(valor: unknown): HallazgoVista[] {
  if (!esObjeto(valor) || !Array.isArray(valor.findings)) return []

  const salida: HallazgoVista[] = []

  for (const item of valor.findings) {
    if (!esObjeto(item)) continue
    const text = textoDe(item.text)
    if (text === null) continue

    salida.push({
      type: textoDe(item.type) ?? "info",
      text,
      codigo: textoDe(item.codigo),
    })
  }

  return salida
}

function colorHallazgo(type: string): string {
  switch (type) {
    case "fail":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300"
    default:
      return "border-mint/30 bg-mint/5 text-mint"
  }
}

function colorEstado(estado: string): string {
  switch (estado) {
    case "PUNTUADO":
    case "ENRIQUECIDO":
      return "border-cyan/30 bg-cyan/5 text-cyan"
    case "SIN_ENRIQUECER":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300"
    case "SUPRIMIDO":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    case "DESCARTADO":
      return "border-border bg-bg/40 text-text-dim"
    default:
      return "border-violet/30 bg-violet-soft text-text"
  }
}

function origenDe(fuenteTipo: string | null): string {
  switch (fuenteTipo) {
    case "PLACES":
      return "Google Places (solo place_id)"
    case "WEB_NEGOCIO":
      return "Web del negocio"
    case "CARGA_MANUAL":
      return "Carga manual con fuente"
    default:
      return "Sin origen registrado"
  }
}

function fechaHora(valor: Date | string | null): string | null {
  if (valor === null) return null
  const fecha = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null
  return formatearFechaHoraPortal(fecha)
}

/** Solo http/https sin credenciales: evita pintar un enlace `javascript:`. */
function urlSegura(valor: string | null): string | null {
  if (typeof valor !== "string" || valor.trim().length === 0) return null
  try {
    const url = new URL(valor)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: {
      id: true,
      nombreNegocio: true,
      sitioWeb: true,
      dominioNormalizado: true,
      ciudad: true,
      rubro: true,
      email: true,
      telefono: true,
      contactoNombre: true,
      contactoCargo: true,
      emailFuenteUrl: true,
      emailFechaFuente: true,
      fuenteTipo: true,
      fuenteUrl: true,
      fechaFuente: true,
      estado: true,
      score: true,
      scoreDetalle: true,
      auditoriaResumen: true,
      auditoriaEstado: true,
      auditoriaFecha: true,
      posibleDuplicadoDeId: true,
      motivoSinEnriquecer: true,
      notas: true,
      ultimaInteraccionEn: true,
      creadoEn: true,
      actualizadoEn: true,
      campanaOrigen: {
        select: { id: true, nombre: true, estado: true, rubro: true, zona: true },
      },
    },
  })
}

function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className={CLASE_DEFINICION}>{etiqueta}</dt>
      <dd className={CLASE_VALOR}>{children}</dd>
    </div>
  )
}

export default async function ProspectoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let prospecto: Awaited<ReturnType<typeof cargarProspecto>> | null
  try {
    prospecto = await cargarProspecto(id)
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

  if (!prospecto) notFound()

  const resumen = esObjeto(prospecto.auditoriaResumen)
    ? prospecto.auditoriaResumen
    : null
  const scores = scoresDe(resumen)
  const hallazgos = hallazgosDe(resumen)
  const auditoriaEstado =
    prospecto.auditoriaEstado ??
    (resumen ? textoDe(resumen.estado) : null)
  const fechaResumenTexto = resumen ? textoDe(resumen.fecha) : null
  const auditoriaFecha =
    prospecto.auditoriaFecha ??
    (fechaResumenTexto !== null ? new Date(fechaResumenTexto) : null)
  const auditoriaFinalUrl = resumen ? textoDe(resumen.finalUrl) : null
  const auditoriaMotivo = resumen ? textoDe(resumen.motivo) : null
  const auditada = auditoriaEstado !== null || resumen !== null

  const sitioSeguro = urlSegura(prospecto.sitioWeb)
  const fuenteSegura = urlSegura(prospecto.fuenteUrl)
  const emailFuenteSegura = urlSegura(prospecto.emailFuenteUrl)
  const auditoriaUrlSegura = urlSegura(auditoriaFinalUrl)

  const editable = {
    id: prospecto.id,
    nombreNegocio: prospecto.nombreNegocio,
    sitioWeb: prospecto.sitioWeb,
    email: prospecto.email,
    telefono: prospecto.telefono,
    ciudad: prospecto.ciudad,
    rubro: prospecto.rubro,
    contactoNombre: prospecto.contactoNombre,
    contactoCargo: prospecto.contactoCargo,
    fuenteUrl: prospecto.fuenteUrl,
    emailFuenteUrl: prospecto.emailFuenteUrl,
    estado: prospecto.estado,
  }

  return (
    <div>
      <header className="mb-8 max-w-[80ch]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Ficha de prospecto
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-text">
              {prospecto.nombreNegocio}
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-dim">
              Datos del portal con su procedencia. Analizar no envía emails ni
              toca el CRM; la aprobación y el envío viven en tareas posteriores.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] ${colorEstado(
              prospecto.estado,
            )}`}
          >
            {prospecto.estado}
          </span>
        </div>
        <p className="mt-3">
          <Link
            href={`/propuestas/campanas/${prospecto.campanaOrigen.id}`}
            className={CLASE_ENLACE}
          >
            Volver a la campaña «{prospecto.campanaOrigen.nombre}»
          </Link>
        </p>
      </header>

      <div className="mb-8">
        <AnalizarProspecto key={prospecto.id} prospectoId={prospecto.id} />
      </div>

      {prospecto.posibleDuplicadoDeId && (
        <div
          role="note"
          aria-label="Posible duplicado"
          className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <p className={CLASE_DEFINICION}>Posible duplicado</p>
          <p className="mt-1 text-sm leading-6 text-text">
            El email o el dominio coincide con otra ficha. No se fusionó
            automáticamente: revisá la ficha relacionada antes de contactar.
          </p>
          <p className="mt-2">
            <Link
              href={`/propuestas/prospectos/${encodeURIComponent(
                prospecto.posibleDuplicadoDeId,
              )}`}
              className={CLASE_ENLACE}
            >
              Ver ficha relacionada
            </Link>
          </p>
        </div>
      )}

      {prospecto.motivoSinEnriquecer && (
        <div
          role="note"
          aria-label="Motivo sin enriquecer"
          className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <p className={CLASE_DEFINICION}>Motivo sin enriquecer</p>
          <p className="mt-1 font-mono text-sm text-text">
            {prospecto.motivoSinEnriquecer}
          </p>
        </div>
      )}

      <section aria-label="Resumen del prospecto" className="mb-8">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Score</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-text">
              {prospecto.score === null ? "—" : `${prospecto.score}/100`}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Contacto</dt>
            <dd className="mt-1 text-sm leading-6 text-text">
              {prospecto.email
                ? prospecto.emailFuenteUrl
                  ? "Email registrado con fuente"
                  : "Email registrado sin fuente"
                : "Sin email: no se puede aprobar"}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Auditoría</dt>
            <dd className="mt-1 text-sm leading-6 text-text">
              {auditoriaEstado ?? "Sin auditoría"}
            </dd>
          </div>
          <div className={`${CLASE_SECCION} p-4`}>
            <dt className={CLASE_DEFINICION}>Última interacción</dt>
            <dd className="mt-1 text-sm leading-6 text-text">
              {fechaHora(prospecto.ultimaInteraccionEn) ?? "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Datos del prospecto"
        className={`${CLASE_SECCION} mb-8`}
      >
        <h2 className="font-display text-xl font-semibold text-text">Datos</h2>
        <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Nombre del negocio">
            {prospecto.nombreNegocio}
          </Campo>

          <Campo etiqueta="Sitio web">
            {sitioSeguro ? (
              <a
                href={sitioSeguro}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={CLASE_ENLACE}
              >
                {prospecto.sitioWeb}
              </a>
            ) : (
              "—"
            )}
          </Campo>

          <Campo etiqueta="Dominio normalizado">
            {prospecto.dominioNormalizado ?? "—"}
          </Campo>

          <Campo etiqueta="Email de contacto">
            {prospecto.email ? (
              <a href={`mailto:${prospecto.email}`} className={CLASE_ENLACE}>
                {prospecto.email}
              </a>
            ) : (
              "Sin email publicado"
            )}
          </Campo>

          <Campo etiqueta="Teléfono comercial">
            {prospecto.telefono ?? "—"}
          </Campo>

          <Campo etiqueta="Ciudad">{prospecto.ciudad ?? "—"}</Campo>

          <Campo etiqueta="Rubro">{prospecto.rubro ?? "—"}</Campo>

          <Campo etiqueta="Contacto">
            {prospecto.contactoNombre || prospecto.contactoCargo
              ? [prospecto.contactoNombre, prospecto.contactoCargo]
                  .filter((valor): valor is string => Boolean(valor))
                  .join(" — ")
              : "—"}
          </Campo>

          <Campo etiqueta="Origen de la ficha">
            {origenDe(prospecto.fuenteTipo)}
          </Campo>

          <Campo etiqueta="Campaña">
            <Link
              href={`/propuestas/campanas/${prospecto.campanaOrigen.id}`}
              className={CLASE_ENLACE}
            >
              {prospecto.campanaOrigen.nombre}
            </Link>{" "}
            <span className="font-mono text-xs text-text-faint">
              ({prospecto.campanaOrigen.estado})
            </span>
          </Campo>

          <Campo etiqueta="Notas internas">
            {prospecto.notas ?? "—"}
          </Campo>
        </dl>
      </section>

      <section
        aria-label="Fuentes y fechas"
        className={`${CLASE_SECCION} mb-8`}
      >
        <h2 className="font-display text-xl font-semibold text-text">
          Fuentes y fechas
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-dim">
          Cada dato relevante conserva la página pública donde se encontró y la
          fecha de obtención. No se muestran datos sin procedencia.
        </p>
        <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Fuente general">
            {fuenteSegura ? (
              <a
                href={fuenteSegura}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={CLASE_ENLACE}
              >
                {prospecto.fuenteUrl}
              </a>
            ) : (
              "—"
            )}
          </Campo>

          <Campo etiqueta="Fecha de la fuente">
            {fechaHora(prospecto.fechaFuente) ?? "—"}
          </Campo>

          <Campo etiqueta="Fuente del email">
            {emailFuenteSegura ? (
              <a
                href={emailFuenteSegura}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={CLASE_ENLACE}
              >
                {prospecto.emailFuenteUrl}
              </a>
            ) : (
              "—"
            )}
          </Campo>

          <Campo etiqueta="Fecha de la fuente del email">
            {fechaHora(prospecto.emailFechaFuente) ?? "—"}
          </Campo>

          <Campo etiqueta="Fecha de auditoría">
            {fechaHora(auditoriaFecha) ?? "—"}
          </Campo>

          <Campo etiqueta="Creado">
            {fechaHora(prospecto.creadoEn) ?? "—"}
          </Campo>

          <Campo etiqueta="Actualizado">
            {fechaHora(prospecto.actualizadoEn) ?? "—"}
          </Campo>
        </dl>
      </section>

      <section
        aria-label="Auditoría del sitio"
        className={`${CLASE_SECCION} mb-8`}
      >
        <h2 className="font-display text-xl font-semibold text-text">
          Auditoría del sitio
        </h2>

        {!auditada ? (
          <p role="status" className="mt-3 text-sm leading-6 text-text-dim">
            Sin auditoría registrada. Se ejecuta al analizar la web del
            prospecto; no se llama al endpoint público ni se guarda el HTML.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Campo etiqueta="Estado">
                <span className="font-mono text-xs">
                  {auditoriaEstado ?? "SIN_DATOS"}
                </span>
              </Campo>
              <Campo etiqueta="Fecha de auditoría">
                {fechaHora(auditoriaFecha) ?? "—"}
              </Campo>
              <Campo etiqueta="URL auditada">
                {auditoriaUrlSegura ? (
                  <a
                    href={auditoriaUrlSegura}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={CLASE_ENLACE}
                  >
                    {auditoriaFinalUrl}
                  </a>
                ) : (
                  "—"
                )}
              </Campo>
            </dl>

            {auditoriaMotivo && (
              <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text">
                Motivo saneado:{" "}
                <span className="font-mono text-xs">{auditoriaMotivo}</span>
              </p>
            )}

            {scores === null ? (
              <p className="mt-4 text-sm leading-6 text-text-dim">
                La auditoría no registró puntajes. No se completan con valores
                inventados.
              </p>
            ) : (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Velocidad", scores.velocidad],
                  ["SSL", scores.ssl],
                  ["SEO", scores.seo],
                  ["Seguridad", scores.seguridad],
                ].map(([etiqueta, valor]) => (
                  <div
                    key={String(etiqueta)}
                    className="rounded-lg border border-border bg-bg/40 p-3"
                  >
                    <dt className={CLASE_DEFINICION}>{String(etiqueta)}</dt>
                    <dd className="mt-1 text-lg font-semibold text-text">
                      {typeof valor === "number" ? `${valor}/100` : "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {hallazgos.length === 0 ? (
              <p className="mt-4 text-sm leading-6 text-text-dim">
                Sin hallazgos registrados en el resumen.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {hallazgos.map((hallazgo, indice) => (
                  <li
                    key={`${hallazgo.type}-${indice}-${hallazgo.codigo ?? ""}`}
                    className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-bg/40 p-3"
                  >
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] ${colorHallazgo(
                        hallazgo.type,
                      )}`}
                    >
                      {hallazgo.type}
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-6 text-text">
                      {hallazgo.text}
                    </span>
                    {hallazgo.codigo && (
                      <span className="font-mono text-[0.65rem] text-text-faint">
                        {hallazgo.codigo}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="mb-8">
        <ScoreDesglose
          score={prospecto.score}
          detalle={prospecto.scoreDetalle}
        />
      </div>

      <section aria-label="Corrección del prospecto">
        <ProspectoFicha prospecto={editable} />
      </section>
    </div>
  )
}
