interface EstadoUI {
  label: string
  pill: string
  dot: string
}

const ESTADOS: Record<string, EstadoUI> = {
  ACTIVE: { label: "Activo", pill: "bg-mint/10 text-mint", dot: "bg-mint" },
  SUCCEEDED: { label: "Pagado", pill: "bg-mint/10 text-mint", dot: "bg-mint" },
  PAST_DUE: { label: "Vencido", pill: "bg-red-500/10 text-red-400", dot: "bg-red-400" },
  FAILED: { label: "Fallido", pill: "bg-red-500/10 text-red-400", dot: "bg-red-400" },
  PENDING: { label: "Pendiente", pill: "bg-yellow-500/10 text-yellow-400", dot: "bg-yellow-400" },
  READY: { label: "Entregado", pill: "bg-violet/10 text-violet", dot: "bg-violet" },
  TRIALING: { label: "Prueba", pill: "bg-violet/10 text-violet", dot: "bg-violet" },
  CANCELED: { label: "Cancelado", pill: "bg-white/5 text-text-dim", dot: "bg-text-faint" },
  PAUSED: { label: "Pausado", pill: "bg-white/5 text-text-dim", dot: "bg-text-faint" },
  REFUNDED: { label: "Reembolsado", pill: "bg-white/5 text-text-dim", dot: "bg-text-faint" },
  INACTIVE: { label: "Inactivo", pill: "bg-white/5 text-text-dim", dot: "bg-text-faint" },
}

export function estadoUI(estado: string): EstadoUI {
  return ESTADOS[estado] ?? { label: estado, pill: "bg-white/5 text-text-dim", dot: "bg-text-faint" }
}
