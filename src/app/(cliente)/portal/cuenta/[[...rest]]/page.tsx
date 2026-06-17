"use client"

import { useUser, useClerk } from "@clerk/nextjs"
import { Mail, ExternalLink, LogOut, Settings } from "lucide-react"

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
}

const cardBg = "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)"

export default function CuentaPage() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!user) return null

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase()
  const primaryEmail = user.primaryEmailAddress
  const accounts = user.externalAccounts

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-white">Mi cuenta</h1>
        <p className="mt-1 text-sm text-white/60">Información y configuración de tu perfil.</p>
      </div>

      {/* Avatar + nombre + email */}
      <div
        style={{ background: cardBg, border: "1px solid rgba(127,90,240,0.12)", borderRadius: "16px" }}
        className="p-6"
      >
        <div className="flex items-center gap-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.fullName ?? ""}
              className="h-14 w-14 rounded-full border-2 border-[rgba(127,90,240,0.25)] object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(127,90,240,0.2)] font-display text-lg font-bold text-[#7f5af0]">
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">{user.fullName}</p>
            <p className="text-sm text-white/70">{primaryEmail?.emailAddress}</p>
          </div>
        </div>
      </div>

      {/* Email addresses */}
      <div
        style={{ background: cardBg, border: "1px solid rgba(127,90,240,0.12)", borderRadius: "16px" }}
      >
        <div className="flex items-center gap-2 border-b border-[rgba(127,90,240,0.08)] px-6 py-4">
          <Mail className="h-4 w-4 text-[#7f5af0]" />
          <h2 className="text-sm font-semibold text-white">Email addresses</h2>
        </div>
        <div>
          {user.emailAddresses.map((email, i) => (
            <div
              key={email.id}
              className="flex items-center justify-between px-6 py-3"
              style={i < user.emailAddresses.length - 1 ? { borderBottom: "1px solid rgba(127,90,240,0.08)" } : undefined}
            >
              <span className="text-sm text-white">{email.emailAddress}</span>
              <div className="flex items-center gap-2 shrink-0">
                {email.id === primaryEmail?.id && (
                  <span className="rounded-full bg-[rgba(127,90,240,0.15)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f5af0]">
                    Primary
                  </span>
                )}
                <span className="text-[11px] text-[#34d399] font-medium">Verified</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connected accounts */}
      {accounts.length > 0 && (
        <div
          style={{ background: cardBg, border: "1px solid rgba(127,90,240,0.12)", borderRadius: "16px" }}
        >
          <div className="flex items-center gap-2 border-b border-[rgba(127,90,240,0.08)] px-6 py-4">
            <ExternalLink className="h-4 w-4 text-[#7f5af0]" />
            <h2 className="text-sm font-semibold text-white">Connected accounts</h2>
          </div>
          <div>
            {accounts.map((acc, i) => (
              <div
                key={acc.id}
                className="flex items-center justify-between px-6 py-3"
                style={i < accounts.length - 1 ? { borderBottom: "1px solid rgba(127,90,240,0.08)" } : undefined}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white">{providers[acc.provider] ?? acc.provider}</span>
                  {acc.emailAddress && (
                    <span className="text-sm text-white/60">• {acc.emailAddress}</span>
                  )}
                </div>
                <span className="text-[11px] text-[#34d399] font-medium">Connected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boton para editar en Clerk */}
      <button
        onClick={() => signOut({ redirectUrl: "/" })}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm font-medium text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.15)]"
      >
        <LogOut className="h-4 w-4" />
        Cerrar sesion
      </button>
    </div>
  )
}
