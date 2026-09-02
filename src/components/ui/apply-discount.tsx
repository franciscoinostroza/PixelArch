"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle2 } from "lucide-react"

export function ApplyDiscount({ suscripcionId }: { suscripcionId: string }) {
  const [open, setOpen] = useState(false)
  const [codigo, setCodigo] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [descripcion, setDescripcion] = useState("")

  async function aplicar() {
    setLoading(true)
    setError("")
    setSuccess(false)
    try {
      const res = await fetch("/api/portal/apply-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim(), suscripcionId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Código inválido")
        return
      }
      setDescripcion(body.descripcion || "Descuento aplicado")
      setSuccess(true)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-mint/20 bg-mint/5 px-2.5 py-1.5 text-xs text-mint">
        <CheckCircle2 size={12} />
        {descripcion}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-text-dim transition-colors hover:text-violet"
      >
        Tengo un código de descuento
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-lg border border-border/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="CÓDIGO"
          className="h-8 w-32 font-mono text-xs uppercase"
        />
        <Button
          size="sm"
          variant="default"
          onClick={aplicar}
          disabled={loading || !codigo.trim()}
          className="h-8 text-xs"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : "Aplicar"}
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  )
}
