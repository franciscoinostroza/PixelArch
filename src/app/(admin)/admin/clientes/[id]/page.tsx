import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { DeployConfig } from "@/components/ui/deploy-config"
import { EntregarButton } from "@/components/ui/entregar-button"
import { cn } from "@/lib/utils"

const mapEstado = (e: string) => {
  switch (e) {
    case "ACTIVE": return "active"
    case "PAST_DUE": return "past_due"
    case "CANCELED": return "paused"
    case "PAUSED": return "paused"
    case "PENDING": return "pending"
    case "READY": return "active"
    default: return "paused"
  }
}

const mapLabel = (e: string) => {
  switch (e) {
    case "ACTIVE": return "Activo"
    case "PAST_DUE": return "Vencido"
    case "CANCELED": return "Cancelado"
    case "PAUSED": return "Pausado"
    case "PENDING": return "En desarrollo"
    case "READY": return "Entregado"
    default: return e
  }
}

const mapEstadoPago = (e: string) => {
  switch (e) {
    case "SUCCEEDED": return "Pagado"
    case "FAILED": return "Fallido"
    case "REFUNDED": return "Reembolsado"
    case "PENDING": return "Pendiente"
    default: return e
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
        include: { servicio: { select: { nombre: true, precioUnico: true, precioBasico: true, precioMantenimiento: true, paddlePriceIdBasico: true, paddlePriceIdMantenimiento: true, paddlePriceIdUnico: true } } },
        orderBy: { creadoEn: "desc" },
      },
      pagos: {
        orderBy: { creadoEn: "desc" },
        include: { suscripcion: { include: { servicio: { select: { nombre: true } } } } },
      },
    },
  })

  if (!cliente) notFound()

  return (
    <div>
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-extrabold">{cliente.nombre}</h1>
          <p className="mt-0.5 text-xs text-muted">{cliente.email}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]",
            cliente.activo
              ? "bg-accent2/10 text-accent2"
              : "bg-muted/10 text-muted"
          )}
        >
          <span className={cn("w-[5px] h-[5px] rounded-full", cliente.activo ? "bg-accent2" : "bg-muted")} />
          {cliente.activo ? "Cliente activo" : "Inactivo"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-[#4a5568] mb-1">Empresa</p>
              <p className="text-text">{cliente.empresa || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-[#4a5568] mb-1">Telefono</p>
              <p className="text-text">{cliente.telefono || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-[#4a5568] mb-1">Registrado</p>
              <p className="text-text">{new Date(cliente.creadoEn).toLocaleDateString("es-AR")}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-[#4a5568] mb-1">Paddle ID</p>
              <p className="text-muted text-[11px] truncate">{cliente.paddleCustomerId || "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="font-display text-sm font-bold mb-4">
            Suscripciones ({cliente.suscripciones.length})
          </p>
          {cliente.suscripciones.length === 0 ? (
            <p className="text-xs text-muted py-4 text-center">Sin suscripciones</p>
          ) : (
            <div className="space-y-2">
              {cliente.suscripciones.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-text">
                        {s.servicio.nombre}
                        {s.plan && <span className="text-[10px] text-muted ml-1">· {s.plan === "UNICO" ? "Pago unico" : s.plan === "BASICO" ? "Basico" : "Mantenimiento"}</span>}
                      </p>
                      <p className="text-[11px] text-muted font-mono">
                        {s.plan === "MANTENIMIENTO" ? `$${(s.servicio.precioMantenimiento / 100).toFixed(2)}/mes` : s.plan === "BASICO" ? `$${(s.servicio.precioBasico / 100).toFixed(2)}/mes` : `$${(s.servicio.precioUnico / 100).toFixed(2)} pago unico`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                          s.estado === "ACTIVE" || s.estado === "READY"
                            ? "bg-accent2/10 text-accent2"
                            : s.estado === "PAST_DUE"
                              ? "bg-red-500/10 text-red-400"
                              : s.estado === "PENDING"
                                ? "bg-yellow-400/10 text-yellow-400"
                                : "bg-muted/10 text-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "w-[5px] h-[5px] rounded-full",
                            s.estado === "ACTIVE" || s.estado === "READY"
                              ? "bg-accent2"
                              : s.estado === "PAST_DUE"
                                ? "bg-red-400"
                                : s.estado === "PENDING"
                                  ? "bg-yellow-400"
                                  : "bg-muted"
                          )}
                        />
                        {mapLabel(s.estado)}
                      </span>
                      {s.estado !== "PENDING" && <SubscriptionActions suscripcionId={s.id} estado={s.estado} />}
                    </div>
                  </div>
                  {s.estado === "PENDING" && (
                    <div className="mt-2">
                      <EntregarButton suscripcionId={s.id} />
                    </div>
                  )}
                  {(s.estado === "ACTIVE" || s.estado === "PAST_DUE" || s.estado === "PAUSED") && (
                    <DeployConfig
                      suscripcionId={s.id}
                      deploymentId={s.deploymentId}
                      deploymentPlatform={s.deploymentPlatform}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg2 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <p className="font-display text-sm font-bold">
            Historial de pagos ({cliente.pagos.length})
          </p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-t border-border">
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 py-3 font-mono font-normal">
                Servicio
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 py-3 font-mono font-normal">
                Fecha
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 py-3 font-mono font-normal">
                Monto
              </th>
              <th className="text-right text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 py-3 font-mono font-normal">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {cliente.pagos.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-muted">
                  Sin pagos registrados
                </td>
              </tr>
            ) : (
              cliente.pagos.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="px-5 py-3 text-xs text-text">
                    {p.suscripcion?.servicio.nombre ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted font-mono">
                    {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-5 py-3 text-xs text-text font-mono">
                    ${(p.monto / 100).toFixed(2)} {p.moneda.toUpperCase()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                        p.estadoPago === "SUCCEEDED"
                          ? "bg-accent2/10 text-accent2"
                          : p.estadoPago === "FAILED"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-muted/10 text-muted"
                      )}
                    >
                      <span
                        className={cn(
                          "w-[5px] h-[5px] rounded-full",
                          p.estadoPago === "SUCCEEDED"
                            ? "bg-accent2"
                            : p.estadoPago === "FAILED"
                              ? "bg-red-400"
                              : "bg-muted"
                        )}
                      />
                      {mapEstadoPago(p.estadoPago)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
