import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

export default async function AdminClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams

  const clientes = q
    ? await prisma.cliente.findMany({
        where: {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { empresa: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { _count: { select: { suscripciones: true, pagos: true } } },
        orderBy: { creadoEn: "desc" },
      })
    : await prisma.cliente.findMany({
        include: { _count: { select: { suscripciones: true, pagos: true } } },
        orderBy: { creadoEn: "desc" },
      })

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
    </div>
  )
}
