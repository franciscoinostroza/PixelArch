"use client"

/**
 * Registro manual de un pago PayPal (T-25: AC-17, AC-23, AC-25).
 *
 * - Solo admin: el disparador no se renderiza cuando `puedeRegistrarManual` es
 *   falso. La API `/api/admin/paypal/manual` vuelve a exigir admin, asi que la
 *   UI es solo la primera barrera.
 * - Modal accesible con seleccion hito/soporte, capture id y/o order id,
 *   desglose `monto acordado + comision = total`, evidencia textual/URL (sin
 *   upload), fecha de registro, meses 1..12 para soporte y flags para aplicar el
 *   pago al concepto.
 * - La fecha que se muestra es la de registro: la API no acepta una fecha
 *   retroactiva y el servidor guarda `creadoEn`/`reciboEmitidoEn` al confirmar.
 * - El recibo interno se emite siempre con los datos del cliente del CRM; el
 *   modal lo informa y, al terminar, enlaza al recibo con el `pagoId`.
 * - No se envian ni muestran datos del pagador. La evidencia se valida contra
 *   emails para no guardar PII por accidente (misma regla que el servidor).
 * - Los errores usan `role=alert`, el exito `role=status` + `aria-live`, y el
 *   foco vuelve al disparador al cerrar.
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
import { CheckCircle2, Loader2, Receipt } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { PaypalDialog } from "@/components/ui/paypal-dialog"
import { formatearMonto } from "@/lib/pagos"
import { calcularGrossUp } from "@/lib/paypal/fees-core"
import { centavosAInput, parsearMontoUsd } from "@/lib/paypal/monto-input"

export interface PaypalManualConceptoHito {
  tipo: "hito"
  hitoId: string
  titulo: string
  /** Monto acordado sugerido en centavos USD. */
  montoAcordadoCents: number
}

export interface PaypalManualConceptoSoporte {
  tipo: "soporte"
  suscripcionId: string
  titulo: string
  /** Total acordado sugerido en centavos USD. */
  montoAcordadoCents: number
  /** Precio mensual en centavos; recalcula el total al cambiar los meses. */
  montoMensualCents?: number | null
  /** Meses iniciales (1..12). Default 1. */
  mesesDefault?: number
}

export type PaypalManualConcepto =
  | PaypalManualConceptoHito
  | PaypalManualConceptoSoporte

export interface RegistrarPagoPaypalRequest {
  hitoId?: string
  suscripcionId?: string
  montoAcordadoCents: number
  comisionCents: number
  totalCents: number
  externalId?: string
  paypalOrderId?: string
  evidencia: string
  meses?: number
  marcarHitoPagado?: boolean
  acreditarMeses?: boolean
}

export interface RegistrarPagoPaypalResult {
  ok: boolean
  pagoId: string | null
  duplicado?: boolean
}

export interface RegistrarPagoPaypalButtonProps {
  conceptos: readonly PaypalManualConcepto[]
  feeBps: number
  feeFixedCents: number
  /** Solo admin. Si es `false` no se renderiza ningun disparador. */
  puedeRegistrarManual: boolean
  label?: string
  ariaLabel?: string
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  className?: string
  /** Presupuesto de la peticion. Default 15 s. */
  timeoutMs?: number
  /** Inyectable en tests o para reutilizar el modal. */
  registrarPago?: (
    input: RegistrarPagoPaypalRequest
  ) => Promise<RegistrarPagoPaypalResult>
  onSuccess?: () => void
}

export interface RegistrarPagoPaypalModalProps
  extends Omit<
    RegistrarPagoPaypalButtonProps,
    "label" | "ariaLabel" | "size" | "variant" | "className"
  > {
  open: boolean
  onClose: () => void
}

const TIMEOUT_MS_DEFAULT = 15_000
const MENSAJE_TIMEOUT = "La operación tardó demasiado. Reintentá."
const MENSAJE_CONEXION = "Error de conexión. Reintentá."
const MENSAJE_MONTO = "Ingresá un monto válido en USD (por ejemplo 100,50)."
const MENSAJE_COMISION = "Ingresá una comisión válida en USD (0 o más)."
const MENSAJE_REFERENCIA = "Indicá el capture id y/o el order id de PayPal."
const MENSAJE_REFERENCIA_LARGA =
  "La referencia de PayPal no puede superar 128 caracteres."
const MENSAJE_EVIDENCIA =
  "La evidencia es obligatoria (texto o URL, máximo 2000 caracteres)."
const MENSAJE_PII =
  "La evidencia no puede contener datos personales del pagador."
const MENSAJE_MESES = "Elegí entre 1 y 12 meses."
const MENSAJE_TARIFA =
  "No se pudo calcular la comisión con la tarifa configurada; ingresala a mano."
const MENSAJE_REGISTRAR = "No se pudo registrar el pago de PayPal."
const MENSAJE_INVALIDO = "El servidor devolvió una respuesta inválida."

const PATRON_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PRISMA_INT_MAX = 2_147_483_647

function claveConcepto(concepto: PaypalManualConcepto): string {
  return concepto.tipo === "hito"
    ? `hito:${concepto.hitoId}`
    : `soporte:${concepto.suscripcionId}`
}

function mesesDeConcepto(concepto: PaypalManualConcepto): number {
  if (concepto.tipo !== "soporte") return 1
  const meses = concepto.mesesDefault
  return typeof meses === "number" &&
    Number.isSafeInteger(meses) &&
    meses >= 1 &&
    meses <= 12
    ? meses
    : 1
}

function montoDeConcepto(concepto: PaypalManualConcepto): number {
  if (
    concepto.tipo === "soporte" &&
    typeof concepto.montoMensualCents === "number" &&
    concepto.montoMensualCents > 0
  ) {
    const total = concepto.montoMensualCents * mesesDeConcepto(concepto)
    if (Number.isSafeInteger(total)) return total
  }

  return Number.isSafeInteger(concepto.montoAcordadoCents) &&
    concepto.montoAcordadoCents > 0
    ? concepto.montoAcordadoCents
    : 0
}

function comisionSugerida(
  montoCents: number,
  feeBps: number,
  feeFixedCents: number
): string {
  if (!Number.isSafeInteger(montoCents) || montoCents <= 0) return "0,00"
  try {
    const resultado = calcularGrossUp(montoCents, {
      bps: feeBps,
      fixedCents: feeFixedCents,
    })
    return centavosAInput(resultado.comisionCents)
  } catch {
    return "0,00"
  }
}

function tarifaEsValida(feeBps: number, feeFixedCents: number): boolean {
  try {
    calcularGrossUp(100, { bps: feeBps, fixedCents: feeFixedCents })
    return true
  } catch {
    return false
  }
}

function fechaLocalHoy(): string {
  const ahora = new Date()
  const anio = ahora.getFullYear()
  const mes = String(ahora.getMonth() + 1).padStart(2, "0")
  const dia = String(ahora.getDate()).padStart(2, "0")
  return `${anio}-${mes}-${dia}`
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

/**
 * Error del servidor con `409 DUPLICADO`. Conserva el `pagoId` existente para
 * que la UI pueda enlazar su recibo sin obligar a buscarlo a mano.
 */
export class PaypalManualDuplicadoError extends Error {
  readonly pagoId: string | null
  readonly duplicado = true

  constructor(mensaje: string, pagoId: string | null) {
    super(mensaje)
    this.name = "PaypalManualDuplicadoError"
    this.pagoId = pagoId
  }
}

export function esPaypalManualDuplicado(
  error: unknown
): error is PaypalManualDuplicadoError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { duplicado?: unknown }).duplicado === true
  )
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

async function pedirRegistro(
  input: RegistrarPagoPaypalRequest,
  timeoutMs: number
): Promise<RegistrarPagoPaypalResult> {
  const { res, body } = await postConTimeout(
    "/api/admin/paypal/manual",
    input,
    timeoutMs
  )
  const pagoId = typeof body.pagoId === "string" ? body.pagoId : null

  if (!res.ok) {
    const mensaje = mensajeDeRespuesta(body, MENSAJE_REGISTRAR)
    if (body.duplicado === true) {
      throw new PaypalManualDuplicadoError(mensaje, pagoId)
    }
    throw new Error(mensaje)
  }

  if (body.ok !== true) throw new Error(MENSAJE_INVALIDO)
  return { ok: true, pagoId }
}

function etiquetaConcepto(concepto: PaypalManualConcepto): string {
  const prefijo = concepto.tipo === "hito" ? "Hito" : "Soporte"
  return `${prefijo} · ${concepto.titulo}`
}

export function RegistrarPagoPaypalModal({
  open,
  onClose,
  conceptos,
  feeBps,
  feeFixedCents,
  puedeRegistrarManual,
  timeoutMs = TIMEOUT_MS_DEFAULT,
  registrarPago,
  onSuccess,
}: RegistrarPagoPaypalModalProps) {
  const baseId = useId()
  const conceptoId = `${baseId}-concepto`
  const montoId = `${baseId}-monto`
  const comisionId = `${baseId}-comision`
  const totalId = `${baseId}-total`
  const externalIdId = `${baseId}-external`
  const orderIdId = `${baseId}-order`
  const evidenciaId = `${baseId}-evidencia`
  const evidenciaAyudaId = `${baseId}-evidencia-ayuda`
  const mesesId = `${baseId}-meses`
  const aplicarId = `${baseId}-aplicar`
  const fechaId = `${baseId}-fecha`
  const reciboAyudaId = `${baseId}-recibo-ayuda`

  const router = useRouter()
  const onCloseRef = useRef(onClose)
  const estabaAbiertoRef = useRef(false)
  const peticionRef = useRef(0)
  const successRef = useRef<HTMLButtonElement>(null)

  const conceptosValidos = conceptos.filter(
    (concepto) =>
      (concepto.tipo === "hito" && concepto.hitoId.trim().length > 0) ||
      (concepto.tipo === "soporte" &&
        concepto.suscripcionId.trim().length > 0)
  )
  const primero = conceptosValidos[0] ?? null

  const [conceptoClave, setConceptoClave] = useState(() =>
    primero ? claveConcepto(primero) : ""
  )
  const [monto, setMonto] = useState(() =>
    primero ? centavosAInput(montoDeConcepto(primero)) : ""
  )
  const [comision, setComision] = useState(() =>
    primero
      ? comisionSugerida(montoDeConcepto(primero), feeBps, feeFixedCents)
      : "0,00"
  )
  const [meses, setMeses] = useState(() =>
    primero ? mesesDeConcepto(primero) : 1
  )
  const [externalId, setExternalId] = useState("")
  const [paypalOrderId, setPaypalOrderId] = useState("")
  const [evidencia, setEvidencia] = useState("")
  const [aplicarConcepto, setAplicarConcepto] = useState(true)
  const [fecha, setFecha] = useState(fechaLocalHoy)
  const [accion, setAccion] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [campoInvalido, setCampoInvalido] = useState<string | null>(null)
  const [pagoExistente, setPagoExistente] = useState<string | null>(null)
  const [pagoCreado, setPagoCreado] = useState<string | null>(null)

  useEffect(() => {
    onCloseRef.current = () => {
      peticionRef.current += 1
      onClose()
    }
  }, [onClose])

  const concepto =
    conceptosValidos.find(
      (candidato) => claveConcepto(candidato) === conceptoClave
    ) ?? primero
  const soporte = concepto?.tipo === "soporte"
  const tarifaValida = tarifaEsValida(feeBps, feeFixedCents)

  const montoCents = parsearMontoUsd(monto)
  const comisionCents = parsearMontoUsd(comision, true)
  const montoInvalido = monto.trim().length > 0 && montoCents === null
  const comisionInvalida =
    comision.trim().length > 0 && comisionCents === null
  const totalCents =
    montoCents !== null &&
    comisionCents !== null &&
    Number.isSafeInteger(montoCents + comisionCents)
      ? montoCents + comisionCents
      : null

  // Reset al abrir; no se depende de props que el padre puede recrear.
  useEffect(() => {
    if (open && !estabaAbiertoRef.current) {
      peticionRef.current += 1
      const inicial = primero
      const mesesIniciales = inicial ? mesesDeConcepto(inicial) : 1
      const montoInicial = inicial ? montoDeConcepto(inicial) : 0
      setConceptoClave(inicial ? claveConcepto(inicial) : "")
      setMonto(inicial ? centavosAInput(montoInicial) : "")
      setComision(
        inicial ? comisionSugerida(montoInicial, feeBps, feeFixedCents) : "0,00"
      )
      setMeses(mesesIniciales)
      setExternalId("")
      setPaypalOrderId("")
      setEvidencia("")
      setAplicarConcepto(true)
      setFecha(fechaLocalHoy())
      setAccion(false)
      setError("")
      setFeedback("")
      setCampoInvalido(null)
      setPagoExistente(null)
      setPagoCreado(null)
    }

    if (!open) peticionRef.current += 1
    estabaAbiertoRef.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (pagoCreado) successRef.current?.focus()
  }, [pagoCreado])

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
    setPagoExistente(null)
  }

  function cambiarConcepto(clave: string) {
    const siguiente = conceptosValidos.find(
      (candidato) => claveConcepto(candidato) === clave
    )
    setConceptoClave(clave)
    if (siguiente) {
      const mesesSiguientes = mesesDeConcepto(siguiente)
      const montoSiguiente = montoDeConcepto(siguiente)
      setMeses(mesesSiguientes)
      setMonto(centavosAInput(montoSiguiente))
      setComision(
        comisionSugerida(montoSiguiente, feeBps, feeFixedCents)
      )
    }
    setAplicarConcepto(true)
    limpiarAvisos()
  }

  function cambiarMonto(valor: string) {
    setMonto(valor)
    limpiarAvisos()
    const cents = parsearMontoUsd(valor)
    if (cents !== null && tarifaValida) {
      setComision(comisionSugerida(cents, feeBps, feeFixedCents))
    }
  }

  function cambiarComision(valor: string) {
    setComision(valor)
    limpiarAvisos()
  }

  function cambiarMeses(valor: number) {
    const nuevo = Math.min(12, Math.max(1, Math.trunc(valor)))
    setMeses(nuevo)
    limpiarAvisos()
    if (
      concepto?.tipo === "soporte" &&
      typeof concepto.montoMensualCents === "number" &&
      concepto.montoMensualCents > 0
    ) {
      const total = concepto.montoMensualCents * nuevo
      if (Number.isSafeInteger(total)) {
        setMonto(centavosAInput(total))
        if (tarifaValida) {
          setComision(comisionSugerida(total, feeBps, feeFixedCents))
        }
      }
    }
  }

  function cambiarFlag(valor: boolean) {
    setAplicarConcepto(valor)
    limpiarAvisos()
  }

  function cambiarTexto(
    setter: (valor: string) => void,
    valor: string
  ) {
    setter(valor)
    limpiarAvisos()
  }

  function validar(): { campo: string; mensaje: string } | null {
    if (montoCents === null || montoCents > PRISMA_INT_MAX) {
      return { campo: montoId, mensaje: MENSAJE_MONTO }
    }
    if (comisionCents === null || comisionCents > PRISMA_INT_MAX) {
      return { campo: comisionId, mensaje: MENSAJE_COMISION }
    }
    if (
      totalCents === null ||
      totalCents <= 0 ||
      totalCents > PRISMA_INT_MAX
    ) {
      return { campo: totalId, mensaje: MENSAJE_MONTO }
    }

    const capture = externalId.trim()
    const order = paypalOrderId.trim()
    if (capture.length === 0 && order.length === 0) {
      return { campo: externalIdId, mensaje: MENSAJE_REFERENCIA }
    }
    if (capture.length > 128 || order.length > 128) {
      return { campo: externalIdId, mensaje: MENSAJE_REFERENCIA_LARGA }
    }

    const texto = evidencia.trim()
    if (texto.length === 0 || texto.length > 2_000) {
      return { campo: evidenciaId, mensaje: MENSAJE_EVIDENCIA }
    }
    if (PATRON_EMAIL.test(texto)) {
      return { campo: evidenciaId, mensaje: MENSAJE_PII }
    }

    if (soporte && (meses < 1 || meses > 12)) {
      return { campo: mesesId, mensaje: MENSAJE_MESES }
    }

    return null
  }

  async function registrar() {
    if (accion || !puedeRegistrarManual) return

    const problema = validar()
    if (problema) {
      setError(problema.mensaje)
      setCampoInvalido(problema.campo)
      document.getElementById(problema.campo)?.focus()
      return
    }

    if (
      !concepto ||
      montoCents === null ||
      comisionCents === null ||
      totalCents === null
    ) {
      return
    }

    const captura = externalId.trim()
    const orden = paypalOrderId.trim()
    const input: RegistrarPagoPaypalRequest = {
      montoAcordadoCents: montoCents,
      comisionCents,
      totalCents,
      evidencia: evidencia.trim(),
      ...(concepto.tipo === "hito"
        ? {
            hitoId: concepto.hitoId,
            marcarHitoPagado: aplicarConcepto,
          }
        : {
            suscripcionId: concepto.suscripcionId,
            meses,
            acreditarMeses: aplicarConcepto,
          }),
      ...(captura.length > 0 ? { externalId: captura } : {}),
      ...(orden.length > 0 ? { paypalOrderId: orden } : {}),
    }

    const peticion = nuevaPeticion()
    limpiarAvisos()
    setAccion(true)

    try {
      const resultado = registrarPago
        ? await conTimeout(registrarPago(input), timeoutMs)
        : await pedirRegistro(input, timeoutMs)

      if (peticion !== peticionRef.current) return
      if (!resultado.ok) throw new Error(MENSAJE_REGISTRAR)

      setPagoCreado(resultado.pagoId)
      setFeedback("Pago registrado.")
      onSuccess?.()
      router.refresh()
    } catch (fallo) {
      if (peticion !== peticionRef.current) return
      if (esPaypalManualDuplicado(fallo)) {
        setError(fallo.message)
        setPagoExistente(fallo.pagoId)
      } else {
        setError(mensajeDeError(fallo))
      }
    } finally {
      if (peticion === peticionRef.current) setAccion(false)
    }
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void registrar()
  }

  if (!puedeRegistrarManual || !concepto || conceptosValidos.length === 0) {
    return null
  }

  const cargando = accion

  return (
    <PaypalDialog
      open={open}
      onClose={cerrar}
      title="Registrar pago PayPal"
      description="Registro manual de un pago ya confirmado en PayPal, con evidencia."
      busy={cargando}
      maxWidthClassName="max-w-lg"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {feedback}
      </p>

      {pagoCreado ? (
        <div className="space-y-4">
          <div
            className="flex flex-col items-center gap-2 rounded-lg px-3 py-4 text-center"
            style={{ background: "rgba(52,211,153,0.08)" }}
          >
            <CheckCircle2 size={28} style={{ color: "#34d399" }} />
            <p className="text-sm font-medium" style={{ color: "#34d399" }}>
              Pago registrado
            </p>
            <p className="text-xs text-text-dim">
              El recibo interno quedó asociado al pago.
            </p>
          </div>
          {pagoCreado && (
            <Link
              href={`/admin/pagos/${encodeURIComponent(pagoCreado)}/recibo`}
              className="a-btn ghost w-full"
            >
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
        <form className="space-y-3" onSubmit={enviar} noValidate>
          <div>
            <label
              htmlFor={conceptoId}
              className="mb-1 block text-xs text-text-dim"
            >
              Concepto
            </label>
            <select
              id={conceptoId}
              value={conceptoClave}
              disabled={cargando}
              onChange={(event) => cambiarConcepto(event.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            >
              {conceptosValidos.map((candidato) => (
                <option
                  key={claveConcepto(candidato)}
                  value={claveConcepto(candidato)}
                >
                  {etiquetaConcepto(candidato)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={externalIdId}
                className="mb-1 block text-xs text-text-dim"
              >
                Capture id
              </label>
              <input
                id={externalIdId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={cargando}
                value={externalId}
                aria-invalid={campoInvalido === externalIdId}
                onChange={(event) =>
                  cambiarTexto(setExternalId, event.target.value)
                }
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
            <div>
              <label
                htmlFor={orderIdId}
                className="mb-1 block text-xs text-text-dim"
              >
                Order id
              </label>
              <input
                id={orderIdId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={cargando}
                value={paypalOrderId}
                aria-invalid={campoInvalido === orderIdId}
                onChange={(event) =>
                  cambiarTexto(setPaypalOrderId, event.target.value)
                }
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
          </div>
          <p
            className="text-text-dim"
            style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
          >
            Indicá al menos una referencia de PayPal. Con el order id, el
            servidor consulta la orden y valida la captura.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label
                htmlFor={montoId}
                className="mb-1 block text-xs text-text-dim"
              >
                Monto acordado (USD)
              </label>
              <input
                id={montoId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                disabled={cargando}
                value={monto}
                aria-invalid={campoInvalido === montoId || montoInvalido}
                onChange={(event) => cambiarMonto(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
            <div>
              <label
                htmlFor={comisionId}
                className="mb-1 block text-xs text-text-dim"
              >
                Comisión (USD)
              </label>
              <input
                id={comisionId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                disabled={cargando}
                value={comision}
                aria-invalid={campoInvalido === comisionId || comisionInvalida}
                onChange={(event) => cambiarComision(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
            <div>
              <label
                htmlFor={totalId}
                className="mb-1 block text-xs text-text-dim"
              >
                Total (USD)
              </label>
              <input
                id={totalId}
                type="text"
                readOnly
                value={totalCents !== null ? centavosAInput(totalCents) : ""}
                aria-describedby={`${baseId}-total-ayuda`}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
            </div>
          </div>
          <p
            id={`${baseId}-total-ayuda`}
            className="text-text-dim"
            style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
          >
            Total = monto acordado + comisión
            {totalCents !== null
              ? ` · ${formatearMonto(totalCents, "usd")}`
              : ""}
          </p>
          {!tarifaValida && (
            <p role="alert" className="text-xs text-red-400">
              {MENSAJE_TARIFA}
            </p>
          )}

          {soporte && (
            <div>
              <label
                htmlFor={mesesId}
                className="mb-1 block text-xs text-text-dim"
              >
                Meses
              </label>
              <select
                id={mesesId}
                value={meses}
                disabled={cargando}
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

          <div>
            <label
              htmlFor={evidenciaId}
              className="mb-1 block text-xs text-text-dim"
            >
              Evidencia (texto o URL)
            </label>
            <textarea
              id={evidenciaId}
              rows={3}
              disabled={cargando}
              value={evidencia}
              aria-invalid={campoInvalido === evidenciaId}
              aria-describedby={evidenciaAyudaId}
              onChange={(event) =>
                cambiarTexto(setEvidencia, event.target.value)
              }
              placeholder="Capture id, order id, comprobante o nota interna"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
            />
            <p
              id={evidenciaAyudaId}
              className="mt-1 text-text-dim"
              style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
            >
              Texto o URL. No se adjuntan archivos ni datos del pagador.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={fechaId}
                className="mb-1 block text-xs text-text-dim"
              >
                Fecha de registro
              </label>
              <input
                id={fechaId}
                type="date"
                readOnly
                value={fecha}
                aria-describedby={`${baseId}-fecha-ayuda`}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text"
              />
              <p
                id={`${baseId}-fecha-ayuda`}
                className="mt-1 text-text-dim"
                style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
              >
                El servidor guarda la fecha y hora al confirmar.
              </p>
            </div>

            <div className="space-y-2 self-end">
              <label className="flex items-center gap-2 text-sm text-text-dim">
                <input
                  id={aplicarId}
                  type="checkbox"
                  checked={aplicarConcepto}
                  disabled={cargando}
                  onChange={(event) => cambiarFlag(event.target.checked)}
                  style={{ accentColor: "#8b5cf6" }}
                />
                {soporte
                  ? "Acreditar los meses al soporte"
                  : "Marcar el hito como pagado"}
              </label>
              <label className="flex items-center gap-2 text-sm text-text-dim">
                <input
                  type="checkbox"
                  defaultChecked
                  disabled
                  readOnly
                  aria-describedby={reciboAyudaId}
                  style={{ accentColor: "#8b5cf6" }}
                />
                Recibo interno
              </label>
              <p
                id={reciboAyudaId}
                className="text-text-dim"
                style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}
              >
                Se emite con los datos del cliente del CRM.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          {pagoExistente && (
            <Link
              href={`/admin/pagos/${encodeURIComponent(pagoExistente)}/recibo`}
              className="a-btn ghost"
            >
              Ver el pago existente
            </Link>
          )}

          <div className="flex gap-3 pt-1">
            <Button
              type="submit"
              className="flex-1"
              disabled={cargando}
            >
              {cargando ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : null}
              {cargando ? "Registrando…" : "Registrar pago"}
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
        </form>
      )}
    </PaypalDialog>
  )
}

export function RegistrarPagoPaypalButton({
  conceptos,
  feeBps,
  feeFixedCents,
  puedeRegistrarManual,
  label = "Registrar pago PayPal",
  ariaLabel,
  size = "sm",
  variant = "outline",
  className,
  timeoutMs,
  registrarPago,
  onSuccess,
}: RegistrarPagoPaypalButtonProps) {
  const [open, setOpen] = useState(false)

  if (!puedeRegistrarManual) return null
  if (conceptos.length === 0) return null

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
        <Receipt size={14} className="mr-1.5" />
        {label}
      </Button>
      <RegistrarPagoPaypalModal
        open={open}
        onClose={() => setOpen(false)}
        conceptos={conceptos}
        feeBps={feeBps}
        feeFixedCents={feeFixedCents}
        puedeRegistrarManual={puedeRegistrarManual}
        timeoutMs={timeoutMs}
        registrarPago={registrarPago}
        onSuccess={onSuccess}
      />
    </>
  )
}
