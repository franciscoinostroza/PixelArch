import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

export default async function AdminClientes() {
  // TODO: Fetch from Prisma
  const clientes: never[] = []

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Clientes</h1>
          <p className="mt-1 text-muted font-mono text-sm">Gestioná tus clientes</p>
        </div>
      </div>

      <div className="mt-6">
        <Input placeholder="Buscar cliente..." className="max-w-sm" />
      </div>

      <div className="mt-6">
        {clientes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay clientes registrados aún
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* TODO: Client list table */}
          </div>
        )}
      </div>
    </div>
  )
}
