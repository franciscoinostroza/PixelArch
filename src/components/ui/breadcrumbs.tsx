import Link from "next/link"
import { ChevronRight } from "lucide-react"

interface BreadcrumbItem {
  name: string
  href?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.href ? { item: `${process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"}${item.href}` } : {}),
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-1.5 text-sm font-mono text-muted">
          {items.map((item, i) => {
            const isLast = i === items.length - 1
            return (
              <li key={item.href || item.name} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={12} className="text-border" />}
                {isLast || !item.href ? (
                  <span className={isLast ? "text-text" : ""}>{item.name}</span>
                ) : (
                  <Link href={item.href} className="hover:text-accent transition-colors">
                    {item.name}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}
