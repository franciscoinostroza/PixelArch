"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useUser } from "@clerk/nextjs"
import { AccountModal } from "@/components/ui/account-modal"

export function AdminUserButton() {
  const { user, isLoaded } = useUser()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!isLoaded || !user) return null

  const nombre =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.primaryEmailAddress?.emailAddress ||
    "Mi cuenta"
  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="a-user-btn" aria-label="Abrir mi cuenta">
        <span className="a-user-avatar" aria-hidden="true">
          {user.imageUrl ? <img src={user.imageUrl} alt="" /> : initials}
        </span>
        <span className="a-user-name">{nombre}</span>
        <span className="a-user-caret" aria-hidden="true">›</span>
      </button>

      {open && mounted && createPortal(
        <AccountModal isOpen={open} onClose={() => setOpen(false)} />,
        document.body
      )}

      <style>{`
        .a-user-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.02);
          color: var(--color-text);
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          text-align: left;
        }
        .a-user-btn:hover { border-color: rgba(139,92,246,0.45); background: rgba(139,92,246,0.08) }
        .a-user-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          overflow: hidden;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139,92,246,0.2);
          color: #b9a6ff;
          font-size: 0.7rem;
          font-weight: 700;
        }
        .a-user-avatar img { width: 100%; height: 100%; object-fit: cover }
        .a-user-name {
          font-size: 0.82rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .a-user-caret { color: var(--color-text-faint); font-size: 1rem }
      `}</style>
    </>
  )
}