"use client"

import { useEffect, useState } from "react"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClerkComponents = { UserButton: any } | null

export function PortalUserButton() {
  const [ClerkComponents, setClerkComponents] = useState<ClerkComponents>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return
    import("@clerk/nextjs")
      .then((mod) => setClerkComponents({ UserButton: mod.UserButton }))
      .catch(() => setError(true))
  }, [])

  if (error || !ClerkComponents) {
    return <div className="h-8 w-8 rounded-full bg-bg border border-border" />
  }

  const { UserButton } = ClerkComponents

  return <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/portal/cuenta" />
}
