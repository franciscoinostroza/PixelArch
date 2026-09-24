"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { X, Undo2, Play, Pause, Loader2, AlertTriangle } from "lucide-react"

interface SubscriptionActionsProps {
  suscripcionId: string
  estado: string
  deploymentPlatform?: string | null
  platformServiceId?: string | null
}

type ModalKind = "pausar" | "cancelar" | null

export function SubscriptionActions({ suscripcionId, estado, deploymentPlatform, platformServiceId }: SubscriptionActionsProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [modal, setModal] = useState<ModalKind>(null)
  const [conDeploy, setConDeploy] = useState(true)
  const router = useRouter()

  const hasDeploy = !!(deploymentPlatform && platformServiceId)

  async function action(accion: string, extra?: Record<string, unknown>) {
    setLoading(accion)
    setError("")
    try {
      const res = await fetch("/api/admin/suscripciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suscripcionId, accion, ...(extra || {}) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Error en la operacion")
        return
      }
      setModal(null)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  if (estado === "PENDING" || estado === "READY") return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {(estado === "ACTIVE" || estado === "PAST_DUE") && (
          <Button variant="ghost" size="sm" onClick={() => { setConDeploy(true); setModal("pausar") }} disabled={!!loading} title="Pausar suscripcion">
            {loading === "pausar" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
          </Button>
        )}
        {estado === "ACTIVE" && (
          <Button variant="ghost" size="sm" onClick={() => action("marcar-vencido")} disabled={!!loading} title="Marcar como vencido">
            {loading === "marcar-vencido" ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
          </Button>
        )}
        {(estado === "PAUSED" || estado === "CANCELED") && (
          <Button variant="ghost" size="sm" onClick={() => action("reactivar")} disabled={!!loading} title="Reactivar">
            {loading === "reactivar" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          </Button>
        )}
        {estado !== "CANCELED" && (
          <Button variant="ghost" size="sm" onClick={() => { setConDeploy(true); setModal("cancelar") }} disabled={!!loading} title="Cancelar suscripcion">
            <X size={14} />
          </Button>
        )}
        {hasDeploy && (estado === "ACTIVE" || estado === "PAST_DUE") && (
          <>
            <Button variant="ghost" size="sm" onClick={() => action("pause-deploy")} disabled={!!loading} title="Pausar deploy">
              {loading === "pause-deploy" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => action("resume-deploy")} disabled={!!loading} title="Reanudar deploy">
              {loading === "resume-deploy" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!loading) setModal(null) }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-base font-bold text-text mb-2">
              {modal === "pausar" ? "Pausar suscripción" : "Cancelar suscripción"}
            </h2>
            <p className="text-xs text-text-dim mb-5">
              {modal === "pausar"
                ? "El servicio queda marcado como pausado. Podés reactivarlo cuando quieras."
                : "Esta acción marca la suscripción como cancelada. No se puede deshacer (aunque podés reactivarla después)."}
            </p>

            {hasDeploy && (
              <label className="flex items-center gap-2 text-sm text-text-dim mb-5">
                <input type="checkbox" checked={conDeploy} onChange={(e) => setConDeploy(e.target.checked)} style={{ accentColor: "#8b5cf6" }} />
                {modal === "pausar" ? "Pausar también el deploy del cliente" : "Pausar también el deploy del cliente"}
              </label>
            )}

            <div className="flex gap-3">
              <Button
                onClick={() => action(modal === "pausar" ? "pausar" : "cancelar", { pausarDeploy: hasDeploy ? conDeploy : false })}
                disabled={!!loading}
                className="flex-1"
                variant={modal === "cancelar" ? "outline" : "default"}
              >
                {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                {modal === "pausar" ? "Pausar" : "Cancelar suscripción"}
              </Button>
              <Button variant="ghost" onClick={() => setModal(null)} disabled={!!loading} className="flex-1">
                Volver
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}