"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Link2, Copy, Check } from "lucide-react"
import { waLink } from "@/lib/contact"

interface Props {
  suscripcionId: string
  servicio: string
  cliente?: string | null
  precioUsd: number
  precioArs: number | null
  clienteTelefono?: string | null
  linkGuardado?: string | null
  linkExpira?: string | null
  mesesGuardados?: number | null
  size?: "sm" | "default"
}

export function GenerarLinkMpButton({
  suscripcionId,
  servicio,
  cliente,
  precioUsd,
  precioArs,
  clienteTelefono,
  linkGuardado,
  linkExpira,
  mesesGuardados,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false)
  const [modo, setModo] = useState<"meses" | "solo">("meses")
  const [meses, setMeses] = useState(1)
  const [montoArs, setMontoArs] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [link, setLink] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const linkVigente =
    linkGuardado && linkExpira && new Date(linkExpira).getTime() > Date.now()

  useEffect(() => {
    if (!open || link) return
    if (linkVigente) return
    if (modo === "meses" && precioArs) {
      setMontoArs(String(Math.round((precioArs * meses) / 100)))
    } else if (!montoArs && precioArs) {
      setMontoArs(String(Math.round(precioArs / 100)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modo, meses, precioArs, link, linkVigente])

  function abrir() {
    setOpen(true)
    setError("")
    setLink(linkVigente ? linkGuardado : null)
    setModo("meses")
    setMeses(mesesGuardados && mesesGuardados > 0 ? mesesGuardados : 1)
    if (!linkVigente && precioArs) setMontoArs(String(Math.round(precioArs / 100)))
  }

  function regenerar() {
    setLink(null)
    if (precioArs) setMontoArs(String(Math.round((precioArs * meses) / 100)))
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
        body: JSON.stringify({
          suscripcionId,
          meses: modo === "solo" ? 0 : meses,
          montoArsCents: Math.round(montoNum * 100),
        }),
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
    ? `Hola! Acá te dejo el link para el pago de ${servicio} (${modo === "solo" ? "pago" : `${meses} ${meses === 1 ? "mes" : "meses"}`}): ${link}`
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
              title={servicio}
            >
              {servicio}
            </h2>
            <p
              className="text-xs text-text-dim mb-5"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={`${cliente ? `${cliente} · ` : ""}US$${(precioUsd / 100).toFixed(0)}/mes`}
            >
              {cliente ? `${cliente} · ` : ""}US${(precioUsd / 100).toFixed(0)}/mes
            </p>

            {link ? (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: "#34d399" }}>
                  ✓ Link {linkVigente && link === linkGuardado ? "guardado" : "generado"}
                  {link === linkGuardado && linkExpira && (
                    <span style={{ color: "var(--color-text-faint)" }}>
                      {" · válido hasta "}
                      {new Date(linkExpira).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </p>
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
                    <a
                      href={waLink(clienteTelefono, mensajeWa)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="gradient" className="w-full">Enviar por WhatsApp</Button>
                    </a>
                  ) : (
                    <Button variant="ghost" disabled className="flex-1" title="El cliente no tiene teléfono cargado">
                      Sin teléfono
                    </Button>
                  )}
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="ghost" onClick={regenerar} disabled={loading} className="flex-1">
                    Regenerar link
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)} className="flex-1">
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <span className="block text-xs text-text-dim mb-1">¿Qué acredita?</span>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setModo("meses")}
                      className="flex-1 px-3 py-2 text-sm"
                      style={modo === "meses" ? { background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c", fontWeight: 600 } : { color: "var(--color-text-dim)" }}
                    >
                      Meses
                    </button>
                    <button
                      type="button"
                      onClick={() => setModo("solo")}
                      className="flex-1 px-3 py-2 text-sm"
                      style={modo === "solo" ? { background: "linear-gradient(135deg,#8b5cf6,#22d3ee)", color: "#07060c", fontWeight: 600 } : { color: "var(--color-text-dim)" }}
                    >
                      Solo registrar
                    </button>
                  </div>
                  <p className="text-xs text-text-dim mt-1.5" style={{ fontSize: ".68rem" }}>
                    {modo === "meses"
                      ? "El pago acredita meses de vencimiento al aprobarse."
                      : "El pago queda en el historial sin mover el vencimiento (parciales o extras)."}
                  </p>
                </div>

                {modo === "meses" && (
                  <div>
                    <label htmlFor="mp-meses" className="block text-xs text-text-dim mb-1">Meses</label>
                    <select
                      id="mp-meses"
                      value={meses}
                      onChange={(e) => setMeses(Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{m} {m === 1 ? "mes" : "meses"}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="mp-monto" className="block text-xs text-text-dim mb-1">Monto (ARS)</label>
                  <input
                    id="mp-monto"
                    type="number"
                    min="0"
                    step="1"
                    value={montoArs}
                    onChange={(e) => setMontoArs(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text font-mono"
                  />
                  {modo === "meses" && (
                    <p className="text-text-dim mt-1" style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}>
                      ≈ US${((precioUsd / 100) * meses).toFixed(0)} × {meses} {meses === 1 ? "mes" : "meses"} — editable para descuentos
                    </p>
                  )}
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