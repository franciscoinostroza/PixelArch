"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, Settings2 } from "lucide-react"

interface Props {
  suscripcionId: string
  precioCustom: number | null
  proximoPago: string | null
}

export function AjustesSuscripcionButton({ suscripcionId, precioCustom, proximoPago }: Props) {
  const [open, setOpen] = useState(false)
  const [precio, setPrecio] = useState(precioCustom ? (precioCustom / 100).toString() : "")
  const [fecha, setFecha] = useState(proximoPago ? new Date(proximoPago).toISOString().slice(0, 10) : "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function guardar() {
    setLoading(true)
    setError("")
    try {
      const precioNum = precio.trim() ? Number(precio.replace(",", ".")) : 0
      const resPrecio = await fetch("/api/admin/suscripciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suscripcionId, accion: "set-precio", precioCustom: precioNum > 0 ? Math.round(precioNum * 100) : 0 }),
      })
      if (!resPrecio.ok) {
        const body = await resPrecio.json().catch(() => ({}))
        setError(body.error || "Error al guardar el precio")
        return
      }

      if (fecha) {
        const resFecha = await fetch("/api/admin/suscripciones", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suscripcionId, accion: "fijar-vencimiento", fecha: `${fecha}T12:00:00` }),
        })
        if (!resFecha.ok) {
          const body = await resFecha.json().catch(() => ({}))
          setError(body.error || "Error al guardar la fecha")
          return
        }
      }

      setSuccess(true)
      router.refresh()
      setTimeout(() => { setOpen(false); setSuccess(false) }, 1000)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="Ajustes de suscripción">
        <Settings2 size={14} />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!loading) setOpen(false) }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 size={32} className="text-mint" />
                <p className="text-sm text-mint font-medium">Ajustes guardados</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Ajustes de suscripción</h2>
                <p className="text-xs text-text-dim mb-5">Precio acordado y próximo vencimiento.</p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="aj-precio" className="block text-xs text-text-dim mb-1">Precio acordado (USD/mes)</label>
                    <input
                      id="aj-precio"
                      type="number"
                      min="0"
                      step="0.01"
                      value={precio}
                      onChange={(e) => setPrecio(e.target.value)}
                      placeholder="Vacío = precio de catálogo"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="aj-fecha" className="block text-xs text-text-dim mb-1">Próximo vencimiento</label>
                    <input
                      id="aj-fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                    />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={guardar} disabled={loading} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Guardar
                    </Button>
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading} className="flex-1">
                      Cancelar
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}