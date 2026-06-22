import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PER_PAGE = 20

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { userId } = await auth()
  const { page } = await searchParams
  const currentPage = Math.max(1, parseInt(page ?? "1"))

  if (!userId) redirect("/sign-in")

  const cliente = await prisma.cliente.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  })

  if (!cliente) {
    return (
      <div>
        <Card>
          <CardContent className="py-12 text-center text-muted font-mono text-sm">
            Cliente no encontrado.
          </CardContent>
        </Card>
      </div>
    )
  }

  const [pagos, total] = await Promise.all([
    prisma.pago.findMany({
      where: { clienteId: cliente.id },
      include: {
        suscripcion: {
          include: { servicio: { select: { nombre: true } } },
        },
      },
      orderBy: { creadoEn: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.pago.count({ where: { clienteId: cliente.id } }),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

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
                        p.estadoPago === "SUCCEEDED" ? "accent2"
                        : p.estadoPago === "FAILED" ? "destructive"
                        : "accent"
                      }
                    >
                      {p.estadoPago === "SUCCEEDED" ? "Pagado"
                      : p.estadoPago === "FAILED" ? "Fallido"
                      : p.estadoPago === "REFUNDED" ? "Reembolsado"
                      : p.estadoPago}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link
            href={`/portal/facturacion?page=${currentPage - 1}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage <= 1 && "pointer-events-none opacity-40")}
            aria-disabled={currentPage <= 1}
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
          <span className="text-xs text-muted font-mono">
            Pagina {currentPage} de {totalPages}
          </span>
          <Link
            href={`/portal/facturacion?page=${currentPage + 1}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage >= totalPages && "pointer-events-none opacity-40")}
            aria-disabled={currentPage >= totalPages}
          >
            Siguiente <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </div>
  )
}
