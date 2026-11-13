"use client"

/**
 * T-18 (AC-26, AC-28, AC-29, AC-30, AC-31; RF-43..RF-50): confirmación de
 * envío, seguimiento y registro de resultado.
 *
 * - `EnvioConfirmacion`: modal **separado** del de aprobación. Exige marcar
 *   "Entiendo que se enviará un email real" y escribe `confirmacion: "ENVIAR"`.
 *   Un doble clic queda bloqueado en cliente; el servidor igual revalida todo.
 *   Si el gate/configuración de envío está incompleto, la acción queda
 *   deshabilitada con los motivos (el servidor ya falla cerrado).
 * - `EnvioSeguimiento`: muestra estado/message ID/error saneado y permite
 *   registrar RESPONDIDO / REBOTE_DURO / QUEJA o crear una versión BORRADOR
 *   para reintentar un FALLIDO. Ninguna acción envía automáticamente.
 * - Todo se refresca con `router.refresh()`; no hay auto-refresh ni scheduler.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MailCheck,
  RotateCcw,
  Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { PaypalDialog } from "@/components/ui/paypal-dialog"

export interface EnvioConfirmacionProps {
  envioId: string
  destinatario: string
  asunto: string
  version: number
  secuencia: number
  /** `false` si el gate o la configuracion de Resend estan incompletos. */
  habilitado?: boolean
  /** Motivos saneados de `estadoEnvio` cuando el envio esta deshabilitado. */
  motivos?: string[]
}

export interface EnvioSeguimientoProps {
  envioId: string
  estado: string
  version: number
  secuencia: number
  proveedorMessageId: string | null
  error: string | null
  fechaTexto: string | null
  /** Hay un BORRADOR/APROBADO actual: no se ofrece otro reintento. */
  hayEnvioAbierto: boolean
}

type TipoResultado = "RESPONDIDO" | "REBOTE_DURO" | "QUEJA"

interface Mensaje {
  tono: "ok" | "aviso" | "error"
  texto: string
}

interface RespuestaApi {
  estado?: unknown
  messageId?: unknown
  envioId?: unknown
  version?: unknown
  codigo?: unknown
  motivos?: unknown
}

const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_VALOR = "mt-1 text-sm leading-6 text-text"
const CLASE_MENSAJE =
  "mt-4 rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_SELECT =
  "mt-1 flex h-10 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_TEXTAREA =
  "mt-1 flex min-h-[80px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"

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

async function leerJson(res: Response): Promise<RespuestaApi | null> {
  try {
    return (await res.json()) as RespuestaApi
  } catch {
    return null
  }
}

function mensajeError(codigo: string | undefined): string {
  switch (codigo) {
    case "ESTADO":
      return "El envío cambió de estado. Recargá la ficha y revisá el envío actual."
    case "REVALIDACION":
      return "La aprobación ya no coincide con el contenido o la configuración actual. Revisá los motivos y aprobá de nuevo antes de enviar."
    case "CONFIGURACION":
      return "La configuración de envío está incompleta. Avisá al responsable técnico; no se envió nada."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se puede enviar nada."
    case "SIN_EMAIL":
      return "El prospecto no tiene email de contacto válido."
    case "CUPO":
      return "Se alcanzó el cupo diario de envíos. No se encola: se reintenta el día siguiente o se ajusta el cupo aprobado."
    case "PROVEEDOR":
      return "El proveedor no confirmó el envío. El envío quedó FALLIDO y no se reintenta automáticamente."
    case "BORRADOR_ABIERTO":
      return "Ya hay un borrador o una aprobación pendiente para este mensaje. Editá y aprobá esa versión."
    case "NO_ENCONTRADO":
      return "El recurso no existe o fue eliminado."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para enviar propuestas."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    case "VALIDACION":
      return "La confirmación no es válida. Recargá la página e intentá de nuevo."
    case "NO_CONFIGURADO":
      return "Falta configuración del portal para esta acción. No se envió nada."
    default:
      return "No se pudo completar la acción. Intentá de nuevo."
  }
}

function colorEstado(estado: string): string {
  switch (estado) {
    case "ENVIADO":
    case "RESPONDIDO":
      return "border-mint/30 bg-mint/5 text-mint"
    case "ENVIANDO":
      return "border-cyan/30 bg-cyan/5 text-cyan"
    case "FALLIDO":
    case "REBOTADO":
    case "QUEJA":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    default:
      return "border-border bg-bg/40 text-text-dim"
  }
}

function etiquetaResultado(tipo: TipoResultado): string {
  switch (tipo) {
    case "RESPONDIDO":
      return "Respondido"
    case "REBOTE_DURO":
      return "Rebote duro"
    case "QUEJA":
      return "Queja"
  }
}

function Aviso({ mensaje }: { mensaje: Mensaje }) {
  return (
    <div
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
  )
}

export function EnvioConfirmacion({
  envioId,
  destinatario,
  asunto,
  version,
  secuencia,
  habilitado = true,
  motivos = [],
}: EnvioConfirmacionProps) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)

  useEffect(() => {
    if (mensaje === null) return
    const nodo = document.getElementById(`envio-mensaje-${envioId}`)
    nodo?.focus()
  }, [mensaje, envioId])

  function cerrar(): void {
    if (enviando) return
    setAbierto(false)
    setMensaje(null)
  }

  async function enviar(): Promise<void> {
    if (enCurso.current || !confirmado || !habilitado) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/envios/${encodeURIComponent(envioId)}/enviar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmacion: "ENVIAR" }),
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

      const messageId = textoDe(data?.messageId)
      setConfirmado(false)
      setMensaje({
        tono: "ok",
        texto: messageId
          ? `Email enviado a Resend. Message ID: ${messageId}`
          : "Email enviado a Resend.",
      })
      setAbierto(false)
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. El envío puede haberse procesado; recargá la ficha y verificá el estado antes de reintentar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <section
      aria-label="Confirmación de envío"
      aria-busy={enviando}
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[70ch]">
          <h2 className="font-display text-xl font-semibold text-text">
            Enviar la propuesta
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            La aprobación guardó el snapshot, pero todavía no se envió nada.
            El envío real es una segunda acción explícita y no se programa.
          </p>
        </div>
        <span className="rounded-full border border-violet/30 bg-violet-soft px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] text-text">
          {habilitado ? "APROBADO" : "ENVÍO DESHABILITADO"}
        </span>
      </div>

      {!habilitado && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          <p>
            El envío real está deshabilitado en este entorno. La aprobación
            quedó guardada y no se envió nada.
          </p>
          {motivos.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-text-dim">
              {motivos.map((motivo) => (
                <li key={motivo}>{motivo}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className={CLASE_DEFINICION}>Destinatario</dt>
          <dd className={CLASE_VALOR}>{destinatario || "Sin destinatario"}</dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>Asunto</dt>
          <dd className={CLASE_VALOR}>{asunto || "Sin asunto"}</dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>Versión y secuencia</dt>
          <dd className={`${CLASE_VALOR} font-mono text-xs`}>
            v{version} · secuencia {secuencia}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button
          type="button"
          onClick={() => setAbierto(true)}
          disabled={enviando || !habilitado}
        >
          <Send aria-hidden="true" />
          Enviar email
        </Button>
        <p className="text-xs text-text-dim">
          No hay autoenvío, envío por lote, cola ni programación.
        </p>
      </div>

      {mensaje && !abierto && (
        <div id={`envio-mensaje-${envioId}`}>
          <Aviso mensaje={mensaje} />
        </div>
      )}

      <PaypalDialog
        open={abierto && habilitado}
        onClose={cerrar}
        title="Confirmar envío real"
        description={`${destinatario} · v${version} · secuencia ${secuencia}`}
        busy={enviando}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <div
            role="note"
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
          >
            <strong>Se enviará un email real a {destinatario}.</strong> Se llama
            a Resend una sola vez con clave de idempotencia. Si el proveedor
            falla, el envío queda FALLIDO y no se reintenta automáticamente.
          </div>

          <div className="mt-1">
            <p className={CLASE_DEFINICION}>Asunto</p>
            <p className={CLASE_VALOR}>{asunto || "Sin asunto"}</p>
          </div>

          <div className="flex items-start gap-3">
            <input
              id={`envio-confirmar-${envioId}`}
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-violet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
              checked={confirmado}
              onChange={(evento) => setConfirmado(evento.target.checked)}
              disabled={enviando}
            />
            <label
              htmlFor={`envio-confirmar-${envioId}`}
              className="text-sm font-medium text-text"
            >
              Entiendo que se enviará un email real
            </label>
          </div>

          {mensaje && <Aviso mensaje={mensaje} />}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={cerrar}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void enviar()}
              disabled={!confirmado || enviando}
              aria-busy={enviando}
            >
              {enviando ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {enviando ? "Enviando…" : "Enviar email real"}
            </Button>
          </div>
        </div>
      </PaypalDialog>
    </section>
  )
}

export function EnvioSeguimiento({
  envioId,
  estado,
  version,
  secuencia,
  proveedorMessageId,
  error,
  fechaTexto,
  hayEnvioAbierto,
}: EnvioSeguimientoProps) {
  const router = useRouter()
  const [tipo, setTipo] = useState<TipoResultado>("RESPONDIDO")
  const [detalle, setDetalle] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)

  useEffect(() => {
    if (mensaje === null) return
    const nodo = document.getElementById(`seguimiento-mensaje-${envioId}`)
    nodo?.focus()
  }, [mensaje, envioId])

  const esEnviado = estado === "ENVIADO"
  const esFallido = estado === "FALLIDO"
  const esEnviando = estado === "ENVIANDO"
  const esFinal =
    estado === "REBOTADO" || estado === "QUEJA" || estado === "RESPONDIDO"

  async function registrarResultado(): Promise<void> {
    if (enCurso.current || !esEnviado) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/envios/${encodeURIComponent(envioId)}/resultado`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo,
            ...(detalle.trim().length > 0 ? { detalle: detalle.trim() } : {}),
          }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo) ?? undefined),
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto:
          tipo === "RESPONDIDO"
            ? "Resultado registrado: el prospecto respondió."
            : `Resultado registrado: ${etiquetaResultado(
                tipo,
              )}. El email quedó suprimido y se cancelaron los pendientes.`,
      })
      setDetalle("")
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Recargá la ficha y verificá el estado antes de volver a intentar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  async function reintentar(): Promise<void> {
    if (enCurso.current || !esFallido || hayEnvioAbierto) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/envios/${encodeURIComponent(envioId)}/reintentar`,
        { method: "POST" },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo) ?? undefined),
        })
        return
      }

      const nuevaVersion =
        typeof data?.version === "number" ? data.version : null
      setMensaje({
        tono: "ok",
        texto:
          nuevaVersion !== null
            ? `Se creó un borrador nuevo (v${nuevaVersion}). No se envió nada: editalo y aprobalo antes de enviar.`
            : "Se creó un borrador nuevo. No se envió nada: editalo y aprobalo antes de enviar.",
      })
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Recargá la ficha y verificá si se creó una versión nueva.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <section
      aria-label="Seguimiento del envío"
      aria-busy={enviando}
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[70ch]">
          <h2 className="font-display text-xl font-semibold text-text">
            Seguimiento del envío
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            Estado del email, message ID y resultado. Registrar un resultado no
            envía nada ni reintenta automáticamente.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] ${colorEstado(
            estado,
          )}`}
        >
          {estado}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className={CLASE_DEFINICION}>Message ID</dt>
          <dd className={`${CLASE_VALOR} break-all font-mono text-xs`}>
            {proveedorMessageId ?? "—"}
          </dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>Enviado</dt>
          <dd className={CLASE_VALOR}>{fechaTexto ?? "—"}</dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>Versión y secuencia</dt>
          <dd className={`${CLASE_VALOR} font-mono text-xs`}>
            v{version} · secuencia {secuencia}
          </dd>
        </div>
      </dl>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm leading-6 text-red-300"
        >
          Error saneado: <span className="font-mono text-xs">{error}</span>
        </p>
      )}

      {esEnviando && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-cyan/30 bg-cyan/5 p-3 text-sm leading-6 text-text"
        >
          El envío quedó en curso. Si pasaron más de 10 minutos sin
          confirmación, hace falta reconciliarlo manualmente verificando el
          estado en Resend. No se reintenta solo.
        </p>
      )}

      {esEnviado && (
        <div className="mt-5 rounded-lg border border-border bg-bg/40 p-4">
          <h3 className="font-display text-lg font-semibold text-text">
            Registrar resultado
          </h3>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            v1 no usa webhooks de Resend: el resultado se registra a mano.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`resultado-tipo-${envioId}`}
                className={CLASE_DEFINICION}
              >
                Resultado
              </label>
              <select
                id={`resultado-tipo-${envioId}`}
                className={CLASE_SELECT}
                value={tipo}
                onChange={(evento) =>
                  setTipo(evento.target.value as TipoResultado)
                }
                disabled={enviando}
              >
                <option value="RESPONDIDO">Respondido</option>
                <option value="REBOTE_DURO">Rebote duro</option>
                <option value="QUEJA">Queja</option>
              </select>
            </div>
            <div>
              <label
                htmlFor={`resultado-detalle-${envioId}`}
                className={CLASE_DEFINICION}
              >
                Detalle (opcional)
              </label>
              <textarea
                id={`resultado-detalle-${envioId}`}
                className={CLASE_TEXTAREA}
                value={detalle}
                maxLength={500}
                onChange={(evento) => setDetalle(evento.target.value)}
                disabled={enviando}
                placeholder="Sin datos sensibles"
              />
            </div>
          </div>

          {tipo !== "RESPONDIDO" && (
            <div
              role="note"
              className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-1 h-4 w-4 shrink-0"
              />
              <p>
                Un rebote duro o una queja suprimen el email por hash y cancelan
                los borradores/aprobaciones pendientes del prospecto. No se
                reintenta automáticamente.
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              onClick={() => void registrarResultado()}
              disabled={enviando}
              aria-busy={enviando}
            >
              {enviando ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <MailCheck aria-hidden="true" />
              )}
              {enviando ? "Registrando…" : "Registrar resultado"}
            </Button>
          </div>
        </div>
      )}

      {esFallido && (
        <div className="mt-5 rounded-lg border border-border bg-bg/40 p-4">
          <h3 className="font-display text-lg font-semibold text-text">
            Reintento manual
          </h3>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            Un envío FALLIDO no se reintenta solo. Crear una versión nueva no
            envía nada: después hay que editarla y aprobarla otra vez.
          </p>

          {hayEnvioAbierto ? (
            <p
              role="status"
              className="mt-3 rounded-lg border border-border bg-panel p-3 text-sm leading-6 text-text-dim"
            >
              Ya hay un borrador o una aprobación pendiente para este mensaje.
              Revisá esa versión antes de crear otra.
            </p>
          ) : (
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void reintentar()}
                disabled={enviando}
                aria-busy={enviando}
              >
                {enviando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                {enviando
                  ? "Creando versión…"
                  : "Crear versión BORRADOR para reintentar"}
              </Button>
            </div>
          )}
        </div>
      )}

      {esFinal && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-mint/30 bg-mint/5 p-3 text-sm leading-6 text-text">
          <CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
          <p>
            El resultado de este envío ya está registrado. No se envía nada más
            automáticamente; un follow-up exigiría un borrador nuevo y una
            aprobación nueva.
          </p>
        </div>
      )}

      {mensaje && (
        <div id={`seguimiento-mensaje-${envioId}`}>
          <Aviso mensaje={mensaje} />
        </div>
      )}
    </section>
  )
}
