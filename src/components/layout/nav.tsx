"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Show, SignInButton, UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Menu, X } from "lucide-react"

const links = [
  { href: "/", label: "Inicio" },
  { href: "/servicios", label: "Servicios" },
  { href: "/#contacto", label: "Contacto" },
]

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
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Ingresar
              </Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton
              appearance={{
                elements: {
                  userButtonBox: "border border-border rounded-full",
                },
              }}
            />
          </Show>
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
            <Show when="signed-in">
              <UserButton
                appearance={{
                  elements: {
                    userButtonBox: "border border-border rounded-full",
                  },
                }}
              />
            </Show>
          </div>
        </div>
      )}
    </nav>
  )
}
