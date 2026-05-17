import { auth } from "@clerk/nextjs/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"

export default async function FacturacionPage() {
  const { userId } = await auth()

  if (!userId) {
    return (
      <div>
        <Card>
          <CardContent className="py-12 text-center text-muted font-mono text-sm">
            Iniciá sesión para ver tu historial.
          </CardContent>
        </Card>
      </div>
    )
  }

  const cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  })

  const pagos = cliente
    ? await prisma.pago.findMany({
        where: { clienteId: cliente.id },
        include: {
          suscripcion: {
            include: { servicio: { select: { nombre: true } } },
          },
        },
        orderBy: { creadoEn: "desc" },
      })
    : []

  return (
    <div>
      <h1 className="text-2xl font-bold text-text font-display">Facturacion</h1>
      <p className="mt-1 text-muted font-mono text-sm">Historial de pagos</p>

      <div className="mt-8">
        {pagos.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay pagos registrados
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pagos.map((p) => (
              <Card key={p.id}>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-mono text-sm text-text">
                      {p.suscripcion?.servicio.nombre ?? "Pago"}
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
                      {p.estadoPago === "SUCCEEDED" ? "Pagado" : p.estadoPago}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
