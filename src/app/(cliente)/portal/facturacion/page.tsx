import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"
import { Pagination } from "@/components/ui/pagination"
import { Reveal } from "@/components/ui/reveal"

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
      <Reveal>
        <div className="section-shell">
          <PageHeader title="Facturación" subtitle="Historial de pagos" />
        </div>
      </Reveal>

      <Reveal className="mt-8" delay={80}>
        <div className="section-shell">
          {pagos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/40 bg-panel p-10 text-center">
              <p className="font-mono text-sm text-text-dim">No hay pagos registrados</p>
            </div>
          ) : (
            <div className="brand-card--static brand-card overflow-hidden">
              {pagos.map((p, i) => (
                <div
                  key={p.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.02] ${i > 0 ? "border-t border-border/40" : ""}`}
                >
                  <div>
                    <p className="font-display text-sm font-medium text-text">
                      {p.suscripcion?.servicio.nombre ?? "Pago"}
                    </p>
                    <p className="mt-0.5 text-xs text-text-dim font-mono">
                      {new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-mono font-semibold text-text">US${(p.monto / 100).toFixed(2)}</p>
                    <StatusPill estado={p.estadoPago} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            buildHref={(n) => `/portal/facturacion?page=${n}`}
          />
        </div>
      </Reveal>
    </div>
  )
}
