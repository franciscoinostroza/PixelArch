import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default async function AdminPagos() {
  // TODO: Fetch from Prisma
  const pagos: never[] = []

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
          <div className="space-y-3">
            {/* TODO: Payment history table */}
          </div>
        )}
      </div>
    </div>
  )
}
