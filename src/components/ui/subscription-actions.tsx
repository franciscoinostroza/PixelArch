"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Pause, Play, X, Loader2 } from "lucide-react"

interface SubscriptionActionsProps {
  suscripcionId: string
  estado: string
}

export function SubscriptionActions({ suscripcionId, estado }: SubscriptionActionsProps) {
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

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {estado === "ACTIVE" || estado === "PAST_DUE" ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => action("pause")}
              disabled={!!loading}
              title="Pausar"
            >
              {loading === "pause" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => action("cancel")}
              disabled={!!loading}
              title="Cancelar"
            >
              {loading === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            </Button>
          </>
        ) : estado === "PAUSED" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => action("resume")}
            disabled={!!loading}
            title="Reanudar"
          >
            {loading === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </Button>
        ) : null}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
