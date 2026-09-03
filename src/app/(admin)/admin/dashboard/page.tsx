import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react"

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
    const color =
      e === "ACTIVE"
        ? "linear-gradient(90deg,#34d399,#22d3ee)"
        : e === "PAST_DUE"
          ? "linear-gradient(90deg,#f87171,#ef4444)"
          : e === "PENDING"
            ? "linear-gradient(90deg,#fbbf24,#f59e0b)"
            : e === "READY"
              ? "linear-gradient(90deg,#8b5cf6,#22d3ee)"
              : "linear-gradient(90deg,#645f74,#a29cb3)"
    return color
  }

  const initials = (name: string) =>
    name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()

  const stats = [
    {
      label: "Ingresos (mes)",
      value: `$${(ingresoActual / 100).toFixed(0)}`,
      variant: "a" as const,
      iconBg: "v" as const,
      icon: "dollar" as const,
      delta: deltaIngreso !== 0 ? { value: deltaIngreso, positive: deltaIngreso > 0 } : null,
    },
    {
      label: "Clientes activos",
      value: String(clientesActivos),
      variant: "b" as const,
      iconBg: "c" as const,
      icon: "users" as const,
      delta: null,
    },
    {
      label: "Suscripciones",
      value: String(suscripcionesActivas),
      variant: "a" as const,
      iconBg: "v" as const,
      icon: "card" as const,
      delta: null,
    },
    {
      label: "Vencidos",
      value: String(pagosVencidos),
      variant: "d" as const,
      iconBg: "r" as const,
      icon: "alert" as const,
      delta: null,
    },
  ]

  function StatIcon({ icon }: { icon: string }) {
    if (icon === "dollar") return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    if (icon === "users") return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    if (icon === "card") return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
  }

  return (
    <div>
      <div className="a-greet">
        <h1>Dashboard</h1>
        <p>Bienvenido de vuelta. Así va PixelArch hoy.</p>
      </div>

      {pagosVencidos > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, background: "rgba(248,113,113,0.06)", color: "#fca5a5", fontSize: "0.9rem", marginBottom: 22 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
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
            <div className={cn("a-ic", s.iconBg)}>
              <StatIcon icon={s.icon} />
            </div>
            <div className="a-lbl">{s.label}</div>
            <div className="a-val" style={s.icon === "alert" ? { color: "#f87171" } : undefined}>{s.value}</div>
            {s.delta && (
              <div className="a-sub" style={{ display: "flex", alignItems: "center", gap: 4, color: s.delta.positive ? "#34d399" : "#f87171" }}>
                {s.delta.positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {s.delta.positive ? "+" : ""}{s.delta.value}% vs anterior
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
          {ultimosClientes.map((c) => (
            <Link key={c.id} href={`/admin/clientes/${c.id}`} className="a-rowc">
              <span className="a-av">{initials(c.nombre)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="a-nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</div>
                <div className="a-em" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
              </div>
              <span className="a-meta">{c._count.suscripciones} susc.</span>
            </Link>
          ))}
          {ultimosClientes.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-dim)", padding: "16px 0", textAlign: "center" }}>Sin clientes todavía</p>
          )}
        </div>

        <div className="a-panel">
          <div className="a-head"><h3>Estado de suscripciones</h3></div>
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
