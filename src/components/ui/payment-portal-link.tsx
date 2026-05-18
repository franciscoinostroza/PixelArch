"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2 } from "lucide-react"

export function PaymentPortalLink() {
  const [loading, setLoading] = useState(false)

  async function openPortal() {
    setLoading(true)
    const res = await fetch("/api/portal/payment-portal", { method: "POST" })
    const data = await res.json()
    setLoading(false)
    if (data.url) window.open(data.url, "_blank")
  }

  return (
    <Button size="sm" variant="outline" onClick={openPortal} disabled={loading}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
      <span className="ml-2">Actualizar pago</span>
    </Button>
  )
}
