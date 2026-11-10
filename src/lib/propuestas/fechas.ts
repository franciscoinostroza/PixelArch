/**
 * T-02 (AC-5; RF-5): convencion de fechas del portal.
 *
 * La base guarda UTC. La UI del portal muestra es-AR: las fechas sin hora se
 * formatean en UTC para no correr el dia; las marcas de tiempo se convierten a
 * la zona de Argentina.
 */
const FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

const FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
})

export function formatearFechaPortal(fecha: Date): string {
  return FECHA.format(fecha)
}

export function formatearFechaHoraPortal(fecha: Date): string {
  return FECHA_HORA.format(fecha)
}
