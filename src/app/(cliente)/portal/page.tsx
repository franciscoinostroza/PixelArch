import { auth } from "@clerk/nextjs/server"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AlertTriangle, Plus } from "lucide-react"
import Link from "next/link"

export default async function PortalPage() {
  const { userId } = await auth()

  // TODO: Fetch active subscriptions from Prisma
  const suscripciones: {
    id: string
    nombre: string
    estado: string
    precio: number
    proximoPago: string | null
  }[] = []

  const tienePagoFallido = false

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Mis servicios</h1>
          <p className="mt-1 text-muted font-mono text-sm">
            Cliente #{userId?.slice(-6)}
          </p>
        </div>
        <Link
          href="/servicios"
          className={cn(buttonVariants())}
        >
          <Plus size={16} /> Agregar servicio
        </Link>
      </div>

      {tienePagoFallido && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 font-mono">
          <AlertTriangle size={18} />
          Tenés un pago pendiente. Actualizá tu método de pago para evitar la
          interrupción del servicio.
        </div>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {suscripciones.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No tenés servicios activos. Explorá nuestro catálogo.
            </CardContent>
          </Card>
        ) : (
          suscripciones.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{s.nombre}</CardTitle>
                  <Badge
                    variant={s.estado === "ACTIVE" ? "accent2" : "accent"}
                  >
                    {s.estado === "ACTIVE" ? "Activo" : s.estado}
                  </Badge>
                </div>
                <CardDescription>
                  ${(s.precio / 100).toFixed(2)}/mes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {s.proximoPago && (
                  <p className="text-xs text-muted font-mono">
                    Próximo pago:{" "}
                    {new Date(s.proximoPago).toLocaleDateString("es-AR")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
