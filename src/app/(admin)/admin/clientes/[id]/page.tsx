import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { DeployConfig } from "@/components/ui/deploy-config"

export default async function ClienteDetalle({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: {
      suscripciones: {
        include: { servicio: { select: { nombre: true, precio: true } } },
        orderBy: { creadoEn: "desc" },
      },
      pagos: {
        orderBy: { creadoEn: "desc" },
        include: { suscripcion: { include: { servicio: { select: { nombre: true } } } } },
      },
    },
  })

  if (!cliente) notFound()

  const mapEstado = (e: string) => {
    switch (e) {
      case "ACTIVE": return "Activo"
      case "PAST_DUE": return "Pendiente"
      case "CANCELED": return "Cancelado"
      case "PAUSED": return "Pausado"
      case "TRIALING": return "Prueba"
      default: return e
    }
  }

  const mapEstadoPago = (e: string) => {
    switch (e) {
      case "SUCCEEDED": return "Pagado"
      case "FAILED": return "Fallido"
      case "REFUNDED": return "Reembolsado"
      case "PENDING": return "Pendiente"
      default: return e
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text font-display">
        {cliente.nombre}
      </h1>
      <p className="mt-1 text-muted font-mono text-sm">ID: {id}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos del cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted">Nombre</span>
                <span className="text-text">{cliente.nombre}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Email</span>
                <span className="text-text">{cliente.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Empresa</span>
                <span className="text-text">{cliente.empresa ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Estado</span>
                <Badge variant={cliente.activo ? "accent2" : "muted"}>
                  {cliente.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suscripciones ({cliente.suscripciones.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {cliente.suscripciones.length === 0 ? (
              <p className="text-muted font-mono text-sm">Sin suscripciones</p>
            ) : (
              <div className="space-y-3">
                {cliente.suscripciones.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-border px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-sm text-text">
                          {s.servicio.nombre}
                        </p>
                        <p className="text-xs text-muted font-mono">
                          ${(s.servicio.precio / 100).toFixed(2)}/mes
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={s.estado === "ACTIVE" ? "accent2" : "accent"}>
                          {mapEstado(s.estado)}
                        </Badge>
                        <SubscriptionActions suscripcionId={s.id} estado={s.estado} />
                      </div>
                    </div>
                    <DeployConfig
                      suscripcionId={s.id}
                      deploymentId={s.deploymentId}
                      deploymentPlatform={s.deploymentPlatform}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Historial de pagos ({cliente.pagos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {cliente.pagos.length === 0 ? (
              <p className="text-muted font-mono text-sm">Sin pagos registrados</p>
            ) : (
              <div className="space-y-2">
                {cliente.pagos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div>
                      <p className="font-mono text-sm text-text">
                        {p.suscripcion?.servicio.nombre ?? "Pago suelto"}
                      </p>
                      <p className="text-xs text-muted font-mono">
                        {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-medium text-text">
                        ${(p.monto / 100).toFixed(2)} {p.moneda.toUpperCase()}
                      </p>
                      <Badge
                        variant={
                          p.estadoPago === "SUCCEEDED" ? "accent2" : "accent"
                        }
                      >
                        {mapEstadoPago(p.estadoPago)}
                      </Badge>
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
