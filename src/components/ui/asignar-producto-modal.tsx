"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2 } from "lucide-react"

interface Servicio {
  id: string
  nombre: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  clienteId: string
  servicios: Servicio[]
}

export function AsignarProductoModal({ isOpen, onClose, clienteId, servicios }: Props) {
  const [servicioId, setServicioId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  if (!isOpen) return null

  async function asignar() {
    if (!servicioId) return
    setLoading(true)
    setError("")
    setSuccess(false)
    try {
      const res = await fetch("/api/admin/asignar-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, servicioId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al asignar")
        return
      }
      setSuccess(true)
      setTimeout(() => { onClose(); router.refresh() }, 1200)
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-2xl"
        style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 size={32} className="text-mint" />
            <p className="text-sm text-mint font-medium">Producto asignado</p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-lg font-bold text-text mb-1">Asignar producto</h2>
            <p className="text-xs text-text-dim mb-5">Seleccioná el servicio que el cliente compró por fuera.</p>

            <div className="space-y-4">
              <div>
                <label htmlFor="servicio-select" className="sr-only">Servicio</label>
                <select
                  id="servicio-select"
                  value={servicioId}
                  onChange={(e) => setServicioId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                >
                  <option value="">Seleccionar servicio...</option>
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}

              <div className="flex gap-3">
                <Button onClick={asignar} disabled={loading || !servicioId} className="flex-1">
                  {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                  Asignar
                </Button>
                <Button variant="ghost" onClick={onClose} disabled={loading} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
