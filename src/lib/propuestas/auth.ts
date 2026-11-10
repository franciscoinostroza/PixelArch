import { auth, clerkClient } from "@clerk/nextjs/server"

/**
 * T-02 (AC-1, AC-2, AC-3; RF-1, RF-2, RF-4): guard Clerk-only del portal.
 *
 * No importa Prisma ni consulta `Cliente`: el portal de propuestas debe quedar
 * aislado del CRM. La pagina y cada API revalidan el rol en el servidor; el
 * middleware es solo la primera barrera.
 */
export interface AdminPropuestas {
  userId: string
  nombre: string
}

export type ResultadoAdminPropuestas =
  | { ok: true; admin: AdminPropuestas }
  | { ok: false; motivo: "SIN_SESION" | "NO_ADMIN"; esAsistente: boolean }

function nombreDe(user: {
  fullName?: string | null
  firstName?: string | null
}): string {
  return user.fullName?.trim() || user.firstName?.trim() || "Admin"
}

export async function resolverAdminPropuestas(): Promise<ResultadoAdminPropuestas> {
  try {
    const { userId } = await auth()
    if (!userId) {
      return { ok: false, motivo: "SIN_SESION", esAsistente: false }
    }

    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const role = (user.publicMetadata as { role?: unknown } | undefined)?.role

    if (role !== "admin") {
      return {
        ok: false,
        motivo: "NO_ADMIN",
        esAsistente: role === "asistente",
      }
    }

    return { ok: true, admin: { userId, nombre: nombreDe(user) } }
  } catch {
    // Clerk no disponible o error inesperado: fallar cerrado sin datos.
    return { ok: false, motivo: "SIN_SESION", esAsistente: false }
  }
}
