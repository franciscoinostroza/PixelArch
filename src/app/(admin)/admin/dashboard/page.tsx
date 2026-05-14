import { auth } from "@clerk/nextjs/server"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DollarSign, Users, RefreshCw, AlertTriangle } from "lucide-react"

export default async function AdminDashboard() {
  const { userId } = await auth()

  // TODO: Replace with real Prisma queries
  const metrics = {
    ingresosMes: 0,
    clientesActivos: 0,
    suscripciones: 0,
    pagosVencidos: 0,
  }

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
              ${(metrics.ingresosMes / 100).toFixed(0)}
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
              {metrics.clientesActivos}
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
              {metrics.suscripciones}
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
              {metrics.pagosVencidos}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Últimos clientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center py-8 text-muted font-mono text-sm">
              <Users size={32} className="mb-2 opacity-30" />
              Conecta la base de datos para ver los clientes
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ingresos mensuales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-muted font-mono text-sm">
              Gráfico (conecta BD)
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
