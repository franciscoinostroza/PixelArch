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
    <nav className="p-nav">
      {links.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(active && "on")}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
