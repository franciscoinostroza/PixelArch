import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { DeployConfig } from "@/components/ui/deploy-config"
import { EntregarButton } from "@/components/ui/entregar-button"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { AsignarProductoButton } from "@/components/ui/asignar-producto-button"
import { cn } from "@/lib/utils"

const mapLabel = (e: string) => {
  switch (e) {
    case "ACTIVE": return "Activo"
    case "PAST_DUE": return "Vencido"
    case "CANCELED": return "Cancelado"
    case "PENDING": return "En desarrollo"
    case "READY": return "Entregado"
    case "PAUSED": return "Pausado"
    default: return e
  }
}

function pillOf(estado: string) {
  const label = mapLabel(estado)
  const cls =
    estado === "ACTIVE" || estado === "READY"
      ? "a-pill mint"
      : estado === "PAST_DUE"
        ? "a-pill red"
        : estado === "PENDING"
          ? "a-pill yellow"
          : "a-pill gray"
  return { cls, label }
}

function pillOfPago(estado: string) {
  switch (estado) {
    case "SUCCEEDED": return { cls: "a-pill mint", label: "Pagado" }
    case "FAILED": return { cls: "a-pill red", label: "Fallido" }
    case "REFUNDED": return { cls: "a-pill gray", label: "Reembolsado" }
    case "PENDING": return { cls: "a-pill yellow", label: "Pendiente" }
    default: return { cls: "a-pill gray", label: estado }
  }
}

export default async function ClienteDetalle({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: {
      suscripciones: {
        include: { servicio: { select: { nombre: true, precioUnico: true, precioBasico: true, precioMantenimiento: true, polarProductIdBasico: true, polarProductIdMantenimiento: true, polarProductIdUnico: true } } },
        orderBy: { creadoEn: "desc" },
      },
      pagos: {
        orderBy: { creadoEn: "desc" },
        include: { suscripcion: { include: { servicio: { select: { nombre: true } } } } },
      },
    },
  })

  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  if (!cliente) notFound()

  const servicios = await prisma.servicio.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } })

  const pillCliente = cliente.activo ? { cls: "a-pill mint", label: "Cliente activo" } : { cls: "a-pill gray", label: "Inactivo" }

  return (
    <div>
      <div className="a-greet">
        <h1>{cliente.nombre}</h1>
        <p>{cliente.email}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          <AsignarProductoButton clienteId={cliente.id} servicios={servicios} />
          <span className={cn("a-pill", pillCliente.cls)}><i />{pillCliente.label}</span>
        </div>
      </div>

      <div className="a-panel">
        <div className="a-head"><h3>Datos</h3></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Empresa</div>
            <div>{cliente.empresa || "—"}</div>
          </div>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Teléfono</div>
            <div>{cliente.telefono || "—"}</div>
          </div>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Registrado</div>
            <div>{new Date(cliente.creadoEn).toLocaleDateString("es-AR")}</div>
          </div>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Polar ID</div>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cliente.polarCustomerId || "—"}</div>
          </div>
        </div>
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Suscripciones</h3>
          <span className="a-faint">{cliente.suscripciones.length}</span>
        </div>
        {cliente.suscripciones.length === 0 ? (
          <p className="a-empty">Sin suscripciones</p>
        ) : (
          cliente.suscripciones.map((s) => {
            const pill = pillOf(s.estado)
            return (
              <div key={s.id} className="a-prow" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="a-name">
                      {s.servicio.nombre}
                      {s.plan && <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>· {s.plan === "UNICO" ? "Pago único" : s.plan === "BASICO" ? "Básico" : "Mantenimiento"}</span>}
                    </div>
                    <div className="a-date">
                      {s.plan === "MANTENIMIENTO" ? `$${(s.servicio.precioMantenimiento / 100).toFixed(2)}/mes` : s.plan === "BASICO" ? `$${(s.servicio.precioBasico / 100).toFixed(2)}/mes` : `$${(s.servicio.precioUnico / 100).toFixed(2)} pago único`}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
                    {s.polarDiscountId && (
                      <span className="a-pill gray">Dto.</span>
                    )}
                    {s.estado !== "PENDING" && <SubscriptionActions suscripcionId={s.id} estado={s.estado} cancelAtPeriodEnd={s.cancelAtPeriodEnd} deploymentPlatform={s.deploymentPlatform} platformServiceId={s.platformServiceId} />}
                  </div>
                </div>
                {s.estado === "PENDING" && (
                  <div style={{ marginTop: 10 }}>
                    <EntregarButton suscripcionId={s.id} />
                  </div>
                )}
                {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <div style={{ marginTop: 10 }}>
                    <DeployConfig
                      suscripcionId={s.id}
                      deploymentId={s.deploymentId}
                      deploymentPlatform={s.deploymentPlatform}
                      platformServiceId={s.platformServiceId}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Historial de pagos</h3>
          <span className="a-faint">{cliente.pagos.length}</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cliente.pagos.length === 0 ? (
                <tr><td colSpan={4} className="a-empty">Sin pagos registrados</td></tr>
              ) : (
                cliente.pagos.map((p) => {
                  const pill = pillOfPago(p.estadoPago)
                  return (
                    <tr key={p.id}>
                      <td>{p.suscripcion?.servicio.nombre ?? "—"}</td>
                      <td className="a-faint">{new Date(p.creadoEn).toLocaleDateString("es-AR")}</td>
                      <td className="a-mono">US${(p.monto / 100).toFixed(2)}</td>
                      <td>
                        <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}