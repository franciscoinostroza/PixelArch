"use client"

import { useState, useRef, useEffect } from "react"
import { useUser, useClerk } from "@clerk/nextjs"
import { X, Mail, ExternalLink, LogOut, ChevronRight, Plus, Trash2, Star, Camera } from "lucide-react"

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
}

interface Props { isOpen: boolean; onClose: () => void }

function Pill({ dot, color, bg, children }: { dot: string; color: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color, background: bg, letterSpacing: "0.01em" }}
    >
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
      {children}
    </span>
  )
}

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 16,
  background: "linear-gradient(170deg, rgba(17,14,26,0.85), rgba(17,14,26,0.6))",
  backdropFilter: "blur(10px)",
}

const divider = "1px solid rgba(255,255,255,0.06)"
const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "#f6f5f8",
}
const ghostBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.6)",
}

export function AccountModal({ isOpen, onClose }: Props) {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const [editingName, setEditingName] = useState(false)
  const [firstName, setFirstName] = useState(user?.firstName ?? "")
  const [lastName, setLastName] = useState(user?.lastName ?? "")
  const [addingEmail, setAddingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const prev = document.activeElement as HTMLElement | null
    const modal = document.getElementById("account-modal-dialog")
    const focusable = modal?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable?.[0]
    const last = focusable?.[focusable.length - 1]
    first?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return }
      if (e.key !== "Tab" || !focusable?.length) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      prev?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null
  if (!isLoaded || !user) return null

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"
  const primaryEmail = user.primaryEmailAddress

  async function saveName() { if (!user) return; setSaving(true); setError(""); try { await user.update({ firstName: firstName.trim(), lastName: lastName.trim() }); setEditingName(false) } catch { setError("Error al guardar") }; setSaving(false) }
  async function addEmail() { if (!user || !newEmail.trim()) return; setSaving(true); setError(""); try { await user.createEmailAddress({ email: newEmail.trim() }); setNewEmail(""); setAddingEmail(false) } catch { setError("Error al agregar email") }; setSaving(false) }
  async function removeEmail(id: string) { if (!user) return; setSaving(true); setError(""); try { const e = user.emailAddresses.find(x => x.id === id); if (e) await e.destroy() } catch { setError("Error al eliminar email") }; setSaving(false) }
  async function setPrimary(id: string) { if (!user) return; setSaving(true); setError(""); try { await user.update({ primaryEmailAddressId: id }) } catch { setError("Error al cambiar primary") }; setSaving(false) }
  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) { if (!user) return; const f = e.target.files?.[0]; if (!f) return; setSaving(true); setError(""); try { await user.setProfileImage({ file: f }) } catch { setError("Error al actualizar avatar") }; setSaving(false) }

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: "rgba(7,6,12,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        id="account-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex max-h-[85vh] w-full max-w-lg min-h-0 flex-col overflow-y-auto rounded-[18px]"
        style={{
          background: "linear-gradient(170deg, rgba(23,19,33,0.97), rgba(17,14,26,0.93))",
          border: "1px solid rgba(139,92,246,0.14)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.06)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4" style={{ background: "rgba(17,14,26,0.9)", borderColor: "rgba(255,255,255,0.06)" }}>
          <h1 id="account-modal-title" className="font-display text-lg font-bold" style={{ color: "#f6f5f8" }}>Mi cuenta</h1>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={{ color: "rgba(255,255,255,0.5)" }}>
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-lg px-4 py-2 text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4 p-6">
          {/* Avatar + name */}
          <div className="flex items-center gap-4 pb-4" style={{ borderBottom: divider }}>
            <div className="relative shrink-0">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="" onClick={() => fileRef.current?.click()} className="h-14 w-14 cursor-pointer rounded-full border-2 object-cover transition-opacity hover:opacity-80" style={{ borderColor: "rgba(139,92,246,0.35)" }} />
              ) : (
                <div onClick={() => fileRef.current?.click()} className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full font-display text-lg font-bold transition-opacity hover:opacity-80" style={{ background: "rgba(139,92,246,0.2)", color: "#8b5cf6" }}>
                  {initials}
                </div>
              )}
              <div onClick={() => fileRef.current?.click()} className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full" style={{ background: "#8b5cf6", color: "#fff" }}>
                <Camera size={12} />
              </div>
            </div>
            {editingName ? (
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex gap-2">
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nombre" className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors focus:border-violet" style={inputStyle} />
                  <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Apellido" className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors focus:border-violet" style={inputStyle} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveName} disabled={saving} className="rounded-lg px-3 py-1 text-xs font-semibold text-white transition-opacity disabled:opacity-50" style={{ background: "linear-gradient(90deg,#8b5cf6,#22d3ee)", color: "#07060c" }}>{saving ? "Guardando..." : "Guardar"}</button>
                  <button onClick={() => setEditingName(false)} className="rounded-lg px-3 py-1 text-xs font-medium transition-colors hover:bg-white/10" style={ghostBtn}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold" style={{ color: "#f6f5f8" }}>{user.fullName}</p>
                <p className="truncate text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{primaryEmail?.emailAddress}</p>
              </div>
            )}
          </div>

          {!editingName && (
            <button onClick={() => { setFirstName(user.firstName ?? ""); setLastName(user.lastName ?? ""); setEditingName(true) }} className="group flex w-fit items-center gap-2 border-none bg-transparent px-0 py-1 text-sm transition-colors" style={{ color: "rgba(255,255,255,0.6)" }}>
              <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              <span className="transition-colors group-hover:text-violet">Editar perfil</span>
            </button>
          )}

          {/* Emails */}
          <div className="overflow-hidden" style={panelStyle}>
            <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <Mail size={16} style={{ color: "#8b5cf6" }} />
              <h2 className="text-sm font-semibold" style={{ color: "#f6f5f8" }}>Emails</h2>
            </div>
            <div>
              {user.emailAddresses.map((email, i) => (
                <div key={email.id} className="flex items-center justify-between px-6 py-3" style={{ borderBottom: i < user.emailAddresses.length - 1 ? divider : undefined }}>
                  <span className="truncate text-sm" style={{ color: "#f6f5f8" }}>{email.emailAddress}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {email.id === primaryEmail?.id && (
                      <Pill dot="#8b5cf6" color="#b6a0ff" bg="rgba(139,92,246,0.12)">Primaria</Pill>
                    )}
                    {email.id !== primaryEmail?.id && (
                      <>
                        <button onClick={() => setPrimary(email.id)} className="transition-colors hover:brightness-150" style={{ color: "rgba(255,255,255,0.4)", background: "transparent", border: "none", cursor: "pointer" }} title="Hacer principal"><Star size={14} /></button>
                        <button onClick={() => removeEmail(email.id)} className="transition-colors hover:text-red-400" style={{ color: "rgba(255,255,255,0.4)", background: "transparent", border: "none", cursor: "pointer" }} title="Eliminar"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {addingEmail ? (
                <div className="flex items-center gap-2 px-6 py-3">
                  <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="nuevo@email.com" className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors focus:border-violet" style={inputStyle} />
                  <button onClick={addEmail} disabled={saving || !newEmail.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50" style={{ background: "linear-gradient(90deg,#8b5cf6,#22d3ee)", color: "#07060c" }}>{saving ? "..." : "Agregar"}</button>
                  <button onClick={() => { setAddingEmail(false); setNewEmail("") }} className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10" style={ghostBtn}>Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setAddingEmail(true)} className="flex w-full items-center gap-2 px-6 py-3 text-sm transition-colors hover:brightness-150" style={{ color: "rgba(255,255,255,0.5)", background: "transparent", border: "none", cursor: "pointer", borderTop: divider }}>
                  <Plus size={14} />
                  Agregar email
                </button>
              )}
            </div>
          </div>

          {/* Connected accounts */}
          {user.externalAccounts.length > 0 && (
            <div className="overflow-hidden" style={panelStyle}>
              <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <ExternalLink size={16} style={{ color: "#8b5cf6" }} />
                <h2 className="text-sm font-semibold" style={{ color: "#f6f5f8" }}>Cuentas conectadas</h2>
              </div>
              {user.externalAccounts.map((acc, i) => (
                <div key={acc.id} className="flex items-center px-6 py-3" style={{ borderBottom: i < user.externalAccounts.length - 1 ? divider : undefined }}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm" style={{ color: "#f6f5f8" }}>{providers[acc.provider] ?? acc.provider}</span>
                    {acc.emailAddress && <span className="truncate text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>• {acc.emailAddress}</span>}
                  </div>
                  <span className="ml-auto shrink-0 pl-3">
                    <Pill dot="#34d399" color="#34d399" bg="rgba(52,211,153,0.12)">Conectada</Pill>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Sign out */}
          <button onClick={() => signOut({ redirectUrl: "/" })} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:brightness-125" style={{ border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer" }}>
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}