"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Link2, Copy, Check } from "lucide-react"
import { waLink } from "@/lib/contact"

interface Props {
  hitoId: string
  hitoTitulo: string
  proyectoTitulo: string
  precioUsd: number
  precioArs: number | null
  clienteTelefono?: string | null
  size?: "sm" | "default"
}

export function GenerarLinkHitoButton({
  hitoId,
  hitoTitulo,
  proyectoTitulo,
  precioUsd,
  precioArs,
  clienteTelefono,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false)
  const [montoArs, setMontoArs] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [link, setLink] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!open || link) return
    if (precioArs) setMontoArs(String(Math.round(precioArs / 100)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, precioArs, link])

  function abrir() {
    setOpen(true)
    setLink(null)
    setError("")
    if (precioArs) setMontoArs(String(Math.round(precioArs / 100)))
  }

  async function generar() {
    const montoNum = Number(montoArs.replace(",", "."))
    if (!montoNum || montoNum <= 0) {
      setError("Ingresá un monto válido")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/mp/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hitoId, montoArsCents: Math.round(montoNum * 100) }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || "Error al generar el link")
        return
      }
      setLink(body.url)
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError("No se pudo copiar — copialo a mano")
    }
  }

  const mensajeWa = link
    ? `Hola! Acá te dejo el link para el pago de ${proyectoTitulo} (${hitoTitulo}): ${link}`
    : ""

  return (
    <>
      <Button size={size} variant="outline" onClick={abrir}>
        <Link2 size={14} className="mr-1.5" />
        Link MP
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
            <h2
              className="font-display text-lg font-bold text-text mb-1"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={proyectoTitulo}
            >
              {proyectoTitulo}
            </h2>
            <p
              className="text-xs text-text-dim mb-5"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={`${hitoTitulo} · ≈ US$${(precioUsd / 100).toFixed(0)}`}
            >
              {hitoTitulo} · ≈ US${(precioUsd / 100).toFixed(0)}
            </p>

            {link ? (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: "#34d399" }}>✓ Link generado</p>
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-xs text-text-dim"
                />
                <div className="flex gap-3">
                  <Button onClick={copiar} className="flex-1" variant="outline">
                    {copiado ? <Check size={14} className="mr-1.5" /> : <Copy size={14} className="mr-1.5" />}
                    {copiado ? "Copiado" : "Copiar"}
                  </Button>
                  {clienteTelefono ? (
                    <a href={waLink(clienteTelefono, mensajeWa)} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button variant="gradient" className="w-full">Enviar por WhatsApp</Button>
                    </a>
                  ) : (
                    <Button variant="ghost" disabled className="flex-1" title="El cliente no tiene teléfono cargado">
                      Sin teléfono
                    </Button>
                  )}
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="ghost" onClick={() => setLink(null)} disabled={loading} className="flex-1">
                    Generar otro
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)} className="flex-1">
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="lh-monto" className="block text-xs text-text-dim mb-1">Monto (ARS)</label>
                  <input
                    id="lh-monto"
                    type="number"
                    min="0"
                    step="1"
                    value={montoArs}
                    onChange={(e) => setMontoArs(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                  />
                  <p className="text-text-dim mt-1" style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}>
                    ≈ US${(precioUsd / 100).toFixed(0)} — editable para descuentos
                  </p>
                </div>

                {!precioArs && (
                  <p className="text-xs" style={{ color: "#fbbf24" }}>
                    No hay cotización del dólar disponible — ingresá el monto a mano.
                  </p>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}

                <div className="flex gap-3 pt-1">
                  <Button onClick={generar} disabled={loading || !montoArs} className="flex-1">
                    {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                    Generar link
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading} className="flex-1">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}