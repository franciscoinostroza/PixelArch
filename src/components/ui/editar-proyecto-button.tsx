"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2 } from "lucide-react"

interface Props {
  proyectoId: string
  titulo: string
  notas: string | null
}

export function EditarProyectoButton({ proyectoId, titulo, notas }: Props) {
  const [open, setOpen] = useState(false)
  const [nuevoTitulo, setNuevoTitulo] = useState(titulo)
  const [nuevasNotas, setNuevasNotas] = useState(notas ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function abrir() {
    setOpen(true)
    setNuevoTitulo(titulo)
    setNuevasNotas(notas ?? "")
    setError("")
    setSuccess(false)
  }

  async function guardar() {
    if (nuevoTitulo.trim().length < 2) { setError("Poné un título al proyecto"); return }

    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/proyectos/${proyectoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: nuevoTitulo, notas: nuevasNotas }),
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
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".78rem", color: "var(--color-text-dim)", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, cursor: "pointer", padding: "6px 11px" }}
      >
        Editar proyecto
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!loading) setOpen(false) }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 size={32} className="text-mint" />
                <p className="text-sm text-mint font-medium">Proyecto actualizado</p>
              </div>
            ) : (
              <>
                <h2
                  className="font-display text-lg font-bold text-text mb-1"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={titulo}
                >
                  Editar proyecto
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
                    <label htmlFor="ep-titulo" className="block text-xs text-text-dim mb-1">Título</label>
                    <input id="ep-titulo" value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" />
                  </div>
                  <div>
                    <label htmlFor="ep-notas" className="block text-xs text-text-dim mb-1">Notas internas</label>
                    <textarea id="ep-notas" value={nuevasNotas} onChange={(e) => setNuevasNotas(e.target.value)} rows={4} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text resize-none" placeholder="Detalles del acuerdo, hitos acordados, etc." />
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