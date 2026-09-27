export interface CheckUptime {
  servicio: string
  ok: boolean
  statusCode: number | null
  latenciaMs: number
}

export type AccionAlerta =
  | { tipo: "caida"; servicio: string; statusCode: number | null; latenciaMs: number }
  | { tipo: "recuperacion"; servicio: string }

/**
 * Decide alertas por transicion de estado (anti-spam).
 * Recibe el historial por servicio ordenado del mas reciente al mas viejo,
 * incluyendo el chequeo actual ya guardado.
 *
 * Reglas:
 * - Caida: los ultimos 2 chequeos fallaron y el anterior no estaba fallado
 *   (o no existe). Si ya estaba caido, no se repite la alerta.
 * - Recuperacion: el chequeo actual esta ok y los 2 anteriores fallaron.
 */
export function decidirAlertas(historiales: CheckUptime[][]): AccionAlerta[] {
  const acciones: AccionAlerta[] = []

  for (const checks of historiales) {
    if (checks.length < 2) continue

    const [actual, anterior, previo] = checks

    if (!actual.ok && !anterior.ok) {
      const yaEstabaCaido = previo ? !previo.ok : false
      if (!yaEstabaCaido) {
        acciones.push({
          tipo: "caida",
          servicio: actual.servicio,
          statusCode: actual.statusCode,
          latenciaMs: actual.latenciaMs,
        })
      }
    } else if (actual.ok && !anterior.ok && previo && !previo.ok) {
      acciones.push({ tipo: "recuperacion", servicio: actual.servicio })
    }
  }

  return acciones
}
