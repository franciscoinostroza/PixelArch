import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PER_PAGE = 20

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
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Gestión</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Clientes</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Gestiona tus clientes</p>
      </div>

      <div className="mb-5">
        <form>
          <Input
            name="q"
            placeholder="Buscar por nombre, email o empresa..."
            className="max-w-sm"
            defaultValue={q}
          />
        </form>
      </div>

      <div className="brand-table">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Nombre
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Email
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Suscripciones
              </th>
              <th className="text-right text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {clientes.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-text-dim">
                  No hay clientes registrados
                </td>
              </tr>
            ) : (
              clientes.map((c) => (
                <tr key={c.id} className="border-t border-border/50 hover:bg-panel/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/clientes/${c.id}`}
                      className="text-xs text-text hover:text-violet transition-colors"
                    >
                      {c.nombre}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-xs text-text-dim">{c.email}</td>
                  <td className="px-5 py-3 text-xs text-text-dim font-mono">
                    {c._count.suscripciones}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                        c.activo
                          ? "bg-mint/10 text-mint"
                          : "bg-text-faint/10 text-text-dim"
                      )}
                    >
                      <span className={cn("w-[5px] h-[5px] rounded-full", c.activo ? "bg-mint" : "bg-text-faint")} />
                      {c.activo ? "Activo" : "Inactivo"}
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
            href={`/admin/clientes?page=${currentPage - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              currentPage <= 1 && "pointer-events-none opacity-40"
            )}
            aria-disabled={currentPage <= 1}
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
          <span className="text-xs text-text-dim font-mono">
            Pagina {currentPage} de {totalPages}
          </span>
          <Link
            href={`/admin/clientes?page=${currentPage + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              currentPage >= totalPages && "pointer-events-none opacity-40"
            )}
            aria-disabled={currentPage >= totalPages}
          >
            Siguiente <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </div>
  )
}
