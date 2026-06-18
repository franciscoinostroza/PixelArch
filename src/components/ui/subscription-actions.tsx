"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { X, Undo2, Loader2 } from "lucide-react"

interface SubscriptionActionsProps {
  suscripcionId: string
  estado: string
  cancelAtPeriodEnd?: boolean
}

export function SubscriptionActions({ suscripcionId, estado, cancelAtPeriodEnd }: SubscriptionActionsProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")
  const router = useRouter()

  async function action(accion: string) {
    setLoading(accion)
    setError("")
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suscripcionId, accion }),
    })
    setLoading(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Error en la operacion")
      return
    }
    router.refresh()
  }

  if (estado !== "ACTIVE" && estado !== "PAST_DUE") return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {cancelAtPeriodEnd ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => action("uncancel")}
            disabled={!!loading}
            title="Revertir cancelacion"
          >
            {loading === "uncancel" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => action("cancel")}
            disabled={!!loading}
            title="Cancelar al final del periodo"
          >
            {loading === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
