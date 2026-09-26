import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { formatearMonto, precioDePlan, convertirUsdAArs } from "@/lib/pagos"
import { waLink } from "@/lib/contact"
import { RegistrarPagoButton } from "@/components/ui/registrar-pago-button"
import { RegistrarPagoHitoButton } from "@/components/ui/registrar-pago-hito-button"
import { GenerarLinkMpButton } from "@/components/ui/generar-link-mp-button"
import { GenerarLinkHitoButton } from "@/components/ui/generar-link-hito-button"
import { RecordarEmailButton } from "@/components/ui/recordar-email-button"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { MarcarHitoButton } from "@/components/ui/marcar-hito-button"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Cobros — Admin PixelArch",
  robots: { index: false },
}

const PLAN_LABEL: Record<string, string> = {
  UNICO: "Pago único",
  BASICO: "Básico",
  MANTENIMIENTO: "Mantenimiento",
  SOPORTE: "Soporte",
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

  const [hitosPendientes, soportes, rate] = await Promise.all([
    prisma.hito.findMany({
      where: { estado: "PENDIENTE" },
      include: {
        proyecto: {
          include: {
            cliente: true,
            servicio: { select: { nombre: true } },
          },
        },
      },
      orderBy: [{ vencimiento: "asc" }, { orden: "asc" }],
    }),
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

  const hitosVencidos = hitosPendientes.filter((h) => h.vencimiento && h.vencimiento < ahora)
  const hitosPorVencer = hitosPendientes.filter((h) => h.vencimiento && h.vencimiento >= ahora && h.vencimiento <= en7dias)
  const hitosSinFecha = hitosPendientes.filter((h) => !h.vencimiento)

  const soportesVencidos = soportes.filter((s) => s.proximoPago && s.proximoPago < ahora)
  const soportesPorVencer = soportes.filter((s) => s.proximoPago && s.proximoPago >= ahora)

  const totalHitos = hitosPendientes.reduce((acc, h) => acc + h.monto, 0)
  const totalSoportes = soportes.reduce((acc, s) => acc + precioDePlan(s.plan, s.servicio, s.precioCustom), 0)
  const alertas = hitosVencidos.length + hitosPorVencer.length + soportesVencidos.length + soportesPorVencer.length

  function HitoRow({ h }: { h: (typeof hitosPendientes)[number] }) {
    const precioArs = rate ? convertirUsdAArs(h.monto, rate) : null
    const vencido = h.vencimiento ? h.vencimiento < ahora : false
    const mensaje = `Hola ${h.proyecto.cliente.nombre}! Te escribo de PixelArch por el proyecto ${h.proyecto.titulo}: el hito "${h.titulo}" (${formatearMonto(h.monto, "usd")})${h.vencimiento ? ` vence el ${new Date(h.vencimiento).toLocaleDateString("es-AR")}` : ""}. Cuando quieras te paso el link de pago.`

    return (
      <div className="a-prow" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="a-name">
              <Link href={`/admin/clientes/${h.proyecto.clienteId}`} style={{ color: "inherit", textDecoration: "none" }}>
                {h.proyecto.titulo}
              </Link>
              <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>
                · {h.titulo} · {h.proyecto.cliente.nombre}
              </span>
            </div>
            <div className="a-date">
              {formatearMonto(h.monto, "usd")}
              {precioArs && <span style={{ color: "var(--color-text-faint)" }}> · ≈ {formatearMonto(precioArs, "ars")}</span>}
              {h.vencimiento && (
                <>
                  {" · "}
                  <span style={vencido ? { color: "#f87171" } : undefined}>
                    {vencido
                      ? `venció hace ${diasAtraso(h.vencimiento, ahora)} día${diasAtraso(h.vencimiento, ahora) === 1 ? "" : "s"}`
                      : `vence en ${diasRestantes(h.vencimiento, ahora)} día${diasRestantes(h.vencimiento, ahora) === 1 ? "" : "s"}`}
                  </span>
                </>
              )}
            </div>
          </div>
          <span className={cn("a-pill", vencido ? "red" : "yellow")}>
            <i />{vencido ? "Vencido" : "Pendiente"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <RegistrarPagoHitoButton
            hitoId={h.id}
            hitoTitulo={h.titulo}
            proyectoTitulo={h.proyecto.titulo}
            precioUsd={h.monto}
            precioArs={precioArs}
          />
          <GenerarLinkHitoButton
            hitoId={h.id}
            hitoTitulo={h.titulo}
            proyectoTitulo={h.proyecto.titulo}
            precioUsd={h.monto}
            precioArs={precioArs}
            clienteTelefono={h.proyecto.cliente.telefono}
            linkGuardado={h.mpLink}
            linkExpira={h.mpLinkExpira ? new Date(h.mpLinkExpira).toISOString() : null}
          />
          {h.proyecto.cliente.telefono ? (
            <a
              href={waLink(h.proyecto.cliente.telefono, mensaje)}
              target="_blank"
              rel="noopener noreferrer"
              className="a-btn ghost"
              title={`WhatsApp a ${h.proyecto.cliente.telefono}`}
            >
              WhatsApp
            </a>
          ) : null}
          <RecordarEmailButton hitoId={h.id} />
          <MarcarHitoButton hitoId={h.id} estado={h.estado} />
        </div>
      </div>
    )
  }

  function SoporteRow({ s }: { s: (typeof soportes)[number] }) {
    const precio = precioDePlan(s.plan, s.servicio, s.precioCustom)
    const precioArs = rate ? convertirUsdAArs(precio, rate) : null
    const vencida = s.proximoPago ? s.proximoPago < ahora : false
    const mensaje = `Hola ${s.cliente.nombre}! Te escribo de PixelArch por el soporte de ${s.servicio.nombre}: figura un pago de ${formatearMonto(precio, "usd")}${s.proximoPago ? ` con vencimiento ${new Date(s.proximoPago).toLocaleDateString("es-AR")}` : ""}. Cuando quieras te paso los datos para el pago.`

    return (
      <div className="a-prow" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="a-name">
              <Link href={`/admin/clientes/${s.clienteId}`} style={{ color: "inherit", textDecoration: "none" }}>
                {s.cliente.nombre}
              </Link>
              <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>
                · Soporte {s.servicio.nombre}
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
            servicio={`Soporte ${s.servicio.nombre}`}
            cliente={s.cliente.nombre}
            precioUsd={precio}
            precioArs={precioArs}
          />
          <GenerarLinkMpButton
            suscripcionId={s.id}
            servicio={`Soporte ${s.servicio.nombre}`}
            cliente={s.cliente.nombre}
            precioUsd={precio}
            precioArs={precioArs}
            clienteTelefono={s.cliente.telefono}
            linkGuardado={s.mpLink}
            linkExpira={s.mpLinkExpira ? new Date(s.mpLinkExpira).toISOString() : null}
            mesesGuardados={s.mpLinkMeses}
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
        <p>Hitos de proyectos y soportes por cobrar.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          <span className={cn("a-pill", alertas > 0 ? "red" : "mint")}>
            <i />{alertas} para cobrar
          </span>
          <span className="a-pill gray"><i />Hitos pendientes: {formatearMonto(totalHitos, "usd")}</span>
          <span className="a-pill gray"><i />Soportes 7d: {formatearMonto(totalSoportes, "usd")}</span>
        </div>
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Hitos vencidos</h3>
          <span className="a-faint">{hitosVencidos.length}</span>
        </div>
        {hitosVencidos.length === 0 ? (
          <p className="a-empty">Sin hitos vencidos 🎉</p>
        ) : (
          hitosVencidos.map((h) => <HitoRow key={h.id} h={h} />)
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Hitos por vencer (7 días)</h3>
          <span className="a-faint">{hitosPorVencer.length}</span>
        </div>
        {hitosPorVencer.length === 0 ? (
          <p className="a-empty">Nada por vencer esta semana</p>
        ) : (
          hitosPorVencer.map((h) => <HitoRow key={h.id} h={h} />)
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Hitos sin fecha</h3>
          <span className="a-faint">{hitosSinFecha.length}</span>
        </div>
        {hitosSinFecha.length === 0 ? (
          <p className="a-empty">Sin hitos pendientes sin fecha</p>
        ) : (
          hitosSinFecha.map((h) => <HitoRow key={h.id} h={h} />)
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Soportes vencidos</h3>
          <span className="a-faint">{soportesVencidos.length}</span>
        </div>
        {soportesVencidos.length === 0 ? (
          <p className="a-empty">Sin soportes vencidos 🎉</p>
        ) : (
          soportesVencidos.map((s) => <SoporteRow key={s.id} s={s} />)
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Soportes por vencer (7 días)</h3>
          <span className="a-faint">{soportesPorVencer.length}</span>
        </div>
        {soportesPorVencer.length === 0 ? (
          <p className="a-empty">Nada por vencer esta semana</p>
        ) : (
          soportesPorVencer.map((s) => <SoporteRow key={s.id} s={s} />)
        )}
      </div>
    </div>
  )
}