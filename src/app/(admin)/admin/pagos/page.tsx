import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"
import { Pagination } from "@/components/ui/pagination"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"

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
      <PageHeader title="Pagos" subtitle="Historial completo de transacciones" />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form className="flex flex-wrap items-center gap-3">
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="h-9 rounded-lg border border-border bg-panel px-3 text-xs text-text font-mono"
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
            className="h-9 rounded-lg border border-border bg-panel px-3 text-xs text-text font-mono"
            title="Desde"
          />
          <input
            type="date"
            name="hasta"
            defaultValue={hasta ?? ""}
            className="h-9 rounded-lg border border-border bg-panel px-3 text-xs text-text font-mono"
            title="Hasta"
          />
          <Button type="submit" size="sm" variant="outline">Filtrar</Button>
          {(estado || desde || hasta) && (
            <Link href="/admin/pagos" className={buttonVariants({ variant: "ghost", size: "sm" })}>
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
                <tr key={p.id} className="border-t border-border/50 transition-colors hover:bg-panel/50">
                  <td className="px-5 py-3 text-xs text-text">{p.cliente.nombre}</td>
                  <td className="px-5 py-3 text-xs text-text-dim">
                    {p.suscripcion?.servicio.nombre ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-text-dim font-mono">
                    {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-5 py-3 text-xs text-text font-mono font-medium">
                    US${(p.monto / 100).toFixed(2)}
                    {p.discountAmount ? (
                      <span className="ml-1.5 text-[11px] text-violet">
                        (-${(p.discountAmount / 100).toFixed(0)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <StatusPill estado={p.estadoPago} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildHref={(p) => `/admin/pagos?${queryString(p)}`}
      />
    </div>
  )
}
