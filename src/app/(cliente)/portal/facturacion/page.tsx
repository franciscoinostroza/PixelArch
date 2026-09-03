import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { StatusPill } from "@/components/ui/status-pill"
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
      <div className="mb-12">
        <h1
          style={{
            fontFamily: "var(--font-pixel-display)",
            fontWeight: 700,
            letterSpacing: 0,
            fontSize: "clamp(1.9rem, 4vw, 2.9rem)",
            lineHeight: 1.1,
            marginBottom: "8px",
          }}
        >
          Facturación
        </h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: "1rem", maxWidth: "46ch", lineHeight: 1.65 }}>
          Tu historial de pagos completo.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <h2 className="font-display text-[1.35rem] font-bold">Pagos</h2>
        <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.08), transparent)" }} aria-hidden="true" />
      </div>

      <div
        className="mt-6 overflow-hidden rounded-[18px]"
        style={{
          border: "1px solid rgba(255,255,255,0.07)",
          background: "linear-gradient(170deg, rgba(17,14,26,0.85), rgba(17,14,26,0.6))",
          backdropFilter: "blur(10px)",
        }}
      >
        {pagos.length === 0 ? (
          <p className="px-6 py-14 text-center font-mono text-sm text-text-dim">No hay pagos registrados</p>
        ) : (
          pagos.map((p, i) => (
            <div
              key={p.id}
              className={cn("flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-white/[0.02]", i > 0 && "border-t")}
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <div>
                <p className="text-[0.92rem] font-semibold">{p.suscripcion?.servicio.nombre ?? "Pago"}</p>
                <p className="mt-0.5 font-mono text-[11px] text-text-faint">
                  {new Date(p.creadoEn).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[0.92rem] font-semibold">US${(p.monto / 100).toFixed(2)}</span>
                <StatusPill estado={p.estadoPago} />
              </div>
            </div>
          ))
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
