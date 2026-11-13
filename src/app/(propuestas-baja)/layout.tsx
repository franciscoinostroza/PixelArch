import type { Metadata } from "next"

/**
 * T-19 (AC-33, AC-34, AC-35; RF-51, RF-52, RF-56): layout minimo de la baja
 * publica.
 *
 * Vive en un route group propio, fuera de `(propuestas)`, para no heredar el
 * guard admin ni el shell del portal. No importa Clerk, Prisma ni componentes
 * del CRM: la baja debe funcionar sin sesion y sin revelar datos.
 */

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Baja de propuestas — PixelArch",
  robots: { index: false, follow: false, nocache: true },
  // El token viaja en la URL: no debe filtrarse por Referer.
  referrer: "no-referrer",
}

export default function BajaPropuestasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="flex min-h-svh flex-col bg-bg text-text">{children}</div>
}
