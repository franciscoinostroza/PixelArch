import type { Metadata } from "next"
import SpaceCanvas from "@/components/layout/space-canvas"
import { AdminGate } from "@/components/layout/admin-gate"

export const metadata: Metadata = {
  title: "Acceso al panel — PixelArch",
  robots: { index: false },
}

export default async function GateAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const safeNext =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/admin/dashboard"

  const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

  return (
    <div style={{ position: "relative", minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <SpaceCanvas />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-40 top-[-10%] z-[1] h-[500px] w-[500px] rounded-full blur-[130px]"
        style={{ background: "rgba(139,92,246,0.16)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-40 bottom-[-10%] z-[1] h-[400px] w-[400px] rounded-full blur-[130px]"
        style={{ background: "rgba(34,211,238,0.10)" }}
      />

      {hasClerk ? (
        <AdminGate next={safeNext} />
      ) : (
        <div style={{ position: "relative", zIndex: 2, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Autenticación no disponible</h1>
          <p style={{ color: "var(--color-text-dim)", marginTop: 8, fontFamily: "var(--font-mono)", fontSize: ".85rem" }}>
            Las claves de Clerk no están configuradas.
          </p>
        </div>
      )}
    </div>
  )
}