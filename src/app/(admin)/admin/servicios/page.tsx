import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"
import { formatearMonto } from "@/lib/pagos"

function pillOf(activo: boolean) {
  return activo ? { cls: "a-pill mint", label: "Activo" } : { cls: "a-pill gray", label: "Inactivo" }
}

export default async function AdminServicios() {
  const admin = await requireAdmin()
  if (!admin) redirect("/admin")
  const servicios = await prisma.servicio.findMany({
    orderBy: { nombre: "asc" },
  })

  return (
    <div>
      <div className="a-greet">
        <h1>Servicios</h1>
        <p>Catálogo de servicios y precios.</p>
      </div>

      <div className="a-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Catálogo</h3>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Precio</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {servicios.length === 0 ? (
                <tr><td colSpan={4} className="a-empty">No hay servicios configurados</td></tr>
              ) : (
                servicios.map((s) => {
                  const p = pillOf(s.activo)
                  return (
                    <tr key={s.id}>
                      <td>{s.nombre}</td>
                      <td className="a-dim">{s.descripcion}</td>
                      <td className="a-mono">
                        {formatearMonto(s.precioUnico, "usd")} impl. · {s.precioBasico > 0 ? formatearMonto(s.precioBasico, "usd") : "—"} soporte · {s.precioMantenimiento > 0 ? formatearMonto(s.precioMantenimiento, "usd") : "—"} premium
                      </td>
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
    </div>
  )
}