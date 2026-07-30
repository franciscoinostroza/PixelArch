import { Card, CardContent } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PER_PAGE = 20

export default async function AdminPagos({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; estado?: string; desde?: string; hasta?: string }>
}) {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

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
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Facturación</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Pagos</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Historial completo de transacciones</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form className="flex flex-wrap items-center gap-3">
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-text font-mono"
          >
            <option value="">Todos los estados</option>
            {estados.map((e) => (
              <option key={e} value={e}>{mapEstado(e)}</option>
            ))}
          </select>
          <input
            type="date"
            name="desde"
            defaultValue={desde ?? ""}
            className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-text font-mono"
            title="Desde"
          />
          <input
            type="date"
            name="hasta"
            defaultValue={hasta ?? ""}
            className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-text font-mono"
            title="Hasta"
          />
          <Button type="submit" size="sm" variant="outline">Filtrar</Button>
          {(estado || desde || hasta) && (
            <Link href="/admin/pagos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Limpiar
            </Link>
          )}
        </form>
        <span className="text-xs text-text-dim font-mono">{total} resultados</span>
      </div>

      <div className="brand-table overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Cliente
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Servicio
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Fecha
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Monto
              </th>
              <th className="text-right text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {pagos.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-xs text-text-dim">
                  No hay pagos registrados
                </td>
              </tr>
            ) : (
              pagos.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="px-5 py-3 text-xs text-text">{p.cliente.nombre}</td>
                  <td className="px-5 py-3 text-xs text-text-dim">
                    {p.suscripcion?.servicio.nombre ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-text-dim font-mono">
                    {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-5 py-3 text-xs text-text font-mono font-medium">
                    ${(p.monto / 100).toFixed(2)} {p.moneda.toUpperCase()}
                    {p.discountAmount ? (
                      <span className="ml-1 text-[10px] text-violet">
                        (-${(p.discountAmount / 100).toFixed(0)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                        p.estadoPago === "SUCCEEDED"
                          ? "bg-mint/10 text-mint"
                          : p.estadoPago === "FAILED"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-text-faint/10 text-text-dim"
                      )}
                    >
                      <span
                        className={cn(
                          "w-[5px] h-[5px] rounded-full",
                          p.estadoPago === "SUCCEEDED"
                            ? "bg-mint"
                            : p.estadoPago === "FAILED"
                              ? "bg-red-400"
                              : "bg-text-faint"
                        )}
                      />
                      {mapEstado(p.estadoPago)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-4">
          <Link
            href={`/admin/pagos?${queryString(currentPage - 1)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage <= 1 && "pointer-events-none opacity-40")}
            aria-disabled={currentPage <= 1}
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
          <span className="text-xs text-text-dim font-mono">
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
