"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const links = [
  { href: "/portal", label: "Mis servicios" },
  { href: "/portal/facturacion", label: "Facturación" },
]

export function PortalNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-6 font-display text-sm font-medium">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "transition-colors",
            pathname === href
              ? "text-violet"
              : "text-text-dim hover:text-text"
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
