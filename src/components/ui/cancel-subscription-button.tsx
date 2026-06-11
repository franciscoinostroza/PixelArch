"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, X } from "lucide-react"

export function CancelSubscriptionButton({ suscripcionId }: { suscripcionId: string }) {
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function cancelar() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setLoading(true)
    setError("")
    const res = await fetch("/api/portal/cancel-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suscripcionId }),
    })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Error al cancelar")
      return
    }
    setConfirming(false)
    router.refresh()
  }

  function reset() {
    setConfirming(false)
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={cancelar} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirmar cancelacion
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} disabled={loading}>
            No
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <Button size="sm" variant="ghost" onClick={cancelar} title="Cancelar suscripcion">
      <X size={14} />
    </Button>
  )
}
