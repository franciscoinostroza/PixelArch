import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
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
          <CardContent className="py-12 text-center text-text-dim font-mono text-sm">
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
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Facturación</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Facturación</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Historial de pagos</p>
      </div>

      <div className="mt-8">
        {pagos.length === 0 ? (
          <div className="brand-card p-8 text-center">
            <p className="font-mono text-sm text-text-dim">No hay pagos registrados</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pagos.map((p) => (
              <div key={p.id} className="brand-card relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet/20 to-cyan/20" />
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-mono text-sm text-text">
                      {p.suscripcion?.servicio.nombre ?? "Pago"}
                    </p>
                    <p className="text-xs text-text-dim font-mono">
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
              </div>
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
          <span className="text-xs text-text-dim font-mono">
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
