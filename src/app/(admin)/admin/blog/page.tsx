import { sanityFetch } from "@/lib/sanity"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const ARTICULOS_QUERY = `*[_type == "articulo"] | order(fecha desc) {
  _id,
  titulo,
  "slug": slug.current,
  fecha,
  tags,
  activo
}`

function Pill({ activo }: { activo: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", activo ? "text-[#34d399] bg-[rgba(52,211,153,0.12)]" : "text-[#a29cb3] bg-[rgba(255,255,255,0.05)]")}
      style={{ letterSpacing: "0.01em" }}
    >
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: activo ? "#34d399" : "#645f74", boxShadow: activo ? "0 0 8px #34d399" : "none" }} />
      {activo ? "Publicado" : "Borrador"}
    </span>
  )
}

export default async function AdminBlog() {
  const admin = await requireAdmin()
  if (!admin) redirect("/sign-in")

  const articulos = await sanityFetch<{ _id: string; titulo: string; slug?: string; fecha?: string; tags?: string[]; activo?: boolean }[]>(ARTICULOS_QUERY)

  const lista = articulos || []

  return (
    <div>
      <div className="a-greet">
        <h1>Blog</h1>
        <p>Gestioná los artículos del blog. La edición se hace en Sanity Studio.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          <Link href="/studio/desk/articulo" className="a-btn solid">
            ＋ Nuevo artículo
          </Link>
        </div>
      </div>

      <div className="a-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Artículos</h3>
          <span className="a-faint">{lista.length}</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Fecha</th>
                <th>Tags</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={5} className="a-empty">Todavía no hay artículos. Creá el primero en Sanity Studio.</td></tr>
              ) : (
                lista.map((a) => (
                  <tr key={a._id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{a.titulo}</span>
                      {a.slug && <span className="a-faint" style={{ display: "block", marginTop: 2 }}>/{a.slug}</span>}
                    </td>
                    <td className="a-faint">{a.fecha ? new Date(a.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                    <td className="a-dim">{a.tags?.length ? a.tags.slice(0, 3).join(", ") : "—"}</td>
                    <td>
                      <Pill activo={!!a.activo} />
                    </td>
                    <td>
                      <Link href={`/studio/desk/articulo;${a._id}`} className="a-btn ghost" style={{ height: 32, padding: "0 12px", fontSize: "0.8rem" }}>
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}