"use client"

import { useUser } from "@clerk/nextjs"
import { Mail, Shield, ExternalLink } from "lucide-react"

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

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!user) return null

  const primaryEmail = user.primaryEmailAddress
  const otherEmails = user.emailAddresses.filter(e => e.id !== primaryEmail?.id)
  const connectedAccounts = user.externalAccounts

  const initials = (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-text">Mi cuenta</h1>
        <p className="mt-1 text-sm text-muted">Información de tu perfil y cuentas conectadas.</p>
      </div>

      <div className="rounded-xl border border-border bg-bg2 p-6">
        <div className="flex items-center gap-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.fullName ?? ""}
              className="h-14 w-14 rounded-full border-2 border-accent/20 object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 font-display text-lg font-bold text-accent">
              {initials || "?"}
            </div>
          )}
          <div>
            <p className="text-base font-semibold text-text">{user.fullName}</p>
            <p className="text-sm text-muted">{primaryEmail?.emailAddress}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg2">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Mail className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Email addresses</h2>
        </div>
        <div className="divide-y divide-border">
          {user.emailAddresses.map(email => (
            <div key={email.id} className="flex items-center justify-between px-6 py-3">
              <span className="text-sm text-text">{email.emailAddress}</span>
              <div className="flex items-center gap-2">
                {email.id === primaryEmail?.id && (
                  <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
                    Primary
                  </span>
                )}
                {email.verification.status === "verified" ? (
                  <span className="text-[11px] text-emerald-400">✓ Verified</span>
                ) : (
                  <span className="text-[11px] text-amber-400">Unverified</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {connectedAccounts.length > 0 && (
        <div className="rounded-xl border border-border bg-bg2">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <ExternalLink className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text">Connected accounts</h2>
          </div>
          <div className="divide-y divide-border">
            {connectedAccounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text">{providers[acc.provider] ?? acc.provider}</span>
                  {acc.emailAddress && (
                    <span className="text-sm text-muted">• {acc.emailAddress}</span>
                  )}
                </div>
                <span className="text-[11px] text-emerald-400">✓ Connected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg2">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Shield className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Security</h2>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-muted">
            To change your password or configure two-factor authentication, visit the Clerk security page.
          </p>
        </div>
      </div>
    </div>
  )
}
