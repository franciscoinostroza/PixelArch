"use client"

/**
 * T-19 (AC-33, AC-34, AC-35; RF-51, RF-52, RF-56): confirmacion explicita de
 * la baja publica.
 *
 * - No hace auto-POST: la baja solo se pide al presionar el boton.
 * - Envia el token opaco al POST publico `/api/opt-out`.
 * - Los estados son genericos: exito, error y rate limit no revelan si el
 *   email existia, si el prospecto existia o si el token era valido.
 * - No muestra el token ni datos del prospecto.
 */

import { useRef, useState } from "react"
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface BajaConfirmarProps {
  /** Token opaco que ya viene en la URL de la pagina. */
  token: string
}

type Estado = "inicial" | "enviando" | "confirmado" | "error"

const MENSAJE_EXITO =
  "Listo. Si este enlace correspondía a una dirección nuestra, la baja ya quedó registrada y no vas a recibir más propuestas en esa dirección."

const MENSAJE_ERROR =
  "No pudimos completar la baja en este momento. Intentá de nuevo en unos minutos."

const MENSAJE_RATE_LIMIT =
  "Recibimos demasiadas solicitudes desde tu conexión. Esperá un minuto y volvé a intentar."

export function BajaConfirmar({ token }: BajaConfirmarProps) {
  const [estado, setEstado] = useState<Estado>("inicial")
  const [mensaje, setMensaje] = useState<string | null>(null)
  const enCurso = useRef(false)

  async function confirmarBaja(): Promise<void> {
    if (enCurso.current || estado === "enviando" || estado === "confirmado") {
      return
    }

    enCurso.current = true
    setEstado("enviando")
    setMensaje(null)

    try {
      const res = await fetch("/api/opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })

      if (res.status === 429) {
        setEstado("error")
        setMensaje(MENSAJE_RATE_LIMIT)
        return
      }

      if (!res.ok) {
        setEstado("error")
        setMensaje(MENSAJE_ERROR)
        return
      }

      setEstado("confirmado")
      setMensaje(MENSAJE_EXITO)
    } catch {
      setEstado("error")
      setMensaje(MENSAJE_ERROR)
    } finally {
      enCurso.current = false
    }
  }

  const enviando = estado === "enviando"
  const confirmado = estado === "confirmado"

  return (
    <div aria-busy={enviando}>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          size="lg"
          onClick={() => void confirmarBaja()}
          disabled={enviando || confirmado}
        >
          {enviando ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : confirmado ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}
          {enviando
            ? "Confirmando…"
            : confirmado
              ? "Baja registrada"
              : "Confirmar baja"}
        </Button>

        <p className="text-xs leading-5 text-text-dim">
          La confirmación es un paso explícito: abrir esta página no da de baja
          nada por sí solo.
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="mt-4 min-h-6 text-sm leading-6 text-text"
      >
        {mensaje !== null && (
          <p
            className={
              confirmado
                ? "rounded-lg border border-mint/30 bg-mint/5 p-3 text-text"
                : "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-text"
            }
          >
            {mensaje}
          </p>
        )}
      </div>
    </div>
  )
}
