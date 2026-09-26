"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, Pencil, Trash2 } from "lucide-react"

interface Props {
  hitoId: string
  titulo: string
  monto: number
  vencimiento: string | null
  puedeEliminar: boolean
}

export function EditarHitoButton({ hitoId, titulo, monto, vencimiento, puedeEliminar }: Props) {
  const [open, setOpen] = useState(false)
  const [nuevoTitulo, setNuevoTitulo] = useState(titulo)
  const [nuevoMonto, setNuevoMonto] = useState((monto / 100).toString())
  const [nuevaFecha, setNuevaFecha] = useState(vencimiento ? new Date(vencimiento).toISOString().slice(0, 10) : "")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function abrir() {
    setOpen(true)
    setNuevoTitulo(titulo)
    setNuevoMonto((monto / 100).toString())
    setNuevaFecha(vencimiento ? new Date(vencimiento).toISOString().slice(0, 10) : "")
    setError("")
    setSuccess(false)
  }

  async function guardar() {
    const montoNum = Number(nuevoMonto.replace(",", "."))
    if (nuevoTitulo.trim().length < 1) { setError("El título no puede quedar vacío"); return }
    if (!montoNum || montoNum <= 0) { setError("Ingresá un monto válido"); return }

    setLoading("guardar")
    setError("")
    try {
      const res = await fetch(`/api/admin/hitos/${hitoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: nuevoTitulo,
          monto: Math.round(montoNum * 100),
          vencimiento: nuevaFecha ? `${nuevaFecha}T12:00:00` : null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al guardar")
        return
      }
      setSuccess(true)
      router.refresh()
      setTimeout(() => { setOpen(false); setSuccess(false) }, 1000)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(null)
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar el hito "${titulo}"? Esta acción no se puede deshacer.`)) return
    setLoading("eliminar")
    setError("")
    try {
      const res = await fetch(`/api/admin/hitos/${hitoId}`, { method: "DELETE" })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al eliminar")
        return
      }
      router.refresh()
      setOpen(false)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={abrir} title="Editar hito">
        <Pencil size={13} />
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
                <p className="text-sm text-mint font-medium">Hito actualizado</p>
              </div>
            ) : (
              <>
                <h2
                  className="font-display text-lg font-bold text-text mb-1"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={titulo}
                >
                  Editar hito
                </h2>
                <p
                  className="text-xs text-text-dim mb-5"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={titulo}
                >
                  {titulo}
                </p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="eh-titulo" className="block text-xs text-text-dim mb-1">Título</label>
                    <input id="eh-titulo" value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" />
                  </div>
                  <div>
                    <label htmlFor="eh-monto" className="block text-xs text-text-dim mb-1">Monto (USD)</label>
                    <input id="eh-monto" type="number" min="0" step="1" value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" />
                  </div>
                  <div>
                    <label htmlFor="eh-fecha" className="block text-xs text-text-dim mb-1">Vencimiento (opcional)</label>
                    <input id="eh-fecha" type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={guardar} disabled={!!loading} className="flex-1">
                      {loading === "guardar" ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Guardar
                    </Button>
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={!!loading} className="flex-1">
                      Cancelar
                    </Button>
                  </div>

                  {puedeEliminar && (
                    <button
                      type="button"
                      onClick={eliminar}
                      disabled={!!loading}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".78rem", color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
                    >
                      {loading === "eliminar" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Eliminar hito
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}