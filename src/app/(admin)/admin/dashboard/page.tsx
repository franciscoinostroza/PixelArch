import { auth } from "@clerk/nextjs/server"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { DollarSign, Users, RefreshCw, AlertTriangle } from "lucide-react"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

export default async function AdminDashboard() {
  const { userId } = await auth()

  const now = new Date()
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)

  const [clientesActivos, suscripcionesActivas, pagosVencidos, ingresos] = await Promise.all([
    prisma.cliente.count({ where: { activo: true } }),
    prisma.suscripcion.count({ where: { estado: "ACTIVE" } }),
    prisma.suscripcion.count({ where: { estado: "PAST_DUE" } }),
    prisma.pago.aggregate({
      where: {
        estadoPago: "SUCCEEDED",
        creadoEn: { gte: inicioMes },
      },
      _sum: { monto: true },
    }),
  ])

  const ultimosClientes = await prisma.cliente.findMany({
    orderBy: { creadoEn: "desc" },
    take: 5,
    include: { _count: { select: { suscripciones: true } } },
  })

  const suscripcionesPorMes = await prisma.suscripcion.groupBy({
    by: ["estado"],
    _count: { id: true },
  })

  const totalSuscripciones = suscripcionesPorMes.reduce((acc, g) => acc + g._count.id, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-text font-display">Dashboard</h1>
      <p className="mt-1 text-muted font-mono text-sm">
        Bienvenido, admin #{userId?.slice(-6)}
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent2/10 p-2 text-accent2">
                <DollarSign size={20} />
              </div>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted">
                Ingresos (mes)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text font-display">
              ${((ingresos._sum.monto ?? 0) / 100).toFixed(0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/10 p-2 text-accent">
                <Users size={20} />
              </div>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted">
                Clientes
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text font-display">
              {clientesActivos}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/10 p-2 text-accent">
                <RefreshCw size={20} />
              </div>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted">
                Suscripciones
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text font-display">
              {suscripcionesActivas}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-500/10 p-2 text-red-400">
                <AlertTriangle size={20} />
              </div>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted">
                Vencidos
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text font-display">
              {pagosVencidos}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ultimos clientes</CardTitle>
          </CardHeader>
          <CardContent>
            {ultimosClientes.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-muted font-mono text-sm">
                <Users size={32} className="mb-2 opacity-30" />
                No hay clientes registrados
              </div>
            ) : (
              <div className="space-y-3">
                {ultimosClientes.map((c) => (
                  <Link
                    key={c.id}
                    href={`/admin/clientes/${c.id}`}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted/5"
                  >
                    <div>
                      <p className="font-mono text-sm text-text">{c.nombre}</p>
                      <p className="text-xs text-muted font-mono">{c.email}</p>
                    </div>
                    <div className="text-right text-xs text-muted font-mono">
                      {c._count.suscripciones} susc.
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado de suscripciones</CardTitle>
          </CardHeader>
          <CardContent>
            {suscripcionesPorMes.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-muted font-mono text-sm">
                Sin datos
              </div>
            ) : (
              <div className="space-y-3">
                {suscripcionesPorMes.map((g) => (
                  <div key={g.estado} className="flex items-center justify-between">
                    <span className="font-mono text-sm text-text">{g.estado}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max((g._count.id / totalSuscripciones) * 200, 8)}px` }} />
                      <span className="text-xs text-muted font-mono">{g._count.id}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
