import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { prisma } from "@/lib/prisma"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PER_PAGE = 20

export default async function AdminClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
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
      include: { _count: { select: { suscripciones: true, pagos: true } } },
      orderBy: { creadoEn: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.cliente.count({ where }),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text font-display">Clientes</h1>
          <p className="mt-1 text-muted font-mono text-sm">Gestiona tus clientes</p>
        </div>
      </div>

      <div className="mt-6">
        <form>
          <Input name="q" placeholder="Buscar cliente..." className="max-w-sm" defaultValue={q} />
        </form>
      </div>

      <div className="mt-6">
        {clientes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted font-mono text-sm">
              No hay clientes registrados aun
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {clientes.map((c) => (
              <Link key={c.id} href={`/admin/clientes/${c.id}`}>
                <Card className="transition-colors hover:bg-muted/5">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-sm text-text">{c.nombre}</p>
                        <p className="text-xs text-muted font-mono">{c.email}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted font-mono">
                        <span>{c._count.suscripciones} susc.</span>
                        <span>{c._count.pagos} pagos</span>
                        <Badge variant={c.activo ? "accent2" : "muted"}>
                          {c.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link
            href={`/admin/clientes?page=${currentPage - 1}${q ? `&q=${q}` : ""}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage <= 1 && "pointer-events-none opacity-40")}
            aria-disabled={currentPage <= 1}
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
          <span className="text-xs text-muted font-mono">
            Pagina {currentPage} de {totalPages}
          </span>
          <Link
            href={`/admin/clientes?page=${currentPage + 1}${q ? `&q=${q}` : ""}`}
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
