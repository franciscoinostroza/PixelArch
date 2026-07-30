import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowUpRight, ArrowDownRight, AlertTriangle } from "lucide-react"

export default async function AdminDashboard() {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  const now = new Date()
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const inicioMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const finMesAnterior = new Date(now.getFullYear(), now.getMonth(), 0)

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
        where: {
          estadoPago: "SUCCEEDED",
          creadoEn: { gte: inicioMesAnterior, lt: inicioMes },
        },
        _sum: { monto: true },
      }),
    ])

  const ingresoActual = ingresosMes._sum.monto ?? 0
  const ingresoAnteriorVal = ingresosAnterior._sum.monto ?? 0
  const deltaIngreso =
    ingresoAnteriorVal > 0
      ? Math.round(((ingresoActual - ingresoAnteriorVal) / ingresoAnteriorVal) * 100)
      : ingresoActual > 0
        ? 100
        : 0

  const suscripcionesPorEstado = await prisma.suscripcion.groupBy({
    by: ["estado"],
    _count: { id: true },
  })

  const totalSuscripciones = suscripcionesPorEstado.reduce((a, g) => a + g._count.id, 0)
  const maxCount = Math.max(...suscripcionesPorEstado.map((g) => g._count.id), 1)

  const ultimosClientes = await prisma.cliente.findMany({
    orderBy: { creadoEn: "desc" },
    take: 6,
    include: { _count: { select: { suscripciones: true } } },
  })

  const mapEstado = (e: string) => {
    switch (e) {
      case "ACTIVE": return "active"
      case "PAST_DUE": return "past_due"
      case "CANCELED": return "paused"
      case "TRIALING": return "active"
      default: return "paused"
    }
  }

  const mapLabel = (e: string) => {
    switch (e) {
      case "ACTIVE": return "Activo"
      case "PAST_DUE": return "Vencido"
      case "CANCELED": return "Cancelado"
      case "TRIALING": return "Prueba"
      default: return e
    }
  }

  return (
    <div>
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Panel</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Dashboard</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Bienvenido, admin</p>
      </div>

      {pagosVencidos > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            {pagosVencidos} suscripcion{pagosVencidos > 1 ? "es" : ""} vencida{pagosVencidos > 1 ? "s" : ""}. Revisa los clientes.
          </span>
          <Link href="/admin/clientes?estado=PAST_DUE" className="shrink-0 text-violet hover:underline">
            Ver clientes
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="brand-card p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet to-cyan" />
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">Ingresos (mes)</p>
          </div>
          <p className="font-display text-3xl font-extrabold tracking-[-0.03em] text-text">
            <span className="text-violet">$</span>{(ingresoActual / 100).toFixed(0)}
          </p>
          {deltaIngreso !== 0 && (
            <p className={`mt-2 flex items-center gap-1.5 text-[12px] ${deltaIngreso > 0 ? "text-mint" : "text-red-400"}`}>
              {deltaIngreso > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {deltaIngreso > 0 ? "+" : ""}{deltaIngreso}% vs mes anterior
            </p>
          )}
        </div>
        <div className="brand-card p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan to-violet" />
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint mb-3">Clientes activos</p>
          <p className="font-display text-3xl font-extrabold tracking-[-0.03em] text-text">
            {clientesActivos}
          </p>
        </div>
        <div className="brand-card p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet to-cyan" />
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint mb-3">Suscripciones activas</p>
          <p className="font-display text-3xl font-extrabold tracking-[-0.03em] text-text">
            {suscripcionesActivas}
          </p>
        </div>
        <div className="brand-card p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-400 to-red-500" />
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint mb-3">Vencidos</p>
          <p className="font-display text-3xl font-extrabold tracking-[-0.03em] text-red-400">
            {pagosVencidos}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="brand-card p-5 overflow-x-auto">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-display text-sm font-bold">Clientes recientes</p>
            <Link href="/admin/clientes" className="text-[11px] text-violet font-mono hover:text-violet/80 transition-colors inline-flex items-center gap-1">
              Ver todos →
            </Link>
          </div>
          <div className="h-[2px] bg-gradient-to-r from-violet/20 to-cyan/20 mb-4" />
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] uppercase tracking-[0.12em] text-text-faint pb-3 font-mono font-normal">
                  Nombre
                </th>
                <th className="text-left text-[10px] uppercase tracking-[0.12em] text-text-faint pb-3 font-mono font-normal">
                  Email
                </th>
                <th className="text-right text-[10px] uppercase tracking-[0.12em] text-text-faint pb-3 font-mono font-normal">
                  Susc.
                </th>
              </tr>
            </thead>
            <tbody>
              {ultimosClientes.map((c) => (
                <tr key={c.id} className="border-t border-border/30 transition-colors hover:bg-violet/[0.02]">
                  <td className="py-3 pr-4">
                    <Link href={`/admin/clientes/${c.id}`} className="text-xs text-text hover:text-violet transition-colors font-display font-medium">
                      {c.nombre}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-xs text-text-dim">{c.email}</td>
                  <td className="py-3 text-right text-xs text-text-dim font-mono">
                    {c._count.suscripciones}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="brand-card p-5">
          <p className="font-display text-sm font-bold mb-4">Estado de suscripciones</p>
          <div className="h-[2px] bg-gradient-to-r from-cyan/20 to-violet/20 mb-4" />
          <div className="space-y-4">
            {suscripcionesPorEstado.map((g) => {
              const barColor = g.estado === "ACTIVE" ? "from-mint to-cyan" : g.estado === "PAST_DUE" ? "from-red-400 to-red-500" : "from-text-faint to-text-dim/50"
              const dotColor = g.estado === "ACTIVE" ? "bg-mint" : g.estado === "PAST_DUE" ? "bg-red-400" : "bg-text-faint"
              return (
                <div key={g.estado}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                      <span className="text-xs text-text font-display font-medium">{mapLabel(g.estado)}</span>
                    </div>
                    <span className="text-xs text-text-dim font-mono">{g._count.id}</span>
                  </div>
                  <div className="h-2 rounded-full bg-bg overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${barColor}`}
                      style={{ width: `${Math.max((g._count.id / maxCount) * 100, 8)}%`, transition: "width 0.6s cubic-bezier(.19,1,.22,1)" }}
                    />
                  </div>
                </div>
              )
            })}
            {suscripcionesPorEstado.length === 0 && (
              <p className="text-xs text-text-dim py-8 text-center">Sin datos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
