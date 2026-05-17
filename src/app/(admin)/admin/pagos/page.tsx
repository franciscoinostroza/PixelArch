import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"

export default async function AdminPagos() {
  const pagos = await prisma.pago.findMany({
    orderBy: { creadoEn: "desc" },
    include: {
      cliente: { select: { nombre: true, email: true } },
      suscripcion: { include: { servicio: { select: { nombre: true } } } },
    },
  })

  const mapEstado = (e: string) => {
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
      <h1 className="text-2xl font-bold text-text font-display">Pagos</h1>
      <p className="mt-1 text-muted font-mono text-sm">Historial completo de transacciones</p>

      <div className="mt-8">
        {pagos.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay pagos registrados
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pagos.map((p) => (
              <Card key={p.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm text-text">
                        {p.cliente.nombre}
                      </p>
                      <p className="text-xs text-muted font-mono">
                        {p.suscripcion?.servicio.nombre ?? "—"} ·{" "}
                        {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-medium text-text">
                        ${(p.monto / 100).toFixed(2)} {p.moneda.toUpperCase()}
                      </p>
                      <Badge
                        variant={p.estadoPago === "SUCCEEDED" ? "accent2" : "accent"}
                      >
                        {mapEstado(p.estadoPago)}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
