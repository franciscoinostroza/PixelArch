"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2 } from "lucide-react"
import { METODOS_PAGO, METODO_LABEL } from "@/lib/pagos"

interface Props {
  suscripcionId: string
  servicioNombre: string
  precioUsd: number
  precioArs: number | null
  size?: "sm" | "default"
  variant?: "default" | "outline" | "gradient" | "ghost"
  label?: string
  className?: string
}

export function RegistrarPagoButton({
  suscripcionId,
  servicioNombre,
  precioUsd,
  precioArs,
  size = "sm",
  variant = "default",
  label,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [moneda, setMoneda] = useState<"usd" | "ars">("usd")
  const [monto, setMonto] = useState("")
  const [metodo, setMetodo] = useState<string>("TRANSFERENCIA")
  const [nota, setNota] = useState("")
  const [enviarRecibo, setEnviarRecibo] = useState(true)
  const [avanzar, setAvanzar] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    if (moneda === "usd") {
      setMonto((precioUsd / 100).toString())
    } else {
      setMonto(precioArs ? Math.round(precioArs / 100).toString() : "")
    }
  }, [moneda, open, precioUsd, precioArs])

  async function registrar() {
    const montoNum = Number(monto.replace(",", "."))
    if (!montoNum || montoNum <= 0) {
      setError("Ingresá un monto válido")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suscripcionId,
          monto: Math.round(montoNum * 100),
          moneda,
          metodo,
          nota,
          enviarRecibo,
          avanzarVencimiento: avanzar,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al registrar el pago")
        return
      }
      setSuccess(true)
      router.refresh()
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        setMonto("")
        setNota("")
      }, 1100)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        {label ?? "Registrar pago"}
      </Button>

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
                <p className="text-sm text-mint font-medium">Pago registrado</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold text-text mb-1">Registrar pago</h2>
                <p className="text-xs text-text-dim mb-5">{servicioNombre}</p>

                <div className="space-y-3">
                  <div>
                    <span className="block text-xs text-text-dim mb-1">Moneda</span>
                    <div className="flex rounded-lg border border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setMoneda("usd")}
                        className="flex-1 px-3 py-2 text-sm font-mono"
                        style={moneda === "usd" ? { background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c", fontWeight: 600 } : { color: "var(--color-text-dim)" }}
                      >
                        USD
                      </button>
                      <button
                        type="button"
                        onClick={() => setMoneda("ars")}
                        className="flex-1 px-3 py-2 text-sm font-mono"
                        style={moneda === "ars" ? { background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c", fontWeight: 600 } : { color: "var(--color-text-dim)" }}
                      >
                        ARS
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="rp-monto" className="block text-xs text-text-dim mb-1">
                      Monto ({moneda === "usd" ? "dólares" : "pesos"})
                    </label>
                    <input
                      id="rp-monto"
                      type="number"
                      min="0"
                      step="0.01"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="rp-metodo" className="block text-xs text-text-dim mb-1">Método</label>
                    <select
                      id="rp-metodo"
                      value={metodo}
                      onChange={(e) => setMetodo(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                    >
                      {METODOS_PAGO.map((m) => (
                        <option key={m} value={m}>{METODO_LABEL[m]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rp-nota" className="block text-xs text-text-dim mb-1">Nota (opcional)</label>
                    <input
                      id="rp-nota"
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text"
                      placeholder="N° de operación, detalle, etc."
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-text-dim">
                    <input type="checkbox" checked={avanzar} onChange={(e) => setAvanzar(e.target.checked)} style={{ accentColor: "#8b5cf6" }} />
                    Actualizar próximo vencimiento (+1 mes)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text-dim">
                    <input type="checkbox" checked={enviarRecibo} onChange={(e) => setEnviarRecibo(e.target.checked)} style={{ accentColor: "#8b5cf6" }} />
                    Enviar recibo por email
                  </label>

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  <div className="flex gap-3 pt-1">
                    <Button onClick={registrar} disabled={loading || !monto} className="flex-1">
                      {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                      Registrar
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