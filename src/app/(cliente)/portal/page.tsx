import { auth } from "@clerk/nextjs/server"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { CancelSubscriptionButton } from "@/components/ui/cancel-subscription-button"
import { PaymentPortalLink } from "@/components/ui/payment-portal-link"

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>
}) {
  const { userId } = await auth()
  const { success } = await searchParams

  if (!userId) {
    return (
      <div>
        <div className="rounded-xl border border-border bg-bg2 p-12 text-center text-muted font-mono text-sm">
          Inicia sesion para ver tus servicios.
        </div>
      </div>
    )
  }

  const cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, nombre: true },
  })

  const [suscripciones, ultimosPagos, tienePagoFallido] = await Promise.all([
    cliente
      ? prisma.suscripcion.findMany({
          where: { clienteId: cliente.id },
          include: { servicio: { select: { nombre: true, precio: true, descripcion: true } } },
          orderBy: { creadoEn: "desc" },
        })
      : Promise.resolve([]),
    cliente
      ? prisma.pago.findMany({
          where: { clienteId: cliente.id },
          include: { suscripcion: { include: { servicio: { select: { nombre: true } } } } },
          orderBy: { creadoEn: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
    cliente
      ? prisma.pago.count({ where: { clienteId: cliente.id, estadoPago: "FAILED" } }).then((n) => n > 0)
      : Promise.resolve(false),
  ])

  const nombre = cliente?.nombre ?? "Cliente"
  const primerNombre = nombre.split(" ")[0]

  const mapEstado = (e: string): { label: string; key: string } => {
    switch (e) {
      case "ACTIVE": return { label: "Activo", key: "active" }
      case "PAST_DUE": return { label: "Pago fallido", key: "past_due" }
      case "CANCELED": return { label: "Cancelado", key: "paused" }
      case "PAUSED": return { label: "Pausado", key: "paused" }
      case "TRIALING": return { label: "Prueba", key: "active" }
      default: return { label: e, key: "paused" }
    }
  }

  const mapEstadoPago = (e: string): { label: string; key: string } => {
    switch (e) {
      case "SUCCEEDED": return { label: "Pagado", key: "ok" }
      case "FAILED": return { label: "Fallido", key: "fail" }
      case "PENDING": return { label: "Pendiente", key: "pending" }
      default: return { label: e, key: "pending" }
    }
  }

  const cardBorder = (estado: string) => {
    if (estado === "ACTIVE" || estado === "TRIALING") return "border-t-2 border-t-accent"
    if (estado === "PAST_DUE") return "border-t-2 border-t-red-400"
    return "border-t-2 border-t-muted"
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[1.4rem] font-extrabold leading-tight">
          Hola, <span className="text-accent">{primerNombre}</span> 👋
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          Estos son tus servicios activos con PixelArch.
        </p>
      </div>

      {success === "true" && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-accent2/30 bg-accent2/5 px-4 py-3 text-[13px] text-accent2 font-mono">
          <CheckCircle2 size={18} />
          Pago exitoso. Tu suscripcion se activara en breve.
        </div>
      )}

      {tienePagoFallido && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/5 px-5 py-4 text-[13px] text-red-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 leading-relaxed">
            <strong className="text-red-200">Tu pago reciente fallo.</strong> Actualiza tu metodo de pago para evitar la interrupcion del servicio.
          </span>
          <PaymentPortalLink />
        </div>
      )}

      <div className="mb-5 flex items-center justify-between">
        <p className="font-display text-[0.95rem] font-bold">Mis servicios</p>
        <Link href="/servicios" className="text-xs font-mono text-accent hover:underline">
          + Agregar servicio
        </Link>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suscripciones.length === 0 && (
          <Link
            href="/servicios"
            className="col-span-full flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 px-6 py-12 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
          >
            <span className="text-2xl text-[#4a5568]">+</span>
            <span className="text-[13px] text-[#4a5568]">
              Agregar un<br />nuevo servicio
            </span>
          </Link>
        )}

        {suscripciones.map((s) => {
          const estado = mapEstado(s.estado)
          return (
            <div
              key={s.id}
              className={cn(
                "rounded-xl border border-border/50 bg-bg2 p-5 relative overflow-hidden",
                cardBorder(s.estado)
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                    estado.key === "active" && "bg-accent2/10 text-accent2",
                    estado.key === "past_due" && "bg-red-500/10 text-red-300",
                    estado.key === "paused" && "bg-muted/10 text-muted"
                  )}
                >
                  <span
                    className={cn(
                      "w-[5px] h-[5px] rounded-full",
                      estado.key === "active" && "bg-accent2 animate-pulse",
                      estado.key === "past_due" && "bg-red-400",
                      estado.key === "paused" && "bg-muted"
                    )}
                  />
                  {estado.label}
                </span>
                {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <CancelSubscriptionButton suscripcionId={s.id} />
                )}
              </div>

              <p className="font-display text-[0.95rem] font-bold mb-1">
                {s.servicio.nombre}
              </p>
              <p className="text-xs text-muted leading-relaxed mb-3">
                {s.servicio.descripcion}
              </p>

              <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between">
                <p className="font-display text-[0.95rem] font-bold">
                  ${(s.servicio.precio / 100).toFixed(0)}
                  <span className="text-[11px] font-normal text-muted">/mes</span>
                </p>
                {s.proximoPago && (
                  <span
                    className={cn(
                      "text-[11px]",
                      s.estado === "PAST_DUE" ? "text-[#fac775]" : "text-muted"
                    )}
                  >
                    {s.estado === "PAST_DUE" ? "⚠ Vence " : "Renueva "}
                    {new Date(s.proximoPago).toLocaleDateString("es-AR", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {suscripciones.length > 0 && (
          <Link
            href="/servicios"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 px-6 py-3 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
          >
            <span className="text-xl text-[#4a5568]">+</span>
            <span className="text-[13px] text-[#4a5568] text-center">
              Agregar un<br />nuevo servicio
            </span>
          </Link>
        )}
      </div>

      {ultimosPagos.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-[0.95rem] font-bold">Ultimos pagos</p>
            <Link href="/portal/facturacion" className="text-xs font-mono text-accent hover:underline">
              Ver historial completo
            </Link>
          </div>

          <div className="rounded-xl border border-border/50 bg-bg2 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">
                    Descripcion
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">
                    Fecha
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">
                    Monto
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-[0.1em] text-[#4a5568] px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {ultimosPagos.map((p) => {
                  const ep = mapEstadoPago(p.estadoPago)
                  return (
                    <tr key={p.id} className="border-b border-border/30 last:border-b-0">
                      <td className="px-5 py-3 text-xs text-text">
                        {p.suscripcion?.servicio.nombre ?? "Pago"}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted font-mono">
                        {new Date(p.creadoEn).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-5 py-3 text-xs text-text font-mono font-medium">
                        ${(p.monto / 100).toFixed(0)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                            ep.key === "ok" && "bg-accent2/10 text-accent2",
                            ep.key === "fail" && "bg-red-500/10 text-red-300",
                            ep.key === "pending" && "bg-[#ef9f27]/10 text-[#fac775]"
                          )}
                        >
                          {ep.key === "ok" ? "✓ " : ep.key === "fail" ? "✗ " : ""}
                          {ep.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
