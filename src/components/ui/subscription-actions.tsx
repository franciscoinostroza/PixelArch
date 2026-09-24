"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Play, Pause, Loader2 } from "lucide-react"

interface SubscriptionActionsProps {
  suscripcionId: string
  estado: string
  deploymentPlatform?: string | null
  platformServiceId?: string | null
}

export function SubscriptionActions({ suscripcionId, estado, deploymentPlatform, platformServiceId }: SubscriptionActionsProps) {
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

  const hasDeploy = !!(deploymentPlatform && platformServiceId)

  if (estado !== "ACTIVE" && estado !== "PAST_DUE") return null
  if (!hasDeploy) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => action("pause-deploy")} disabled={!!loading} title="Pausar deploy">
          {loading === "pause-deploy" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => action("resume-deploy")} disabled={!!loading} title="Reanudar deploy">
          {loading === "resume-deploy" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}