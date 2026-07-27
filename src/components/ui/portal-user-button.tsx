"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useUser } from "@clerk/nextjs"
import { AccountModal } from "@/components/ui/account-modal"

export function PortalUserButton() {
  const { user, isLoaded } = useUser()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!isLoaded || !user) {
    return <div className="h-8 w-8 rounded-full bg-bg border border-border" />
  }

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir mi cuenta"
        className="h-8 w-8 overflow-hidden rounded-full border-2 border-[rgba(139,92,246,0.2)] transition-colors hover:border-[#8b5cf6]"
      >
        {user.imageUrl ? (
          <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[rgba(139,92,246,0.2)] text-xs font-bold text-[#8b5cf6]">
            {initials}
          </div>
        )}
      </button>
      {open && mounted && createPortal(
        <AccountModal isOpen={open} onClose={() => setOpen(false)} />,
        document.body
      )}
    </>
  )
}
