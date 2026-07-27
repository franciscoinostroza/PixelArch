import { cn } from "@/lib/utils"

interface SectionLabelProps {
  children: React.ReactNode
  className?: string
}

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border border-violet/20 bg-violet/5 px-4 py-1 text-xs font-mono font-medium tracking-wider text-violet uppercase",
        className
      )}
    >
      {children}
    </span>
  )
}
