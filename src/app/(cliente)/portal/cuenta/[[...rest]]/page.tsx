"use client"

import { useUser, useClerk } from "@clerk/nextjs"
import { Mail, ExternalLink, LogOut } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
}

function Pill({ dot, color, bg, children }: { dot: string; color: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color, background: bg, letterSpacing: "0.01em" }}
    >
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
      {children}
    </span>
  )
}

export default function CuentaPage() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet border-t-transparent" />
      </div>
    )
  }

  if (!user) return null

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase()
  const primaryEmail = user.primaryEmailAddress
  const accounts = user.externalAccounts

  const panelStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    background: "linear-gradient(170deg, rgba(17,14,26,0.85), rgba(17,14,26,0.6))",
    backdropFilter: "blur(10px)",
  }
  const divider = "1px solid rgba(255,255,255,0.06)"

  return (
    <div className="space-y-5">
      <PageHeader title="Mi cuenta" subtitle="Información y configuración de tu perfil." />

      <div className="p-5" style={panelStyle}>
        <div className="flex items-center gap-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.fullName ?? ""}
              className="h-14 w-14 rounded-full border-2 object-cover"
              style={{ borderColor: "rgba(139,92,246,0.35)" }}
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full font-display text-lg font-bold" style={{ background: "rgba(139,92,246,0.2)", color: "#8b5cf6" }}>
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-base font-semibold" style={{ color: "#f6f5f8" }}>{user.fullName}</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{primaryEmail?.emailAddress}</p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden" style={panelStyle}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <Mail className="h-4 w-4" style={{ color: "#8b5cf6" }} />
          <h2 className="text-sm font-semibold" style={{ color: "#f6f5f8" }}>Emails</h2>
        </div>
        <div>
          {user.emailAddresses.map((email, i) => (
            <div
              key={email.id}
              className="flex items-center justify-between px-6 py-3"
              style={{ borderBottom: i < user.emailAddresses.length - 1 ? divider : undefined }}
            >
              <span className="text-sm" style={{ color: "#f6f5f8" }}>{email.emailAddress}</span>
              <div className="flex items-center gap-3 shrink-0">
                {email.id === primaryEmail?.id && (
                  <Pill dot="#8b5cf6" color="#b6a0ff" bg="rgba(139,92,246,0.12)">Primaria</Pill>
                )}
                <Pill dot="#34d399" color="#34d399" bg="rgba(52,211,153,0.12)">Verificada</Pill>
              </div>
            </div>
          ))}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="overflow-hidden" style={panelStyle}>
          <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <ExternalLink className="h-4 w-4" style={{ color: "#8b5cf6" }} />
            <h2 className="text-sm font-semibold" style={{ color: "#f6f5f8" }}>Cuentas conectadas</h2>
          </div>
          <div>
            {accounts.map((acc, i) => (
              <div
                key={acc.id}
                className="flex items-center justify-between px-6 py-3"
                style={{ borderBottom: i < accounts.length - 1 ? divider : undefined }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm" style={{ color: "#f6f5f8" }}>{providers[acc.provider] ?? acc.provider}</span>
                  {acc.emailAddress && <span className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>• {acc.emailAddress}</span>}
                </div>
                <Pill dot="#34d399" color="#34d399" bg="rgba(52,211,153,0.12)">Conectada</Pill>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => signOut({ redirectUrl: "/" })}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:brightness-125"
        style={{ border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer" }}
      >
        <LogOut className="h-4 w-4" />
        Cerrar sesión
      </button>
    </div>
  )
}