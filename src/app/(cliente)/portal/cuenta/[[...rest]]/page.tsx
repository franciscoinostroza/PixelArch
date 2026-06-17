"use client"

import { useUser } from "@clerk/nextjs"
import { Mail, Shield, ExternalLink } from "lucide-react"

const cardStyle = {
  background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
  border: "1px solid rgba(127,90,240,0.12)",
  borderRadius: "16px",
} as const

const sectionBorder = {
  borderBottom: "1px solid rgba(127,90,240,0.08)",
} as const

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
  const connectedAccounts = user.externalAccounts

  const initials = (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#f1f5f9]">Mi cuenta</h1>
        <p className="mt-1 text-sm text-[#94a3b8]">Información de tu perfil y cuentas conectadas.</p>
      </div>

      <div style={cardStyle} className="p-6">
        <div className="flex items-center gap-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.fullName ?? ""}
              className="h-14 w-14 rounded-full border-2 border-[rgba(127,90,240,0.2)] object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(127,90,240,0.2)] font-display text-lg font-bold text-[#7f5af0]">
              {initials || "?"}
            </div>
          )}
          <div>
            <p className="text-base font-semibold text-[#f1f5f9]">{user.fullName}</p>
            <p className="text-sm text-[#cbd5e1]">{primaryEmail?.emailAddress}</p>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionBorder} className="flex items-center gap-2 px-6 py-4">
          <Mail className="h-4 w-4 text-[#7f5af0]" />
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Email addresses</h2>
        </div>
        <div>
          {user.emailAddresses.map((email, i) => (
            <div
              key={email.id}
              style={i < user.emailAddresses.length - 1 ? sectionBorder : undefined}
              className="flex items-center justify-between px-6 py-3"
            >
              <span className="text-sm text-[#e2e8f0]">{email.emailAddress}</span>
              <div className="flex items-center gap-2">
                {email.id === primaryEmail?.id && (
                  <span className="rounded-full bg-[rgba(127,90,240,0.15)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f5af0]">
                    Primary
                  </span>
                )}
                {email.verification.status === "verified" ? (
                  <span className="text-[11px] text-[#34d399]">✓ Verified</span>
                ) : (
                  <span className="text-[11px] text-[#f59e0b]">Unverified</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {connectedAccounts.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionBorder} className="flex items-center gap-2 px-6 py-4">
            <ExternalLink className="h-4 w-4 text-[#7f5af0]" />
            <h2 className="text-sm font-semibold text-[#f1f5f9]">Connected accounts</h2>
          </div>
          <div>
            {connectedAccounts.map((acc, i) => (
              <div
                key={acc.id}
                style={i < connectedAccounts.length - 1 ? sectionBorder : undefined}
                className="flex items-center justify-between px-6 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#e2e8f0]">{providers[acc.provider] ?? acc.provider}</span>
                  {acc.emailAddress && (
                    <span className="text-sm text-[#cbd5e1]">• {acc.emailAddress}</span>
                  )}
                </div>
                <span className="text-[11px] text-[#34d399]">✓ Connected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={sectionBorder} className="flex items-center gap-2 px-6 py-4">
          <Shield className="h-4 w-4 text-[#7f5af0]" />
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Security</h2>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-[#cbd5e1]">
            To change your password or configure two-factor authentication, visit the Clerk security page.
          </p>
        </div>
      </div>
    </div>
  )
}
