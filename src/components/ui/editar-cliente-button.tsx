"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2 } from "lucide-react"

interface ClienteEditable {
  id: string
  nombre: string
  email: string
  empresa: string | null
  telefono: string | null
  notas: string | null
  activo: boolean
}

export function EditarClienteButton({ cliente }: { cliente: ClienteEditable }) {
  const [open, setOpen] = useState(false)
  const [nombre, setNombre] = useState(cliente.nombre)
  const [email, setEmail] = useState(cliente.email)
  const [empresa, setEmpresa] = useState(cliente.empresa ?? "")
  const [telefono, setTelefono] = useState(cliente.telefono ?? "")
  const [notas, setNotas] = useState(cliente.notas ?? "")
  const [activo, setActivo] = useState(cliente.activo)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function guardar() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/clientes/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, empresa, telefono, notas, activo }),
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
      <button type="button" className="a-btn ghost" onClick={() => setOpen(true)}>
        Editar datos
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
                <p className="text-sm text-mint font-medium">Datos guardados</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Editar cliente</h2>
                <p className="text-xs text-text-dim mb-5">Actualizá los datos o desactivá la cuenta.</p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="ec-nombre" className="block text-xs text-text-dim mb-1">Nombre *</label>
                    <input id="ec-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" />
                  </div>
                  <div>
                    <label htmlFor="ec-email" className="block text-xs text-text-dim mb-1">Email *</label>
                    <input id="ec-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ec-empresa" className="block text-xs text-text-dim mb-1">Empresa</label>
                      <input id="ec-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" />
                    </div>
                    <div>
                      <label htmlFor="ec-telefono" className="block text-xs text-text-dim mb-1">Teléfono / WhatsApp</label>
                      <input id="ec-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ec-notas" className="block text-xs text-text-dim mb-1">Notas internas</label>
                    <textarea id="ec-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text resize-none" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-text-dim">
                    <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} style={{ accentColor: "#8b5cf6" }} />
                    Cliente activo
                  </label>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={guardar} disabled={loading || nombre.length < 2 || !email} className="flex-1">
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