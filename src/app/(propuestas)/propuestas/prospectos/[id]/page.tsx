import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Clock, Gauge, Mail, ShieldCheck } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  configPropuestas,
  estadoEnvio,
  type ConfigPropuestas,
} from "@/lib/propuestas/config"
import {
  estadoConsumoProspecto,
  estadoCupos,
  type EstadoConsumo,
  type EstadoCupos,
} from "@/lib/propuestas/consumo"
import { verificarHashContenido } from "@/lib/propuestas/envios"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"
import { EstadoOperativo } from "@/components/propuestas/estado-vacio"
import { CupoDia } from "@/components/propuestas/cupo-dia"
import { ProspectoFicha } from "@/components/propuestas/prospecto-ficha"
import { ScoreDesglose } from "@/components/propuestas/score-desglose"
import { AnalizarProspecto } from "@/components/propuestas/analizar-prospecto-button"
import {
  BorradorEditor,
  GenerarBorrador,
} from "@/components/propuestas/borrador-editor"
import { AprobacionPanel } from "@/components/propuestas/aprobacion-panel"
import { ArcoPanel } from "@/components/propuestas/arco-panel"
import {
  EnvioConfirmacion,
  EnvioSeguimiento,
} from "@/components/propuestas/envio-confirmacion"
import type { PlantillaOpcion } from "@/components/propuestas/campana-form"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { ScoreRing } from "@/components/propuestas/ui/score-ring"
import { StatCard } from "@/components/propuestas/ui/stat-card"
import {
  StatusPill,
  type StatusTone,
} from "@/components/propuestas/ui/status-pill"

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
 *
 * T-16 (AC-22, AC-24): agrega el panel de borrador: boton "Generar borrador"
 * con las plantillas activas o el editor del envio BORRADOR/APROBADO abierto.
 * No se envia nada desde esta ficha.
 *
 * T-17 (AC-25, AC-27): agrega el panel de aprobacion cuando hay un envio
 * BORRADOR/APROBADO: destinatario, from/reply-to, asunto, HTML/texto, fuentes,
 * score, auditoria, version y estado, con aviso "Aprobar no envia" y una
 * confirmacion explicita. En APROBADO se muestra el snapshot inmutable y se
 * recuerda que el envio es otra accion (T-18).
 *
 * T-18 (AC-26, AC-31): en APROBADO agrega la confirmacion de envio real; si el
 * gate/configuracion de Resend esta incompleto, la accion se muestra
 * deshabilitada con el motivo. Un prospecto ENVIADO puede iniciar un follow-up
 * manual (nuevo borrador + nueva aprobacion), nunca automatico.
 */

const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-dim"
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

function tonoHallazgo(type: string): StatusTone {
  switch (type) {
    case "fail":
      return "red"
    case "warn":
      return "amber"
    default:
      return "mint"
  }
}

function tonoEstado(estado: string): StatusTone {
  switch (estado) {
    case "PUNTUADO":
    case "ENRIQUECIDO":
      return "cyan"
    case "SIN_ENRIQUECER":
      return "amber"
    case "SUPRIMIDO":
      return "red"
    case "DESCARTADO":
      return "neutral"
    default:
      return "violet"
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
        select: {
          id: true,
          nombre: true,
          estado: true,
          rubro: true,
          zona: true,
          plantillaId: true,
        },
      },
    },
  })
}

function cargarPlantillasActivas(): Promise<PlantillaOpcion[]> {
  return prisma.plantillaPropuesta.findMany({
    where: { activa: true },
    select: { id: true, nombre: true, version: true },
    orderBy: [{ nombre: "asc" }, { version: "desc" }],
  })
}

interface EnvioAbierto {
  id: string
  estado: string
  version: number
  secuencia: number
  asunto: string
  cuerpoTexto: string
  cuerpoHtml: string
  hashContenido: string
  destinatario: string
  fromEmail: string | null
  fromNombre: string | null
  replyTo: string | null
  plantillaId: string | null
  plantillaVersion: number | null
  aprobadoAsunto: string | null
  aprobadoCuerpoHtml: string | null
  aprobadoCuerpoTexto: string | null
  aprobadoPorNombre: string | null
  aprobadoEn: Date | null
}

function cargarEnvioAbierto(prospectoId: string): Promise<EnvioAbierto | null> {
  return prisma.envioPropuesta.findFirst({
    where: {
      prospectoId,
      estado: { in: ["BORRADOR", "APROBADO"] },
    },
    orderBy: { actualizadoEn: "desc" },
    select: {
      id: true,
      estado: true,
      version: true,
      secuencia: true,
      asunto: true,
      cuerpoTexto: true,
      cuerpoHtml: true,
      hashContenido: true,
      destinatario: true,
      fromEmail: true,
      fromNombre: true,
      replyTo: true,
      plantillaId: true,
      plantillaVersion: true,
      aprobadoAsunto: true,
      aprobadoCuerpoHtml: true,
      aprobadoCuerpoTexto: true,
      aprobadoPorNombre: true,
      aprobadoEn: true,
    },
  })
}

interface EnvioSeguimientoBd {
  id: string
  estado: string
  version: number
  secuencia: number
  proveedorMessageId: string | null
  error: string | null
  enviadoEn: Date | null
}

/**
 * T-18: ultimo envio ya salido de la aprobacion (ENVIANDO/ENVIADO/FALLIDO o
 * terminal). Se muestra aparte del envio abierto para no mezclar el snapshot
 * aprobado con el resultado real. No hay autoenvio: solo lectura + acciones
 * manuales en el componente cliente.
 */
function cargarEnvioSeguimiento(
  prospectoId: string,
): Promise<EnvioSeguimientoBd | null> {
  return prisma.envioPropuesta.findFirst({
    where: {
      prospectoId,
      estado: {
        in: [
          "ENVIANDO",
          "ENVIADO",
          "FALLIDO",
          "REBOTADO",
          "QUEJA",
          "RESPONDIDO",
        ],
      },
    },
    orderBy: { actualizadoEn: "desc" },
    select: {
      id: true,
      estado: true,
      version: true,
      secuencia: true,
      proveedorMessageId: true,
      error: true,
      enviadoEn: true,
    },
  })
}

/**
 * Motivos visibles para no habilitar la aprobacion en la UI. El servidor
 * revalida todo; esto evita ofrecer un boton que va a fallar. No incluye PII.
 */
function motivosAprobacion(
  envio: EnvioAbierto,
  prospecto: {
    sitioWeb: string | null
    fuenteUrl: string | null
    emailFuenteUrl: string | null
  },
): string[] {
  const motivos: string[] = []

  if (!textoDe(envio.destinatario)) {
    motivos.push("Falta el destinatario del envío.")
  }
  if (!textoDe(envio.fromEmail)) {
    motivos.push("Falta el remitente configurado (PROPUESTAS_FROM_EMAIL).")
  }
  if (!textoDe(envio.replyTo)) {
    motivos.push("Falta el reply-to configurado (PROPUESTAS_REPLY_TO).")
  }
  if (!textoDe(envio.asunto)) {
    motivos.push("Falta el asunto del email.")
  }
  if (!textoDe(envio.cuerpoTexto)) {
    motivos.push("Falta el cuerpo del email.")
  }
  if (
    !textoDe(prospecto.sitioWeb) &&
    !textoDe(prospecto.fuenteUrl) &&
    !textoDe(prospecto.emailFuenteUrl)
  ) {
    motivos.push("Falta la fuente pública de los datos para el aviso legal.")
  }

  const hashIntacto = verificarHashContenido(
    {
      asunto: textoDe(envio.asunto) ?? "",
      cuerpoTexto: textoDe(envio.cuerpoTexto) ?? "",
      cuerpoHtml: textoDe(envio.cuerpoHtml) ?? "",
      destinatario: textoDe(envio.destinatario) ?? "",
      plantillaId: envio.plantillaId ?? null,
      plantillaVersion: envio.plantillaVersion ?? null,
      secuencia: envio.secuencia,
    },
    textoDe(envio.hashContenido),
  )

  if (!hashIntacto) {
    motivos.push(
      "El contenido del borrador cambió desde que se generó: regeneralo o guardalo antes de aprobar.",
    )
  }

  return motivos
}

/**
 * Motivos de configuracion que bloquean la aprobacion. Aprobar no envia: el
 * gate `PROPUESTAS_ENVIO_HABILITADO` y `RESEND_API_KEY` son requisitos del
 * envio (T-18) y no se exigen aca. Espejo de la revalidacion de
 * `/api/propuestas/envios/[id]/aprobar`.
 */
function motivosConfiguracionAprobacion(config: ConfigPropuestas): string[] {
  const motivos: string[] = []

  if (config.secreto === null) {
    motivos.push("Falta PROPUESTAS_SECRETO o no es valido.")
  }
  if (config.urlPublica === null) {
    motivos.push("Falta NEXT_PUBLIC_URL https absoluta.")
  }
  if (config.fromEmail === null) {
    motivos.push("Falta PROPUESTAS_FROM_EMAIL o no es valido.")
  }
  if (config.replyTo === null) {
    motivos.push("Falta PROPUESTAS_REPLY_TO o no es valido.")
  }
  if (config.textoLegal === null) {
    motivos.push("Falta PROPUESTAS_TEXTO_LEGAL aprobado.")
  }
  if (config.baseLegal === null) {
    motivos.push("Falta PROPUESTAS_BASE_LEGAL aprobado.")
  }

  return motivos
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

  let plantillas: PlantillaOpcion[] = []
  let envioAbierto: EnvioAbierto | null = null
  let envioSeguimiento: EnvioSeguimientoBd | null = null

  try {
    const [plantillasCargadas, envioCargado, seguimientoCargado] =
      await Promise.all([
        cargarPlantillasActivas(),
        cargarEnvioAbierto(prospecto.id),
        cargarEnvioSeguimiento(prospecto.id),
      ])
    plantillas = plantillasCargadas
    envioAbierto = envioCargado
    envioSeguimiento = seguimientoCargado
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

  let consumoProspecto: EstadoConsumo
  let cuposGlobales: EstadoCupos
  try {
    const hoy = new Date()
    const [consumo, cupos] = await Promise.all([
      estadoConsumoProspecto(prospecto.id, hoy, { cliente: prisma }),
      estadoCupos(hoy, { cliente: prisma }),
    ])
    consumoProspecto = consumo
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
  const disponibilidadConsumo = {
    places: config.places.disponible,
    resend: config.resend.disponible,
    secreto: config.secreto !== null,
  }

  const resumen = esObjeto(prospecto.auditoriaResumen)
    ? prospecto.auditoriaResumen
    : null
  const scores = scoresDe(resumen)
  const hallazgos = hallazgosDe(resumen)
  const auditoriaEstado =
    prospecto.auditoriaEstado ?? (resumen ? textoDe(resumen.estado) : null)
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

  // La aprobacion ya registrada no se bloquea por la configuracion actual de
  // envio: el snapshot es inmutable y el envio (T-18) revalida por su cuenta.
  // Aprobar en seco no depende del gate ni de Resend (T-18): solo exige las
  // piezas con las que se re-renderiza el email final.
  const bloqueosAprobacion =
    envioAbierto && envioAbierto.estado === "BORRADOR"
      ? [
          ...motivosAprobacion(envioAbierto, prospecto),
          ...motivosConfiguracionAprobacion(config),
        ]
      : []

  // T-18: la confirmacion de envio se deshabilita en la UI cuando falta
  // configuracion o el gate esta apagado. El servidor ya falla cerrado; esto
  // evita ofrecer un boton que va a terminar en 409.
  const estadoConfigEnvio = estadoEnvio(config)
  const hayEnvioEnCurso = envioSeguimiento?.estado === "ENVIANDO"

  const contactoResumen = prospecto.email
    ? prospecto.emailFuenteUrl
      ? "Email con fuente"
      : "Email sin fuente"
    : "Sin email"

  const contactoDetalle = prospecto.email
    ? prospecto.emailFuenteUrl
      ? "Email registrado con fuente"
      : "Email registrado sin fuente"
    : "Sin email: no se puede aprobar"

  return (
    <div>
      <PageHeader
        eyebrow="Ficha de prospecto"
        title={prospecto.nombreNegocio}
        description={
          <>
            <p>
              Datos del portal con su procedencia. Analizar no envía emails ni
              toca el CRM; la aprobación y el envío viven en tareas posteriores.
            </p>
            <p className="mt-3">
              <Link
                href={`/propuestas/campanas/${prospecto.campanaOrigen.id}`}
                className={CLASE_ENLACE}
              >
                Volver a la campaña «{prospecto.campanaOrigen.nombre}»
              </Link>
            </p>
          </>
        }
        status={
          <StatusPill tone={tonoEstado(prospecto.estado)}>
            {prospecto.estado}
          </StatusPill>
        }
      />

      <div className="p-prospect-layout">
        <aside className="p-prospect-rail">
          <div className="p-rail-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="p-panel-eyebrow">Estado</p>
                <div className="mt-2">
                  <StatusPill tone={tonoEstado(prospecto.estado)}>
                    {prospecto.estado}
                  </StatusPill>
                </div>
              </div>
              {prospecto.score === null ? (
                <StatusPill>Sin score</StatusPill>
              ) : (
                <ScoreRing score={prospecto.score} size={76} />
              )}
            </div>

            <dl className="p-kv-grid p-kv-grid--rail">
              <div>
                <dt className="p-detail-term">Contacto</dt>
                <dd className="p-detail-value" aria-label={contactoDetalle}>
                  {contactoResumen}
                </dd>
              </div>
              <div>
                <dt className="p-detail-term">Auditoría</dt>
                <dd className="p-detail-value">
                  {auditoriaEstado ?? "Sin auditoría"}
                </dd>
              </div>
              <div>
                <dt className="p-detail-term">Última interacción</dt>
                <dd className="p-detail-value">
                  {fechaHora(prospecto.ultimaInteraccionEn) ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <AnalizarProspecto key={prospecto.id} prospectoId={prospecto.id} />

          <div className="p-rail-card">
            <p className="p-panel-eyebrow">Siguiente paso</p>
            <p className="mt-2 text-sm leading-6 text-text">
              Revisá fuentes y borrador antes de aprobar
            </p>
            <p className="mt-3">
              <a href="#borrador-propuesta" className="p-quota-link text-sm">
                Ir al borrador
              </a>
            </p>
          </div>
        </aside>

        <div className="p-prospect-main">
          {prospecto.posibleDuplicadoDeId && (
            <Panel
              tone="warn"
              role="note"
              aria-label="Posible duplicado"
              title="Posible duplicado"
              className="mb-8"
            >
              <p className="text-sm leading-6 text-text">
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
            </Panel>
          )}

          {prospecto.motivoSinEnriquecer && (
            <Panel
              tone="warn"
              role="note"
              aria-label="Motivo sin enriquecer"
              title="Motivo sin enriquecer"
              className="mb-8"
            >
              <p className="font-mono text-sm text-text">
                {prospecto.motivoSinEnriquecer}
              </p>
            </Panel>
          )}

          <section aria-label="Resumen del prospecto" className="mb-8">
            <div className="p-stat-grid">
              <StatCard
                label="Score"
                value={
                  prospecto.score === null ? "—" : `${prospecto.score}/100`
                }
                accent="cyan"
                icon={<Gauge size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Contacto"
                value={contactoDetalle}
                accent="violet"
                icon={<Mail size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Auditoría"
                value={auditoriaEstado ?? "Sin auditoría"}
                accent="mint"
                icon={<ShieldCheck size={18} aria-hidden="true" />}
              />
              <StatCard
                label="Última interacción"
                value={fechaHora(prospecto.ultimaInteraccionEn) ?? "—"}
                accent="amber"
                icon={<Clock size={18} aria-hidden="true" />}
              />
            </div>
          </section>

          <section aria-label="Consumo del prospecto" className="mb-8">
            <div className="grid gap-4 lg:grid-cols-2">
              <CupoDia
                estado={consumoProspecto}
                titulo="Consumo del prospecto (hoy)"
                variante="compacto"
                disponibilidad={disponibilidadConsumo}
                mostrarPresupuesto={false}
                mostrarPie={false}
              />
              <CupoDia
                estado={cuposGlobales}
                titulo="Cupos globales del día"
                variante="compacto"
                disponibilidad={disponibilidadConsumo}
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-text-dim">
              Fetches, auditoría y borradores se registran por prospecto y por
              día. No se muestran datos personales en este medidor.
            </p>
          </section>

          <Panel
            aria-label="Datos del prospecto"
            title="Datos"
            className="mb-8"
          >
            <dl className="p-kv-grid">
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
                  <a
                    href={`mailto:${prospecto.email}`}
                    className={CLASE_ENLACE}
                  >
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
                <span className="font-mono text-xs text-text-dim">
                  ({prospecto.campanaOrigen.estado})
                </span>
              </Campo>

              <Campo etiqueta="Notas internas">{prospecto.notas ?? "—"}</Campo>
            </dl>
          </Panel>

          <Panel
            aria-label="Fuentes y fechas"
            title="Fuentes y fechas"
            description="Cada dato relevante conserva la página pública donde se encontró y la fecha de obtención. No se muestran datos sin procedencia."
            className="mb-8"
          >
            <dl className="p-kv-grid">
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
          </Panel>

          <Panel
            aria-label="Auditoría del sitio"
            title="Auditoría del sitio"
            className="mb-8"
          >
            {!auditada ? (
              <p role="status" className="mt-3 text-sm leading-6 text-text-dim">
                Sin auditoría registrada. Se ejecuta al analizar la web del
                prospecto; no se llama al endpoint público ni se guarda el HTML.
              </p>
            ) : (
              <>
                <dl className="p-kv-grid">
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
                    La auditoría no registró puntajes. No se completan con
                    valores inventados.
                  </p>
                ) : (
                  <dl className="p-audit-grid">
                    {[
                      ["Velocidad", scores.velocidad],
                      ["SSL", scores.ssl],
                      ["SEO", scores.seo],
                      ["Seguridad", scores.seguridad],
                    ].map(([etiqueta, valor]) => (
                      <div key={String(etiqueta)} className="p-audit-cell">
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
                        <StatusPill tone={tonoHallazgo(hallazgo.type)}>
                          {hallazgo.type}
                        </StatusPill>
                        <span className="min-w-0 flex-1 text-sm leading-6 text-text">
                          {hallazgo.text}
                        </span>
                        {hallazgo.codigo && (
                          <span className="font-mono text-[0.65rem] text-text-dim">
                            {hallazgo.codigo}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Panel>

          <div className="mb-8">
            <ScoreDesglose
              score={prospecto.score}
              detalle={prospecto.scoreDetalle}
            />
          </div>

          <Panel
            id="borrador-propuesta"
            aria-label="Borrador de propuesta"
            title="Borrador de propuesta"
            description="El borrador se genera con una plantilla activa, los datos verificados de la ficha y los hallazgos de la auditoría. No se envía nada: la aprobación y el envío son pasos separados."
            className="mb-8"
          >
            {envioAbierto ? (
              <BorradorEditor
                key={envioAbierto.id}
                envioId={envioAbierto.id}
                prospectoId={prospecto.id}
                estado={envioAbierto.estado}
                version={envioAbierto.version}
                secuencia={envioAbierto.secuencia}
                asunto={envioAbierto.asunto}
                cuerpoTexto={envioAbierto.cuerpoTexto}
              />
            ) : (
              <GenerarBorrador
                prospectoId={prospecto.id}
                plantillas={plantillas}
                plantillaPorDefectoId={prospecto.campanaOrigen.plantillaId}
                tieneEmail={Boolean(prospecto.email)}
                estadoProspecto={prospecto.estado}
                hayEnvioAbierto={hayEnvioEnCurso}
              />
            )}
          </Panel>

          {envioAbierto && (
            <div className="mb-8">
              <AprobacionPanel
                key={`aprobacion-${envioAbierto.id}`}
                envioId={envioAbierto.id}
                estado={envioAbierto.estado}
                version={envioAbierto.version}
                secuencia={envioAbierto.secuencia}
                plantillaVersion={envioAbierto.plantillaVersion ?? null}
                destinatario={textoDe(envioAbierto.destinatario) ?? ""}
                fromEmail={textoDe(envioAbierto.fromEmail)}
                fromNombre={textoDe(envioAbierto.fromNombre)}
                replyTo={textoDe(envioAbierto.replyTo)}
                asunto={textoDe(envioAbierto.asunto) ?? ""}
                cuerpoTexto={textoDe(envioAbierto.cuerpoTexto) ?? ""}
                cuerpoHtml={textoDe(envioAbierto.cuerpoHtml)}
                aprobadoAsunto={textoDe(envioAbierto.aprobadoAsunto)}
                aprobadoCuerpoTexto={textoDe(envioAbierto.aprobadoCuerpoTexto)}
                aprobadoCuerpoHtml={textoDe(envioAbierto.aprobadoCuerpoHtml)}
                aprobadoPorNombre={textoDe(envioAbierto.aprobadoPorNombre)}
                aprobadoEnTexto={fechaHora(envioAbierto.aprobadoEn)}
                bloqueos={bloqueosAprobacion}
                fuentes={{
                  sitioWeb: sitioSeguro,
                  fuenteUrl: fuenteSegura,
                  emailFuenteUrl: emailFuenteSegura,
                }}
                score={prospecto.score}
                auditoriaEstado={auditoriaEstado}
              />
            </div>
          )}

          {envioAbierto && envioAbierto.estado === "APROBADO" && (
            <div className="mb-8">
              <EnvioConfirmacion
                key={`envio-${envioAbierto.id}`}
                envioId={envioAbierto.id}
                destinatario={textoDe(envioAbierto.destinatario) ?? ""}
                asunto={
                  textoDe(envioAbierto.aprobadoAsunto) ??
                  textoDe(envioAbierto.asunto) ??
                  ""
                }
                version={envioAbierto.version}
                secuencia={envioAbierto.secuencia}
                habilitado={estadoConfigEnvio.ok}
                motivos={estadoConfigEnvio.ok ? [] : estadoConfigEnvio.motivos}
              />
            </div>
          )}

          {envioSeguimiento && (
            <div className="mb-8">
              <EnvioSeguimiento
                key={`seguimiento-${envioSeguimiento.id}`}
                envioId={envioSeguimiento.id}
                estado={envioSeguimiento.estado}
                version={envioSeguimiento.version}
                secuencia={envioSeguimiento.secuencia}
                proveedorMessageId={textoDe(
                  envioSeguimiento.proveedorMessageId,
                )}
                error={textoDe(envioSeguimiento.error)}
                fechaTexto={fechaHora(envioSeguimiento.enviadoEn)}
                hayEnvioAbierto={envioAbierto !== null}
              />
            </div>
          )}

          <section aria-label="Corrección del prospecto" className="mb-8">
            <ProspectoFicha prospecto={editable} />
          </section>

          <ArcoPanel
            prospecto={editable}
            campanaId={prospecto.campanaOrigen.id}
          />
        </div>
      </div>
    </div>
  )
}
