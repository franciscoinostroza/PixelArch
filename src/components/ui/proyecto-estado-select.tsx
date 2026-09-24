"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

const ESTADOS: { value: string; label: string }[] = [
  { value: "ACTIVO", label: "Activo" },
  { value: "ENTREGADO", label: "Entregado" },
  { value: "CANCELADO", label: "Cancelado" },
]

export function ProyectoEstadoSelect({ proyectoId, estado }: { proyectoId: string; estado: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function cambiar(nuevo: string) {
    if (nuevo === estado) return
    setLoading(true)
    try {
      await fetch(`/api/admin/proyectos/${proyectoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <select
        value={estado}
        onChange={(e) => cambiar(e.target.value)}
        disabled={loading}
        className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs font-mono text-text"
        title="Estado del proyecto"
      >
        {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
      </select>
      {loading && <Loader2 size={13} className="animate-spin" />}
    </span>
  )
}