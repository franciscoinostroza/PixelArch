import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { DeployConfig } from "@/components/ui/deploy-config"
import { EntregarButton } from "@/components/ui/entregar-button"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { AsignarProductoButton } from "@/components/ui/asignar-producto-button"
import { EditarClienteButton } from "@/components/ui/editar-cliente-button"
import { NuevoProyectoButton } from "@/components/ui/nuevo-proyecto-button"
import { ProyectoBlock } from "@/components/ui/proyecto-block"
import { ActivarSoporteButton } from "@/components/ui/activar-soporte-button"
import { RegistrarPagoButton } from "@/components/ui/registrar-pago-button"
import { GenerarLinkMpButton } from "@/components/ui/generar-link-mp-button"
import { AjustesSuscripcionButton } from "@/components/ui/ajustes-suscripcion-button"
import { cn } from "@/lib/utils"
import { formatearMonto, METODO_LABEL, precioDePlan, convertirUsdAArs } from "@/lib/pagos"
import { getDolarVentaBancoNacion } from "@/lib/dolar"

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
        include: { servicio: { select: { nombre: true, precioUnico: true, precioBasico: true, precioMantenimiento: true } } },
        orderBy: { creadoEn: "desc" },
      },
      pagos: {
        orderBy: { creadoEn: "desc" },
        include: { suscripcion: { include: { servicio: { select: { nombre: true } } } }, hito: { select: { titulo: true, proyecto: { select: { titulo: true } } } } },
      },
      proyectos: {
        include: {
          hitos: { orderBy: { orden: "asc" } },
          servicio: { select: { nombre: true } },
        },
        orderBy: { creadoEn: "desc" },
      },
    },
  })

  const admin = await requireAdmin()
  if (!admin) redirect("/admin")

  if (!cliente) notFound()

  const [servicios, rate] = await Promise.all([
    prisma.servicio.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    getDolarVentaBancoNacion(),
  ])

  const pillCliente = cliente.activo ? { cls: "a-pill mint", label: "Cliente activo" } : { cls: "a-pill gray", label: "Inactivo" }

  return (
    <div>
      <div className="a-greet">
        <h1>{cliente.nombre}</h1>
        <p>{cliente.email}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          <NuevoProyectoButton clienteId={cliente.id} servicios={servicios} />
          <AsignarProductoButton clienteId={cliente.id} servicios={servicios} />
          <EditarClienteButton cliente={{ id: cliente.id, nombre: cliente.nombre, email: cliente.email, empresa: cliente.empresa, telefono: cliente.telefono, notas: cliente.notas, activo: cliente.activo }} />
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
        </div>
        {cliente.notas && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="a-faint" style={{ marginBottom: 6 }}>Notas internas</div>
            <p style={{ fontSize: ".86rem", color: "var(--color-text-dim)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{cliente.notas}</p>
          </div>
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Proyectos</h3>
          <span className="a-faint">{cliente.proyectos.length}</span>
        </div>
        {cliente.proyectos.length === 0 ? (
          <p className="a-empty">Sin proyectos — creá el primero con "Nuevo proyecto"</p>
        ) : (
          <div style={{ marginTop: -18 }}>
            {cliente.proyectos.map((p) => (
              <ProyectoBlock key={p.id} proyecto={p} rate={rate} clienteTelefono={cliente.telefono} />
            ))}
          </div>
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Suscripciones (soporte)</h3>
          <span className="a-faint">{cliente.suscripciones.length}</span>
          <ActivarSoporteButton clienteId={cliente.id} servicios={servicios} />
        </div>
        {cliente.suscripciones.length === 0 ? (
          <p className="a-empty">Sin suscripciones</p>
        ) : (
          cliente.suscripciones.map((s) => {
            const pill = pillOf(s.estado)
            const precio = precioDePlan(s.plan, s.servicio, s.precioCustom)
            const precioArs = rate ? convertirUsdAArs(precio, rate) : null
            return (
              <div key={s.id} className="a-prow" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="a-name">
                      {s.servicio.nombre}
                      {s.plan && <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>· {s.plan === "UNICO" ? "Pago único" : s.plan === "BASICO" ? "Básico" : s.plan === "SOPORTE" ? "Soporte" : "Mantenimiento"}</span>}
                    </div>
                    <div className="a-date">
                      {formatearMonto(precio, "usd")}
                      {s.plan === "UNICO" ? " pago único" : "/mes"}
                      {s.precioCustom ? " · acordado" : ""}
                      {s.proximoPago ? ` · vence ${new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
                    {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                      <RegistrarPagoButton
                        suscripcionId={s.id}
                        servicio={s.servicio.nombre}
                        cliente={cliente.nombre}
                        precioUsd={precio}
                        precioArs={precioArs}
                      />
                    )}
                    {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                      <GenerarLinkMpButton
                        suscripcionId={s.id}
                        servicio={s.servicio.nombre}
                        cliente={cliente.nombre}
                        precioUsd={precio}
                        precioArs={precioArs}
                        clienteTelefono={cliente.telefono}
                      />
                    )}
                    {s.estado !== "PENDING" && <SubscriptionActions suscripcionId={s.id} estado={s.estado} deploymentPlatform={s.deploymentPlatform} platformServiceId={s.platformServiceId} />}
                    {s.estado !== "PENDING" && (
                      <AjustesSuscripcionButton
                        suscripcionId={s.id}
                        precioCustom={s.precioCustom}
                        proximoPago={s.proximoPago ? s.proximoPago.toISOString() : null}
                      />
                    )}
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
                      <td>{p.hito ? `${p.hito.proyecto.titulo} — ${p.hito.titulo}` : p.suscripcion?.servicio.nombre ?? "—"}</td>
                      <td className="a-faint">{new Date(p.creadoEn).toLocaleDateString("es-AR")}</td>
                      <td className="a-mono">
                        {formatearMonto(p.monto, p.moneda)}
                        {p.metodo ? <span style={{ color: "var(--color-text-faint)", fontSize: "0.72rem", marginLeft: 6 }}>· {METODO_LABEL[p.metodo] ?? p.metodo}</span> : null}
                      </td>
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