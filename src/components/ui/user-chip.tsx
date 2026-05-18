"use client"

import { useEffect, useState } from "react"

interface UserChipProps {
  nombre?: string
}

export function UserChip({ nombre }: UserChipProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [UserButtonComp, setUserButtonComp] = useState<any>(null)

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return
    import("@clerk/nextjs").then((mod) => {
      setUserButtonComp(mod.UserButton)
    }).catch(() => {})
  }, [])

  const iniciales = nombre
    ? nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "??"

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 rounded-full border border-border/20 bg-card-bg px-3 py-1">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent/20 font-display text-[11px] font-bold text-accent">
          {iniciales}
        </div>
        <span className="text-xs text-text">{nombre ?? "Usuario"}</span>
      </div>
      {UserButtonComp ? <UserButtonComp afterSignOutUrl="/" /> : null}
    </div>
  )
}
