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
import { StatusPill } from "@/components/ui/status-pill"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"

const EMOJIS: Record<string, string> = {
  "chatbot inteligente": "🤖",
  "desarrollo web": "🌐",
  "agentes de ia": "🧠",
  "landing pages": "🎯",
  automatizaciones: "⚡",
  integraciones: "🔗",
}

const emojiOf = (nombre: string) => EMOJIS[nombre.trim().toLowerCase()] ?? "🛠️"

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
    if (rate) return formatARS(cents, rate)
    return `$${(cents / 100).toFixed(0)}`
  }

  const moneda = (cents: number) => `≈ ${formatUSD(cents)}`

  return (
    <div>
      {/* Greeting */}
      <div className="mb-12">
        <h1
          style={{
            fontFamily: "var(--font-pixel-display)",
            fontWeight: 700,
            letterSpacing: 0,
            fontSize: "clamp(1.9rem, 4vw, 2.9rem)",
            lineHeight: 1.1,
            marginBottom: "8px",
          }}
        >
          Hola,{" "}
          <span
            style={{
              background: "linear-gradient(120deg, #8b5cf6, #22d3ee)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {primerNombre}
          </span>{" "}
          👋
        </h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: "1rem", maxWidth: "46ch", lineHeight: 1.65 }}>
          Estos son tus servicios con PixelArch. Todo online, todo bajo control.
        </p>
      </div>

      {success === "true" && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-mint/30 bg-mint/5 px-4 py-3 text-[13px] text-mint">
          <CheckCircle2 size={18} className="shrink-0" /> Pago exitoso. Tu suscripción se activará en breve.
        </div>
      )}

      {tienePagoFallido && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[13px] text-red-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 leading-relaxed"><strong className="text-red-200">Tu pago reciente falló.</strong> Actualiza tu método de pago.</span>
          <PaymentPortalLink />
        </div>
      )}

      {/* Section head */}
      <div className="mb-6 flex items-center gap-4">
        <h2 className="font-display text-[1.35rem] font-bold">Mis servicios</h2>
        <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.08), transparent)" }} aria-hidden="true" />
        <Link href="/productos" className="text-[0.92rem] font-semibold text-violet transition-colors hover:text-text">+ Agregar producto</Link>
      </div>

      {/* Cards */}
      {suscripciones.length === 0 && (
        <Link
          href="/productos"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/40 px-6 py-16 transition-colors hover:border-violet/40 hover:bg-violet/[0.04]"
          style={{ background: "linear-gradient(160deg,#171321 0%,#110e1a 60%,#141020 100%)" }}
        >
          <span className="text-3xl text-text-faint">+</span>
          <span className="text-sm text-text-faint">Agregá tu primer producto</span>
        </Link>
      )}

      <div className="grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {suscripciones.map((s) => {
          const config = estadoConfig(s)
          const esMant = s.plan === "MANTENIMIENTO"
          const precioCents = s.estado === "PENDING" ? s.servicio.precioUnico : esMant ? s.servicio.precioMantenimiento : s.servicio.precioBasico
          const topBar =
            s.estado === "ACTIVE" ? "linear-gradient(90deg,#34d399,#22d3ee)"
            : s.estado === "PAST_DUE" ? "linear-gradient(90deg,#f87171,#ef4444)"
            : s.estado === "PENDING" ? "linear-gradient(90deg,#fbbf24,#f59e0b)"
            : s.estado === "READY" ? "linear-gradient(90deg,#8b5cf6,#22d3ee)"
            : "linear-gradient(90deg,#645f74,#a29cb3)"
          const iconStyle =
            s.estado === "READY"
              ? { background: "linear-gradient(135deg,#8b5cf6,#22d3ee)" }
              : s.estado === "ACTIVE"
                ? { background: "rgba(34,211,238,0.14)" }
                : { background: "rgba(139,92,246,0.14)" }

          return (
            <article
              key={s.id}
              className="relative flex flex-col overflow-hidden rounded-[18px] p-6 transition-all duration-300 hover:-translate-y-[5px]"
              style={{
                background: "linear-gradient(160deg,#171321 0%,#110e1a 60%,#141020 100%)",
                border: "1px solid rgba(255,255,255,0.07)",
                transitionProperty: "transform, border-color, box-shadow",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(139,92,246,0.35)"
                e.currentTarget.style.boxShadow = "0 24px 60px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.06), 0 0 40px -18px rgba(139,92,246,0.35)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"
                e.currentTarget.style.boxShadow = "none"
              }}
            >
              <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 22, right: 22, height: 2, borderRadius: "0 0 4px 4px", background: topBar }} />

              <div className="mb-4 flex items-center justify-between">
                <StatusPill estado={s.estado} label={config.label} pulse={s.estado === "ACTIVE"} />
                {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <CancelSubscriptionButton suscripcionId={s.id} />
                )}
              </div>

              <div className="mb-4 flex items-center gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-[24px] leading-none"
                  style={iconStyle}
                >
                  {emojiOf(s.servicio.nombre)}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate font-display text-[1.08rem] font-bold leading-tight">{s.servicio.nombre}</h3>
                  <p className="mt-0.5 text-[13px] text-text-dim">
                    {s.estado === "ACTIVE" && s.plan
                      ? `Plan ${s.plan === "MANTENIMIENTO" ? "Mantenimiento" : "Básico"}`
                      : s.estado === "PENDING"
                        ? "Pago único"
                        : s.estado === "READY"
                          ? "Elegí un plan para mantenerlo online"
                          : s.estado === "PAST_DUE"
                            ? "Pago pendiente"
                            : config.label}
                  </p>
                </div>
              </div>

              <p className="mb-5 text-sm leading-relaxed text-text-dim">{config.descripcion}</p>

              {s.estado === "READY" && (
                <>
                  <div className="flex flex-col gap-2.5">
                    {s.servicio.polarProductIdBasico && (
                      <CheckoutButton polarProductId={s.servicio.polarProductIdBasico} servicioNombre={s.servicio.nombre} tipo="BASICO" label="Mantener online (Básico)" size="default" variant="gradient" className="w-full" />
                    )}
                    {s.servicio.polarProductIdMantenimiento && (
                      <CheckoutButton polarProductId={s.servicio.polarProductIdMantenimiento} servicioNombre={s.servicio.nombre} tipo="MANTENIMIENTO" label="Online + cambios (Mantenimiento)" size="default" variant="outline" className="w-full" />
                    )}
                  </div>
                  <p className="mt-3.5 text-center text-xs text-text-faint">Sin un plan mensual, el servicio deja de estar online.</p>
                </>
              )}

              {s.estado !== "READY" && (
                <div className="mt-auto flex items-end justify-between gap-3 border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <div>
                    <p className="font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "1.45rem", lineHeight: 1.1 }}>
                      {price(precioCents)}
                      <span className="ml-1 text-[13px] font-normal text-text-dim">
                        {s.estado === "PENDING" ? (rate ? "ARS" : "") : rate ? "ARS/mes" : "/mes"}
                      </span>
                    </p>
                    {rate && (
                      <p className="mt-1 font-mono text-[11px] text-text-faint">{moneda(precioCents)}</p>
                    )}
                  </div>
                  {s.proximoPago && (
                    <p className={cn("pb-1 text-right text-[13px]", s.estado === "PAST_DUE" ? "text-red-400" : "text-text-dim")}>
                      {s.estado === "PAST_DUE" ? "⚠ Vence " : "Renueva "}
                      {new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </p>
                  )}
                </div>
              )}

              {s.estado === "ACTIVE" && <ApplyDiscount suscripcionId={s.id} />}
            </article>
          )
        })}
      </div>

      {suscripciones.length > 0 && (
        <Link
          href="/productos"
          className="mt-5 flex items-center justify-center gap-2.5 rounded-2xl border border-dashed px-6 py-[18px] text-sm text-text-faint transition-colors hover:border-violet/40 hover:text-text"
          style={{ borderColor: "rgba(255,255,255,0.14)", background: "rgba(17,14,26,0.5)" }}
        >
          ＋ <span>¿Querés <span className="font-semibold text-violet">sumar otro producto</span> a tu stack?</span>
        </Link>
      )}

      {/* Últimos pagos */}
      {ultimosPagos.length > 0 && (
        <div
          className="mt-12 overflow-hidden rounded-[18px]"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "linear-gradient(170deg, rgba(17,14,26,0.85), rgba(17,14,26,0.6))",
            backdropFilter: "blur(10px)",
          }}
        >
          <div className="flex items-center gap-4 px-6 pb-3 pt-5">
            <h2 className="font-display text-[1.35rem] font-bold">Últimos pagos</h2>
            <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.08), transparent)" }} aria-hidden="true" />
            <Link href="/portal/facturacion" className="text-[0.92rem] font-semibold text-violet transition-colors hover:text-text">Ver historial completo</Link>
          </div>
          {ultimosPagos.map((p, i) => (
            <div
              key={p.id}
              className={cn("flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-white/[0.02]", i > 0 && "border-t")}
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <div>
                <p className="text-[0.92rem] font-semibold">{p.suscripcion?.servicio.nombre ?? "Pago"}</p>
                <p className="mt-0.5 font-mono text-[11px] text-text-faint">
                  {new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[0.92rem] font-semibold">US${(p.monto / 100).toFixed(2)}</span>
                <StatusPill estado={p.estadoPago} />
              </div>
            </div>
          ))}
        </div>
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
