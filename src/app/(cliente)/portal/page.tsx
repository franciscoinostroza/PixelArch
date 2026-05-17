import { auth } from "@clerk/nextjs/server"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AlertTriangle, Plus } from "lucide-react"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

export default async function PortalPage() {
  const { userId } = await auth()

  if (!userId) {
    return (
      <div>
        <Card>
          <CardContent className="py-12 text-center text-muted font-mono text-sm">
            Iniciá sesión para ver tus servicios.
          </CardContent>
        </Card>
      </div>
    )
  }

  const cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  })

  const suscripciones = cliente
    ? await prisma.suscripcion.findMany({
        where: { clienteId: cliente.id },
        include: { servicio: { select: { nombre: true, precio: true } } },
        orderBy: { creadoEn: "desc" },
      })
    : []

  const tienePagoFallido = cliente
    ? (await prisma.pago.count({
        where: {
          clienteId: cliente.id,
          estadoPago: "FAILED",
        },
      })) > 0
    : false

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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Mis servicios</h1>
          <p className="mt-1 text-muted font-mono text-sm">
            Cliente #{userId.slice(-6)}
          </p>
        </div>
        <Link href="/servicios" className={cn(buttonVariants())}>
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
                  <CardTitle>{s.servicio.nombre}</CardTitle>
                  <Badge
                    variant={s.estado === "ACTIVE" ? "accent2" : "accent"}
                  >
                    {mapEstado(s.estado)}
                  </Badge>
                </div>
                <CardDescription>
                  ${(s.servicio.precio / 100).toFixed(2)}/mes
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
