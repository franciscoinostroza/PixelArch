"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2 } from "lucide-react"

export function PaymentPortalLink() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function openPortal() {
    setLoading(true)
    setError("")
    const res = await fetch("/api/portal/payment-portal", { method: "POST" })
    const data = await res.json()
    setLoading(false)
    if (data.url) {
      window.open(data.url, "_blank")
    } else {
      setError(data.error || "Error al abrir portal de pago")
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={openPortal} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
        Actualizar pago
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
