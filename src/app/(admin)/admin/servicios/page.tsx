import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"

export default async function AdminServicios() {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")
  const servicios = await prisma.servicio.findMany({
    orderBy: { nombre: "asc" },
  })

  return (
    <div>
      <div className="section-head" style={{ maxWidth: "600px", marginBottom: "40px" }}>
        <p className="eyebrow">Catálogo</p>
        <h2 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.5rem, 2.5vw, 2rem)", marginBottom: "10px" }}>Servicios</h2>
        <p style={{ color: "var(--color-text-dim)", fontSize: ".9rem" }}>Catálogo de servicios</p>
      </div>

      <div className="brand-card overflow-hidden">
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
                <tr key={s.id} className="border-t border-border/50">
                  <td className="px-5 py-3 text-xs text-text">{s.nombre}</td>
                  <td className="px-5 py-3 text-xs text-text-dim max-w-xs truncate">
                    {s.descripcion}
                  </td>
                  <td className="px-5 py-3 text-xs text-text font-mono font-medium">
                    ${(s.precioUnico / 100).toFixed(0)} unico · {s.precioBasico > 0 ? `$${(s.precioBasico / 100).toFixed(0)}/mes` : "—"} · {s.precioMantenimiento > 0 ? `$${(s.precioMantenimiento / 100).toFixed(0)}/mes` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
                        s.activo
                          ? "bg-mint/10 text-mint"
                          : "bg-text-faint/10 text-text-dim"
                      )}
                    >
                      <span className={cn("w-[5px] h-[5px] rounded-full", s.activo ? "bg-mint" : "bg-text-faint")} />
                      {s.activo ? "Activo" : "Inactivo"}
                    </span>
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
