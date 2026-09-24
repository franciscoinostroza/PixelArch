"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Mail, Check } from "lucide-react"

export function RecordarEmailButton({ suscripcionId, hitoId }: { suscripcionId?: string; hitoId?: string }) {
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function enviar() {
    setLoading(true)
    setError("")
    setOk(false)
    try {
      const res = await fetch("/api/admin/recordar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suscripcionId, hitoId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al enviar")
        return
      }
      setOk(true)
      router.refresh()
      setTimeout(() => setOk(false), 3000)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" className="a-btn ghost" onClick={enviar} disabled={loading} title="Enviar recordatorio por email">
        {loading ? <Loader2 size={13} className="animate-spin" /> : ok ? <Check size={13} /> : <Mail size={13} />}
        {ok ? "Enviado" : "Email"}
      </button>
      {error && <span style={{ fontSize: ".7rem", color: "#f87171" }}>{error}</span>}
    </span>
  )
}