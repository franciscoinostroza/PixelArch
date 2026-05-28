"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

type PlanTipo = "UNICO" | "BASICO" | "MANTENIMIENTO"

interface CheckoutButtonProps {
  paddlePriceId: string
  servicioNombre: string
  tipo?: PlanTipo
  label?: string
}

export function CheckoutButton({ paddlePriceId, tipo = "UNICO", label }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paddlePriceId }),
      })
      const data = await res.json()
      if (data.error) { console.error(data.error); setLoading(false); setError(data.error); return }

      const Paddle = (window as any).Paddle
      if (!Paddle?.Initialize) {
        console.error("Paddle.js no inicializado")
        setError("Error de conexion con el procesador de pagos. Recargá la pagina.")
        setLoading(false)
        return
      }

      Paddle.Checkout.open({
        items: [{ priceId: data.paddlePriceId, quantity: 1 }],
        ...(data.customerId ? { customer: { id: data.customerId } } : {}),
        settings: { displayMode: "overlay", successUrl: data.successUrl },
        customData: { tipo },
      })
    } catch (e) {
      console.error(e)
      setError("Error inesperado. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button size="lg" onClick={handleCheckout} disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin mr-2" />}
        {label || "Contratar"}
      </Button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
