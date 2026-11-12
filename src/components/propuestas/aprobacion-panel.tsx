"use client"

/**
 * T-17 (AC-25, AC-27; RF-40..RF-42, RF-44): panel de aprobación con snapshot.
 *
 * - Muestra destinatario, from/reply-to, asunto, HTML/texto, fuentes, score,
 *   auditoría, versión y estado del envío abierto.
 * - Avisa de forma visible que **aprobar no envía**: el envío real es otra
 *   acción separada (T-18) y requiere su propia confirmación.
 * - La aprobación exige una confirmación explícita (checkbox) y se envía con
 *   `{ confirmado: true }`. No hay auto-envío ni auto-refresh que mutte nada.
 * - El botón se deshabilita si faltan datos, configuración o el hash del
 *   borrador no coincide; el servidor vuelve a revalidar todo.
 * - En APROBADO se muestra el snapshot guardado (inmutable) y se recuerda que
 *   el envío todavía no ocurrió.
 * - Errores accesibles con el código saneado y los motivos del servidor.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatearFechaHoraPortal } from "@/lib/propuestas/fechas"

export interface FuentesAprobacion {
  sitioWeb: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
}

export interface AprobacionPanelProps {
  envioId: string
  estado: string
  version: number
  secuencia: number
  plantillaVersion: number | null
  destinatario: string
  fromEmail: string | null
  fromNombre: string | null
  replyTo: string | null
  asunto: string
  cuerpoTexto: string
  cuerpoHtml: string | null
  aprobadoAsunto: string | null
  aprobadoCuerpoTexto: string | null
  aprobadoCuerpoHtml: string | null
  aprobadoPorNombre: string | null
  aprobadoEnTexto: string | null
  /** Motivos ya calculados por el servidor (datos, config, hash). */
  bloqueos: string[]
  fuentes: FuentesAprobacion
  score: number | null
  auditoriaEstado: string | null
}

interface Mensaje {
  tono: "ok" | "aviso" | "error"
  texto: string
}

interface RespuestaAprobacion {
  estado?: unknown
  aprobadoEn?: unknown
  codigo?: unknown
  motivos?: unknown
}

const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_VALOR = "mt-1 text-sm leading-6 text-text"
const CLASE_ENLACE =
  "break-all underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_MENSAJE =
  "mt-4 rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_BLOQUEO =
  "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0
    ? valor.trim()
    : null
}

function motivosDe(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  )
}

async function leerJson(res: Response): Promise<RespuestaAprobacion | null> {
  try {
    return (await res.json()) as RespuestaAprobacion
  } catch {
    return null
  }
}

function mensajeError(codigo: string | undefined): string {
  switch (codigo) {
    case "ESTADO":
      return "El envío cambió de estado y ya no es un borrador. Recargá la ficha y revisá el envío actual."
    case "REVALIDACION":
      return "La aprobación ya no coincide con el contenido actual. Revisá los motivos y regenerá o guardá el borrador antes de aprobar."
    case "CONFIGURACION":
      return "La configuración de envío está incompleta. Avisá al responsable técnico; no se aprobó nada."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se puede aprobar ni enviar nada."
    case "SIN_EMAIL":
      return "El prospecto no tiene email de contacto. Completalo con fuente antes de aprobar."
    case "NO_ENCONTRADO":
      return "El recurso no existe o fue eliminado."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para aprobar propuestas."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    case "VALIDACION":
      return "La confirmación no es válida. Recargá la página e intentá de nuevo."
    default:
      return "No se pudo aprobar el borrador. Intentá de nuevo."
  }
}

function fechaAprobado(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null
  return formatearFechaHoraPortal(fecha)
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

function EnlaceFuente({
  etiqueta,
  url,
}: {
  etiqueta: string
  url: string | null
}) {
  return (
    <Campo etiqueta={etiqueta}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={CLASE_ENLACE}
        >
          {url}
        </a>
      ) : (
        "—"
      )}
    </Campo>
  )
}

export function AprobacionPanel({
  envioId,
  estado,
  version,
  secuencia,
  plantillaVersion,
  destinatario,
  fromEmail,
  fromNombre,
  replyTo,
  asunto,
  cuerpoTexto,
  cuerpoHtml,
  aprobadoAsunto,
  aprobadoCuerpoTexto,
  aprobadoCuerpoHtml,
  aprobadoPorNombre,
  aprobadoEnTexto,
  bloqueos,
  fuentes,
  score,
  auditoriaEstado,
}: AprobacionPanelProps) {
  const router = useRouter()
  const [confirmado, setConfirmado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  const esAprobado = estado === "APROBADO"
  const esBorrador = estado === "BORRADOR"
  const asuntoMostrado = esAprobado ? aprobadoAsunto : asunto
  const cuerpoTextoMostrado = esAprobado
    ? aprobadoCuerpoTexto
    : cuerpoTexto
  const cuerpoHtmlMostrado = esAprobado ? aprobadoCuerpoHtml : cuerpoHtml

  const faltantes = new Set<string>(bloqueos.filter(Boolean))
  if ((destinatario ?? "").trim().length === 0) {
    faltantes.add("Falta el destinatario del envío.")
  }
  if (!fromEmail) {
    faltantes.add("Falta el remitente (PROPUESTAS_FROM_EMAIL).")
  }
  if (!replyTo) {
    faltantes.add("Falta el reply-to (PROPUESTAS_REPLY_TO).")
  }
  if ((asuntoMostrado ?? "").trim().length === 0) {
    faltantes.add("Falta el asunto del email.")
  }
  if ((cuerpoTextoMostrado ?? "").trim().length === 0) {
    faltantes.add("Falta el cuerpo del email.")
  }
  if (
    !fuentes.sitioWeb &&
    !fuentes.fuenteUrl &&
    !fuentes.emailFuenteUrl
  ) {
    faltantes.add("Falta la fuente pública de los datos para el aviso legal.")
  }

  const bloqueosVisibles = [...faltantes]
  const puedeAprobar =
    esBorrador && confirmado && bloqueosVisibles.length === 0 && !enviando

  async function aprobar(): Promise<void> {
    if (enCurso.current || !puedeAprobar) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/envios/${encodeURIComponent(envioId)}/aprobar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmado: true }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        const codigo = textoDe(data?.codigo) ?? undefined
        const motivos = motivosDe(data?.motivos)
        setMensaje({
          tono: "error",
          texto:
            motivos.length > 0
              ? `${mensajeError(codigo)} ${motivos.join(" ")}`
              : mensajeError(codigo),
        })
        return
      }

      const fecha = fechaAprobado(data?.aprobadoEn)
      setMensaje({
        tono: "ok",
        texto: fecha
          ? `Aprobación registrada el ${fecha}. No se envió ningún email: el envío es una acción separada que todavía no ocurrió.`
          : "Aprobación registrada. No se envió ningún email: el envío es una acción separada que todavía no ocurrió.",
      })
      setConfirmado(false)
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. La aprobación puede haberse guardado; recargá la ficha para verificarlo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <section
      aria-label="Aprobación de la propuesta"
      aria-busy={enviando}
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[70ch]">
          <h2 className="font-display text-xl font-semibold text-text">
            Aprobación
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            Revisá el snapshot completo antes de aprobar. La aprobación queda
            registrada con tu usuario y la fecha.
          </p>
        </div>
        <span className="rounded-full border border-violet/30 bg-violet-soft px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] text-text">
          {estado}
        </span>
      </div>

      <div
        role="note"
        aria-label="Aprobar no envía"
        className="mt-4 rounded-lg border border-mint/30 bg-mint/5 p-3 text-sm leading-6 text-text"
      >
        <strong>Aprobar no envía.</strong> La aprobación guarda un snapshot
        exacto del email y no llama a Resend. El envío real es otra acción
        separada (T-18) con su propia confirmación explícita.
      </div>

      {esAprobado ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-border bg-bg/40 p-3 text-sm leading-6 text-text-dim"
        >
          Snapshot aprobado e inmutable
          {aprobadoPorNombre ? ` por ${aprobadoPorNombre}` : ""}
          {aprobadoEnTexto ? ` el ${aprobadoEnTexto}` : ""}. El envío es otra
          acción: todavía no se envió ningún email.
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-text-dim">
          El footer legal, la fuente, el canal ARCO, el enlace visible de baja,
          el token y los headers <code>List-Unsubscribe</code> se materializan
          al aprobar. El borrador no los contiene todavía.
        </p>
      )}

      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Destinatario">
          {destinatario && destinatario.trim().length > 0
            ? destinatario
            : "Sin destinatario"}
        </Campo>
        <Campo etiqueta="From">
          {fromEmail
            ? fromNombre
              ? `${fromNombre} <${fromEmail}>`
              : fromEmail
            : "Sin remitente configurado"}
        </Campo>
        <Campo etiqueta="Reply-to">
          {replyTo ?? "Sin reply-to configurado"}
        </Campo>
        <Campo etiqueta="Asunto">
          {asuntoMostrado && asuntoMostrado.trim().length > 0
            ? asuntoMostrado
            : "Sin asunto"}
        </Campo>
        <Campo etiqueta="Versión y secuencia">
          <span className="font-mono text-xs">
            v{version} · secuencia {secuencia}
          </span>
        </Campo>
        <Campo etiqueta="Estado">{estado}</Campo>
        <Campo etiqueta="Score">
          {score === null ? "—" : `${score}/100`}
        </Campo>
        <Campo etiqueta="Auditoría">
          {auditoriaEstado ?? "Sin auditoría"}
        </Campo>
        <Campo etiqueta="Plantilla">
          <span className="font-mono text-xs">
            {plantillaVersion === null ? "—" : `v${plantillaVersion}`}
          </span>
        </Campo>
      </dl>

      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <EnlaceFuente etiqueta="Sitio web" url={fuentes.sitioWeb} />
        <EnlaceFuente etiqueta="Fuente de los datos" url={fuentes.fuenteUrl} />
        <EnlaceFuente
          etiqueta="Fuente del email"
          url={fuentes.emailFuenteUrl}
        />
      </dl>

      <div className="mt-5 space-y-3">
        <details className="rounded-lg border border-border bg-bg/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-text">
            Cuerpo (texto plano)
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-dim">
            {cuerpoTextoMostrado && cuerpoTextoMostrado.trim().length > 0
              ? cuerpoTextoMostrado
              : "Sin cuerpo."}
          </pre>
        </details>

        <details className="rounded-lg border border-border bg-bg/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-text">
            {esAprobado ? "HTML del snapshot" : "HTML del borrador"}
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-dim">
            {cuerpoHtmlMostrado && cuerpoHtmlMostrado.trim().length > 0
              ? cuerpoHtmlMostrado
              : esAprobado
                ? "Sin HTML en el snapshot."
                : "El HTML final se genera al aprobar."}
          </pre>
        </details>
      </div>

      {bloqueosVisibles.length > 0 && (
        <div
          role="note"
          aria-label="Motivos por los que no se puede aprobar"
          className={`mt-5 ${CLASE_BLOQUEO}`}
        >
          <p className="font-medium">
            {esAprobado
              ? "El snapshot aprobado tiene datos incompletos:"
              : "No se puede aprobar todavía:"}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {bloqueosVisibles.map((bloqueo, indice) => (
              <li key={`${indice}-${bloqueo}`}>{bloqueo}</li>
            ))}
          </ul>
        </div>
      )}

      {esBorrador && (
        <div className="mt-5 rounded-lg border border-border bg-bg/40 p-4">
          <div className="flex items-start gap-3">
            <input
              id={`aprobacion-confirmar-${envioId}`}
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-violet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
              checked={confirmado}
              onChange={(evento) => setConfirmado(evento.target.checked)}
              disabled={enviando}
              aria-describedby={`aprobacion-confirmar-ayuda-${envioId}`}
            />
            <div>
              <label
                htmlFor={`aprobacion-confirmar-${envioId}`}
                className="text-sm font-medium text-text"
              >
                Confirmo que revisé el destinatario, el asunto y el cuerpo.
                Entiendo que aprobar no envía el email.
              </label>
              <p
                id={`aprobacion-confirmar-ayuda-${envioId}`}
                className="mt-1 text-xs leading-5 text-text-faint"
              >
                La aprobación congela el snapshot; el envío queda pendiente de
                una segunda confirmación (T-18).
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              onClick={() => void aprobar()}
              disabled={!puedeAprobar}
              aria-busy={enviando}
            >
              {enviando ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {enviando ? "Aprobando…" : "Aprobar"}
            </Button>
            <p className="text-xs text-text-dim">
              Solo se guarda el snapshot. No se llama a Resend ni a ningún
              proveedor.
            </p>
          </div>
        </div>
      )}

      {esAprobado && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-mint/30 bg-mint/5 p-3 text-sm leading-6 text-text">
          <CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
          <p>
            Este envío está aprobado. No se envía nada automáticamente: el
            envío es otra acción (T-18).
          </p>
        </div>
      )}

      {!esBorrador && !esAprobado && (
        <p
          role="status"
          className="mt-5 rounded-lg border border-border bg-bg/40 p-3 text-sm leading-6 text-text-dim"
        >
          Solo un borrador puede aprobarse. Este envío está en estado{" "}
          <span className="font-mono text-xs">{estado}</span>.
        </p>
      )}

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "error" ? "alert" : "status"}
          className={`${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : mensaje.tono === "aviso"
                ? "border-amber-500/30 bg-amber-500/5 text-text"
                : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}
    </section>
  )
}
