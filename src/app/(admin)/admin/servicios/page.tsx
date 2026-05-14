import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function AdminServicios() {
  // TODO: Fetch from Prisma
  const servicios: never[] = []

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Servicios</h1>
          <p className="mt-1 text-muted font-mono text-sm">Catálogo de servicios</p>
        </div>
        <Button>
          <Plus size={16} /> Nuevo servicio
        </Button>
      </div>

      <div className="mt-8">
        {servicios.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay servicios configurados
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* TODO: Service list with CRUD */}
          </div>
        )}
      </div>
    </div>
  )
}
