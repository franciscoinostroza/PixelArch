/**
 * Helpers puros de presentacion de `EnlacePago` (T-21/T-22).
 *
 * Las paginas del CRM (detalle del cliente y `/admin/cobros`) necesitan dos
 * cosas distintas a partir de los links PayPal de un cobro:
 *
 * - el link **vigente** que el modal reutiliza para copiar/enviar (AC-2, AC-26);
 * - el **ultimo intento no vigente** (fallido, vencido o invalidado) para
 *   mostrar por que no hay link y ofrecer regenerarlo (AC-15).
 *
 * Se resuelve en un unico lugar para que ambas pantallas no dupliquen la regla.
 * No toca base de datos ni red y no expone PII: solo estado, montos, fechas y
 * el motivo sanitizado que ya guarda el `EnlacePago`.
 */

export type PaypalIdiomaVista = "es" | "en"

export type EstadoIntentoPaypal = "FALLIDO" | "VENCIDO" | "INVALIDADO"

/**
 * Configuracion server-side que reciben el bloque de proyecto y el boton de
 * soporte. Se arma en un unico lugar para que detalle y cobros no dupliquen
 * el mapeo desde `paypalConfig()`.
 */
export interface PaypalBlockConfig {
  disponible: boolean
  feeBps: number
  feeFixedCents: number
}

/** Subconjunto de `paypalConfig()` que necesita la UI. */
export interface PaypalConfigVista {
  disponible: boolean
  fee: { bps: number; fixedCents: number }
}

export function paypalBlockDesdeConfig(config: PaypalConfigVista): PaypalBlockConfig {
  return {
    disponible: config.disponible,
    feeBps: config.fee.bps,
    feeFixedCents: config.fee.fixedCents,
  }
}

/**
 * Regla unica de elegibilidad de un soporte para cobrar por PayPal: plan
 * SOPORTE y estado ACTIVE o PAST_DUE. No depende de `proximoPago`: el detalle
 * del cliente ofrece PayPal aunque el soporte no entre en la ventana de 7 dias
 * de `/admin/cobros`.
 */
export function esSoportePaypalElegible(soporte: {
  plan: string | null
  estado: string
}): boolean {
  return (
    soporte.plan === "SOPORTE" &&
    (soporte.estado === "ACTIVE" || soporte.estado === "PAST_DUE")
  )
}

export const ESTADO_INTENTO_PAYPAL_LABEL: Record<EstadoIntentoPaypal, string> = {
  FALLIDO: "Fallido",
  VENCIDO: "Vencido",
  INVALIDADO: "Invalidado",
}

/** Subconjunto de `EnlacePago` que consumen las vistas server-side. */
export interface EnlacePaypalVista {
  id: string
  url: string | null
  total: number
  montoAcordado: number
  comision: number
  expiraEn: Date | string
  estado: string
  meses?: number | null
  idioma?: string | null
  creadoEn?: Date | string | null
  ultimoError?: string | null
  motivoInvalido?: string | null
}

/** Link vigente listo para la prop `enlaceExistente` del modal. */
export interface EnlaceExistenteVista {
  enlaceId: string
  url: string
  total: number
  expiraEn: string
  montoAcordado: number
  comision: number
  meses: number | null
  idioma: PaypalIdiomaVista | null
  reutilizado: boolean
}

/** Ultimo intento no vigente listo para la prop `ultimoIntento` del modal. */
export interface UltimoIntentoVista {
  enlaceId: string
  estado: EstadoIntentoPaypal
  montoAcordado: number | null
  comision: number | null
  total: number | null
  expiraEn: string | null
  creadoEn: string | null
  meses: number | null
  idioma: PaypalIdiomaVista | null
  motivo: string | null
}

export interface DatosPaypalEnlaces {
  enlaceExistente: EnlaceExistenteVista | null
  ultimoIntento: UltimoIntentoVista | null
  /** Texto compacto para la fila del CRM; `null` si no hay nada que mostrar. */
  resumen: string | null
}

function aMilisegundos(
  valor: Date | string | null | undefined
): number | null {
  if (valor === null || valor === undefined) return null
  const fecha = valor instanceof Date ? valor : new Date(valor)
  const ms = fecha.getTime()
  return Number.isFinite(ms) ? ms : null
}

function aIso(valor: Date | string | null | undefined): string | null {
  const ms = aMilisegundos(valor)
  return ms === null ? null : new Date(ms).toISOString()
}

function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const texto = valor.trim()
  return texto.length > 0 ? texto : null
}

function idiomaOpcional(
  valor: string | null | undefined
): PaypalIdiomaVista | null {
  return valor === "es" || valor === "en" ? valor : null
}

function mesesOpcionales(valor: number | null | undefined): number | null {
  return typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 1 &&
    valor <= 12
    ? valor
    : null
}

function esLinkVigente(
  enlace: EnlacePaypalVista,
  ahoraMs: number
): boolean {
  if (enlace.estado !== "ACTIVO") return false
  if (!textoOpcional(enlace.url)) return false
  if (!Number.isSafeInteger(enlace.total) || enlace.total <= 0) return false
  const expira = aMilisegundos(enlace.expiraEn)
  return expira !== null && expira > ahoraMs
}

function ordenarMasReciente(
  enlaces: readonly EnlacePaypalVista[]
): EnlacePaypalVista[] {
  return [...enlaces].sort((a, b) => {
    const fechaA = aMilisegundos(a.creadoEn ?? a.expiraEn) ?? 0
    const fechaB = aMilisegundos(b.creadoEn ?? b.expiraEn) ?? 0
    return fechaB - fechaA
  })
}

/** Fecha corta es-AR; vacia si el valor no es una fecha valida. */
export function formatearFechaEnlace(
  valor: Date | string | null | undefined,
  conAnio = false
): string {
  const ms = aMilisegundos(valor)
  if (ms === null) return ""

  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    ...(conAnio ? { year: "numeric" as const } : {}),
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(ms))
}

export function estadoIntentoLabel(estado: EstadoIntentoPaypal): string {
  return ESTADO_INTENTO_PAYPAL_LABEL[estado]
}

/**
 * Link PayPal ACTIVO y no vencido mas reciente. Si hay varios, gana el ultimo
 * creado; los vencidos se ignoran (su vencimiento es perezoso, la API los marca
 * VENCIDO al leerlos).
 */
export function enlacePaypalVigente(
  enlaces: readonly EnlacePaypalVista[] | null | undefined,
  ahora: Date = new Date()
): EnlaceExistenteVista | null {
  const ahoraMs = aMilisegundos(ahora)
  if (ahoraMs === null || !enlaces || enlaces.length === 0) return null

  const vigente = ordenarMasReciente(enlaces).find((enlace) =>
    esLinkVigente(enlace, ahoraMs)
  )
  if (!vigente) return null

  const url = textoOpcional(vigente.url)
  if (!url) return null

  return {
    enlaceId: vigente.id,
    url,
    total: vigente.total,
    expiraEn: new Date(
      aMilisegundos(vigente.expiraEn) ?? ahoraMs
    ).toISOString(),
    montoAcordado: vigente.montoAcordado,
    comision: vigente.comision,
    meses: mesesOpcionales(vigente.meses),
    idioma: idiomaOpcional(vigente.idioma),
    reutilizado: true,
  }
}

/**
 * Ultimo link PayPal que no esta vigente y que explica por que hay que
 * regenerar: FALLIDO, VENCIDO, INVALIDADO o un ACTIVO cuyo `expiraEn` ya paso.
 * Se excluyen PAGADO y CREANDO; un link vigente no se reporta como intento.
 */
export function ultimoIntentoPaypal(
  enlaces: readonly EnlacePaypalVista[] | null | undefined,
  ahora: Date = new Date()
): UltimoIntentoVista | null {
  const ahoraMs = aMilisegundos(ahora)
  if (ahoraMs === null || !enlaces || enlaces.length === 0) return null

  for (const enlace of ordenarMasReciente(enlaces)) {
    let estado: EstadoIntentoPaypal | null = null

    if (enlace.estado === "FALLIDO") estado = "FALLIDO"
    else if (enlace.estado === "INVALIDADO") estado = "INVALIDADO"
    else if (enlace.estado === "VENCIDO") estado = "VENCIDO"
    else if (enlace.estado === "ACTIVO" && !esLinkVigente(enlace, ahoraMs)) {
      estado = "VENCIDO"
    }

    if (!estado) continue

    return {
      enlaceId: enlace.id,
      estado,
      montoAcordado: Number.isSafeInteger(enlace.montoAcordado)
        ? enlace.montoAcordado
        : null,
      comision: Number.isSafeInteger(enlace.comision)
        ? enlace.comision
        : null,
      total: Number.isSafeInteger(enlace.total) ? enlace.total : null,
      expiraEn: aIso(enlace.expiraEn),
      creadoEn: aIso(enlace.creadoEn ?? enlace.expiraEn),
      meses: mesesOpcionales(enlace.meses),
      idioma: idiomaOpcional(enlace.idioma),
      motivo:
        estado === "FALLIDO"
          ? textoOpcional(enlace.ultimoError)
          : estado === "INVALIDADO"
            ? textoOpcional(enlace.motivoInvalido)
            : null,
    }
  }

  return null
}

function resumenDeDatos(
  enlaceExistente: EnlaceExistenteVista | null,
  ultimoIntento: UltimoIntentoVista | null
): string | null {
  if (enlaceExistente) {
    const vence = formatearFechaEnlace(enlaceExistente.expiraEn)
    return vence
      ? `Link PayPal vigente · vence ${vence}`
      : "Link PayPal vigente"
  }

  if (!ultimoIntento) return null

  const fecha = formatearFechaEnlace(
    ultimoIntento.creadoEn ?? ultimoIntento.expiraEn
  )
  const etiqueta = estadoIntentoLabel(ultimoIntento.estado).toLowerCase()
  return fecha
    ? `PayPal: último intento ${etiqueta} · ${fecha}`
    : `PayPal: último intento ${etiqueta}`
}

/**
 * Datos listos para el modal y para la fila. Se calculan juntos para que la
 * etiqueta visible y las props del modal no puedan quedar desincronizadas.
 */
export function datosPaypalEnlaces(
  enlaces: readonly EnlacePaypalVista[] | null | undefined,
  ahora: Date = new Date()
): DatosPaypalEnlaces {
  const enlaceExistente = enlacePaypalVigente(enlaces, ahora)
  const ultimoIntento = enlaceExistente
    ? null
    : ultimoIntentoPaypal(enlaces, ahora)

  return {
    enlaceExistente,
    ultimoIntento,
    resumen: resumenDeDatos(enlaceExistente, ultimoIntento),
  }
}
