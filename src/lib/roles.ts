export const STAFF_ROLES = ["admin", "asistente"] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/**
 * Secciones del admin a las que puede entrar la asistente. El admin mantiene
 * acceso a todas. No se acepta el alias "assistant".
 */
export const SECCIONES_ASISTENTE = [
  "/admin/clientes",
  "/admin/cobros",
  "/admin/pagos",
] as const

export function esRolStaff(value: unknown): value is StaffRole {
  return value === "admin" || value === "asistente"
}

function normalizarRuta(pathname: string): string {
  const sinQuery = pathname.split(/[?#]/, 1)[0] ?? "/"
  if (sinQuery.length > 1 && sinQuery.endsWith("/")) {
    return sinQuery.replace(/\/+$/, "")
  }
  return sinQuery
}

export function esRutaAdminPermitida(rol: StaffRole, pathname: string): boolean {
  if (rol === "admin") return true

  const ruta = normalizarRuta(pathname)
  // /admin es solo el punto de entrada: la pagina redirige segun el rol.
  if (ruta === "/admin") return true

  return SECCIONES_ASISTENTE.some(
    (seccion) => ruta === seccion || ruta.startsWith(`${seccion}/`),
  )
}

export function rutaInicioRol(rol: StaffRole): string {
  return rol === "admin" ? "/admin/dashboard" : "/admin/cobros"
}
