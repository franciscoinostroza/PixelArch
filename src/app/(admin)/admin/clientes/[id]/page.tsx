import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default async function ClienteDetalle({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // TODO: Fetch from Prisma
  return (
    <div>
      <h1 className="text-2xl font-bold text-text font-display">Cliente #{id.slice(-6)}</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos del cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted">Nombre</span>
                <span className="text-text">—</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Email</span>
                <span className="text-text">—</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Empresa</span>
                <span className="text-text">—</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Estado</span>
                <Badge variant="accent2">activo</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suscripciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted font-mono text-sm">Conecta BD para ver suscripciones</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Historial de pagos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted font-mono text-sm">Conecta BD para ver pagos</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
