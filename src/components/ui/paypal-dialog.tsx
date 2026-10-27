"use client"

/**
 * Shell accesible compartido por los modales de PayPal (T-25/T-26).
 *
 * Mantiene el mismo patron que `paypal-link-modal` (T-20):
 * - `role=dialog`, `aria-modal`, `aria-labelledby` y `aria-describedby`;
 * - foco inicial en el dialogo, trampa de foco con Tab/Shift+Tab, Escape y
 *   retorno del foco al disparador;
 * - cierre al hacer click en el fondo (salvo cuando la operacion esta en curso);
 * - bloqueo visual del resto del admin con `aria-busy`.
 *
 * El contenido (`children`) define sus propios avisos `aria-live` y errores
 * `role=alert`; el shell solo aporta el contenedor y el comportamiento de foco.
 */

import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

export interface PaypalDialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Texto o nodo del subtitulo; se usa como descripcion accesible. */
  description?: ReactNode
  busy?: boolean
  /** Ancho maximo del panel (default `max-w-md`). */
  maxWidthClassName?: string
  children: ReactNode
}

export function PaypalDialog({
  open,
  onClose,
  title,
  description,
  busy = false,
  maxWidthClassName = "max-w-md",
  children,
}: PaypalDialogProps) {
  const tituloId = useId()
  const descripcionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    if (!open) return

    const previo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.focus()

    function enfocables(): HTMLElement[] {
      if (!dialog) return []
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (elemento) =>
          !elemento.hasAttribute("disabled") &&
          elemento.getAttribute("aria-hidden") !== "true"
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Mientras una operacion esta en curso no se puede cerrar: la
        // peticion seguiria viva y el usuario perderia el contexto.
        if (busyRef.current) return
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== "Tab") return

      const elementos = enfocables()
      if (elementos.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }

      const primero = elementos[0]
      const ultimo = elementos[elementos.length - 1]
      const activo = document.activeElement
      const dentro = activo instanceof Node && dialog?.contains(activo) === true

      if (event.shiftKey) {
        if (!dentro || activo === primero || activo === dialog) {
          event.preventDefault()
          ultimo.focus()
        }
        return
      }

      if (!dentro || activo === ultimo) {
        event.preventDefault()
        primero.focus()
      }
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target
      if (target instanceof Node && dialog && !dialog.contains(target)) {
        const primero = enfocables()[0]
        if (primero) {
          primero.focus()
        } else {
          dialog.focus()
        }
      }
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocusIn)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocusIn)
      previo?.focus()
    }
  }, [open])

  if (!open) return null

  function cerrar() {
    if (busyRef.current) return
    onCloseRef.current()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={cerrar}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descripcionId}
        aria-busy={busy}
        tabIndex={-1}
        className={`w-full ${maxWidthClassName} max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-border bg-panel p-6 shadow-2xl`}
        style={{
          background:
            "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={tituloId} className="font-display text-lg font-bold text-text">
              {title}
            </h2>
            <p
              id={descripcionId}
              className={
                description
                  ? "mt-1 truncate text-xs text-text-dim"
                  : "sr-only"
              }
            >
              {description ?? title}
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            disabled={busy}
            aria-label="Cerrar modal"
            title={
              busy ? "La operación está en curso. Esperá a que termine." : undefined
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-white/10 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {children}
      </div>
    </div>
  )
}
