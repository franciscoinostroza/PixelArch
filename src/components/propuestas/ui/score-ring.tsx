import { cn } from "@/lib/utils"

export interface ScoreRingProps {
  /** Puntaje de 0 a 100; fuera de rango se recorta. */
  score: number
  /** Diametro en px. Default 64. */
  size?: number
  className?: string
}

/**
 * Anillo de score accesible. El SVG expone `role="img"` y un nombre claro
 * ("Score X de 100"); el valor visible queda dentro del propio SVG.
 */
export function ScoreRing({ score, size = 64, className }: ScoreRingProps) {
  const puntaje = Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0
  const lado = Math.max(32, Math.round(size))
  const grosor = Math.max(3, Math.round(lado * 0.07))
  const radio = (lado - grosor) / 2
  const circunferencia = 2 * Math.PI * radio
  const progreso = (puntaje / 100) * circunferencia
  const tono =
    puntaje >= 80
      ? "p-score-ring--mint"
      : puntaje >= 50
        ? "p-score-ring--amber"
        : "p-score-ring--red"

  return (
    <svg
      width={lado}
      height={lado}
      viewBox={`0 0 ${lado} ${lado}`}
      role="img"
      aria-label={`Score ${puntaje} de 100`}
      className={cn("p-score-ring", tono, className)}
    >
      <circle
        className="p-score-ring-track"
        cx={lado / 2}
        cy={lado / 2}
        r={radio}
        fill="none"
        strokeWidth={grosor}
      />
      <circle
        className="p-score-ring-value"
        cx={lado / 2}
        cy={lado / 2}
        r={radio}
        fill="none"
        strokeWidth={grosor}
        strokeLinecap="round"
        strokeDasharray={`${progreso} ${circunferencia - progreso}`}
        transform={`rotate(-90 ${lado / 2} ${lado / 2})`}
      />
      <text
        className="p-score-ring-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        style={{ fontSize: Math.max(11, Math.round(lado * 0.28)) }}
      >
        {puntaje}
      </text>
    </svg>
  )
}
