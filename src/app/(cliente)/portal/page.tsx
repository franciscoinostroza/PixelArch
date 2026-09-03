import { auth, clerkClient } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { CancelSubscriptionButton } from "@/components/ui/cancel-subscription-button"
import { PaymentPortalLink } from "@/components/ui/payment-portal-link"
import { CheckoutButton } from "@/components/ui/checkout-button"
import { ApplyDiscount } from "@/components/ui/apply-discount"
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

const pillOf = (estado: string) =>
  estado === "ACTIVE" ? "mint" : estado === "PAST_DUE" ? "red" : estado === "PENDING" ? "yellow" : estado === "READY" ? "violet" : "gray"

const cardVariantOf = (estado: string) =>
  estado === "ACTIVE" ? "active" : estado === "PAST_DUE" ? "due" : estado === "PENDING" ? "dev" : estado === "READY" ? "ready" : "canceled"

const iconOf = (estado: string) => (estado === "READY" ? "grad" : estado === "ACTIVE" ? "tint-c" : "tint-v")

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

  const [suscripciones, ultimosPagos, tienePagoFallido, servicios, rate] = await Promise.all([
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
    prisma.servicio.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, precioBasico: true },
      orderBy: { nombre: "asc" },
    }).catch(() => []),
    getDolarVentaBancoNacion(),
  ])

  const nombre = cliente?.nombre ?? "Cliente"
  const primerNombre = nombre.split(" ")[0]

  const price = (cents: number) => (rate ? formatARS(cents, rate) : `$${(cents / 100).toFixed(0)}`)
  const desde = (cents: number) => (rate ? `${formatARS(cents, rate)} ARS/mes` : `$${(cents / 100).toFixed(0)}/mes`)

  return (
    <div>
      {/* Greeting */}
      <div className="p-greet">
        <h1>
          Hola,{" "}
          <span
            style={{
              backgroundImage: "linear-gradient(120deg, #8b5cf6, #22d3ee)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            {primerNombre}
          </span>{" "}
          👋
        </h1>
        <p>Estos son tus servicios con PixelArch. Todo online, todo bajo control.</p>
      </div>

      {success === "true" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 12, background: "rgba(52,211,153,0.06)", color: "#34d399", fontSize: "0.9rem", marginBottom: 16 }}>
          ✓ Pago exitoso. Tu suscripción se activará en breve.
        </div>
      )}

      {tienePagoFallido && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, background: "rgba(248,113,113,0.06)", color: "#fca5a5", fontSize: "0.9rem", marginBottom: 16 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}><strong>Tu pago reciente falló.</strong> Actualizá tu método de pago.</span>
          <PaymentPortalLink />
        </div>
      )}

      {/* ============ MIS SERVICIOS ============ */}
      <div className="p-sec-head">
        <h2>Mis servicios</h2>
        <span className="p-line" aria-hidden="true" />
        <Link href="/productos">+ Agregar producto</Link>
      </div>

      {suscripciones.length > 0 ? (
        <>
          <div className="p-grid">
            {suscripciones.map((s) => {
              const config = estadoConfig(s)
              const esMant = s.plan === "MANTENIMIENTO"
              const precioCents = s.estado === "PENDING" ? s.servicio.precioUnico : esMant ? s.servicio.precioMantenimiento : s.servicio.precioBasico
              return (
                <article key={s.id} className={cn("p-card", cardVariantOf(s.estado))}>
                  <div className="p-row">
                    <span className={cn("p-pill", pillOf(s.estado))}>
                      <i />{config.label}
                    </span>
                    {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                      <CancelSubscriptionButton suscripcionId={s.id} />
                    )}
                  </div>

                  <div className="p-ident">
                    <div className={cn("p-icon", iconOf(s.estado))}>{emojiOf(s.servicio.nombre)}</div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.servicio.nombre}</h3>
                      <span style={{ display: "block" }}>
                        {s.estado === "ACTIVE" && s.plan
                          ? `Plan ${s.plan === "MANTENIMIENTO" ? "Mantenimiento" : "Básico"}`
                          : s.estado === "PENDING"
                            ? "Pago único"
                            : s.estado === "READY"
                              ? "Elegí un plan para mantenerlo online"
                              : s.estado === "PAST_DUE"
                                ? "Pago pendiente"
                                : config.label}
                      </span>
                    </div>
                  </div>

                  <p className="p-desc">{config.descripcion}</p>

                  {s.estado === "READY" && (
                    <div style={{ marginTop: "auto" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {s.servicio.polarProductIdBasico && (
                          <CheckoutButton polarProductId={s.servicio.polarProductIdBasico} servicioNombre={s.servicio.nombre} tipo="BASICO" label="Mantener online (Básico)" size="default" variant="gradient" className="h-11 rounded-[11px] w-full" />
                        )}
                        {s.servicio.polarProductIdMantenimiento && (
                          <CheckoutButton polarProductId={s.servicio.polarProductIdMantenimiento} servicioNombre={s.servicio.nombre} tipo="MANTENIMIENTO" label="Online + cambios (Mantenimiento)" size="default" variant="outline" className="h-11 rounded-[11px] w-full" />
                        )}
                      </div>
                      <p className="p-hint">Sin un plan mensual, el servicio deja de estar online.</p>
                    </div>
                  )}

                  {s.estado !== "READY" && (
                    <div className="p-price-row">
                      <div className="p-price">
                        {price(precioCents)}
                        <small>{s.estado === "PENDING" ? (rate ? "ARS" : "") : rate ? "ARS/mes" : "/mes"}</small>
                        {rate && <span className="p-usd">≈ {formatUSD(precioCents)}</span>}
                      </div>
                      {s.proximoPago && (
                        <span className={cn("p-date", s.estado === "PAST_DUE" && "red")}>
                          {s.estado === "PAST_DUE" ? "⚠ Vence " : "Renueva "}
                          {new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  )}

                  {s.estado === "ACTIVE" && <ApplyDiscount suscripcionId={s.id} />}
                </article>
              )
            })}
          </div>

          <Link className="p-add" href="/productos">
            ＋ <span>¿Querés <b>sumar otro producto</b> a tu stack?</span>
          </Link>
        </>
      ) : (
        <>
          <p className="p-desc" style={{ fontSize: "1rem", marginBottom: 22 }}>
            Todavía no tenés servicios contratados. Estos son nuestros productos:
          </p>
          <div className="p-grid">
            {servicios.map((sv) => {
              const slug = sv.id.replace(/^servicio-/, "")
              return (
                <Link key={sv.id} href={`/productos/${slug}`} className="p-card" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="p-ident">
                    <div className="p-icon tint-v">{emojiOf(sv.nombre)}</div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sv.nombre}</h3>
                      <span style={{ display: "block", color: "#8b5cf6", fontWeight: 600 }}>Ver planes →</span>
                    </div>
                  </div>
                  <p className="p-desc" style={{ marginBottom: 0 }}>Desarrollado a medida por PixelArch, con soporte incluido.</p>
                  <div className="p-price-row" style={{ borderTop: "none", paddingTop: 14 }}>
                    <div className="p-price" style={{ fontSize: "1.05rem" }}>
                      desde {sv.precioBasico > 0 ? desde(sv.precioBasico) : "consultar"}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}

      {/* ============ PAGOS ============ */}
      {ultimosPagos.length > 0 && (
        <div className="p-panel">
          <div className="p-sec-head">
            <h2>Últimos pagos</h2>
            <span className="p-line" aria-hidden="true" />
            <Link href="/portal/facturacion">Ver historial completo</Link>
          </div>
          {ultimosPagos.map((p) => (
            <div key={p.id} className="p-prow">
              <div>
                <div className="p-name">{p.suscripcion?.servicio.nombre ?? "Pago"}</div>
                <div className="p-date2">
                  {new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
              <div className="p-right">
                <span className="p-amt">US${(p.monto / 100).toFixed(2)}</span>
                <span className={cn("p-pill", pillOf(p.estadoPago === "SUCCEEDED" ? "ACTIVE" : p.estadoPago === "FAILED" ? "PAST_DUE" : p.estadoPago === "REFUNDED" ? "CANCELED" : "PENDING"))}>
                  <i />{p.estadoPago === "SUCCEEDED" ? "Pagado" : p.estadoPago === "FAILED" ? "Fallido" : p.estadoPago === "REFUNDED" ? "Reembolsado" : p.estadoPago === "PENDING" ? "Pendiente" : p.estadoPago}
                </span>
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
