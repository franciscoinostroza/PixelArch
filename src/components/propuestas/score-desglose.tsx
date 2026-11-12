/**
 * T-15 (AC-21; RF-33): desglose accesible del score v1 del prospecto.
 *
 * Server component de solo lectura. Recibe el total persistido y el JSON
 * `scoreDetalle`; renderiza componentes, puntos/maximo y motivos. Si el JSON no
 * tiene la forma esperada no inventa datos: muestra solo lo que existe y avisa
 * que no hay desglose disponible.
 */

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
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"

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
    <section
      aria-label="Score del prospecto y motivos"
      className="rounded-xl border border-border bg-panel p-5"
    >
      <h2 className="font-display text-xl font-semibold text-text">
        Score y motivos
      </h2>

      {total === null ? (
        <p role="status" className="mt-3 text-sm leading-6 text-text-dim">
          Todavía no hay un score calculado para este prospecto. Se calcula al
          analizar la web y queda explicado por componentes.
        </p>
      ) : (
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className={CLASE_DEFINICION}>Total</span>
          <strong className="font-display text-3xl font-semibold text-text">
            {total}
          </strong>
          <span className="font-mono text-xs text-text-faint">/ 100</span>
        </p>
      )}

      {componentes.length === 0 ? (
        total === null ? null : (
          <p className="mt-3 text-sm leading-6 text-text-dim">
            No hay desglose disponible para este score.
          </p>
        )
      ) : (
        <ul className="mt-5 space-y-4">
          {componentes.map((componente) => (
            <li
              key={componente.clave}
              className="rounded-lg border border-border bg-bg/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-text">
                  {componente.etiqueta}
                </h3>
                <span className="font-mono text-xs text-text-dim">
                  {componente.puntos}/{componente.maximo} puntos
                </span>
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
                <p className="mt-2 text-sm leading-6 text-text-faint">
                  Sin motivos registrados para este componente.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
