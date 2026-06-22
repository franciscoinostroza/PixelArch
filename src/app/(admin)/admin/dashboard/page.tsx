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
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-extrabold">Dashboard</h1>
          <p className="mt-0.5 text-xs text-muted">Bienvenido, admin</p>
        </div>
      </div>

      {pagosVencidos > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            {pagosVencidos} suscripcion{pagosVencidos > 1 ? "es" : ""} vencida{pagosVencidos > 1 ? "s" : ""}. Revisa los clientes.
          </span>
          <Link href="/admin/clientes?estado=PAST_DUE" className="shrink-0 text-accent hover:underline">
            Ver clientes
          </Link>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 mb-7">
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="text-[11px] text-muted tracking-[0.05em] mb-2">Ingresos (mes)</p>
          <p className="font-display text-[1.6rem] font-extrabold leading-none tracking-[-0.03em]">
            <span className="text-accent">$</span>
            {(ingresoActual / 100).toFixed(0)}
          </p>
          {deltaIngreso !== 0 && (
            <p className={`mt-1 flex items-center gap-1 text-[11px] ${deltaIngreso > 0 ? "text-accent2" : "text-red-400"}`}>
              {deltaIngreso > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {deltaIngreso > 0 ? "+" : ""}{deltaIngreso}% vs mes anterior
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="text-[11px] text-muted tracking-[0.05em] mb-2">Clientes activos</p>
          <p className="font-display text-[1.6rem] font-extrabold leading-none tracking-[-0.03em]">
            {clientesActivos}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="text-[11px] text-muted tracking-[0.05em] mb-2">Suscripciones</p>
          <p className="font-display text-[1.6rem] font-extrabold leading-none tracking-[-0.03em]">
            {suscripcionesActivas}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="text-[11px] text-muted tracking-[0.05em] mb-2">Vencidos</p>
          <p className="font-display text-[1.6rem] font-extrabold leading-none tracking-[-0.03em] text-red-400">
            {pagosVencidos}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-border bg-bg2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-display text-sm font-bold">Clientes recientes</p>
            <Link href="/admin/clientes" className="text-[11px] text-accent font-mono hover:underline">
              Ver todos
            </Link>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] pb-3 border-b border-border font-mono font-normal">
                  Nombre
                </th>
                <th className="text-left text-[10px] uppercase tracking-[0.1em] text-[#4a5568] pb-3 border-b border-border font-mono font-normal">
                  Email
                </th>
                <th className="text-right text-[10px] uppercase tracking-[0.1em] text-[#4a5568] pb-3 border-b border-border font-mono font-normal">
                  Susc.
                </th>
              </tr>
            </thead>
            <tbody>
              {ultimosClientes.map((c) => (
                <tr key={c.id} className="border-b border-border/50 last:border-b-0">
                  <td className="py-2.5 pr-4">
                    <Link href={`/admin/clientes/${c.id}`} className="text-xs text-text hover:text-accent transition-colors">
                      {c.nombre}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted">{c.email}</td>
                  <td className="py-2.5 text-right text-xs text-muted font-mono">
                    {c._count.suscripciones}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-bg2 p-5">
          <p className="font-display text-sm font-bold mb-4">Estado de suscripciones</p>
          <div className="space-y-3">
            {suscripcionesPorEstado.map((g) => (
              <div key={g.estado} className="flex items-center gap-3">
                <span className="text-xs text-text font-mono w-16 shrink-0">{mapLabel(g.estado)}</span>
                <div className="flex-1 h-5 rounded-full bg-bg overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      g.estado === "ACTIVE"
                        ? "bg-accent2/60"
                        : g.estado === "PAST_DUE"
                          ? "bg-red-400/60"
                          : "bg-muted/30"
                    }`}
                    style={{ width: `${Math.max((g._count.id / maxCount) * 100, 8)}%` }}
                  />
                </div>
                <span className="text-xs text-muted font-mono w-6 text-right">{g._count.id}</span>
              </div>
            ))}
            {suscripcionesPorEstado.length === 0 && (
              <p className="text-xs text-muted py-8 text-center">Sin datos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
