import { cn } from "@/lib/utils"

interface SectionLabelProps {
  children: React.ReactNode
  className?: string
}

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border border-accent/20 bg-accent/5 px-4 py-1 text-xs font-mono font-medium tracking-wider text-accent uppercase",
        className
      )}
    >
      {children}
    </span>
  )
}
