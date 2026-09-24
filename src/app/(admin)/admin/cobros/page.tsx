import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { formatearMonto, precioDePlan, convertirUsdAArs } from "@/lib/pagos"
import { waLink } from "@/lib/contact"
import { RegistrarPagoButton } from "@/components/ui/registrar-pago-button"
import { GenerarLinkMpButton } from "@/components/ui/generar-link-mp-button"
import { RecordarEmailButton } from "@/components/ui/recordar-email-button"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Cobros — Admin PixelArch",
  robots: { index: false },
}

const PLAN_LABEL: Record<string, string> = {
  UNICO: "Pago único",
  BASICO: "Básico",
  MANTENIMIENTO: "Mantenimiento",
}

function diasAtraso(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / 86400000))
}

function diasRestantes(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.ceil((fecha.getTime() - ahora.getTime()) / 86400000))
}

export default async function AdminCobros() {
  const admin = await requireAdmin()
  if (!admin) redirect("/admin")

  const ahora = new Date()
  const en7dias = new Date(ahora.getTime() + 7 * 86400000)

  const [suscripciones, rate] = await Promise.all([
    prisma.suscripcion.findMany({
      where: {
        estado: { in: ["ACTIVE", "PAST_DUE"] },
        proximoPago: { not: null, lte: en7dias },
      },
      include: { cliente: true, servicio: true },
      orderBy: { proximoPago: "asc" },
    }),
    getDolarVentaBancoNacion(),
  ])

  const vencidos = suscripciones.filter((s) => s.proximoPago && s.proximoPago < ahora)
  const porVencer = suscripciones.filter((s) => s.proximoPago && s.proximoPago >= ahora)

  const totalPorCobrar = suscripciones.reduce(
    (acc, s) => acc + precioDePlan(s.plan, s.servicio, s.precioCustom),
    0
  )

  function Row({ s }: { s: (typeof suscripciones)[number] }) {
    const precio = precioDePlan(s.plan, s.servicio, s.precioCustom)
    const precioArs = rate ? convertirUsdAArs(precio, rate) : null
    const vencida = s.proximoPago ? s.proximoPago < ahora : false
    const mensaje = `Hola ${s.cliente.nombre}! Te escribo de PixelArch por el plan ${PLAN_LABEL[s.plan] ?? s.plan} de ${s.servicio.nombre}: figura un pago de ${formatearMonto(precio, "usd")}${s.proximoPago ? ` con vencimiento ${new Date(s.proximoPago).toLocaleDateString("es-AR")}` : ""}. Cuando quieras te paso los datos para el pago.`

    return (
      <div className="a-prow" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="a-name">
              <Link href={`/admin/clientes/${s.clienteId}`} style={{ color: "inherit", textDecoration: "none" }}>
                {s.cliente.nombre}
              </Link>
              <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>
                · {s.servicio.nombre} · {PLAN_LABEL[s.plan] ?? s.plan}
              </span>
            </div>
            <div className="a-date">
              {formatearMonto(precio, "usd")}/mes
              {s.proximoPago && (
                <>
                  {" · "}
                  <span style={vencida ? { color: "#f87171" } : undefined}>
                    {vencida
                      ? `venció hace ${diasAtraso(s.proximoPago, ahora)} día${diasAtraso(s.proximoPago, ahora) === 1 ? "" : "s"}`
                      : `vence en ${diasRestantes(s.proximoPago, ahora)} día${diasRestantes(s.proximoPago, ahora) === 1 ? "" : "s"}`}
                  </span>
                </>
              )}
              {s.ultimoRecordatorioEn && (
                <span style={{ color: "var(--color-text-faint)" }}>
                  {" · recordado "}
                  {new Date(s.ultimoRecordatorioEn).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                </span>
              )}
            </div>
          </div>
          <span className={cn("a-pill", vencida || s.estado === "PAST_DUE" ? "red" : "yellow")}>
            <i />
            {vencida || s.estado === "PAST_DUE" ? "Vencido" : "Por vencer"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <RegistrarPagoButton
            suscripcionId={s.id}
            servicioNombre={`${s.servicio.nombre} — ${s.cliente.nombre}`}
            precioUsd={precio}
            precioArs={precioArs}
          />
          <GenerarLinkMpButton
            suscripcionId={s.id}
            servicioNombre={`${s.servicio.nombre} — ${s.cliente.nombre}`}
            precioUsd={precio}
            precioArs={precioArs}
            clienteTelefono={s.cliente.telefono}
          />
          {s.cliente.telefono ? (
            <a
              href={waLink(s.cliente.telefono, mensaje)}
              target="_blank"
              rel="noopener noreferrer"
              className="a-btn ghost"
              title={`WhatsApp a ${s.cliente.telefono}`}
            >
              WhatsApp
            </a>
          ) : null}
          <RecordarEmailButton suscripcionId={s.id} />
          <SubscriptionActions
            suscripcionId={s.id}
            estado={s.estado}
            deploymentPlatform={s.deploymentPlatform}
            platformServiceId={s.platformServiceId}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="a-greet">
        <h1>Cobros</h1>
        <p>Vencidos y por vencer en los próximos 7 días.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          <span className={cn("a-pill", vencidos.length > 0 ? "red" : "mint")}>
            <i />{vencidos.length} vencidos
          </span>
          <span className="a-pill yellow"><i />{porVencer.length} por vencer</span>
          <span className="a-pill gray"><i />Por cobrar: {formatearMonto(totalPorCobrar, "usd")}</span>
        </div>
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Vencidos</h3>
          <span className="a-faint">{vencidos.length}</span>
        </div>
        {vencidos.length === 0 ? (
          <p className="a-empty">Sin pagos vencidos 🎉</p>
        ) : (
          vencidos.map((s) => <Row key={s.id} s={s} />)
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Por vencer (7 días)</h3>
          <span className="a-faint">{porVencer.length}</span>
        </div>
        {porVencer.length === 0 ? (
          <p className="a-empty">Nada por vencer esta semana</p>
        ) : (
          porVencer.map((s) => <Row key={s.id} s={s} />)
        )}
      </div>
    </div>
  )
}