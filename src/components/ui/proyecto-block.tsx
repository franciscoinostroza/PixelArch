import { cn } from "@/lib/utils"
import { formatearMonto, convertirUsdAArs, type Moneda } from "@/lib/pagos"
import { MarcarHitoButton } from "@/components/ui/marcar-hito-button"
import { RegistrarPagoHitoButton } from "@/components/ui/registrar-pago-hito-button"
import { GenerarLinkHitoButton } from "@/components/ui/generar-link-hito-button"
import { ProyectoEstadoSelect } from "@/components/ui/proyecto-estado-select"

export interface ProyectoConHitos {
  id: string
  titulo: string
  montoTotal: number
  estado: string
  notas: string | null
  creadoEn: Date
  servicio: { nombre: string } | null
  hitos: {
    id: string
    orden: number
    titulo: string
    monto: number
    estado: string
    vencimiento: Date | null
  }[]
}

const estadoPill: Record<string, { cls: string; label: string }> = {
  ACTIVO: { cls: "a-pill violet", label: "Activo" },
  ENTREGADO: { cls: "a-pill mint", label: "Entregado" },
  CANCELADO: { cls: "a-pill gray", label: "Cancelado" },
}

export function ProyectoBlock({
  proyecto,
  rate,
  clienteTelefono,
}: {
  proyecto: ProyectoConHitos
  rate: number | null
  clienteTelefono?: string | null
}) {
  const pagados = proyecto.hitos.filter((h) => h.estado === "PAGADO").length
  const total = proyecto.hitos.length
  const cobrado = proyecto.hitos.filter((h) => h.estado === "PAGADO").reduce((acc, h) => acc + h.monto, 0)
  const progreso = total > 0 ? Math.round((pagados / total) * 100) : 0
  const pill = estadoPill[proyecto.estado] ?? estadoPill.ACTIVO

  return (
    <div className="a-panel" style={{ marginTop: 18 }}>
      <div className="a-head">
        <h3 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {proyecto.titulo}
          {proyecto.servicio && <span className="a-faint" style={{ fontWeight: 400 }}>· {proyecto.servicio.nombre}</span>}
          <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
        </h3>
        <span className="a-faint">{formatearMonto(proyecto.montoTotal, "usd")}</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
          <span className="a-faint" style={{ fontSize: ".78rem" }}>
            {pagados} de {total} hitos pagados · cobrado {formatearMonto(cobrado, "usd")}
          </span>
          <ProyectoEstadoSelect proyectoId={proyecto.id} estado={proyecto.estado} />
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }} role="img" aria-label={`Progreso: ${progreso}%`}>
          <div style={{ height: "100%", width: `${progreso}%`, borderRadius: 3, background: "linear-gradient(90deg, #8b5cf6, #22d3ee)", transition: "width .4s ease" }} />
        </div>
      </div>

      {proyecto.notas && (
        <p className="a-faint" style={{ fontSize: ".8rem", lineHeight: 1.6, marginBottom: 14, whiteSpace: "pre-wrap" }}>{proyecto.notas}</p>
      )}

      {proyecto.hitos.map((h) => {
        const precioArs = rate ? convertirUsdAArs(h.monto, rate) : null
        const pagado = h.estado === "PAGADO"
        return (
          <div key={h.id} className="a-prow" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="a-name">
                  <span className="a-mono" style={{ color: "var(--color-text-faint)", marginRight: 8 }}>{h.orden}/{total}</span>
                  {h.titulo}
                </div>
                <div className="a-date">
                  {formatearMonto(h.monto, "usd")}
                  {precioArs && <span style={{ color: "var(--color-text-faint)" }}> · ≈ {formatearMonto(precioArs, "ars")}</span>}
                  {h.vencimiento && ` · vence ${new Date(h.vencimiento).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`}
                </div>
              </div>
              <span className={cn("a-pill", pagado ? "mint" : "yellow")}>
                <i />{pagado ? "Pagado" : "Pendiente"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {!pagado && (
                <RegistrarPagoHitoButton
                  hitoId={h.id}
                  hitoTitulo={h.titulo}
                  proyectoTitulo={proyecto.titulo}
                  precioUsd={h.monto}
                  precioArs={precioArs}
                />
              )}
              {!pagado && (
                <GenerarLinkHitoButton
                  hitoId={h.id}
                  hitoTitulo={h.titulo}
                  proyectoTitulo={proyecto.titulo}
                  precioUsd={h.monto}
                  precioArs={precioArs}
                  clienteTelefono={clienteTelefono}
                />
              )}
              <MarcarHitoButton hitoId={h.id} estado={h.estado} />
            </div>
          </div>
        )
      })}
    </div>
  )
}