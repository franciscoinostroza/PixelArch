import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

export default async function AdminDashboard() {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  const now = new Date()
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const inicioMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const [clientesActivos, suscripcionesActivas, pagosVencidos, ingresosMes, ingresosAnterior] =
    await Promise.all([
      prisma.cliente.count({ where: { activo: true } }),
      prisma.suscripcion.count({ where: { estado: "ACTIVE" } }),
      prisma.suscripcion.count({ where: { estado: "PAST_DUE" } }),
      prisma.pago.aggregate({
        where: { estadoPago: "SUCCEEDED", creadoEn: { gte: inicioMes } },
        _sum: { monto: true },
      }),
      prisma.pago.aggregate({
        where: { estadoPago: "SUCCEEDED", creadoEn: { gte: inicioMesAnterior, lt: inicioMes } },
        _sum: { monto: true },
      }),
    ])

  const ingresoActual = ingresosMes._sum.monto ?? 0
  const ingresoAnteriorVal = ingresosAnterior._sum.monto ?? 0
  const deltaIngreso =
    ingresoAnteriorVal > 0
      ? Math.round(((ingresoActual - ingresoAnteriorVal) / ingresoAnteriorVal) * 100)
      : ingresoActual > 0 ? 100 : 0

  const suscripcionesPorEstado = await prisma.suscripcion.groupBy({
    by: ["estado"],
    _count: { id: true },
  })

  const maxCount = Math.max(...suscripcionesPorEstado.map((g) => g._count.id), 1)

  const ultimosClientes = await prisma.cliente.findMany({
    orderBy: { creadoEn: "desc" },
    take: 5,
    include: { _count: { select: { suscripciones: true } } },
  })

  const mapEstado = (e: string) => {
    switch (e) {
      case "ACTIVE": return "Activo"
      case "PAST_DUE": return "Vencido"
      case "CANCELED": return "Cancelado"
      case "PENDING": return "En desarrollo"
      case "READY": return "Entregado"
      case "TRIALING": return "Prueba"
      case "PAUSED": return "Pausado"
      default: return e
    }
  }

  const dotOf = (e: string) =>
    e === "ACTIVE" ? "g" : e === "PAST_DUE" ? "gr" : e === "PENDING" ? "y" : "s"

  const barOf = (e: string) => {
    switch (e) {
      case "ACTIVE": return "linear-gradient(90deg, #34d399, #6ee7b7)"
      case "PAST_DUE": return "linear-gradient(90deg, #f87171, #ef4444)"
      case "PENDING": return "linear-gradient(90deg, #fbbf24, #fcd34d)"
      case "READY": return "linear-gradient(90deg, #8b5cf6, #22d3ee)"
      default: return "linear-gradient(90deg, #a29cb3, #d4c9e8)"
    }
  }

  const initials = (name: string) =>
    name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()

  const stats = [
    {
      label: "Ingresos (mes)",
      value: `$${ingresoActual.toLocaleString("en-US")}`,
      variant: "a" as const,
      iconBg: "v" as const,
      glyph: "$" as const,
      delta: deltaIngreso !== 0 ? { value: deltaIngreso, positive: deltaIngreso > 0 } : null,
    },
    {
      label: "Clientes activos",
      value: String(clientesActivos),
      variant: "b" as const,
      iconBg: "c" as const,
      glyph: "◉" as const,
      delta: null,
    },
    {
      label: "Suscripciones",
      value: String(suscripcionesActivas),
      variant: "a" as const,
      iconBg: "v" as const,
      glyph: "▤" as const,
      delta: null,
    },
    {
      label: "Vencidos",
      value: String(pagosVencidos),
      variant: "d" as const,
      iconBg: "r" as const,
      glyph: "!" as const,
      delta: null,
    },
  ]

  return (
    <div>
      <div className="a-greet">
        <h1>Dashboard</h1>
        <p>Bienvenido de vuelta. Aquí ves el estado de PixelArch en tiempo real.</p>
      </div>

      {pagosVencidos > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, background: "rgba(248,113,113,0.06)", color: "#fca5a5", fontSize: "0.9rem", marginBottom: 22 }}>
          <span style={{ flexShrink: 0 }}>!</span>
          <span style={{ flex: 1 }}>
            {pagosVencidos} suscripción{pagosVencidos > 1 ? "es" : ""} vencida{pagosVencidos > 1 ? "s" : ""}. Revisa los clientes.
          </span>
          <Link href="/admin/clientes?estado=PAST_DUE" style={{ color: "#8b5cf6", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
            Ver clientes →
          </Link>
        </div>
      )}

      <div className="a-stats">
        {stats.map((s, i) => (
          <div key={i} className={cn("a-stat", s.variant)}>
            <div className={cn("a-ic", s.iconBg)} aria-hidden="true">{s.glyph}</div>
            <div className="a-lbl">{s.label}</div>
            <div className="a-val" style={s.glyph === "!" ? { color: "#f87171" } : undefined}>{s.value}</div>
            {s.delta && (
              <div className="a-sub" style={{ color: s.delta.positive ? "#34d399" : "#f87171" }}>
                {s.delta.positive ? "▲" : "▼"} {s.delta.positive ? "+" : ""}{s.delta.value}% vs anterior
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="a-cols">
        <div className="a-panel">
          <div className="a-head">
            <h3>Clientes recientes</h3>
            <Link href="/admin/clientes">Ver todos →</Link>
          </div>
          {ultimosClientes.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-dim)", padding: "16px 0", textAlign: "center" }}>Sin clientes todavía</p>
          )}
          {ultimosClientes.map((c) => (
            <Link key={c.id} href={`/admin/clientes/${c.id}`} className="a-rowc">
              <span className="a-av" aria-hidden="true">{initials(c.nombre)}</span>
              <span className="a-info">
                <span className="a-nm" style={{ display: "block" }}>{c.nombre}</span>
                <span className="a-em" style={{ display: "block" }}>{c.email}</span>
              </span>
              <span className="a-meta">{c._count.suscripciones} susc.</span>
            </Link>
          ))}
        </div>

        <div className="a-panel">
          <div className="a-head">
            <h3>Estado de suscripciones</h3>
          </div>
          {suscripcionesPorEstado.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-dim)", padding: "16px 0", textAlign: "center" }}>Sin datos</p>
          )}
          {suscripcionesPorEstado.map((g) => (
            <div key={g.estado} className="a-bar-row">
              <div className="a-bar-top">
                <span><span className={cn("a-dot", dotOf(g.estado))} />{mapEstado(g.estado)}</span>
                <span className="a-n">{g._count.id}</span>
              </div>
              <div className="a-track">
                <i style={{ width: `${Math.max((g._count.id / maxCount) * 100, 4)}%`, background: barOf(g.estado) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}