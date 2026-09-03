import { Pagination } from "@/components/ui/pagination"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const PER_PAGE = 20

function pillOf(activo: boolean) {
  return activo ? { cls: "a-pill mint", label: "Activo" } : { cls: "a-pill gray", label: "Inactivo" }
}

export default async function AdminClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  const { q, page } = await searchParams
  const currentPage = Math.max(1, parseInt(page ?? "1"))

  const where = q
    ? {
        OR: [
          { nombre: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { empresa: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {}

  const [clientes, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      include: { _count: { select: { suscripciones: true } } },
      orderBy: { creadoEn: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.cliente.count({ where }),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div>
      <div className="a-greet">
        <h1>Clientes</h1>
        <p>Gestiona tus clientes.</p>
      </div>

      <div className="a-filters">
        <form style={{ display: "contents" }}>
          <input
            type="search"
            name="q"
            placeholder="Buscar por nombre, email o empresa..."
            defaultValue={q}
            className="a-field"
            style={{ width: 300, maxWidth: "100%" }}
          />
          <button type="submit" className="a-btn solid">Buscar</button>
        </form>
        {q && (
          <Link href="/admin/clientes" className="a-btn ghost">Limpiar</Link>
        )}
      </div>

      <div className="a-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Listado</h3>
          <span className="a-faint">{total} clientes</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Suscripciones</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {clientes.length === 0 ? (
                <tr><td colSpan={4} className="a-empty">No hay clientes registrados</td></tr>
              ) : (
                clientes.map((c) => {
                  const p = pillOf(c.activo)
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/admin/clientes/${c.id}`} style={{ color: "#8b5cf6", fontWeight: 600 }}>
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="a-dim">{c.email}</td>
                      <td className="a-mono">{c._count.suscripciones}</td>
                      <td>
                        <span className={cn("a-pill", p.cls)}><i />{p.label}</span>
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
        buildHref={(p) => `/admin/clientes?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
      />
    </div>
  )
}