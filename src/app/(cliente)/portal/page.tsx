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
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"

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

  const [suscripciones, ultimosPagos, tienePagoFallido, rate] = await Promise.all([
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
    getDolarVentaBancoNacion(),
  ])

  const nombre = cliente?.nombre ?? "Cliente"
  const primerNombre = nombre.split(" ")[0]

  const price = (cents: number) => {
    if (rate) return `${formatARS(cents, rate)}`
    return `$${(cents / 100).toFixed(0)}`
  }

  const priceRef = (cents: number) => (rate && cents > 0 ? `≈ ${formatUSD(cents)}` : null)

  return (
    <div>
      <PageHeader title={`Hola, ${primerNombre}`} subtitle="Estos son tus servicios activos con PixelArch." />

      {success === "true" && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-mint/30 bg-mint/5 px-4 py-3 text-[13px] text-mint">
          <CheckCircle2 size={18} className="shrink-0" /> Pago exitoso. Tu suscripción se activará en breve.
        </div>
      )}

      {tienePagoFallido && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[13px] text-red-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 leading-relaxed"><strong className="text-red-200">Tu pago reciente falló.</strong> Actualiza tu método de pago.</span>
          <PaymentPortalLink />
        </div>
      )}

      <div className="mb-5 flex items-center justify-between">
        <p className="font-display text-lg font-bold">Mis servicios</p>
        <Link href="/productos" className="text-sm font-medium text-violet transition-colors hover:text-text">+ Agregar producto</Link>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suscripciones.length === 0 && (
          <Link href="/productos" className="col-span-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/40 bg-panel px-6 py-14 transition-colors hover:border-violet/40 hover:bg-violet/[0.04]">
            <span className="text-2xl text-text-faint">+</span>
            <span className="text-[13px] text-text-faint">Agregar un<br />nuevo producto</span>
          </Link>
        )}

        {suscripciones.map((s) => {
          const config = estadoConfig(s)
          return (
            <div key={s.id} className="brand-card p-5 relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${s.estado === "ACTIVE" ? "from-mint to-cyan" : s.estado === "PAST_DUE" ? "from-red-400 to-red-500" : s.estado === "PENDING" ? "from-yellow-400 to-yellow-500" : s.estado === "READY" ? "from-violet to-cyan" : "from-text-faint to-text-dim"}`} />
              <div className="mb-3 flex items-center justify-between">
                <StatusPill estado={s.estado} label={config.label} pulse={s.estado === "ACTIVE"} />
                {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <CancelSubscriptionButton suscripcionId={s.id} />
                )}
              </div>
              <p className="font-display text-base font-bold mb-1">{s.servicio.nombre}</p>
              {s.estado === "ACTIVE" && <ApplyDiscount suscripcionId={s.id} />}
              <p className="text-sm text-text-dim leading-relaxed mb-4">{config.descripcion}</p>

              {s.estado === "READY" && (
                <div className="mb-3 flex flex-col gap-2">
                  {s.servicio.polarProductIdBasico && (
                    <CheckoutButton polarProductId={s.servicio.polarProductIdBasico} servicioNombre={s.servicio.nombre} tipo="BASICO" label="Mantener online (Básico)" size="default" variant="gradient" className="w-full" />
                  )}
                  {s.servicio.polarProductIdMantenimiento && (
                    <CheckoutButton polarProductId={s.servicio.polarProductIdMantenimiento} servicioNombre={s.servicio.nombre} tipo="MANTENIMIENTO" label="Online + cambios (Mantenimiento)" size="default" variant="outline" className="w-full" />
                  )}
                </div>
              )}

              {s.estado === "READY" && (
                <p className="text-xs text-text-faint leading-relaxed">
                  Sin un plan mensual, el servicio deja de estar online.
                </p>
              )}

              {s.estado !== "READY" && (
                <div className="pt-3 border-t border-border/50 flex items-center justify-between">
                  <p className="font-bold" style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>
                    {s.estado === "PENDING" ? price(s.servicio.precioUnico) : s.plan === "MANTENIMIENTO" ? price(s.servicio.precioMantenimiento) : price(s.servicio.precioBasico)}
                    {s.estado !== "PENDING" && <span className="text-xs font-normal text-text-dim">/mes</span>}
                    {rate && <span className="ml-1.5 text-xs font-normal text-text-dim">≈ {formatUSD(s.estado === "PENDING" ? s.servicio.precioUnico : s.plan === "MANTENIMIENTO" ? s.servicio.precioMantenimiento : s.servicio.precioBasico)}</span>}
                  </p>
                  {s.proximoPago && (
                    <span className={cn("text-xs", s.estado === "PAST_DUE" ? "text-red-400" : "text-text-dim")}>
                      {s.estado === "PAST_DUE" ? "⚠ Vence " : "Renueva "}{new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {suscripciones.length > 0 && (
          <Link href="/productos" className="self-start flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/40 bg-panel px-6 py-6 transition-colors hover:border-violet/40 hover:bg-violet/[0.04]">
            <span className="text-lg text-text-faint">+</span>
            <span className="text-xs text-text-faint text-center">Agregar un<br />nuevo producto</span>
          </Link>
        )}
      </div>

      {ultimosPagos.length > 0 && (
        <>
          <div className="mb-5 flex items-center justify-between">
            <p className="font-display text-lg font-bold">Últimos pagos</p>
            <Link href="/portal/facturacion" className="text-sm font-medium text-violet transition-colors hover:text-text">Ver historial completo</Link>
          </div>
          <div className="brand-table overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">Descripción</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">Fecha</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">Monto</th>
                  <th className="text-right text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ultimosPagos.map((p) => (
                  <tr key={p.id} className="border-b border-border/30 last:border-b-0 transition-colors hover:bg-panel/50">
                    <td className="px-5 py-3 text-xs text-text">{p.suscripcion?.servicio.nombre ?? "Pago"}</td>
                    <td className="px-5 py-3 text-xs text-text-dim font-mono">{new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-5 py-3 text-xs text-text font-mono font-medium">US${(p.monto / 100).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right">
                      <StatusPill estado={p.estadoPago} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function estadoConfig(s: { estado: string; servicio: { nombre: string } }) {
  const maps: Record<string, { label: string; descripcion: string }> = {
    PENDING: { label: "En desarrollo", descripcion: "Tu proyecto está en curso. Te avisamos cuando esté listo." },
    READY: { label: "Entregado", descripcion: "Proyecto entregado. Elegí un plan mensual para mantenerlo online." },
    ACTIVE: { label: "Activo", descripcion: "Tu servicio está online y funcionando." },
    PAST_DUE: { label: "Pago fallido", descripcion: "Tu último pago falló. Actualizá tu método de pago para evitar la suspensión del servicio." },
    PAUSED: { label: "Pausado", descripcion: "Suscripción pausada. Contacta a soporte para reactivar." },
    CANCELED: { label: "Cancelado", descripcion: "Suscripción cancelada. El servicio ya no está online." },
  }
  return maps[s.estado] ?? { label: s.estado, descripcion: "" }
}
