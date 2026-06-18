"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Save } from "lucide-react"

interface DeployConfigProps {
  suscripcionId: string
  deploymentId: string | null
  deploymentPlatform: string | null
}

export function DeployConfig({ suscripcionId, deploymentId: initialId, deploymentPlatform: initialPlatform }: DeployConfigProps) {
  const [id, setId] = useState(initialId ?? "")
  const [platform, setPlatform] = useState(initialPlatform ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function guardar() {
    setLoading(true)
    setError("")
    setSuccess(false)
    try {
      const res = await fetch("/api/admin/suscripciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suscripcionId,
          accion: "update-deploy",
          deploymentId: id || null,
          deploymentPlatform: platform || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Error al guardar")
        return
      }
      setSuccess(true)
      router.refresh()
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-2">
      <select
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
        className="rounded-md border border-border bg-bg2 px-2 py-1 text-xs text-text font-mono"
      >
        <option value="">Sin plataforma</option>
        <option value="railway">Railway</option>
        <option value="vercel">Vercel</option>
      </select>
      <Input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="ID del deploy"
        className="h-7 w-36 text-xs font-mono"
      />
      <Button size="sm" variant="ghost" onClick={guardar} disabled={loading || (!id && !platform)}>
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
      </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-accent2">Configuracion guardada</p>}
    </div>
  )
}
