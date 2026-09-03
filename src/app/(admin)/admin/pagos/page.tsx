import { Pagination } from "@/components/ui/pagination"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const PER_PAGE = 20

function pillOf(estado: string) {
  switch (estado) {
    case "SUCCEEDED": return { cls: "a-pill mint", label: "Pagado" }
    case "FAILED": return { cls: "a-pill red", label: "Fallido" }
    case "REFUNDED": return { cls: "a-pill gray", label: "Reembolsado" }
    case "PENDING": return { cls: "a-pill yellow", label: "Pendiente" }
    default: return { cls: "a-pill gray", label: estado }
  }
}

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
      <div className="a-greet">
        <h1>Pagos</h1>
        <p>Historial completo de transacciones.</p>
      </div>

      <div className="a-filters">
        <form style={{ display: "contents" }}>
          <select name="estado" defaultValue={estado ?? ""} className="a-field">
            <option value="">Todos los estados</option>
            {estados.map((e) => (
              <option key={e} value={e}>{pillOf(e).label}</option>
            ))}
          </select>
          <input type="date" name="desde" defaultValue={desde ?? ""} className="a-field" title="Desde" />
          <input type="date" name="hasta" defaultValue={hasta ?? ""} className="a-field" title="Hasta" />
          <button type="submit" className="a-btn solid">Filtrar</button>
          {(estado || desde || hasta) && (
            <Link href="/admin/pagos" className="a-btn ghost">Limpiar</Link>
          )}
        </form>
      </div>

      <div className="a-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Transacciones</h3>
          <span className="a-faint">{total} resultados</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Servicio</th>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pagos.length === 0 ? (
                <tr><td colSpan={5} className="a-empty">No hay pagos registrados</td></tr>
              ) : (
                pagos.map((p) => {
                  const pill = pillOf(p.estadoPago)
                  return (
                    <tr key={p.id}>
                      <td>{p.cliente.nombre}</td>
                      <td className="a-dim">{p.suscripcion?.servicio.nombre ?? "—"}</td>
                      <td className="a-faint">{new Date(p.creadoEn).toLocaleDateString("es-AR")}</td>
                      <td className="a-mono">
                        US${(p.monto / 100).toFixed(2)}
                        {p.discountAmount ? (
                          <span style={{ color: "#8b5cf6", fontSize: "0.72rem", marginLeft: 6 }}>
                            (-${(p.discountAmount / 100).toFixed(0)})
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildHref={(p) => `/admin/pagos?${queryString(p)}`}
      />
    </div>
  )
}