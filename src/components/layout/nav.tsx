"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useUser } from "@clerk/nextjs"

const links = [
  { href: "/#resenas", label: "Reseñas" },
  { href: "/#productos", label: "Productos" },
  { href: "/#proceso", label: "Proceso" },
  { href: "/#nosotros", label: "Nosotros" },
  { href: "/#contacto", label: "Contacto" },
]

const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

function AdminNavLink() {
  const { user } = useUser()
  const role = (user?.publicMetadata as { role?: string } | undefined)?.role
  if (role !== "admin") return null

  return (
    <Link
      href="/admin/dashboard"
      className="text-sm text-text-dim transition-colors hover:text-text"
      style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
    >
      Admin
    </Link>
  )
}

function ClerkAuthSection() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ClerkComponents, setClerkComponents] = useState<any>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!hasClerkKey) return
    import("@clerk/nextjs")
      .then((mod) => {
        setClerkComponents({
          Show: mod.Show,
          SignInButton: mod.SignInButton,
          UserButton: mod.UserButton,
        })
      })
      .catch(() => setError(true))
  }, [])

  if (!hasClerkKey || error || !ClerkComponents) return null

  const Show = ClerkComponents.Show
  const SignInButton = ClerkComponents.SignInButton
  const UserButton = ClerkComponents.UserButton

  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <span
            className="text-sm text-text-dim transition-colors hover:text-text"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500, cursor: "pointer" }}
          >
            Ingresar
          </span>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-4">
          <Link
            href="/portal"
            className="text-sm text-text-dim transition-colors hover:text-text"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Portal
          </Link>
          <AdminNavLink />
          <UserButton />
        </div>
      </Show>
    </>
  )
}

export function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className="site-header"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: scrolled ? "14px 0" : "20px 0",
        background: scrolled ? "rgba(7,6,12,0.75)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
        transition: "background 0.35s cubic-bezier(.19,1,.22,1), border-color 0.35s cubic-bezier(.19,1,.22,1), padding 0.35s cubic-bezier(.19,1,.22,1)",
      }}
    >
      <div
        className="mx-auto flex items-center"
        style={{
          maxWidth: "var(--maxw, 1180px)",
          paddingInline: "clamp(20px, 5vw, 56px)",
          gap: "36px",
        }}
      >
        <Link href="/#inicio" className="logo">
          <svg className="logo-mark" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#logoGrad)"/>
            <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#logoGrad)" opacity=".5"/>
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8b5cf6"/>
                <stop offset="1" stopColor="#22d3ee"/>
              </linearGradient>
            </defs>
          </svg>
          <span className="logo-text">
            Pixel<span className="logo-arch">Arch</span>
            <span className="logo-scan" aria-hidden="true" />
          </span>
        </Link>

        <nav className="main-nav">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
              <span className="nav-underline" aria-hidden="true" />
            </Link>
          ))}
        </nav>

        <div className="clerk-section">
          <ClerkAuthSection />
        </div>

        <a href="#contacto" className="btn btn-primary btn-sm hablemos-btn">Hablemos</a>

        <button
          className="nav-toggle"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Cerrar menu" : "Abrir menu"}
          aria-expanded={open}
        >
          <span className={cn(open && "rotated-1")} />
          <span className={cn(open && "hidden")} />
          <span className={cn(open && "rotated-2")} />
        </button>
      </div>

      {open && (
        <div className="mobile-menu">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="mobile-menu-auth">
            <ClerkAuthSection />
          </div>
        </div>
      )}
    </header>
  )
}
