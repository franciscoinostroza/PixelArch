import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { EstadoPago } from "@prisma/client"

const PER_PAGE = 20

export default async function AdminPagos({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; estado?: string; desde?: string; hasta?: string }>
}) {
  const { page, estado, desde, hasta } = await searchParams
  const currentPage = Math.max(1, parseInt(page ?? "1"))

  const where: Record<string, unknown> = {}
  if (estado && ["SUCCEEDED", "FAILED", "REFUNDED", "PENDING"].includes(estado)) {
    where.estadoPago = estado
  }
  if (desde || hasta) {
    where.creadoEn = {
      ...(desde ? { gte: new Date(desde) } : {}),
      ...(hasta ? { lte: new Date(hasta + "T23:59:59") } : {}),
    }
  }

  const [pagos, total] = await Promise.all([
    prisma.pago.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { creadoEn: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        cliente: { select: { nombre: true, email: true } },
        suscripcion: { include: { servicio: { select: { nombre: true } } } },
      },
    }),
    prisma.pago.count({ where: Object.keys(where).length ? where : undefined }),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

  const mapEstado = (e: string) => {
    switch (e) {
      case "SUCCEEDED": return "Pagado"
      case "FAILED": return "Fallido"
      case "REFUNDED": return "Reembolsado"
      case "PENDING": return "Pendiente"
      default: return e
    }
  }

  const estados = ["SUCCEEDED", "FAILED", "REFUNDED", "PENDING"]

  const queryString = (pageNum: number) => {
    const params = new URLSearchParams()
    params.set("page", String(pageNum))
    if (estado) params.set("estado", estado)
    if (desde) params.set("desde", desde)
    if (hasta) params.set("hasta", hasta)
    return params.toString()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text font-display">Pagos</h1>
      <p className="mt-1 text-muted font-mono text-sm">Historial completo de transacciones</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form className="flex flex-wrap items-center gap-3">
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="rounded-lg border border-border bg-bg2 px-3 py-2 text-sm text-text font-mono"
          >
            <option value="">Todos</option>
            {estados.map((e) => (
              <option key={e} value={e}>{mapEstado(e)}</option>
            ))}
          </select>
          <input
            type="date"
            name="desde"
            defaultValue={desde ?? ""}
            className="rounded-lg border border-border bg-bg2 px-3 py-2 text-sm text-text font-mono"
            title="Desde"
          />
          <input
            type="date"
            name="hasta"
            defaultValue={hasta ?? ""}
            className="rounded-lg border border-border bg-bg2 px-3 py-2 text-sm text-text font-mono"
            title="Hasta"
          />
          <Button type="submit" size="sm" variant="outline">Filtrar</Button>
          {(estado || desde || hasta) && (
            <Link href="/admin/pagos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Limpiar
            </Link>
          )}
        </form>
        <span className="text-xs text-muted font-mono">{total} resultados</span>
      </div>

      <div className="mt-6">
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

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link
            href={`/admin/pagos?${queryString(currentPage - 1)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage <= 1 && "pointer-events-none opacity-40")}
            aria-disabled={currentPage <= 1}
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
          <span className="text-xs text-muted font-mono">
            Pagina {currentPage} de {totalPages}
          </span>
          <Link
            href={`/admin/pagos?${queryString(currentPage + 1)}`}
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
