import { auth, clerkClient } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import Link from "next/link"
import { CancelSubscriptionButton } from "@/components/ui/cancel-subscription-button"
import { PaymentPortalLink } from "@/components/ui/payment-portal-link"
import { CheckoutButton } from "@/components/ui/checkout-button"
import { ApplyDiscount } from "@/components/ui/apply-discount"

export default async function PortalPage({
  searchParams,
}: { searchParams: Promise<{ success?: string }> }) {
  const { userId } = await auth()
  const { success } = await searchParams

  if (!userId) redirect("/sign-in")

  let cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, nombre: true },
  })

  if (!cliente) {
    try {
      const clerk = await clerkClient()
      const user = await clerk.users.getUser(userId)
      const email = user.emailAddresses[0]?.emailAddress ?? ""
      const nombre = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || email

      if (email) {
        cliente = await prisma.cliente.findUnique({
          where: { email },
          select: { id: true, nombre: true },
        })
        if (cliente) {
          await prisma.cliente.update({
            where: { id: cliente.id },
            data: { clerkUserId: userId },
          })
          logger.info("Cliente vinculado por email", { clerkUserId: userId, email, clienteId: cliente.id })
        }
      }

      if (!cliente) {
        cliente = await prisma.cliente.create({
          data: { clerkUserId: userId, email: email || `cliente-${userId}@pixelarch.local`, nombre },
          select: { id: true, nombre: true },
        })
        logger.info("Cliente auto-creado desde portal", { clerkUserId: userId, email })
      }
    } catch (e) {
      logger.error("Error auto-creando cliente en portal", { error: String(e), clerkUserId: userId })
    }
  }

  const [suscripciones, ultimosPagos, tienePagoFallido] = await Promise.all([
    cliente ? prisma.suscripcion.findMany({
      where: { clienteId: cliente.id },
      include: { servicio: true },
      orderBy: { creadoEn: "desc" },
    }) : Promise.resolve([]),
    cliente ? prisma.pago.findMany({
      where: { clienteId: cliente.id },
      include: { suscripcion: { include: { servicio: { select: { nombre: true } } } } },
      orderBy: { creadoEn: "desc" },
      take: 5,
    }) : Promise.resolve([]),
    cliente ? prisma.pago.count({ where: { clienteId: cliente.id, estadoPago: "FAILED" } }).then(n => n > 0) : Promise.resolve(false),
  ])

  const nombre = cliente?.nombre ?? "Cliente"
  const primerNombre = nombre.split(" ")[0]

  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`

  return (
    <div>
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Portal</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Hola, {primerNombre}</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Estos son tus servicios activos con PixelArch.</p>
      </div>

      {success === "true" && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-mint/30 bg-mint/5 px-4 py-3 text-[13px] text-mint font-mono">
          <CheckCircle2 size={18} /> Pago exitoso. Tu suscripcion se activara en breve.
        </div>
      )}

      {tienePagoFallido && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/5 px-5 py-4 text-[13px] text-red-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 leading-relaxed"><strong className="text-red-200">Tu pago reciente fallo.</strong> Actualiza tu metodo de pago.</span>
          <PaymentPortalLink />
        </div>
      )}

      <div className="mb-5 flex items-center justify-between">
        <p className="font-display text-[0.95rem] font-bold">Mis servicios</p>
        <Link href="/productos" className="text-xs font-mono text-violet hover:underline">+ Agregar producto</Link>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suscripciones.length === 0 && (
          <Link href="/productos" className="col-span-full flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 px-6 py-12 transition-colors hover:border-violet/40 hover:bg-violet/[0.04] brand-card">
            <span className="text-2xl text-text-faint">+</span>
            <span className="text-[13px] text-text-faint">Agregar un<br />nuevo producto</span>
          </Link>
        )}

        {suscripciones.map((s) => {
          const config = estadoUI(s)
          return (
            <div key={s.id} className="brand-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]", config.badgeBg, config.badgeColor)}>
                  <span className={cn("w-[5px] h-[5px] rounded-full", s.estado === "ACTIVE" && "animate-pulse")} style={{ backgroundColor: "currentColor" }} />
                  {config.label}
                </span>
                {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <CancelSubscriptionButton suscripcionId={s.id} />
                )}
              </div>
              <p className="font-display text-[0.95rem] font-bold mb-1">{s.servicio.nombre}</p>
              {s.estado === "ACTIVE" && <ApplyDiscount suscripcionId={s.id} />}
              <p className="text-xs text-text-dim leading-relaxed mb-3">{config.descripcion}</p>

              {s.estado === "READY" && (
                <div className="flex flex-col gap-1.5 mb-3">
                  {s.servicio.polarProductIdBasico && (
                    <CheckoutButton polarProductId={s.servicio.polarProductIdBasico} servicioNombre={s.servicio.nombre} tipo="BASICO" label={`Basico ${price(s.servicio.precioBasico)}/mes — mantener online`} size="sm" className="w-full" />
                  )}
                  {s.servicio.polarProductIdMantenimiento && (
                    <CheckoutButton polarProductId={s.servicio.polarProductIdMantenimiento} servicioNombre={s.servicio.nombre} tipo="MANTENIMIENTO" label={`Mantenimiento ${price(s.servicio.precioMantenimiento)}/mes — online + cambios`} size="sm" className="w-full" />
                  )}
                </div>
              )}

              <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between">
                <p className="font-display text-[0.95rem] font-bold">
                  {s.estado === "READY" ? price(s.servicio.precioMantenimiento) : s.estado === "PENDING" ? price(s.servicio.precioUnico) : s.plan === "MANTENIMIENTO" ? price(s.servicio.precioMantenimiento) : price(s.servicio.precioBasico)}
                  {s.estado !== "PENDING" && s.estado !== "READY" && <span className="text-[11px] font-normal text-text-dim">/mes</span>}
                </p>
                {s.proximoPago && (
                  <span className={cn("text-[11px]", s.estado === "PAST_DUE" ? "text-[#fac775]" : "text-text-dim")}>
                    {s.estado === "PAST_DUE" ? "⚠ Vence " : "Renueva "}{new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {suscripciones.length > 0 && (
          <Link href="/productos" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 px-6 py-3 transition-colors hover:border-violet/40 hover:bg-violet/[0.04]">
            <span className="text-xl text-text-faint">+</span>
            <span className="text-[13px] text-text-faint text-center">Agregar un<br />nuevo producto</span>
          </Link>
        )}
      </div>

      {ultimosPagos.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-[0.95rem] font-bold">Ultimos pagos</p>
            <Link href="/portal/facturacion" className="text-xs font-mono text-violet hover:underline">Ver historial completo</Link>
          </div>
          <div className="brand-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">Descripcion</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">Fecha</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">Monto</th>
                  <th className="text-right text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal border-b border-border/50">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ultimosPagos.map((p) => {
                  const ep = p.estadoPago === "SUCCEEDED" ? { label: "Pagado", key: "ok" } : p.estadoPago === "FAILED" ? { label: "Fallido", key: "fail" } : { label: p.estadoPago, key: "pending" }
                  return (
                    <tr key={p.id} className="border-b border-border/30 last:border-b-0">
                      <td className="px-5 py-3 text-xs text-text">{p.suscripcion?.servicio.nombre ?? "Pago"}</td>
                      <td className="px-5 py-3 text-xs text-text-dim font-mono">{new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="px-5 py-3 text-xs text-text font-mono font-medium">${(p.monto / 100).toFixed(0)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]", ep.key === "ok" ? "bg-mint/10 text-mint" : ep.key === "fail" ? "bg-red-500/10 text-red-300" : "bg-[#ef9f27]/10 text-[#fac775]")}>
                          {ep.key === "ok" ? "✓ " : ep.key === "fail" ? "✗ " : ""}{ep.label}
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

function estadoUI(s: { estado: string; servicio: { nombre: string } }) {
  const maps: Record<string, { label: string; descripcion: string; badgeBg: string; badgeColor: string }> = {
    PENDING: { label: "En desarrollo", descripcion: "Tu proyecto esta en curso. Te avisamos cuando este listo.", badgeBg: "bg-yellow-400/10", badgeColor: "text-yellow-400" },
    READY: { label: "Entregado", descripcion: "Proyecto entregado. Elegi un plan mensual para mantenerlo online.", badgeBg: "bg-purple-400/10", badgeColor: "text-purple-400" },
    ACTIVE: { label: "Activo", descripcion: "Tu servicio esta online y funcionando.", badgeBg: "bg-mint/10", badgeColor: "text-mint" },
    PAST_DUE: { label: "Pago fallido", descripcion: "Tu ultimo pago fallo. Actualiza tu metodo de pago para evitar la suspension del servicio.", badgeBg: "bg-red-500/10", badgeColor: "text-red-300" },
    PAUSED: { label: "Pausado", descripcion: "Suscripcion pausada. Contacta a soporte para reactivar.", badgeBg: "bg-text-faint/10", badgeColor: "text-text-dim" },
    CANCELED: { label: "Cancelado", descripcion: "Suscripcion cancelada. El servicio ya no esta online.", badgeBg: "bg-text-faint/10", badgeColor: "text-text-dim" },
  }
  return maps[s.estado] ?? { label: s.estado, descripcion: "", badgeBg: "bg-text-faint/10", badgeColor: "text-text-dim" }
}
