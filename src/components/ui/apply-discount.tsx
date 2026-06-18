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
        setError(body.error || "Codigo invalido")
        return
      }
      setDescripcion(body.descripcion || "Descuento aplicado")
      setSuccess(true)
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex items-center gap-1.5 pt-2 text-xs text-accent2">
        <CheckCircle2 size={12} />
        {descripcion}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pt-2 text-xs text-accent hover:underline"
      >
        Tengo un codigo de descuento
      </button>
    )
  }

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2">
        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="CODIGO"
          className="h-7 w-28 text-xs font-mono uppercase"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={aplicar}
          disabled={loading || !codigo.trim()}
          className="h-7 text-xs"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : "Aplicar"}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
