"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, Plus } from "lucide-react"

export function AgregarHitoButton({ proyectoId }: { proyectoId: string }) {
  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState("")
  const [monto, setMonto] = useState("")
  const [fecha, setFecha] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function abrir() {
    setOpen(true)
    setTitulo("")
    setMonto("")
    setFecha("")
    setError("")
    setSuccess(false)
  }

  async function agregar() {
    const montoNum = Number(monto.replace(",", "."))
    if (!montoNum || montoNum <= 0) { setError("Ingresá un monto válido"); return }

    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/proyectos/${proyectoId}/hitos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          monto: Math.round(montoNum * 100),
          vencimiento: fecha ? `${fecha}T12:00:00` : null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al agregar el hito")
        return
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
      <button
        type="button"
        onClick={abrir}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".78rem", color: "#8b5cf6", background: "none", border: "1px dashed rgba(139,92,246,0.4)", borderRadius: 10, cursor: "pointer", padding: "7px 12px", marginTop: 10 }}
      >
        <Plus size={13} />
        Agregar hito
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
                <p className="text-sm text-mint font-medium">Hito agregado</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-5">Agregar hito</h2>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="ah-titulo" className="block text-xs text-text-dim mb-1">Título</label>
                    <input id="ah-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" placeholder="Ej: Cambio de alcance" />
                  </div>
                  <div>
                    <label htmlFor="ah-monto" className="block text-xs text-text-dim mb-1">Monto (USD) *</label>
                    <input id="ah-monto" type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" placeholder="Ej: 150" />
                  </div>
                  <div>
                    <label htmlFor="ah-fecha" className="block text-xs text-text-dim mb-1">Vencimiento (opcional)</label>
                    <input id="ah-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={agregar} disabled={loading || !monto} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Agregar
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