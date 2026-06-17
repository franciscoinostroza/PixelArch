"use client"

import { useState } from "react"
import { useUser } from "@clerk/nextjs"
import { AccountModal } from "@/components/ui/account-modal"

export function PortalUserButton() {
  const { user, isLoaded } = useUser()
  const [open, setOpen] = useState(false)

  if (!isLoaded || !user) {
    return <div className="h-8 w-8 rounded-full bg-bg border border-border" />
  }

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-8 w-8 overflow-hidden rounded-full border-2 border-[rgba(127,90,240,0.2)] transition-colors hover:border-[#7f5af0]"
      >
        {user.imageUrl ? (
          <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[rgba(127,90,240,0.2)] text-xs font-bold text-[#7f5af0]">
            {initials}
          </div>
        )}
      </button>
      <AccountModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
