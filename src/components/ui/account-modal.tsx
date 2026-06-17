"use client"

import { useState, useRef } from "react"
import { useUser, useClerk } from "@clerk/nextjs"
import { X, Mail, ExternalLink, Shield, LogOut, ChevronDown, ChevronRight, Plus, Trash2, Star, Camera } from "lucide-react"

const cardBg = "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)"
const border = "1px solid rgba(127,90,240,0.12)"
const divider = "1px solid rgba(127,90,240,0.08)"

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-6 py-4" style={{ borderBottom: divider }}>
      <span className="text-[#7f5af0]">{icon}</span>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
    </div>
  )
}

interface AccountModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const { user, isLoaded } = useUser()
  const { signOut, openUserProfile } = useClerk()

  const [editingName, setEditingName] = useState(false)
  const [firstName, setFirstName] = useState(user?.firstName ?? "")
  const [lastName, setLastName] = useState(user?.lastName ?? "")

  const [addingEmail, setAddingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")

  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null
  if (!isLoaded || !user) return null

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"
  const primaryEmail = user.primaryEmailAddress
  const otherEmails = user.emailAddresses.filter(e => e.id !== primaryEmail?.id)
  const accounts = user.externalAccounts

  async function saveName() {
    setSaving(true)
    setError("")
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() })
      setEditingName(false)
    } catch {
      setError("Error al guardar")
    }
    setSaving(false)
  }

  async function addEmail() {
    if (!newEmail.trim()) return
    setSaving(true)
    setError("")
    try {
      await user.createEmailAddress({ email: newEmail.trim() })
      setNewEmail("")
      setAddingEmail(false)
    } catch {
      setError("Error al agregar email")
    }
    setSaving(false)
  }

  async function removeEmail(emailId: string) {
    setSaving(true)
    setError("")
    try {
      const email = user.emailAddresses.find(e => e.id === emailId)
      if (email) await email.destroy()
    } catch {
      setError("Error al eliminar email")
    }
    setSaving(false)
  }

  async function setPrimary(emailId: string) {
    setSaving(true)
    setError("")
    try {
      await user.update({ primaryEmailAddressId: emailId })
    } catch {
      setError("Error al cambiar primary")
    }
    setSaving(false)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    setError("")
    try {
      await user.setProfileImage({ file })
    } catch {
      setError("Error al actualizar avatar")
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto"
        style={{ background: cardBg, border, borderRadius: "16px", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: cardBg, borderBottom: divider }}>
          <h1 className="font-display text-lg font-bold text-white">Mi cuenta</h1>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-1 p-6">
          {/* Avatar + nombre */}
          <div className="flex items-center gap-4 pb-4" style={{ borderBottom: divider }}>
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              {user.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={user.fullName ?? ""}
                  className="h-14 w-14 cursor-pointer rounded-full border-2 border-[rgba(127,90,240,0.25)] object-cover transition-opacity hover:opacity-80"
                  onClick={() => fileInputRef.current?.click()}
                />
              ) : (
                <div
                  className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-[rgba(127,90,240,0.2)] font-display text-lg font-bold text-[#7f5af0] transition-opacity hover:opacity-80"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {initials}
                </div>
              )}
              <div
                className="absolute bottom-0 right-0 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#7f5af0] text-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="h-3 w-3" />
              </div>
            </div>
            {editingName ? (
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="Nombre"
                    className="flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#7f5af0]"
                  />
                  <input
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="Apellido"
                    className="flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#7f5af0]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveName}
                    disabled={saving}
                    className="rounded-lg bg-[#7f5af0] px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="rounded-lg bg-white/5 px-3 py-1 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1">
                <p className="text-base font-semibold text-white">{user.fullName}</p>
                <p className="text-sm text-white/70">{primaryEmail?.emailAddress}</p>
              </div>
            )}
          </div>

          {/* Editar nombre */}
          {!editingName && (
            <button
              onClick={() => { setFirstName(user.firstName ?? ""); setLastName(user.lastName ?? ""); setEditingName(true) }}
              className="group flex w-full items-center gap-2 px-0 py-2 text-sm text-white/50 transition-colors hover:text-white"
            >
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              Editar perfil
            </button>
          )}

          {/* Email addresses */}
          <div style={{ borderRadius: "12px", border, background: cardBg }} className="mt-4">
            <SectionHeader icon={<Mail className="h-4 w-4" />} title="Email addresses" />
            <div>
              {[primaryEmail, ...otherEmails].filter(Boolean).map((email, i) => (
                <div
                  key={email!.id}
                  className="flex items-center justify-between px-6 py-3"
                  style={i < user.emailAddresses.length - 1 ? { borderBottom: divider } : undefined}
                >
                  <span className="text-sm text-white">{email!.emailAddress}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {email!.id === primaryEmail?.id && (
                      <span className="rounded-full bg-[rgba(127,90,240,0.15)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f5af0]">
                        Primary
                      </span>
                    )}
                    {email!.id !== primaryEmail?.id && (
                      <button
                        onClick={() => setPrimary(email!.id)}
                        className="text-white/40 transition-colors hover:text-[#7f5af0]"
                        title="Set as primary"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {email!.id !== primaryEmail?.id && (
                      <button
                        onClick={() => removeEmail(email!.id)}
                        className="text-white/40 transition-colors hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {addingEmail ? (
                <div className="flex items-center gap-2 px-6 py-3">
                  <input
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="nuevo@email.com"
                    className="flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#7f5af0]"
                  />
                  <button
                    onClick={addEmail}
                    disabled={saving || !newEmail.trim()}
                    className="rounded-lg bg-[#7f5af0] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "..." : "Add"}
                  </button>
                  <button
                    onClick={() => { setAddingEmail(false); setNewEmail("") }}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingEmail(true)}
                  className="flex w-full items-center gap-2 px-6 py-3 text-sm text-white/50 transition-colors hover:text-white"
                  style={{ borderTop: divider }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add email address
                </button>
              )}
            </div>
          </div>

          {/* Connected accounts */}
          {accounts.length > 0 && (
            <div style={{ borderRadius: "12px", border, background: cardBg }} className="mt-4">
              <SectionHeader icon={<ExternalLink className="h-4 w-4" />} title="Connected accounts" />
              <div>
                {accounts.map((acc, i) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between px-6 py-3"
                    style={i < accounts.length - 1 ? { borderBottom: divider } : undefined}
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

          {/* Seguridad */}
          <button
            onClick={() => openUserProfile({ routing: "modal" })}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm text-white/60 transition-colors hover:text-white"
            style={{ borderRadius: "12px", border, background: cardBg }}
          >
            <Shield className="h-4 w-4 text-[#7f5af0]" />
            Seguridad (contraseña, MFA)
          </button>

          {/* Cerrar sesion */}
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm font-medium text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.15)]"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  )
}
