/**
 * T-13 (AC-14; RF-16): tabla de prospectos de una campaña.
 *
 * Server component de solo lectura. Muestra solo datos del portal (nunca del
 * CRM). "Ver ficha", "Analizar" y "Descartar" quedan deshabilitados hasta
 * T-14/T-15, para no enlazar a una ruta que todavía no existe. La tabla tiene
 * `caption` y encabezados con `scope` para lectores de pantalla.
 */

export interface ProspectoFila {
  id: string
  nombreNegocio: string
  sitioWeb: string | null
  ciudad: string | null
  estado: string
  posibleDuplicadoDeId: string | null
  score: number | null
}

interface CampanaTablaProps {
  prospectos: ProspectoFila[]
}

const CLASE_CELDA = "px-4 py-3 align-top text-text-dim"
const CLASE_ENCABEZADO =
  "whitespace-nowrap px-4 py-3 text-left font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_PLACEHOLDER =
  "rounded border border-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-text-faint"

export function CampanaTabla({ prospectos }: CampanaTablaProps) {
  if (prospectos.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-panel p-6 text-sm leading-6 text-text-dim">
        La corrida todavía no creó prospectos. Ejecutá la búsqueda cuando la
        campaña esté en borrador; los resultados se van a listar acá.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">
          Prospectos creados por la campaña
        </caption>
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Negocio
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Sitio
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Ciudad
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Estado
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Posible duplicado
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Score
            </th>
            <th scope="col" className={CLASE_ENCABEZADO}>
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {prospectos.map((prospecto) => (
            <tr
              key={prospecto.id}
              className="border-b border-border/60 last:border-0"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left align-top font-medium text-text"
              >
                {prospecto.nombreNegocio}
              </th>
              <td className={CLASE_CELDA}>
                {prospecto.sitioWeb ? (
                  <a
                    href={prospecto.sitioWeb}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
                  >
                    {prospecto.sitioWeb}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className={CLASE_CELDA}>{prospecto.ciudad ?? "—"}</td>
              <td className={CLASE_CELDA}>
                <span className="font-mono text-xs text-text">
                  {prospecto.estado}
                </span>
              </td>
              <td className={CLASE_CELDA}>
                {prospecto.posibleDuplicadoDeId ? (
                  <span
                    className="font-mono text-xs text-amber-300"
                    title={`Referencia interna: ${prospecto.posibleDuplicadoDeId}`}
                  >
                    Sí
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className={CLASE_CELDA}>
                {prospecto.score === null ? "—" : prospecto.score}
              </td>
              <td className={CLASE_CELDA}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* T-15 implementa la ficha del prospecto. */}
                  <button
                    type="button"
                    disabled
                    title="Disponible en T-15"
                    className={CLASE_PLACEHOLDER}
                  >
                    Ver ficha
                  </button>
                  {/* Placeholders: la logica de T-14/T-15 no se implementa aca. */}
                  <button
                    type="button"
                    disabled
                    title="Disponible en T-15"
                    className={CLASE_PLACEHOLDER}
                  >
                    Analizar
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Disponible en T-14"
                    className={CLASE_PLACEHOLDER}
                  >
                    Descartar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
