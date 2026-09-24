"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, Plus } from "lucide-react"

interface Servicio {
  id: string
  nombre: string
}

interface HitoForm {
  titulo: string
  monto: string
  vencimiento: string
}

function tituloDefault(i: number, total: number): string {
  if (i === 0) return "Anticipo"
  if (i === total - 1) return "Entrega final"
  return `Avance ${i}`
}

export function NuevoProyectoButton({ clienteId, servicios }: { clienteId: string; servicios: Servicio[] }) {
  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState("")
  const [servicioId, setServicioId] = useState("")
  const [notas, setNotas] = useState("")
  const [total, setTotal] = useState("")
  const [count, setCount] = useState(3)
  const [hitos, setHitos] = useState<HitoForm[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  function distribuir(nuevoCount: number, nuevoTotal: string) {
    const t = Number(nuevoTotal.replace(",", ".")) || 0
    const base = Math.floor((t / nuevoCount) * 100) / 100
    const arr: HitoForm[] = []
    let acumulado = 0
    for (let i = 0; i < nuevoCount; i++) {
      const esUltimo = i === nuevoCount - 1
      const monto = esUltimo ? Math.max(0, t - acumulado) : base
      acumulado += monto
      arr.push({
        titulo: hitos[i]?.titulo || tituloDefault(i, nuevoCount),
        monto: monto > 0 ? String(monto) : "",
        vencimiento: hitos[i]?.vencimiento || "",
      })
    }
    setHitos(arr)
  }

  function abrir() {
    setOpen(true)
    setTitulo("")
    setServicioId("")
    setNotas("")
    setTotal("")
    setCount(3)
    setError("")
    setSuccess(false)
    distribuir(3, "")
  }

  function cambiarTotal(v: string) {
    setTotal(v)
    distribuir(count, v)
  }

  function cambiarCount(v: number) {
    setCount(v)
    distribuir(v, total)
  }

  function setHito(idx: number, campo: keyof HitoForm, valor: string) {
    setHitos((prev) => prev.map((h, i) => (i === idx ? { ...h, [campo]: valor } : h)))
  }

  async function crear() {
    setError("")
    if (titulo.trim().length < 2) { setError("Poné un título al proyecto"); return }
    const hitosPayload = hitos.map((h, i) => ({
      titulo: h.titulo || tituloDefault(i, hitos.length),
      monto: Math.round((Number(h.monto.replace(",", ".")) || 0) * 100),
      vencimiento: h.vencimiento ? `${h.vencimiento}T12:00:00` : null,
    }))
    if (hitosPayload.some((h) => h.monto <= 0)) { setError("Todos los hitos necesitan un monto"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/admin/proyectos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId,
          servicioId: servicioId || null,
          titulo,
          notas,
          hitos: hitosPayload,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al crear el proyecto")
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

  const totalCalculado = hitos.reduce((acc, h) => acc + (Number(h.monto.replace(",", ".")) || 0), 0)

  return (
    <>
      <Button onClick={abrir} size="default">
        <Plus size={15} className="mr-1.5" />
        Nuevo proyecto
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!loading) setOpen(false) }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            style={{ background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 size={32} className="text-mint" />
                <p className="text-sm text-mint font-medium">Proyecto creado</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Nuevo proyecto</h2>
                <p className="text-xs text-text-dim mb-5">Definí el total y los hitos de pago. Los montos van en USD (referencia).</p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="np-titulo" className="block text-xs text-text-dim mb-1">Título del proyecto *</label>
                    <input id="np-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text" placeholder="Ej: Landing Page — Panadería López" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="np-servicio" className="block text-xs text-text-dim mb-1">Categoría</label>
                      <select id="np-servicio" value={servicioId} onChange={(e) => setServicioId(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono">
                        <option value="">Sin categoría</option>
                        {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="np-total" className="block text-xs text-text-dim mb-1">Monto total (USD) *</label>
                      <input id="np-total" type="number" min="0" step="1" value={total} onChange={(e) => cambiarTotal(e.target.value)} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono" placeholder="Ej: 600" />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="np-count" className="block text-xs text-text-dim mb-1">Cantidad de hitos</label>
                    <select id="np-count" value={count} onChange={(e) => cambiarCount(Number(e.target.value))} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono">
                      {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? "hito" : "hitos"}</option>)}
                    </select>
                  </div>

                  <div className="rounded-xl border border-border p-3" style={{ background: "rgba(7,6,12,0.35)" }}>
                    <p className="text-xs text-text-dim mb-2">Hitos (montos editables):</p>
                    <div className="space-y-2">
                      {hitos.map((h, i) => (
                        <div key={i} className="grid grid-cols-[24px_1fr_96px_130px] gap-2 items-center">
                          <span className="font-mono text-xs text-text-faint">{i + 1}</span>
                          <input value={h.titulo} onChange={(e) => setHito(i, "titulo", e.target.value)} className="rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-text" placeholder={`Hito ${i + 1}`} />
                          <input type="number" min="0" step="1" value={h.monto} onChange={(e) => setHito(i, "monto", e.target.value)} className="rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-text font-mono" placeholder="US$" />
                          <input type="date" value={h.vencimiento} onChange={(e) => setHito(i, "vencimiento", e.target.value)} className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-text-dim font-mono" title="Vencimiento (opcional)" />
                        </div>
                      ))}
                    </div>
                    <p className="font-mono text-xs mt-2" style={{ color: "var(--color-cyan)", fontSize: ".7rem" }}>
                      Suma de hitos: US${totalCalculado.toFixed(0)}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="np-notas" className="block text-xs text-text-dim mb-1">Notas internas</label>
                    <textarea id="np-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text resize-none" placeholder="Detalles del acuerdo..." />
                  </div>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={crear} disabled={loading || titulo.trim().length < 2} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Crear proyecto
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