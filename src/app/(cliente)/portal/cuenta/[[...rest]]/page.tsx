"use client"

import { useUser, useClerk } from "@clerk/nextjs"
import { Mail, ExternalLink, LogOut } from "lucide-react"

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-text">Mi cuenta</h1>
        <p className="mt-1 text-sm text-text-dim">Información y configuración de tu perfil.</p>
      </div>

      <div className="rounded-xl border border-border bg-panel p-6">
        <div className="flex items-center gap-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.fullName ?? ""}
              className="h-14 w-14 rounded-full border-2 border-violet/25 object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet/20 font-display text-lg font-bold text-violet">
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-base font-semibold text-text">{user.fullName}</p>
            <p className="text-sm text-text-dim">{primaryEmail?.emailAddress}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border/40 px-6 py-4">
          <Mail className="h-4 w-4 text-violet" />
          <h2 className="text-sm font-semibold text-text">Email addresses</h2>
        </div>
        <div>
          {user.emailAddresses.map((email, i) => (
            <div
              key={email.id}
              className={`flex items-center justify-between px-6 py-3 ${i < user.emailAddresses.length - 1 ? "border-b border-border/40" : ""}`}
            >
              <span className="text-sm text-text">{email.emailAddress}</span>
              <div className="flex items-center gap-2 shrink-0">
                {email.id === primaryEmail?.id && (
                  <span className="rounded-full bg-violet/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-violet">
                    Primary
                  </span>
                )}
                <span className="text-[11px] text-mint font-medium">Verified</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="rounded-xl border border-border bg-panel">
          <div className="flex items-center gap-2 border-b border-border/40 px-6 py-4">
            <ExternalLink className="h-4 w-4 text-violet" />
            <h2 className="text-sm font-semibold text-text">Connected accounts</h2>
          </div>
          <div>
            {accounts.map((acc, i) => (
              <div
                key={acc.id}
                className={`flex items-center justify-between px-6 py-3 ${i < accounts.length - 1 ? "border-b border-border/40" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-text">{providers[acc.provider] ?? acc.provider}</span>
                  {acc.emailAddress && (
                    <span className="text-sm text-text-dim">• {acc.emailAddress}</span>
                  )}
                </div>
                <span className="text-[11px] text-mint font-medium">Connected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => signOut({ redirectUrl: "/" })}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
      >
        <LogOut className="h-4 w-4" />
        Cerrar sesion
      </button>
    </div>
  )
}
