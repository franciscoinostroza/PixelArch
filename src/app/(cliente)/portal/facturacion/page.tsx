import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Pagination } from "@/components/ui/pagination"
import { cn } from "@/lib/utils"

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
      <div className="p-greet">
        <h1>Facturación</h1>
        <p>Tu historial de pagos completo.</p>
      </div>

      <div className="p-sec-head">
        <h2>Pagos</h2>
        <span className="p-line" aria-hidden="true" />
      </div>

      {pagos.length === 0 ? (
        <div className="p-panel" style={{ marginTop: 0 }}>
          <p className="px-6 py-14 text-center font-mono text-sm text-text-dim">No hay pagos registrados</p>
        </div>
      ) : (
        <div className="p-panel" style={{ marginTop: 0 }}>
          {pagos.map((p) => (
            <div key={p.id} className="p-prow">
              <div>
                <div className="p-name">{p.suscripcion?.servicio.nombre ?? "Pago"}</div>
                <div className="p-date2">
                  {new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
              <div className="p-right">
                <span className="p-amt">US${(p.monto / 100).toFixed(2)}</span>
                <span className={cn("p-pill", pillOf(p.estadoPago))}>
                  <i />{labelOf(p.estadoPago)}
                </span>
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
  )
}

function pillOf(estado: string) {
  switch (estado) {
    case "SUCCEEDED": return "mint"
    case "FAILED": return "red"
    case "REFUNDED": return "gray"
    case "PENDING": return "yellow"
    default: return "gray"
  }
}

function labelOf(estado: string) {
  switch (estado) {
    case "SUCCEEDED": return "Pagado"
    case "FAILED": return "Fallido"
    case "REFUNDED": return "Reembolsado"
    case "PENDING": return "Pendiente"
    default: return estado
  }
}
