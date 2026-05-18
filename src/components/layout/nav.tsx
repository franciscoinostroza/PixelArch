"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const links = [
  { href: "/", label: "Inicio" },
  { href: "/servicios", label: "Servicios" },
  { href: "/#contacto", label: "Contacto" },
]

const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

function AdminNavLink() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const typedWindow = window as unknown as {
      Clerk?: { user?: { publicMetadata?: { role?: string } } }
    }
    const check = setInterval(() => {
      const role = typedWindow.Clerk?.user?.publicMetadata?.role
      if (role === "admin") {
        setIsAdmin(true)
        clearInterval(check)
      }
    }, 500)
    return () => clearInterval(check)
  }, [])

  if (!isAdmin) return null

  return (
    <Link
      href="/admin/dashboard"
      className="text-sm font-mono text-accent transition-colors hover:text-[#a78bfa]"
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

  if (!hasClerkKey || error || !ClerkComponents) {
    return (
      <Button variant="ghost" size="sm" disabled>
        Ingresar
      </Button>
    )
  }

  const { Show, SignInButton, UserButton } = ClerkComponents

  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button variant="ghost" size="sm">
            Ingresar
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-3">
          <Link
            href="/portal"
            className="text-sm font-mono text-muted transition-colors hover:text-text"
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

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-xl font-bold text-text">
          PixelArch
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "text-sm font-mono text-muted transition-colors hover:text-text",
                pathname === l.href && "text-text"
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <ClerkAuthSection />
        </div>

        <button
          className="text-muted md:hidden"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-bg px-6 pb-6 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2 text-sm font-mono text-muted hover:text-text"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-3 border-t border-border pt-3">
            <ClerkAuthSection />
          </div>
        </div>
      )}
    </nav>
  )
}
