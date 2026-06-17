"use client"

import { useState, useRef } from "react"
import { useUser, useClerk } from "@clerk/nextjs"
import { X, Mail, ExternalLink, Shield, LogOut, ChevronRight, Plus, Trash2, Star, Camera } from "lucide-react"

const s = {
  cardBg: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
  border: "1px solid rgba(127,90,240,0.12)",
  divider: "1px solid rgba(127,90,240,0.08)",
  white: "#ffffff",
  white70: "rgba(255,255,255,0.7)",
  white60: "rgba(255,255,255,0.6)",
  white50: "rgba(255,255,255,0.5)",
  white40: "rgba(255,255,255,0.4)",
  accent: "#7f5af0",
  green: "#34d399",
  red: "#ef4444",
}

const providers: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function AccountModal({ isOpen, onClose }: Props) {
  const { user, isLoaded } = useUser()
  const { signOut, openUserProfile } = useClerk()

  const [editingName, setEditingName] = useState(false)
  const [firstName, setFirstName] = useState(user?.firstName ?? "")
  const [lastName, setLastName] = useState(user?.lastName ?? "")
  const [addingEmail, setAddingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null
  if (!isLoaded || !user) return null

  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"
  const primaryEmail = user.primaryEmailAddress

  async function saveName() { if (!user) return; setSaving(true); setError(""); try { await user.update({ firstName: firstName.trim(), lastName: lastName.trim() }); setEditingName(false) } catch { setError("Error al guardar") }; setSaving(false) }
  async function addEmail() { if (!user || !newEmail.trim()) return; setSaving(true); setError(""); try { await user.createEmailAddress({ email: newEmail.trim() }); setNewEmail(""); setAddingEmail(false) } catch { setError("Error al agregar email") }; setSaving(false) }
  async function removeEmail(id: string) { if (!user) return; setSaving(true); setError(""); try { const e = user.emailAddresses.find(x => x.id === id); if (e) await e.destroy() } catch { setError("Error al eliminar email") }; setSaving(false) }
  async function setPrimary(id: string) { if (!user) return; setSaving(true); setError(""); try { await user.update({ primaryEmailAddressId: id }) } catch { setError("Error al cambiar primary") }; setSaving(false) }
  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) { if (!user) return; const f = e.target.files?.[0]; if (!f) return; setSaving(true); setError(""); try { await user.setProfileImage({ file: f }) } catch { setError("Error al actualizar avatar") }; setSaving(false) }

  const T = (color: string) => ({ color }) as const
  const Td = (color: string, display?: string) => ({ color, display } as const)
  const Bg = (bg: string) => ({ background: bg } as const)

  return (
    <div style={{ ...Bg("rgba(0,0,0,0.6)"), backdropFilter: "blur(4px)", position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ ...Bg(s.cardBg), border: s.border, borderRadius: "16px", boxShadow: "0 25px 60px rgba(0,0,0,0.5)", position: "relative", maxHeight: "85vh", width: "100%", maxWidth: "28rem", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ ...Bg(s.cardBg), borderBottom: s.divider, position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem" }}>
          <h1 style={{ ...T(s.white), fontWeight: 700, fontSize: "1.125rem" }}>Mi cuenta</h1>
          <button onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "2rem", height: "2rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", ...Bg("transparent"), ...T(s.white50), transition: "all 0.15s" }}>
            <X size={16} />
          </button>
        </div>

        {error && <div style={{ margin: "1rem 1.5rem 0", padding: "0.5rem 1rem", borderRadius: "0.5rem", ...Bg("rgba(239,68,68,0.1)"), ...T("rgb(248 113 113)"), fontSize: "0.875rem" }}>{error}</div>}

        <div style={{ padding: "1.5rem" }}>
          {/* Avatar + name */}
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingBottom: "1rem", borderBottom: s.divider }}>
            <div style={{ position: "relative" }}>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatar} />
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="" onClick={() => fileRef.current?.click()} style={{ width: "3.5rem", height: "3.5rem", borderRadius: "9999px", border: "2px solid rgba(127,90,240,0.25)", objectFit: "cover", cursor: "pointer" }} />
              ) : (
                <div onClick={() => fileRef.current?.click()} style={{ width: "3.5rem", height: "3.5rem", borderRadius: "9999px", ...Bg("rgba(127,90,240,0.2)"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", ...T(s.accent), fontWeight: 700, fontSize: "1.125rem" }}>{initials}</div>
              )}
              <div onClick={() => fileRef.current?.click()} style={{ position: "absolute", bottom: 0, right: 0, width: "1.25rem", height: "1.25rem", borderRadius: "9999px", ...Bg(s.accent), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", ...T(s.white) }}>
                <Camera size={12} />
              </div>
            </div>
            {editingName ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nombre" style={{ flex: 1, padding: "0.375rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(255,255,255,0.1)", ...Bg("rgba(255,255,255,0.04)"), ...T(s.white), fontSize: "0.875rem", outline: "none" }} />
                  <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Apellido" style={{ flex: 1, padding: "0.375rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(255,255,255,0.1)", ...Bg("rgba(255,255,255,0.04)"), ...T(s.white), fontSize: "0.875rem", outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={saveName} disabled={saving} style={{ padding: "0.25rem 0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", ...Bg(s.accent), ...T(s.white), fontSize: "0.75rem", fontWeight: 500, opacity: saving ? 0.5 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
                  <button onClick={() => setEditingName(false)} style={{ padding: "0.25rem 0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", ...Bg("rgba(255,255,255,0.05)"), ...T(s.white60), fontSize: "0.75rem", fontWeight: 500 }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                <p style={{ ...T(s.white), fontWeight: 600, fontSize: "1rem" }}>{user.fullName}</p>
                <p style={{ ...T(s.white70), fontSize: "0.875rem" }}>{primaryEmail?.emailAddress}</p>
              </div>
            )}
          </div>

          {!editingName && (
            <button onClick={() => { setFirstName(user.firstName ?? ""); setLastName(user.lastName ?? ""); setEditingName(true) }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0", border: "none", cursor: "pointer", ...Bg("transparent"), ...T(s.white50), fontSize: "0.875rem", transition: "color 0.15s" }}>
              <ChevronRight size={14} />
              Editar perfil
            </button>
          )}

          {/* Emails */}
          <div style={{ marginTop: "1rem", borderRadius: "12px", border: s.border, ...Bg(s.cardBg) }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem 1.5rem", borderBottom: s.divider }}>
              <Mail size={16} style={{ ...T(s.accent) }} />
              <h2 style={{ ...T(s.white), fontWeight: 600, fontSize: "0.875rem" }}>Email addresses</h2>
            </div>
            <div>
              {user.emailAddresses.map((email, i) => (
                <div key={email.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.5rem", borderBottom: i < user.emailAddresses.length - 1 ? s.divider : undefined }}>
                  <span style={{ ...T(s.white), fontSize: "0.875rem" }}>{email.emailAddress}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                    {email.id === primaryEmail?.id && (
                      <span style={{ ...T(s.accent), ...Bg("rgba(127,90,240,0.15)"), padding: "0.125rem 0.625rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Primary</span>
                    )}
                    {email.id !== primaryEmail?.id && (
                      <>
                        <button onClick={() => setPrimary(email.id)} style={{ border: "none", cursor: "pointer", ...Bg("transparent"), ...T(s.white40), fontSize: "0.875rem" }} title="Set as primary"><Star size={14} /></button>
                        <button onClick={() => removeEmail(email.id)} style={{ border: "none", cursor: "pointer", ...Bg("transparent"), ...T(s.white40), fontSize: "0.875rem" }} title="Remove"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {addingEmail ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.5rem" }}>
                  <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="nuevo@email.com" style={{ flex: 1, padding: "0.375rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(255,255,255,0.1)", ...Bg("rgba(255,255,255,0.04)"), ...T(s.white), fontSize: "0.875rem", outline: "none" }} />
                  <button onClick={addEmail} disabled={saving || !newEmail.trim()} style={{ padding: "0.375rem 0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", ...Bg(s.accent), ...T(s.white), fontSize: "0.75rem", fontWeight: 500, opacity: saving || !newEmail.trim() ? 0.5 : 1 }}>{saving ? "..." : "Add"}</button>
                  <button onClick={() => { setAddingEmail(false); setNewEmail("") }} style={{ padding: "0.375rem 0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", ...Bg("rgba(255,255,255,0.05)"), ...T(s.white60), fontSize: "0.75rem", fontWeight: 500 }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingEmail(true)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.75rem 1.5rem", border: "none", cursor: "pointer", ...Bg("transparent"), ...T(s.white50), fontSize: "0.875rem", borderTop: s.divider }}>
                  <Plus size={14} />
                  Add email address
                </button>
              )}
            </div>
          </div>

          {/* Connected accounts */}
          {user.externalAccounts.length > 0 && (
            <div style={{ marginTop: "1rem", borderRadius: "12px", border: s.border, ...Bg(s.cardBg) }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem 1.5rem", borderBottom: s.divider }}>
                <ExternalLink size={16} style={{ ...T(s.accent) }} />
                <h2 style={{ ...T(s.white), fontWeight: 600, fontSize: "0.875rem" }}>Connected accounts</h2>
              </div>
              {user.externalAccounts.map((acc, i) => (
                <div key={acc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.5rem", borderBottom: i < user.externalAccounts.length - 1 ? s.divider : undefined }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                    <span style={{ ...T(s.white), fontSize: "0.875rem" }}>{providers[acc.provider] ?? acc.provider}</span>
                    {acc.emailAddress && <span style={{ ...T(s.white60), fontSize: "0.875rem" }}>• {acc.emailAddress}</span>}
                  </div>
                  <span style={{ ...T(s.green), fontSize: "0.6875rem", fontWeight: 500, flexShrink: 0 }}>Connected</span>
                </div>
              ))}
            </div>
          )}

          {/* Security */}
          <button onClick={() => openUserProfile()} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.75rem 1rem", marginTop: "1rem", borderRadius: "12px", border: s.border, ...Bg(s.cardBg), cursor: "pointer", ...T(s.white60), fontSize: "0.875rem", transition: "color 0.15s" }}>
            <Shield size={16} style={{ ...T(s.accent) }} />
            Seguridad (contraseña, MFA)
          </button>

          {/* Sign out */}
          <button onClick={() => signOut({ redirectUrl: "/" })} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", width: "100%", padding: "0.75rem 1rem", marginTop: "1rem", borderRadius: "12px", border: "1px solid rgba(239,68,68,0.2)", ...Bg("rgba(239,68,68,0.08)"), cursor: "pointer", ...T(s.red), fontWeight: 500, fontSize: "0.875rem" }}>
            <LogOut size={16} />
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  )
}
