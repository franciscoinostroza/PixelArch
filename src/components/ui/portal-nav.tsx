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
    <nav className="flex items-center gap-7">
      {links.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("nav-auth-link", active && "text-violet hover:text-violet")}
          >
            {label}
            <span
              className="nav-underline"
              aria-hidden="true"
              style={active ? { right: 0 } : undefined}
            />
          </Link>
        )
      })}
    </nav>
  )
}
