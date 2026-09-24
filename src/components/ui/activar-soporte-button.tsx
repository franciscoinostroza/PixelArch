"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, LifeBuoy } from "lucide-react"

interface Servicio {
  id: string
  nombre: string
}

export function ActivarSoporteButton({ clienteId, servicios }: { clienteId: string; servicios: Servicio[] }) {
  const [open, setOpen] = useState(false)
  const [servicioId, setServicioId] = useState("")
  const [monto, setMonto] = useState("")
  const [fecha, setFecha] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function abrir() {
    setOpen(true)
    setServicioId("")
    setMonto("")
    setError("")
    setSuccess(false)
  }

  async function activar() {
    const montoNum = Number(monto.replace(",", "."))
    if (!servicioId) { setError("Elegí una categoría"); return }
    if (!montoNum || montoNum <= 0) { setError("Ingresá el monto mensual"); return }

    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId,
          servicioId,
          montoUsdCents: Math.round(montoNum * 100),
          proximoPago: `${fecha}T12:00:00`,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al activar el soporte")
        return
      }
      setSuccess(true)
      router.refresh()
      setTimeout(() => { setOpen(false); setSuccess(false) }, 1100)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" className="a-btn ghost" onClick={abrir}>
        <LifeBuoy size={14} style={{ marginRight: 6 }} />
        Activar soporte
      </button>

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
                <p className="text-sm text-mint font-medium">Soporte activado</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Activar soporte</h2>
                <p className="text-xs text-text-dim mb-5">Plan Soporte mensual: hosting, monitoreo, cambios y soporte según lo acordado.</p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="as-servicio" className="block text-xs text-text-dim mb-1">Categoría *</label>
                    <select id="as-servicio" value={servicioId} onChange={(e) => setServicioId(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono">
                      <option value="">Seleccionar...</option>
                      {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="as-monto" className="block text-xs text-text-dim mb-1">Monto mensual (USD) *</label>
                    <input id="as-monto" type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" placeholder="Ej: 50" />
                  </div>

                  <div>
                    <label htmlFor="as-fecha" className="block text-xs text-text-dim mb-1">Primer vencimiento</label>
                    <input id="as-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={activar} disabled={loading} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Activar
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