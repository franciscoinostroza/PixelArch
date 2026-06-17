"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const links = [
  { href: "/portal", label: "Mis servicios" },
  { href: "/portal/cuenta", label: "Cuenta" },
  { href: "/portal/facturacion", label: "Facturacion" },
]

export function PortalNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-6 text-sm font-mono">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "transition-colors",
            pathname === href
              ? "text-text font-medium"
              : "text-muted hover:text-text"
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
