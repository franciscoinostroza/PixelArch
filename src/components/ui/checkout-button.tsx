"use client"

import { useState } from "react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

type PlanTipo = "UNICO" | "BASICO" | "MANTENIMIENTO"

interface CheckoutButtonProps {
  polarProductId: string
  servicioNombre: string
  tipo?: PlanTipo
  label?: string
  size?: "default" | "sm" | "lg" | "icon"
  variant?: ButtonProps["variant"]
  className?: string
}

export function CheckoutButton({ polarProductId, tipo = "UNICO", label, size = "default", variant = "default", className }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polarProductId, tipo }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      window.location.href = data.url
    } catch (e) {
      console.error(e)
      setError("Error inesperado. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button size={size} variant={variant} className={className} onClick={handleCheckout} disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin mr-2" />}
        {label || "Contratar"}
      </Button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
