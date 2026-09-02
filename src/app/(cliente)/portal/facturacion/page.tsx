import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"
import { Pagination } from "@/components/ui/pagination"

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
        <div className="brand-card p-8 text-center">
          <p className="font-mono text-sm text-text-dim">Cliente no encontrado.</p>
        </div>
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
      <PageHeader title="Facturación" subtitle="Historial de pagos" />

      <div className="mt-2">
        {pagos.length === 0 ? (
          <div className="brand-card--static brand-card p-8 text-center">
            <p className="font-mono text-sm text-text-dim">No hay pagos registrados</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pagos.map((p) => (
              <div key={p.id} className="brand-card--static brand-card">
                <div className="flex items-center justify-between p-5">
                  <div>
                    <p className="font-display text-sm font-medium text-text">
                      {p.suscripcion?.servicio.nombre ?? "Pago"}
                    </p>
                    <p className="text-xs text-text-dim font-mono">
                      {new Date(p.creadoEn).toLocaleDateString("es-AR")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-mono font-medium text-text">
                      US${(p.monto / 100).toFixed(2)}
                    </p>
                    <StatusPill estado={p.estadoPago} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildHref={(n) => `/portal/facturacion?page=${n}`}
      />
    </div>
  )
}
