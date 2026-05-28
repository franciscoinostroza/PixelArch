"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { paddleReady } from "@/components/ui/paddle-script"

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
  const openRef = useRef(false)

  async function handleCheckout() {
    if (openRef.current) return
    openRef.current = true
    setLoading(true)
    setError(null)
    try {
      const paddle = await paddleReady
      if (!paddle) { setError("Error de conexion con el procesador de pagos. Recargá la pagina."); setLoading(false); openRef.current = false; return }

      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paddlePriceId }),
      })
      const data = await res.json()
      if (data.error) { console.error(data.error); setError(data.error); return }

      paddle.Checkout.open({
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
      openRef.current = false
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
