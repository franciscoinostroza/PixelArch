/**
 * T-15 (AC-21; RF-33): desglose accesible del score v1 del prospecto.
 *
 * Server component de solo lectura. Recibe el total persistido y el JSON
 * `scoreDetalle`; renderiza componentes, puntos/maximo y motivos. Si el JSON no
 * tiene la forma esperada no inventa datos: muestra solo lo que existe y avisa
 * que no hay desglose disponible.
 */

import { Panel } from "@/components/propuestas/ui/panel"

interface ScoreDesgloseProps {
  score: number | null
  detalle: unknown
}

interface ComponenteVista {
  clave: string
  etiqueta: string
  puntos: number
  maximo: number
  motivos: string[]
}

const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-dim"

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function numeroDe(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null
  return Math.max(0, Math.round(valor))
}

function componentesDe(detalle: unknown): ComponenteVista[] {
  if (!esObjeto(detalle) || !Array.isArray(detalle.componentes)) return []

  const salida: ComponenteVista[] = []
  const clavesVistas = new Set<string>()

  for (const item of detalle.componentes) {
    if (!esObjeto(item)) continue

    const clave = typeof item.clave === "string" ? item.clave : null
    const etiqueta = typeof item.etiqueta === "string" ? item.etiqueta : null
    const puntos = numeroDe(item.puntos)
    const maximo = numeroDe(item.maximo)

    if (clave === null || etiqueta === null || puntos === null || maximo === null) {
      continue
    }

    // Defensa contra un JSON manipulado: una clave repetida no rompe la key de
    // React y no se descarta el resto del desglose.
    const claveUnica = clavesVistas.has(clave)
      ? `${clave}-${salida.length}`
      : clave
    clavesVistas.add(clave)

    const motivos = Array.isArray(item.motivos)
      ? item.motivos.filter(
          (motivo): motivo is string =>
            typeof motivo === "string" && motivo.trim().length > 0,
        )
      : []

    salida.push({ clave: claveUnica, etiqueta, puntos, maximo, motivos })
  }

  return salida
}

function totalDe(score: number | null, detalle: unknown): number | null {
  if (typeof score === "number" && Number.isFinite(score)) {
    return Math.max(0, Math.min(100, Math.round(score)))
  }
  if (esObjeto(detalle)) {
    return numeroDe(detalle.total)
  }
  return null
}

export function ScoreDesglose({ score, detalle }: ScoreDesgloseProps) {
  const total = totalDe(score, detalle)
  const componentes = componentesDe(detalle)

  return (
    <Panel
      aria-label="Score del prospecto y motivos"
      title="Score y motivos"
    >
      {total === null ? (
        <p role="status" className="text-sm leading-6 text-text-dim">
          Todavía no hay un score calculado para este prospecto. Se calcula al
          analizar la web y queda explicado por componentes.
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-2">
          <span className={CLASE_DEFINICION}>Total</span>
          <strong className="font-display text-3xl font-semibold text-text">
            {total}
          </strong>
          <span className="font-mono text-xs text-text-dim">/ 100</span>
        </p>
      )}

      {componentes.length === 0 ? (
        total === null ? null : (
          <p className="mt-3 text-sm leading-6 text-text-dim">
            No hay desglose disponible para este score.
          </p>
        )
      ) : (
        <ul className="p-score-list">
          {componentes.map((componente) => {
            const porcentaje =
              componente.maximo > 0
                ? Math.min(
                    100,
                    Math.round((componente.puntos / componente.maximo) * 100),
                  )
                : 0
            // Defensa contra un JSON manipulado: un progressbar con
            // valuenow > valuemax (o valuemax 0) es invalido.
            const ariaMax = Math.max(1, componente.maximo)
            const ariaNow = Math.min(
              Math.max(0, componente.puntos),
              componente.maximo,
            )

            return (
              <li key={componente.clave} className="p-score-item">
                <div className="p-score-head">
                  <h3 className="text-sm font-medium text-text">
                    {componente.etiqueta}
                  </h3>
                  <span className="p-score-points">
                    {componente.puntos}/{componente.maximo} puntos
                  </span>
                </div>

                <div
                  className="p-progress"
                  role="progressbar"
                  aria-label={`${componente.etiqueta}: ${componente.puntos} de ${componente.maximo} puntos`}
                  aria-valuemin={0}
                  aria-valuemax={ariaMax}
                  aria-valuenow={ariaNow}
                >
                  <div
                    className="p-progress-fill"
                    style={{ width: `${porcentaje}%` }}
                  />
                </div>

                {componente.motivos.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text-dim">
                    {componente.motivos.map((motivo, indice) => (
                      <li key={`${componente.clave}-motivo-${indice}`}>
                        {motivo}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-text-dim">
                    Sin motivos registrados para este componente.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
