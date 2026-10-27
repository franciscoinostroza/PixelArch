"use client"

/**
 * Resolucion de un pago PayPal en revision por diferencia de monto
 * (T-27: AC-23, AC-27).
 *
 * - Solo admin: con `puedeResolverRevision = false` no se renderiza nada. La API
 *   `/api/admin/paypal/revision` vuelve a exigir admin (`requireAdmin`).
 * - Solo se ofrece para pagos PayPal `REVISION` con `revisionEstado =
 *   PENDIENTE`; la elegibilidad vive en `lib/paypal/revision-view.ts` para que
 *   la pagina y el modal usen la misma regla que el servidor.
 * - Muestra el monto capturado (`Pago.monto`), el esperado (`montoEsperado`) y
 *   la diferencia en centavos USD, con texto explicito ademas del color.
 * - Aceptar aplica el hito/meses y emite el recibo; rechazar deja el pago sin
 *   aplicar. La confirmacion es un segundo paso y la accion + la nota se
 *   conservan hasta confirmar (tambien si la peticion falla).
 * - Si la revision fue por moneda distinta de USD o falta una referencia
 *   externa, aceptar queda deshabilitado con el motivo visible: el servidor
 *   tambien lo rechazaria.
 * - Accesibilidad: `PaypalDialog` aporta `role=dialog`, `aria-labelledby`,
 *   foco inicial, trampa de foco, Escape (bloqueado mientras `busy`) y retorno
 *   del foco. Los errores usan `role=alert` y el exito `role=status` +
 *   `aria-live`.
 * - No se muestran ni se envian datos del pagador: solo ids, montos, accion y
 *   la nota interna del admin.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, Receipt } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { PaypalDialog } from "@/components/ui/paypal-dialog"
import {
  esPagoRevisablePaypal,
  motivoNoAceptaRevision,
  puedeAceptarRevisionPaypal,
} from "@/lib/paypal/revision-view"
import { mapearDesglosePago } from "@/lib/paypal/view"

export type AccionRevisionPaypal = "ACEPTAR" | "RECHAZAR"

export interface RevisionPaypalPago {
  id: string
  /** Total capturado en PayPal, en centavos USD. */
  monto: number
  /** Total esperado del link, en centavos USD. */
  montoEsperado?: number | null
  montoAcordado?: number | null
  comision?: number | null
  moneda?: string | null
  revisionNota?: string | null
  revisionEstado?: string | null
  estadoPago?: string | null
  pasarela?: string | null
  /** Texto del concepto para el encabezado del modal. */
  concepto?: string | null
  /** Referencia visible (capture/order) para el encabezado. */
  referencia?: string | null
  externalId?: string | null
  paypalOrderId?: string | null
  tieneHito?: boolean
  tieneSoporte?: boolean
  meses?: number | null
}

export interface ResolverRevisionPaypalRequest {
  pagoId: string
  accion: AccionRevisionPaypal
  nota: string | null
}

export interface ResolverRevisionPaypalResult {
  ok: boolean
  pagoId?: string | null
  accion?: AccionRevisionPaypal | null
  estadoPago?: string | null
  revisionEstado?: string | null
  reciboId?: string | null
  hitoAplicado?: boolean
  mesesAcreditados?: number | null
}

export interface RevisionPaypalButtonProps {
  pago: RevisionPaypalPago
  /** Solo admin. Si es `false` no se renderiza el disparador. */
  puedeResolverRevision: boolean
  label?: string
  ariaLabel?: string
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  className?: string
  /** Presupuesto de la peticion. Default 15 s. */
  timeoutMs?: number
  /** Inyectable en tests o para reutilizar el modal. */
  resolverRevision?: (
    input: ResolverRevisionPaypalRequest
  ) => Promise<ResolverRevisionPaypalResult>
  onSuccess?: () => void
}

export interface RevisionPaypalModalProps
  extends Omit<
    RevisionPaypalButtonProps,
    "label" | "ariaLabel" | "size" | "variant" | "className"
  > {
  open: boolean
  onClose: () => void
}

const TIMEOUT_MS_DEFAULT = 15_000
const MENSAJE_TIMEOUT = "La operación tardó demasiado. Reintentá."
const MENSAJE_CONEXION = "Error de conexión. Reintentá."
const MENSAJE_RESOLVER = "No se pudo resolver la revisión del pago de PayPal."
const MENSAJE_INVALIDO = "El servidor devolvió una respuesta inválida."
const NOTA_MAX = 2_000

const MENSAJE_NO_ACEPTA: Record<string, string> = {
  MONEDA:
    "No se puede aceptar un pago en moneda distinta de USD. Rechazá la revisión y registrá el cobro manualmente o un reembolso.",
  SIN_REFERENCIA:
    "El pago no tiene referencia externa de PayPal (capture id u order id); no se puede emitir el recibo. Rechazá la revisión.",
  NO_REVISABLE: "El pago no está pendiente de revisión.",
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

async function pedirResolucion(
  input: ResolverRevisionPaypalRequest,
  timeoutMs: number
): Promise<ResolverRevisionPaypalResult> {
  const { res, body } = await postConTimeout(
    "/api/admin/paypal/revision",
    input,
    timeoutMs
  )

  if (!res.ok) {
    throw new Error(mensajeDeRespuesta(body, MENSAJE_RESOLVER))
  }
  if (body.ok !== true) throw new Error(MENSAJE_INVALIDO)

  const accion =
    body.accion === "ACEPTAR" || body.accion === "RECHAZAR"
      ? body.accion
      : null

  return {
    ok: true,
    pagoId: typeof body.pagoId === "string" ? body.pagoId : input.pagoId,
    accion,
    estadoPago: typeof body.estadoPago === "string" ? body.estadoPago : null,
    revisionEstado:
      typeof body.revisionEstado === "string" ? body.revisionEstado : null,
    reciboId: typeof body.reciboId === "string" ? body.reciboId : null,
    hitoAplicado: body.hitoAplicado === true,
    mesesAcreditados:
      typeof body.mesesAcreditados === "number" ? body.mesesAcreditados : null,
  }
}

function textoDiferencia(diferencia: number | null): string {
  if (diferencia === null) return "Sin monto esperado para comparar."
  if (diferencia === 0) return "El cobro coincide con el esperado."
  return diferencia < 0
    ? "El cobro es menor al esperado."
    : "El cobro es mayor al esperado."
}

export function RevisionPaypalModal({
  open,
  onClose,
  pago,
  puedeResolverRevision,
  timeoutMs = TIMEOUT_MS_DEFAULT,
  resolverRevision,
  onSuccess,
}: RevisionPaypalModalProps) {
  const baseId = useId()
  const grupoId = `${baseId}-accion`
  const notaId = `${baseId}-nota`
  const notaAyudaId = `${baseId}-nota-ayuda`
  const revisarId = `${baseId}-revisar`

  const router = useRouter()
  const onCloseRef = useRef(onClose)
  const estabaAbiertoRef = useRef(false)
  const peticionRef = useRef(0)
  const confirmarRef = useRef<HTMLButtonElement>(null)
  const successRef = useRef<HTMLButtonElement>(null)

  const aceptaPermitida = puedeAceptarRevisionPaypal(pago)
  const motivoNoAcepta = motivoNoAceptaRevision(pago)

  const [accion, setAccion] = useState<AccionRevisionPaypal>(
    aceptaPermitida ? "ACEPTAR" : "RECHAZAR"
  )
  const [nota, setNota] = useState("")
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [resultado, setResultado] =
    useState<ResolverRevisionPaypalResult | null>(null)

  useEffect(() => {
    onCloseRef.current = () => {
      peticionRef.current += 1
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (open && !estabaAbiertoRef.current) {
      peticionRef.current += 1
      setAccion(aceptaPermitida ? "ACEPTAR" : "RECHAZAR")
      setNota("")
      setConfirmando(false)
      setEnviando(false)
      setError("")
      setFeedback("")
      setResultado(null)
    }

    if (!open) peticionRef.current += 1
    estabaAbiertoRef.current = open
    // La elegibilidad se recalcula al abrir; no se depende de props recreadas.
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

  function cambiarAccion(valor: AccionRevisionPaypal) {
    if (valor === "ACEPTAR" && !aceptaPermitida) return
    setAccion(valor)
    setError("")
    setFeedback("")
  }

  function cambiarNota(valor: string) {
    setNota(valor)
    setError("")
  }

  function pedirConfirmacion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando) return

    if (nota.trim().length > NOTA_MAX) {
      setError(`La nota no puede superar ${NOTA_MAX} caracteres.`)
      return
    }

    setError("")
    setFeedback("")
    setConfirmando(true)
  }

  function volver() {
    setConfirmando(false)
    setError("")
    document.getElementById(revisarId)?.focus()
  }

  async function confirmar() {
    if (enviando) return

    const input: ResolverRevisionPaypalRequest = {
      pagoId: pago.id,
      accion,
      nota: nota.trim().length > 0 ? nota.trim() : null,
    }

    const peticion = nuevaPeticion()
    setEnviando(true)
    setError("")

    try {
      const res = resolverRevision
        ? await conTimeout(resolverRevision(input), timeoutMs)
        : await pedirResolucion(input, timeoutMs)

      if (peticion !== peticionRef.current) return
      if (!res.ok) throw new Error(MENSAJE_RESOLVER)

      const resuelta = res.accion ?? accion
      setResultado({ ...res, accion: resuelta })
      setFeedback(
        resuelta === "ACEPTAR" ? "Revisión aceptada." : "Revisión rechazada."
      )
      setConfirmando(false)
      onSuccess?.()
      router.refresh()
    } catch (fallo) {
      if (peticion !== peticionRef.current) return
      // La accion y la nota siguen intactas para reintentar o volver.
      setError(mensajeDeError(fallo))
    } finally {
      if (peticion === peticionRef.current) setEnviando(false)
    }
  }

  if (!puedeResolverRevision || !esPagoRevisablePaypal(pago)) return null

  const cargando = enviando
  const desglose = mapearDesglosePago(pago)
  const diferencia = desglose.diferencia
  const diferenciaTexto = desglose.formateado.diferencia ?? "—"
  const estadoDiferencia = textoDiferencia(diferencia)

  const accionResuelta = resultado?.accion ?? accion
  const aceptada = accionResuelta === "ACEPTAR"
  const pagoIdRecibo = resultado?.pagoId ?? pago.id
  const reciboHref =
    aceptada && resultado?.reciboId
      ? `/admin/pagos/${encodeURIComponent(pagoIdRecibo)}/recibo`
      : null

  const descripcion = pago.concepto
    ? `${pago.concepto}${pago.referencia ? ` · ${pago.referencia}` : ""}`
    : (pago.referencia ?? pago.id)

  return (
    <PaypalDialog
      open={open}
      onClose={cerrar}
      title="Resolver revisión de pago"
      description={descripcion}
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
              {aceptada ? "Revisión aceptada" : "Revisión rechazada"}
            </p>
            <p className="text-xs text-text-dim">
              {aceptada
                ? "El pago quedó aplicado con el monto capturado."
                : "El pago quedó sin aplicar. Podés registrar un ajuste o reembolso."}
              {resultado.hitoAplicado ? " El hito quedó pagado." : ""}
              {resultado.mesesAcreditados
                ? ` Se acreditaron ${resultado.mesesAcreditados} ${
                    resultado.mesesAcreditados === 1 ? "mes" : "meses"
                  } al soporte.`
                : ""}
            </p>
          </div>

          {reciboHref && (
            <Link href={reciboHref} className="a-btn ghost w-full">
              <Receipt size={14} className="mr-1.5" />
              Ver recibo
            </Link>
          )}

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
          <dl
            aria-label="Monto capturado y esperado"
            className="space-y-1 rounded-lg border border-border px-3 py-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-dim">Cobrado</dt>
              <dd className="font-mono text-text">
                {desglose.formateado.monto ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-dim">Esperado</dt>
              <dd className="font-mono text-text">
                {desglose.formateado.montoEsperado ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-medium text-text">Diferencia</dt>
              <dd className="font-mono font-semibold text-text">
                {diferenciaTexto}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-text-dim">{estadoDiferencia}</p>

          {pago.revisionNota && (
            <div
              role="note"
              className="rounded-lg border border-border px-3 py-2.5"
            >
              <p className="text-xs text-text-dim">Motivo de la revisión</p>
              <p className="mt-1 text-xs text-text">{pago.revisionNota}</p>
            </div>
          )}

          {motivoNoAcepta && (
            <p
              id={`${baseId}-motivo-no-acepta`}
              role="note"
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: "rgba(251,191,36,0.1)", color: "#fcd34d" }}
            >
              {MENSAJE_NO_ACEPTA[motivoNoAcepta]}
            </p>
          )}

          <fieldset
            className="space-y-2"
            disabled={cargando || confirmando}
            aria-describedby={
              motivoNoAcepta ? `${baseId}-motivo-no-acepta` : undefined
            }
          >
            <legend className="mb-1 block text-xs text-text-dim">
              Resolución
            </legend>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="radio"
                name={grupoId}
                value="ACEPTAR"
                checked={accion === "ACEPTAR"}
                disabled={cargando || !aceptaPermitida}
                onChange={() => cambiarAccion("ACEPTAR")}
                className="mt-1"
              />
              <span>Aceptar la diferencia y aplicar el pago</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="radio"
                name={grupoId}
                value="RECHAZAR"
                checked={accion === "RECHAZAR"}
                disabled={cargando}
                onChange={() => cambiarAccion("RECHAZAR")}
                className="mt-1"
              />
              <span>Rechazar la diferencia (el pago queda sin aplicar)</span>
            </label>
          </fieldset>

          <div>
            <label
              htmlFor={notaId}
              className="mb-1 block text-xs text-text-dim"
            >
              Nota (opcional)
            </label>
            <textarea
              id={notaId}
              rows={2}
              maxLength={NOTA_MAX}
              disabled={cargando || confirmando}
              value={nota}
              aria-invalid={nota.trim().length > NOTA_MAX}
              aria-describedby={notaAyudaId}
              onChange={(event) => cambiarNota(event.target.value)}
              placeholder="Por qué se acepta o rechaza la diferencia"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            />
            <p
              id={notaAyudaId}
              className="mt-1 text-text-dim"
              style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
            >
              Queda asociada a la resolución y a quien la resolvió.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          {confirmando ? (
            <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
              <p role="alert" className="text-xs text-text">
                {aceptada
                  ? "¿Confirmás aceptar la diferencia y aplicar el pago?"
                  : "¿Confirmás rechazar la diferencia? El pago quedará sin aplicar."}
                {desglose.formateado.diferencia
                  ? ` Diferencia: ${desglose.formateado.diferencia}.`
                  : ""}
              </p>
              <p className="text-xs text-text-dim">
                La acción y la nota se conservan hasta que confirmes.
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
                    ? "Resolviendo…"
                    : aceptada
                      ? "Confirmar aceptación"
                      : "Confirmar rechazo"}
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
                id={revisarId}
                type="submit"
                className="flex-1"
                disabled={cargando}
              >
                <AlertTriangle size={14} className="mr-1.5" />
                Continuar
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

export function RevisionPaypalButton({
  pago,
  puedeResolverRevision,
  label = "Revisar diferencia",
  ariaLabel,
  size = "sm",
  variant = "outline",
  className,
  timeoutMs,
  resolverRevision,
  onSuccess,
}: RevisionPaypalButtonProps) {
  const [open, setOpen] = useState(false)

  if (!puedeResolverRevision) return null
  if (!esPagoRevisablePaypal(pago)) return null

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
        <AlertTriangle size={14} className="mr-1.5" />
        {label}
      </Button>
      {open && (
        <RevisionPaypalModal
          open={open}
          onClose={() => setOpen(false)}
          pago={pago}
          puedeResolverRevision={puedeResolverRevision}
          timeoutMs={timeoutMs}
          resolverRevision={resolverRevision}
          onSuccess={onSuccess}
        />
      )}
    </>
  )
}
