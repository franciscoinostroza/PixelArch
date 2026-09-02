import Link from "next/link"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function Pagination({
  currentPage,
  totalPages,
  buildHref,
}: {
  currentPage: number
  totalPages: number
  buildHref: (page: number) => string
}) {
  if (totalPages <= 1) return null

  return (
    <div className="mt-6 flex items-center justify-center gap-4">
      <Link
        href={buildHref(currentPage - 1)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage <= 1 && "pointer-events-none opacity-40")}
        aria-disabled={currentPage <= 1}
      >
        <ChevronLeft size={14} /> Anterior
      </Link>
      <span className="font-mono text-xs text-text-dim">
        Página {currentPage} de {totalPages}
      </span>
      <Link
        href={buildHref(currentPage + 1)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), currentPage >= totalPages && "pointer-events-none opacity-40")}
        aria-disabled={currentPage >= totalPages}
      >
        Siguiente <ChevronRight size={14} />
      </Link>
    </div>
  )
}
