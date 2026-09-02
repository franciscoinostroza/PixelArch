"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Check, Loader2 } from "lucide-react"

export function EntregarButton({ suscripcionId }: { suscripcionId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function entregar() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/entregar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suscripcionId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Error al marcar como entregado")
        return
      }
      router.refresh()
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={entregar} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        Marcar como entregado
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
