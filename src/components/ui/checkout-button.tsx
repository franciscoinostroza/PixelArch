"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface CheckoutButtonProps {
  paddlePriceId: string
  servicioNombre: string
}

export function CheckoutButton({ paddlePriceId, servicioNombre }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleCheckout() {
    setLoading(true)
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paddlePriceId }),
      })
      const data = await res.json()

      if (data.error) {
        console.error(data.error)
        setLoading(false)
        return
      }

      const Paddle = (window as any).Paddle
      if (!Paddle) {
        console.error("Paddle.js no esta cargado")
        setLoading(false)
        return
      }

      Paddle.Checkout.open({
        items: [{ priceId: data.paddlePriceId, quantity: 1 }],
        customer: data.customerId ? { id: data.customerId } : undefined,
        settings: {
          displayMode: "overlay",
          theme: "dark",
          successUrl: data.successUrl,
        },
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="lg" onClick={handleCheckout} disabled={loading}>
      {loading && <Loader2 size={16} className="animate-spin mr-2" />}
      Contratar {servicioNombre}
    </Button>
  )
}
