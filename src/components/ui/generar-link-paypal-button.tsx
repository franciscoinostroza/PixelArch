"use client"

/**
 * Boton "Generar link PayPal" + modal accesible (T-20).
 *
 * Mantiene el estado de apertura y reutiliza todas las props del modal. Si
 * PayPal no esta configurado, el boton queda deshabilitado y expone el motivo
 * por `title` y `aria-describedby` (AC-16).
 */

import { useId, useState } from "react"
import { Link2 } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import {
  MENSAJE_PAYPAL_NO_DISPONIBLE,
  PaypalLinkModal,
  type PaypalLinkModalProps,
} from "@/components/ui/paypal-link-modal"

export interface GenerarLinkPaypalButtonProps
  extends Omit<PaypalLinkModalProps, "open" | "onClose"> {
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  label?: string
  /** Nombre accesible con el concepto; evita botones "PayPal" ambiguos. */
  ariaLabel?: string
  className?: string
}

export function GenerarLinkPaypalButton({
  size = "sm",
  variant = "outline",
  label = "Generar link PayPal",
  ariaLabel,
  className,
  paypalDisponible,
  ...props
}: GenerarLinkPaypalButtonProps) {
  const [open, setOpen] = useState(false)
  const motivoId = useId()

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        aria-label={ariaLabel}
        disabled={!paypalDisponible}
        title={paypalDisponible ? undefined : MENSAJE_PAYPAL_NO_DISPONIBLE}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={paypalDisponible ? undefined : motivoId}
        onClick={() => setOpen(true)}
      >
        <Link2 size={14} className="mr-1.5" />
        {label}
      </Button>
      {!paypalDisponible && (
        <span id={motivoId} className="sr-only">
          {MENSAJE_PAYPAL_NO_DISPONIBLE}
        </span>
      )}
      <PaypalLinkModal
        {...props}
        paypalDisponible={paypalDisponible}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
