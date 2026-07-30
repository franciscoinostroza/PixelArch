import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import Script from "next/script"
import { ArrowUpRight, ArrowDownRight } from "lucide-react"

function initials(name: string) {
  return name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
}

function ClientAvatar({ name }: { name: string }) {
  return (
    <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center shrink-0 font-display font-bold text-[.8rem] text-[#07060c]" style={{ background: "linear-gradient(135deg,#8b5cf6,#22d3ee)" }}>
      {initials(name)}
    </div>
  )
}

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
    take: 6,
    include: { _count: { select: { suscripciones: true } } },
  })

  const mapLabel = (e: string) => {
    switch (e) {
      case "ACTIVE": return "Activo"
      case "PAST_DUE": return "Vencido"
      case "CANCELED": return "Cancelado"
      case "TRIALING": return "Prueba"
      default: return e
    }
  }

  const stats = [
    {
      label: "Ingresos (mes)",
      value: `$${(ingresoActual / 100).toFixed(0)}`,
      icon: "dollar" as const,
      gradient: "from-violet to-cyan",
      iconBg: "stat-icon--violet",
      delta: deltaIngreso !== 0 ? { value: deltaIngreso, positive: deltaIngreso > 0 } : null,
    },
    {
      label: "Clientes activos",
      value: String(clientesActivos),
      icon: "users" as const,
      gradient: "from-cyan to-violet",
      iconBg: "stat-icon--cyan",
      delta: null,
    },
    {
      label: "Suscripciones",
      value: String(suscripcionesActivas),
      icon: "card" as const,
      gradient: "from-violet to-cyan",
      iconBg: "stat-icon--violet",
      delta: null,
    },
    {
      label: "Vencidos",
      value: String(pagosVencidos),
      icon: "alert" as const,
      gradient: "from-red-400 to-red-500",
      iconBg: "stat-icon--red",
      delta: null,
    },
  ]

  function StatIcon({ icon }: { icon: string }) {
    if (icon === "dollar") return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    if (icon === "users") return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    if (icon === "card") return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
  }

  return (
    <div>
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "32px" }}>
        <p className="eyebrow">Panel</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "8px" }}>Dashboard</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Bienvenido, admin</p>
      </div>

      {pagosVencidos > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 mb-6" style={{ fontSize: ".8rem", color: "#fca5a5" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
          <span className="flex-1">{pagosVencidos} suscripción{pagosVencidos > 1 ? "es" : ""} vencida{pagosVencidos > 1 ? "s" : ""}. Revisa los clientes.</span>
          <Link href="/admin/clientes?estado=PAST_DUE" className="shrink-0 text-violet font-semibold whitespace-nowrap">Ver clientes →</Link>
        </div>
      )}

      <div className="mb-8">
        <div className="stats-track">
          {stats.map((s, i) => (
            <div key={i} className="stat-card relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${s.gradient}`} />
              <div className={`w-[44px] h-[44px] rounded-[12px] flex items-center justify-center mb-4 ${s.iconBg}`}>
                <StatIcon icon={s.icon} />
              </div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint mb-1.5 leading-tight">{s.label}</p>
              <p className={`font-display text-[1.9rem] font-bold tracking-[-0.02em] ${s.icon === "alert" ? "text-red-400" : "text-text"}`}>{s.value}</p>
              {s.delta && (
                <p className={`flex items-center gap-1 text-[.72rem] mt-2 ${s.delta.positive ? "text-mint" : "text-red-400"}`}>
                  {s.delta.positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {s.delta.positive ? "+" : ""}{s.delta.value}% vs anterior
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="stats-dots" id="statsDots" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="rounded-[18px] border border-border bg-panel-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="font-display text-[.95rem] font-bold">Clientes recientes</p>
            <Link href="/admin/clientes" className="font-mono text-[11px] text-violet inline-flex items-center gap-1">
              Ver todos →
            </Link>
          </div>
          <div className="h-px" style={{ background: "linear-gradient(90deg,rgba(139,92,246,.25),rgba(34,211,238,.15),transparent)", marginBottom: "14px" }} />
          <div className="flex flex-col gap-2">
            {ultimosClientes.map((c) => (
              <Link key={c.id} href={`/admin/clientes/${c.id}`} className="flex items-center gap-3 rounded-[10px] px-1.5 py-2.5 transition-colors hover:bg-white/[0.02]">
                <ClientAvatar name={c.nombre} />
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold text-[.85rem] truncate">{c.nombre}</p>
                  <p className="text-[.72rem] text-text-dim truncate">{c.email}</p>
                </div>
                <span className="font-mono text-[.7rem] text-text-dim border border-border rounded-full px-2 py-0.5 shrink-0">{c._count.suscripciones} susc.</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-border bg-panel-2 p-6">
          <p className="font-display text-[.95rem] font-bold mb-4">Estado de suscripciones</p>
          <div className="h-px" style={{ background: "linear-gradient(90deg,rgba(34,211,238,.25),rgba(139,92,246,.15),transparent)", marginBottom: "14px" }} />
          <div className="flex flex-col gap-4">
            {suscripcionesPorEstado.map((g) => {
              const barGradient = g.estado === "ACTIVE" ? "linear-gradient(90deg,#34d399,#22d3ee)" : g.estado === "PAST_DUE" ? "linear-gradient(90deg,#f87171,#ef4444)" : "linear-gradient(90deg,#645f74,#a29cb3)"
              const dotColor = g.estado === "ACTIVE" ? "#34d399" : g.estado === "PAST_DUE" ? "#f87171" : "#645f74"
              return (
                <div key={g.estado}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 font-display font-medium" style={{ fontSize: ".8rem" }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                      {mapLabel(g.estado)}
                    </span>
                    <span className="font-mono text-[.75rem] text-text-dim">{g._count.id}</span>
                  </div>
                  <div className="h-[7px] rounded-full bg-bg overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max((g._count.id / maxCount) * 100, 8)}%`, background: barGradient }} />
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

      <p className="font-mono text-[11px] text-text-faint text-center mt-7 pt-4" style={{ borderTop: "1px dashed var(--color-border)" }}>
        Datos actualizados en tiempo real
      </p>

      <Script id="stats-dots">{`
        const track = document.querySelector('.stats-track');
        if (track) {
          const cards = track.querySelectorAll('.stat-card');
          const dotsWrap = document.getElementById('statsDots');
          cards.forEach((_, i) => {
            const dot = document.createElement('span');
            if (i === 0) dot.classList.add('active');
            dotsWrap.appendChild(dot);
          });
          const dots = dotsWrap.querySelectorAll('span');
          track.addEventListener('scroll', () => {
            const idx = Math.round(track.scrollLeft / (track.clientWidth * 0.76));
            dots.forEach((d, i) => d.classList.toggle('active', i === idx));
          }, { passive: true });
        }
      `}</Script>

      <style>{`
        .stats-track {
          display: flex;
          gap: 14px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          padding: 4px 4px 4px 0;
          margin: 0 -4px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .stats-track::-webkit-scrollbar { display: none }
        @media (min-width: 640px) {
          .stats-track { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; overflow: visible }
        }
        @media (min-width: 1024px) {
          .stats-track { grid-template-columns: repeat(4, 1fr) }
        }

        .stat-card {
          scroll-snap-align: start;
          flex: 0 0 76%;
          min-width: 230px;
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          padding: 22px;
          transition: transform 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s;
        }
        @media (min-width: 640px) { .stat-card { flex: none; min-width: 0 } }
        .stat-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.3) }

        .stat-icon--violet { background: rgba(139,92,246,0.14); color: #8b5cf6 }
        .stat-icon--cyan { background: rgba(34,211,238,0.14); color: #22d3ee }
        .stat-icon--red { background: rgba(248,113,113,0.14); color: #f87171 }

        .stats-dots {
          display: flex;
          gap: 6px;
          justify-content: center;
          margin-top: 12px;
        }
        @media (min-width: 640px) { .stats-dots { display: none } }
        .stats-dots span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
          transition: background 0.3s, width 0.3s;
        }
        .stats-dots span.active {
          background: #8b5cf6;
          width: 16px;
          border-radius: 3px;
        }
      `}</style>
    </div>
  )
}
