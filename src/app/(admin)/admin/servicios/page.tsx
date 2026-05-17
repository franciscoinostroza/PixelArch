import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"

export default async function AdminServicios() {
  const servicios = await prisma.servicio.findMany({
    orderBy: { nombre: "asc" },
  })

  const intervaloLabel = (i: string) => (i === "MONTHLY" ? "/mes" : "/ano")

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Servicios</h1>
          <p className="mt-1 text-muted font-mono text-sm">Catalogo de servicios</p>
        </div>
      </div>

      <div className="mt-8">
        {servicios.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay servicios configurados. Crea productos en Paddle y ejecuta el seed.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {servicios.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm text-text">{s.nombre}</p>
                      <p className="text-xs text-muted font-mono max-w-md truncate">
                        {s.descripcion}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="text-text font-medium">
                        ${(s.precio / 100).toFixed(2)}{intervaloLabel(s.intervalo)}
                      </span>
                      <Badge variant={s.activo ? "accent2" : "muted"}>
                        {s.activo ? "Activo" : "Inactivo"}
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
