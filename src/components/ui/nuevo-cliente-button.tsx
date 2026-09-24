"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2 } from "lucide-react"

export function NuevoClienteButton() {
  const [open, setOpen] = useState(false)
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [empresa, setEmpresa] = useState("")
  const [telefono, setTelefono] = useState("")
  const [notas, setNotas] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function reset() {
    setNombre("")
    setEmail("")
    setEmpresa("")
    setTelefono("")
    setNotas("")
    setError("")
    setSuccess(false)
  }

  async function crear() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, empresa, telefono, notas }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al crear el cliente")
        return
      }
      setSuccess(true)
      router.refresh()
      setTimeout(() => { setOpen(false); reset() }, 1200)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" className="a-btn solid" onClick={() => setOpen(true)}>
        + Nuevo cliente
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!loading) { setOpen(false); reset() } }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 size={32} className="text-mint" />
                <p className="text-sm text-mint font-medium">Cliente creado</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Nuevo cliente</h2>
                <p className="text-xs text-text-dim mb-5">Cargá los datos del cliente que cerró por fuera del sitio.</p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="nc-nombre" className="block text-xs text-text-dim mb-1">Nombre *</label>
                    <input id="nc-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" placeholder="Nombre y apellido" />
                  </div>
                  <div>
                    <label htmlFor="nc-email" className="block text-xs text-text-dim mb-1">Email *</label>
                    <input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" placeholder="cliente@email.com" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="nc-empresa" className="block text-xs text-text-dim mb-1">Empresa</label>
                      <input id="nc-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" placeholder="Opcional" />
                    </div>
                    <div>
                      <label htmlFor="nc-telefono" className="block text-xs text-text-dim mb-1">Teléfono / WhatsApp</label>
                      <input id="nc-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" placeholder="+54 9 11 ..." />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="nc-notas" className="block text-xs text-text-dim mb-1">Notas internas</label>
                    <textarea id="nc-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text resize-none" placeholder="Detalles del acuerdo, referencias, etc." />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={crear} disabled={loading || nombre.length < 2 || !email} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Crear cliente
                    </Button>
                    <Button variant="ghost" onClick={() => { setOpen(false); reset() }} disabled={loading} className="flex-1">
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