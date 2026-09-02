import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"

export default async function AdminServicios() {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")
  const servicios = await prisma.servicio.findMany({
    orderBy: { nombre: "asc" },
  })

  return (
    <div>
      <PageHeader title="Servicios" subtitle="Catálogo de servicios" />

      <div className="brand-table overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Nombre
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Descripcion
              </th>
              <th className="text-left text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Precio
              </th>
              <th className="text-right text-[10px] uppercase tracking-[0.1em] text-text-faint px-5 pt-4 pb-3 font-mono font-normal">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {servicios.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-text-dim">
                  No hay servicios configurados
                </td>
              </tr>
            ) : (
              servicios.map((s) => (
                <tr key={s.id} className="border-t border-border/50 transition-colors hover:bg-panel/50">
                  <td className="px-5 py-3 text-xs text-text">{s.nombre}</td>
                  <td className="px-5 py-3 text-xs text-text-dim max-w-[200px] lg:max-w-xs truncate">
                    {s.descripcion}
                  </td>
                  <td className="px-5 py-3 text-xs text-text font-mono font-medium">
                    ${(s.precioUnico / 100).toFixed(0)} único · {s.precioBasico > 0 ? `$${(s.precioBasico / 100).toFixed(0)}/mes` : "—"} · {s.precioMantenimiento > 0 ? `$${(s.precioMantenimiento / 100).toFixed(0)}/mes` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <StatusPill estado={s.activo ? "ACTIVE" : "INACTIVE"} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
