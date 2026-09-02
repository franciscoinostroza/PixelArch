import { cn } from "@/lib/utils"
import { estadoUI } from "@/lib/estados"

export function StatusPill({ estado, label, pulse }: { estado: string; label?: string; pulse?: boolean }) {
  const ui = estadoUI(estado)
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]", ui.pill)}>
      <span className={cn("h-[5px] w-[5px] rounded-full", ui.dot, pulse && "animate-pulse")} />
      {label ?? ui.label}
    </span>
  )
}
