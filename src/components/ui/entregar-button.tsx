"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Check, Loader2 } from "lucide-react"

export function EntregarButton({ suscripcionId }: { suscripcionId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function entregar() {
    setLoading(true)
    await fetch("/api/admin/entregar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suscripcionId }),
    })
    setLoading(false)
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" onClick={entregar} disabled={loading}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      <span className="ml-2">Marcar como entregado</span>
    </Button>
  )
}
