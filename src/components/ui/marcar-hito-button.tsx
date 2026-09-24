"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, Check, Undo2 } from "lucide-react"

export function MarcarHitoButton({ hitoId, estado }: { hitoId: string; estado: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function toggle() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/hitos/${hitoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: estado === "PAGADO" ? "PENDIENTE" : "PAGADO" }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Error")
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        disabled={loading}
        title={estado === "PAGADO" ? "Marcar como pendiente" : "Marcar como pagado"}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : estado === "PAGADO" ? <Undo2 size={13} /> : <Check size={13} />}
      </Button>
      {error && <span style={{ fontSize: ".7rem", color: "#f87171" }}>{error}</span>}
    </span>
  )
}