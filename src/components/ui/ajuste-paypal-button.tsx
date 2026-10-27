"use client"

/**
 * Reembolso / contracargo manual de un pago PayPal (T-26: AC-17, AC-22, AC-23).
 *
 * - Solo admin: con `puedeRegistrarAjuste = false` no se renderiza nada. La API
 *   `/api/admin/paypal/ajustes` vuelve a exigir admin.
 * - Solo se ofrece para pagos PayPal `SUCCEEDED` o `REVISION` rechazados con
 *   monto disponible, igual que `lib/paypal/adjustments.ts`.
 * - El modal advierte que el pago original se conserva: no se editan montos,
 *   comision, recibo ni referencias; solo se registra el `AjustePago`, cambia el
 *   estado a Reembolsado/Contracargo y se aplica la decision explicita.
 * - Pide confirmacion en un segundo paso antes de enviar. Los errores usan
 *   `role=alert`, el exito `role=status` + `aria-live`, y el foco vuelve al
 *   disparador al cerrar.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { PaypalDialog } from "@/components/ui/paypal-dialog"
import { formatearMonto } from "@/lib/pagos"
import {
  esPagoAjustablePaypal,
  montoDisponibleAjuste,
} from "@/lib/paypal/ajuste-view"
import { centavosAInput, parsearMontoUsd } from "@/lib/paypal/monto-input"

export type TipoAjustePaypal = "REEMBOLSO" | "CONTRACARGO"
export type DecisionAjustePaypal =
  | "NINGUNA"
  | "REVERTIR_HITO"
  | "DESCONTAR_MESES"

export interface AjustePaypalPago {
  id: string
  /** Total original del pago en centavos. */
  monto: number
  moneda?: string | null
  /** Suma de los `AjustePago` previos (centavos). */
  montoAjustado?: number | null
  tieneHito: boolean
  tieneSoporte: boolean
  estadoPago?: string | null
  revisionEstado?: string | null
  concepto?: string | null
  referencia?: string | null
  /** Pasarela del pago; el ajuste solo aplica a `PAYPAL`. */
  pasarela: string | null
}

export interface RegistrarAjustePaypalRequest {
  pagoId: string
  tipo: TipoAjustePaypal
  montoCents: number
  motivo: string | null
  evidencia: string | null
  decision: DecisionAjustePaypal
  mesesDescontados: number | null
}

export interface RegistrarAjustePaypalResult {
  ok: boolean
  ajusteId?: string | null
  pagoId?: string | null
  estadoPago?: string | null
  decision?: string | null
  mesesDescontados?: number | null
}

export interface AjustePaypalButtonProps {
  pago: AjustePaypalPago
  /** Solo admin. Si es `false` no se renderiza el disparador. */
  puedeRegistrarAjuste: boolean
  label?: string
  ariaLabel?: string
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  className?: string
  /** Presupuesto de la peticion. Default 15 s. */
  timeoutMs?: number
  /** Inyectable en tests o para reutilizar el modal. */
  registrarAjuste?: (
    input: RegistrarAjustePaypalRequest
  ) => Promise<RegistrarAjustePaypalResult>
  onSuccess?: () => void
}

export interface AjustePaypalModalProps
  extends Omit<
    AjustePaypalButtonProps,
    "label" | "ariaLabel" | "size" | "variant" | "className"
  > {
  open: boolean
  onClose: () => void
}

const TIMEOUT_MS_DEFAULT = 15_000
const MENSAJE_TIMEOUT = "La operación tardó demasiado. Reintentá."
const MENSAJE_CONEXION = "Error de conexión. Reintentá."
const MENSAJE_MONTO = "Ingresá un monto válido en USD (por ejemplo 100,50)."
const MENSAJE_MONTO_EXCEDE =
  "El monto supera lo disponible del pago para ajustar."
const MENSAJE_TEXTO = "Indicá al menos un motivo o una evidencia."
const MENSAJE_MESES = "Elegí entre 1 y 12 meses."
const MENSAJE_DECISION =
  "La decisión elegida no aplica al concepto del pago."
const MENSAJE_REGISTRAR = "No se pudo registrar el ajuste de PayPal."
const MENSAJE_INVALIDO = "El servidor devolvió una respuesta inválida."

const ESTADO_LABEL: Record<string, string> = {
  REFUNDED: "Reembolsado",
  CONTRACARGO: "Contracargo",
}

function esAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

function mensajeDeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return "No se pudo completar la operación. Reintentá."
}

function conTimeout<T>(promesa: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(MENSAJE_TIMEOUT)), timeoutMs)
    promesa.then(
      (valor) => {
        clearTimeout(timer)
        resolve(valor)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function leerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {}
  } catch (error) {
    if (esAbort(error)) throw error
    return {}
  }
}

function mensajeDeRespuesta(
  body: Record<string, unknown>,
  fallback: string
): string {
  return typeof body.error === "string" && body.error.trim().length > 0
    ? body.error
    : fallback
}

async function postConTimeout(
  url: string,
  input: unknown,
  timeoutMs: number
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let res: Response
    let body: Record<string, unknown>
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      body = await leerJson(res)
    } catch (error) {
      throw new Error(esAbort(error) ? MENSAJE_TIMEOUT : MENSAJE_CONEXION)
    }
    return { res, body }
  } finally {
    clearTimeout(timer)
  }
}

async function pedirAjuste(
  input: RegistrarAjustePaypalRequest,
  timeoutMs: number
): Promise<RegistrarAjustePaypalResult> {
  const { res, body } = await postConTimeout(
    "/api/admin/paypal/ajustes",
    input,
    timeoutMs
  )

  if (!res.ok) {
    throw new Error(mensajeDeRespuesta(body, MENSAJE_REGISTRAR))
  }
  if (body.ok !== true) throw new Error(MENSAJE_INVALIDO)

  return {
    ok: true,
    ajusteId: typeof body.ajusteId === "string" ? body.ajusteId : null,
    pagoId: typeof body.pagoId === "string" ? body.pagoId : null,
    estadoPago: typeof body.estadoPago === "string" ? body.estadoPago : null,
    decision: typeof body.decision === "string" ? body.decision : null,
    mesesDescontados:
      typeof body.mesesDescontados === "number"
        ? body.mesesDescontados
        : null,
  }
}

export function AjustePaypalModal({
  open,
  onClose,
  pago,
  puedeRegistrarAjuste,
  timeoutMs = TIMEOUT_MS_DEFAULT,
  registrarAjuste,
  onSuccess,
}: AjustePaypalModalProps) {
  const baseId = useId()
  const tipoId = `${baseId}-tipo`
  const montoId = `${baseId}-monto`
  const motivoId = `${baseId}-motivo`
  const evidenciaId = `${baseId}-evidencia`
  const decisionId = `${baseId}-decision`
  const mesesId = `${baseId}-meses`
  const montoAyudaId = `${baseId}-monto-ayuda`

  const router = useRouter()
  const onCloseRef = useRef(onClose)
  const estabaAbiertoRef = useRef(false)
  const peticionRef = useRef(0)
  const confirmarRef = useRef<HTMLButtonElement>(null)
  const successRef = useRef<HTMLButtonElement>(null)

  const disponible = montoDisponibleAjuste(pago)
  const moneda = pago.moneda === "ars" ? "ars" : "usd"
  const puedeAjustar = esPagoAjustablePaypal(pago)

  const [tipo, setTipo] = useState<TipoAjustePaypal>("REEMBOLSO")
  const [monto, setMonto] = useState(() => centavosAInput(disponible))
  const [motivo, setMotivo] = useState("")
  const [evidencia, setEvidencia] = useState("")
  const [decision, setDecision] = useState<DecisionAjustePaypal>("NINGUNA")
  const [meses, setMeses] = useState(1)
  const [confirmando, setConfirmando] = useState(false)
  const [accion, setAccion] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [campoInvalido, setCampoInvalido] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RegistrarAjustePaypalResult | null>(
    null
  )

  useEffect(() => {
    onCloseRef.current = () => {
      peticionRef.current += 1
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (open && !estabaAbiertoRef.current) {
      peticionRef.current += 1
      setTipo("REEMBOLSO")
      setMonto(centavosAInput(disponible))
      setMotivo("")
      setEvidencia("")
      setDecision("NINGUNA")
      setMeses(1)
      setConfirmando(false)
      setAccion(false)
      setError("")
      setFeedback("")
      setCampoInvalido(null)
      setResultado(null)
    }

    if (!open) peticionRef.current += 1
    estabaAbiertoRef.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (confirmando) confirmarRef.current?.focus()
  }, [confirmando])

  useEffect(() => {
    if (resultado) successRef.current?.focus()
  }, [resultado])

  function nuevaPeticion(): number {
    peticionRef.current += 1
    return peticionRef.current
  }

  function cerrar() {
    onCloseRef.current()
  }

  function limpiarAvisos() {
    setError("")
    setFeedback("")
    setCampoInvalido(null)
    setConfirmando(false)
  }

  function cambiarTipo(valor: string) {
    setTipo(valor === "CONTRACARGO" ? "CONTRACARGO" : "REEMBOLSO")
    limpiarAvisos()
  }

  function cambiarMonto(valor: string) {
    setMonto(valor)
    limpiarAvisos()
  }

  function cambiarTexto(
    setter: (valor: string) => void,
    valor: string
  ) {
    setter(valor)
    limpiarAvisos()
  }

  function cambiarDecision(valor: string) {
    if (
      valor === "REVERTIR_HITO" ||
      valor === "DESCONTAR_MESES" ||
      valor === "NINGUNA"
    ) {
      setDecision(valor)
    } else {
      setDecision("NINGUNA")
    }
    limpiarAvisos()
  }

  function cambiarMeses(valor: number) {
    setMeses(Math.min(12, Math.max(1, Math.trunc(valor))))
    limpiarAvisos()
  }

  function volver() {
    setConfirmando(false)
    document.getElementById(tipoId)?.focus()
  }

  const montoCents = parsearMontoUsd(monto)

  function validar(): { campo: string; mensaje: string } | null {
    if (montoCents === null) return { campo: montoId, mensaje: MENSAJE_MONTO }
    if (montoCents > disponible) {
      return { campo: montoId, mensaje: MENSAJE_MONTO_EXCEDE }
    }

    if (motivo.trim().length === 0 && evidencia.trim().length === 0) {
      return { campo: motivoId, mensaje: MENSAJE_TEXTO }
    }

    if (decision === "REVERTIR_HITO" && !pago.tieneHito) {
      return { campo: decisionId, mensaje: MENSAJE_DECISION }
    }
    if (decision === "DESCONTAR_MESES" && !pago.tieneSoporte) {
      return { campo: decisionId, mensaje: MENSAJE_DECISION }
    }
    if (
      decision === "DESCONTAR_MESES" &&
      (meses < 1 || meses > 12 || !Number.isSafeInteger(meses))
    ) {
      return { campo: mesesId, mensaje: MENSAJE_MESES }
    }

    return null
  }

  function pedirConfirmacion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (accion) return

    const problema = validar()
    if (problema) {
      setError(problema.mensaje)
      setCampoInvalido(problema.campo)
      document.getElementById(problema.campo)?.focus()
      return
    }

    setError("")
    setFeedback("")
    setCampoInvalido(null)
    setConfirmando(true)
  }

  async function confirmar() {
    if (accion) return
    if (montoCents === null) return

    const problema = validar()
    if (problema) {
      setError(problema.mensaje)
      setCampoInvalido(problema.campo)
      setConfirmando(false)
      document.getElementById(problema.campo)?.focus()
      return
    }

    const input: RegistrarAjustePaypalRequest = {
      pagoId: pago.id,
      tipo,
      montoCents,
      motivo: motivo.trim().length > 0 ? motivo.trim() : null,
      evidencia: evidencia.trim().length > 0 ? evidencia.trim() : null,
      decision,
      mesesDescontados: decision === "DESCONTAR_MESES" ? meses : null,
    }

    const peticion = nuevaPeticion()
    setAccion(true)
    setError("")

    try {
      const res = registrarAjuste
        ? await conTimeout(registrarAjuste(input), timeoutMs)
        : await pedirAjuste(input, timeoutMs)

      if (peticion !== peticionRef.current) return
      if (!res.ok) throw new Error(MENSAJE_REGISTRAR)

      setResultado(res)
      setFeedback("Ajuste registrado.")
      setConfirmando(false)
      onSuccess?.()
      router.refresh()
    } catch (fallo) {
      if (peticion !== peticionRef.current) return
      setError(mensajeDeError(fallo))
      setConfirmando(false)
    } finally {
      if (peticion === peticionRef.current) setAccion(false)
    }
  }

  if (!puedeRegistrarAjuste || !puedeAjustar) return null

  const cargando = accion
  const estadoVisible = ESTADO_LABEL[resultado?.estadoPago ?? ""] ?? null
  const tipoLabel = tipo === "REEMBOLSO" ? "reembolso" : "contracargo"
  const decisionLabel =
    decision === "REVERTIR_HITO"
      ? "El hito vinculado volverá a PENDIENTE."
      : decision === "DESCONTAR_MESES"
        ? `Se descontarán ${meses} ${meses === 1 ? "mes" : "meses"} del vencimiento del soporte.`
        : "No se modifica el hito ni el soporte."

  return (
    <PaypalDialog
      open={open}
      onClose={cerrar}
      title="Reembolso o contracargo"
      description={
        pago.concepto
          ? `${pago.concepto}${pago.referencia ? ` · ${pago.referencia}` : ""}`
          : (pago.referencia ?? pago.id)
      }
      busy={cargando}
      maxWidthClassName="max-w-lg"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {feedback}
      </p>

      {resultado ? (
        <div className="space-y-4">
          <div
            className="flex flex-col items-center gap-2 rounded-lg px-3 py-4 text-center"
            style={{ background: "rgba(52,211,153,0.08)" }}
          >
            <CheckCircle2 size={28} style={{ color: "#34d399" }} />
            <p className="text-sm font-medium" style={{ color: "#34d399" }}>
              Ajuste registrado
            </p>
            <p className="text-xs text-text-dim">
              {estadoVisible
                ? `El pago quedó como ${estadoVisible}.`
                : "El pago original se conserva."}
              {resultado.mesesDescontados
                ? ` Meses descontados: ${resultado.mesesDescontados}.`
                : ""}
            </p>
          </div>
          <Button
            ref={successRef}
            type="button"
            variant="ghost"
            className="w-full"
            onClick={cerrar}
          >
            Cerrar
          </Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={pedirConfirmacion} noValidate>
          <div
            role="note"
            className="rounded-lg border px-3 py-2.5 text-xs"
            style={{
              borderColor: "rgba(251,191,36,0.35)",
              background: "rgba(251,191,36,0.08)",
              color: "#fbbf24",
            }}
          >
            El pago original se conserva: montos, comisión, recibo y
            referencias no se modifican. Solo se registra el ajuste y cambia el
            estado del pago.
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={tipoId}
                className="mb-1 block text-xs text-text-dim"
              >
                Tipo de ajuste
              </label>
              <select
                id={tipoId}
                value={tipo}
                disabled={cargando || confirmando}
                onChange={(event) => cambiarTipo(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
              >
                <option value="REEMBOLSO">Reembolso</option>
                <option value="CONTRACARGO">Contracargo</option>
              </select>
            </div>
            <div>
              <label
                htmlFor={montoId}
                className="mb-1 block text-xs text-text-dim"
              >
                Monto del ajuste (USD)
              </label>
              <input
                id={montoId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                disabled={cargando || confirmando}
                value={monto}
                aria-invalid={campoInvalido === montoId}
                aria-describedby={montoAyudaId}
                onChange={(event) => cambiarMonto(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
          </div>
          <p
            id={montoAyudaId}
            className="text-text-dim"
            style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
          >
            Disponible para ajustar: {formatearMonto(disponible, moneda)} de{" "}
            {formatearMonto(pago.monto, moneda)}.
          </p>

          <div>
            <label
              htmlFor={motivoId}
              className="mb-1 block text-xs text-text-dim"
            >
              Motivo
            </label>
            <textarea
              id={motivoId}
              rows={2}
              disabled={cargando || confirmando}
              value={motivo}
              aria-invalid={campoInvalido === motivoId}
              onChange={(event) => cambiarTexto(setMotivo, event.target.value)}
              placeholder="Motivo del reembolso o contracargo"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            />
          </div>

          <div>
            <label
              htmlFor={evidenciaId}
              className="mb-1 block text-xs text-text-dim"
            >
              Evidencia
            </label>
            <textarea
              id={evidenciaId}
              rows={2}
              disabled={cargando || confirmando}
              value={evidencia}
              onChange={(event) =>
                cambiarTexto(setEvidencia, event.target.value)
              }
              placeholder="ID de reembolso de PayPal, comprobante o URL"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            />
            <p
              className="mt-1 text-text-dim"
              style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
            >
              Texto o URL. Sin archivos adjuntos.
            </p>
          </div>

          <div>
            <label
              htmlFor={decisionId}
              className="mb-1 block text-xs text-text-dim"
            >
              Decisión
            </label>
            <select
              id={decisionId}
              value={decision}
              disabled={cargando || confirmando}
              aria-invalid={campoInvalido === decisionId}
              onChange={(event) => cambiarDecision(event.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            >
              <option value="NINGUNA">Ninguna (solo registrar el ajuste)</option>
              <option value="REVERTIR_HITO" disabled={!pago.tieneHito}>
                Revertir el hito
              </option>
              <option value="DESCONTAR_MESES" disabled={!pago.tieneSoporte}>
                Descontar meses del soporte
              </option>
            </select>
          </div>

          {decision === "DESCONTAR_MESES" && (
            <div>
              <label
                htmlFor={mesesId}
                className="mb-1 block text-xs text-text-dim"
              >
                Meses a descontar
              </label>
              <select
                id={mesesId}
                value={meses}
                disabled={cargando || confirmando}
                aria-invalid={campoInvalido === mesesId}
                onChange={(event) => cambiarMeses(Number(event.target.value))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              >
                {Array.from({ length: 12 }, (_, indice) => indice + 1).map(
                  (valor) => (
                    <option key={valor} value={valor}>
                      {valor} {valor === 1 ? "mes" : "meses"}
                    </option>
                  )
                )}
              </select>
            </div>
          )}

          <p className="text-xs text-text-dim">{decisionLabel}</p>

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          {confirmando ? (
            <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
              <p role="alert" className="text-xs text-red-400">
                ¿Confirmás el {tipoLabel} por{" "}
                {montoCents !== null
                  ? formatearMonto(montoCents, moneda)
                  : "—"}
                ? El pago original se conserva.
              </p>
              <div className="flex gap-3">
                <Button
                  ref={confirmarRef}
                  type="button"
                  className="flex-1"
                  disabled={cargando}
                  onClick={() => void confirmar()}
                >
                  {cargando ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : null}
                  {cargando
                    ? "Registrando…"
                    : `Confirmar ${tipoLabel}`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  disabled={cargando}
                  onClick={volver}
                >
                  Volver
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 pt-1">
              <Button
                type="submit"
                className="flex-1"
                disabled={cargando}
              >
                <RotateCcw size={14} className="mr-1.5" />
                Registrar ajuste
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                disabled={cargando}
                onClick={cerrar}
              >
                Cancelar
              </Button>
            </div>
          )}
        </form>
      )}
    </PaypalDialog>
  )
}

export function AjustePaypalButton({
  pago,
  puedeRegistrarAjuste,
  label = "Ajuste PayPal",
  ariaLabel,
  size = "sm",
  variant = "outline",
  className,
  timeoutMs,
  registrarAjuste,
  onSuccess,
}: AjustePaypalButtonProps) {
  const [open, setOpen] = useState(false)

  if (!puedeRegistrarAjuste) return null
  if (!esPagoAjustablePaypal(pago)) return null

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <RotateCcw size={14} className="mr-1.5" />
        {label}
      </Button>
      <AjustePaypalModal
        open={open}
        onClose={() => setOpen(false)}
        pago={pago}
        puedeRegistrarAjuste={puedeRegistrarAjuste}
        timeoutMs={timeoutMs}
        registrarAjuste={registrarAjuste}
        onSuccess={onSuccess}
      />
    </>
  )
}
