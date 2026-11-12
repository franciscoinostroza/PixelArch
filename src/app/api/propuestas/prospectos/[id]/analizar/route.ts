/**
 * POST /api/propuestas/prospectos/[id]/analizar (T-15; AC-9, AC-10, AC-19,
 * AC-20, AC-21; RF-13..RF-16, RF-31..RF-33).
 *
 * Fase B del plan §2.3: enriquecimiento web + auditoria + score de UN prospecto,
 * en una sola request y sin worker/cola.
 *
 * Orden deliberado:
 *   1. guard admin Clerk-only (401/403), origen same-origin y rate limit
 *      30/min por admin + 60/min por IP + 10/min para analisis;
 *   2. 404 si el prospecto no existe; se carga tambien su campana;
 *   3. solo se analizan NUEVO/SIN_ENRIQUECER/ENRIQUECIDO/PUNTUADO. Cualquier
 *      otro estado (SUPRIMIDO, DESCARTADO, BORRADOR, APROBADO, ENVIADO,
 *      RESPONDIO) responde 409 ESTADO sin red ni cupo (no se revive);
 *   4. supresion previa por email/dominio actual (`comprobarSupresion`); sin
 *      secreto y con email se falla cerrado 503, y si esta suprimido se marca
 *      SUPRIMIDO sin fetch;
 *   5. sin `sitioWeb` -> SIN_ENRIQUECER con motivo `SIN_WEB`, score con datos
 *      faltantes y 200, sin red (desde NUEVO; los estados ya enriquecidos
 *      conservan su estado porque la transicion inversa no existe);
 *   6. reserva `WEB_FETCH` por pagina dentro de `prisma.$transaction` y, si la
 *      auditoria no es reutilizable, `AUDITORIA` 1 despues de extraer. Los
 *      topes salen siempre de la configuracion (hard cap): este endpoint nunca
 *      pasa overrides de cupo/presupuesto. Un `ErrorCupo` en el home o en la
 *      auditoria responde 429 CUPO/LIMITE sin haber llamado al proveedor y sin
 *      persistir un analisis parcial (la operacion es atomica respecto de los
 *      cupos obligatorios). Un `ErrorCupo` en una pagina de contacto opcional
 *      corta solo los fetches extra y conserva el analisis del home.
 *   7. `fetchHtmlSeguro` del home (sin `fetch` global): DNS/SSRF/robots/
 *      timeout/tamano/HTML. Un fallo deja SIN_ENRIQUECER con el motivo,
 *      `auditoriaEstado=FALLIDA`, score con datos faltantes y 200; no se
 *      guarda HTML. Si el motivo es TLS, ademas persiste un resumen sintetico
 *      con `TLS_INVALIDO` y `ssl: 0` (sin HTML ni certificado).
 *   8. extraccion de nombre/email/telefono con `extraerDatosPublicados` y
 *      `descubrirPaginasContacto` (maximo 2 paginas del mismo dominio
 *      registrable, nunca redes/assets/login). Los campos ya cargados a mano
 *      cuentan como cubiertos: no se piden paginas extra si email y telefono
 *      ya existen. Se completa solo lo vacio y el nombre de una ficha
 *      CARGA_MANUAL nunca se pisa. Maximo 3 fetches totales.
 *   9. un email encontrado que ya pertenece a otro prospecto marca
 *      `posibleDuplicadoDeId` y NO se asigna; uno suprimido deja el prospecto
 *      SUPRIMIDO y tampoco se asigna. Se guardan las fuentes y fechas de la
 *      pagina donde aparecio el dato.
 *  10. auditoria interna reutilizando el HTML/headers/tiempos del home (sin
 *      segundo fetch). Si `auditoriaVigente` (< 24 h) y hay resumen, se
 *      reutiliza; si no, se reserva `AUDITORIA` y se llama `auditarPagina` con
 *      el helper TLS inyectado. Se guarda solo `{ scores, findings, finalUrl,
 *      fecha, estado }`, nunca HTML ni certificado. Un fallo TLS/auditoria deja
 *      `auditoriaEstado=FALLIDA` y el score explica el dato faltante; no se
 *      desactiva la validacion TLS.
 *  11. `calcularScore` determinista (email/fuente/sitio/telefono/ciudad/
 *      rubro/campana/auditoria) y transiciones validas de T-07: NUEVO pasa por
 *      ENRIQUECIDO antes de PUNTUADO; SIN_ENRIQUECER/ENRIQUECIDO pasan directo;
 *      PUNTUADO conserva su estado. El update final nunca pisa SUPRIMIDO,
 *      DESCARTADO, BORRADOR, APROBADO, ENVIADO ni RESPONDIO. Nunca se toca el
 *      CRM.
 *
 * Respuesta 200: `{ estado, emailEncontrado, tieneEmail, auditoriaEstado, score }`.
 * `emailEncontrado` solo es `true` si se asigno un email nuevo en esta corrida;
 * `tieneEmail` indica si la ficha tiene email al terminar.
 * Decisiones documentadas:
 * - estado no analizable -> 409 ESTADO sin red ni cupo;
 * - supresion previa o detectada al extraer -> 200 con estado `SUPRIMIDO`
 *   (sin fetch posterior ni email nuevo; no se revela el email);
 * - sin sitio web -> 200 con `SIN_ENRIQUECER` y motivo `SIN_WEB`;
 * - fallo del fetch del home -> 200 con el estado resultante, el motivo saneado
 *   del fetch, `auditoriaEstado="FALLIDA"` y score con datos faltantes;
 * - falta de cupo obligatorio (home o auditoria) -> 429/503 sin persistir el
 *   analisis parcial; una pagina de contacto sin cupo solo se omite.
 * Errores 401/403/404/429/503/500 sanitizados, `Cache-Control: no-store` y
 * logs solo con ids internos, estado, codigo, score y booleanos; nunca email,
 * nombre, telefono, URLs, HTML ni secretos.
 */

import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { certDaysLeft } from "@/lib/audit-server"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import {
  auditarPagina,
  auditoriaVigente,
  resumenTlsFallido,
  type AuditoriaResumen,
} from "@/lib/propuestas/auditoria"
import { configPropuestas } from "@/lib/propuestas/config"
import { esErrorCupo, reservarCupo } from "@/lib/propuestas/consumo"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import {
  dominioNegocio,
  limpiarNombreNegocio,
  normalizarEmail,
} from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import { comprobarSupresion } from "@/lib/propuestas/prospectos-supresion"
import {
  calcularScore,
  type PuntajesAuditoria,
  type ScoreResultado,
} from "@/lib/propuestas/score"
import {
  normalizarEstadoProspecto,
  transicionProspectoPermitida,
  type EstadoProspecto,
} from "@/lib/propuestas/transiciones"
import {
  descubrirPaginasContacto,
  extraerDatosPublicados,
  fetchHtmlSeguro,
  type ResultadoWebOk,
} from "@/lib/propuestas/web"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const LIMITE_ANALISIS = 10
const VENTANA_MS = 60_000
const MAX_PAGINAS_CONTACTO = 2

/** Estados desde los que se permite un nuevo analisis (T-07). */
const ESTADOS_ANALIZABLES = [
  "NUEVO",
  "SIN_ENRIQUECER",
  "ENRIQUECIDO",
  "PUNTUADO",
] as const

/**
 * Estados que no se pueden pisar con un resultado de analisis:
 * terminales y los que ya avanzaron a borrador/aprobacion/envio.
 */
const ESTADOS_NO_PISABLES = [
  "SUPRIMIDO",
  "DESCARTADO",
  "BORRADOR",
  "APROBADO",
  "ENVIADO",
  "RESPONDIO",
] as const

type EstadoAnalizable = (typeof ESTADOS_ANALIZABLES)[number]

interface DatosContacto {
  email: string | null
  emailFuenteUrl: string | null
  telefono: string | null
  nombre: string | null
  fuenteUrl: string | null
}

function json(
  cuerpo: unknown,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(cuerpo, {
    status,
    headers: { ...NO_STORE, ...headers },
  })
}

function errorJson(
  status: number,
  codigo: CodigoError,
  headers: Record<string, string> = {},
): NextResponse {
  const { mensaje } = sanitizarError(null, { codigo })
  return json({ error: mensaje, codigo }, status, headers)
}

function respuestaAnalisis(
  estado: string,
  emailEncontrado: boolean,
  tieneEmail: boolean,
  auditoriaEstado: string | null,
  score: number | null,
): NextResponse {
  return json(
    { estado, emailEncontrado, tieneEmail, auditoriaEstado, score },
    200,
  )
}

function esEstadoAnalizable(
  estado: EstadoProspecto | null,
): estado is EstadoAnalizable {
  return (
    estado !== null &&
    (ESTADOS_ANALIZABLES as readonly string[]).includes(estado)
  )
}

function respuestaPersistenciaFallida(
  resultado: ResultadoPersistencia,
  tieneEmail: boolean,
  auditoriaEstado: string | null,
  score: number | null,
): NextResponse {
  if (resultado.estadoActual === null) {
    return errorJson(404, "NO_ENCONTRADO")
  }
  if (resultado.estadoActual === "SUPRIMIDO") {
    return respuestaAnalisis(
      "SUPRIMIDO",
      false,
      tieneEmail,
      auditoriaEstado,
      score,
    )
  }
  return errorJson(409, "ESTADO")
}

function ipDe(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  const primera = forwarded?.split(",")[0]?.trim()
  return primera && primera.length > 0 ? primera : "unknown"
}

function esErrorUnique(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  )
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function numeroONull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null
}

function scoresDeResumen(valor: unknown): PuntajesAuditoria | null {
  if (!esObjeto(valor) || !esObjeto(valor.scores)) return null

  return {
    velocidad: numeroONull(valor.scores.velocidad),
    ssl: numeroONull(valor.scores.ssl),
    seo: numeroONull(valor.scores.seo),
    seguridad: numeroONull(valor.scores.seguridad),
  }
}

function estadoDeResumen(valor: unknown): string | null {
  if (!esObjeto(valor) || typeof valor.estado !== "string") return null
  return valor.estado
}

/**
 * Un resumen utilizable debe ser un objeto con estado y el arreglo de
 * hallazgos. No se exige que `scores` exista: una auditoria FALLIDA guarda
 * `scores: null` y sigue siendo reutilizable durante 24 h.
 */
function resumenValido(valor: unknown): boolean {
  return (
    esObjeto(valor) &&
    typeof valor.estado === "string" &&
    Array.isArray(valor.findings)
  )
}

function recorteNombre(valor: string | null): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function hostDe(url: string | null): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, "")
  } catch {
    return null
  }
}

/**
 * `true` cuando el nombre actual parece derivado del host (caso de un prospecto
 * creado por Places o de un nombre provisorio).
 */
function nombreDerivadoDelHost(
  nombreActual: string,
  sitioWeb: string | null,
): boolean {
  const host = hostDe(sitioWeb)
  if (host === null) return false
  return nombreActual.trim() === limpiarNombreNegocio("", host)
}

function esNombreDeRespaldo(
  nombre: string | null,
  sitioWeb: string | null,
): boolean {
  if (nombre === null) return true
  const host = hostDe(sitioWeb)
  if (host === null) return false
  return nombre.trim() === limpiarNombreNegocio("", host)
}

/**
 * Un nombre cargado a mano (`CARGA_MANUAL`) no se sobrescribe aunque coincida
 * por valor con el fallback del host: la proteccion mira `fuenteTipo`, no solo
 * el texto. En el resto de los casos solo se mejora un nombre vacio o derivado
 * del host.
 */
function puedeMejorarNombre(prospecto: {
  nombreNegocio: string
  sitioWeb: string | null
  fuenteTipo: string | null
}): boolean {
  const actual = recorteNombre(prospecto.nombreNegocio)
  if (actual === null) return true
  if (prospecto.fuenteTipo === "CARGA_MANUAL") return false
  return nombreDerivadoDelHost(actual, prospecto.sitioWeb)
}

function fechaDeResumen(valor: unknown): Date | null {
  if (!esObjeto(valor) || typeof valor.fecha !== "string") return null
  const fecha = new Date(valor.fecha)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

function statusDeCupo(error: {
  ambito: string
  codigo: "CUPO" | "LIMITE"
}): NextResponse {
  if (error.ambito === "CONFIGURACION" || error.ambito === "VALIDACION") {
    return errorJson(503, "CONFIGURACION")
  }
  return errorJson(429, error.codigo)
}

/** Reserva una pagina web dentro de una transaccion; los topes son la config. */
async function reservarPaginaWeb(
  campanaId: string,
  prospectoId: string,
): Promise<void> {
  await prisma.$transaction((tx) =>
    reservarCupo(tx, {
      campanaId,
      prospectoId,
      proveedor: "WEB_FETCH",
      cantidad: 1,
      llamadas: 1,
    }),
  )
}

/** Reserva la auditoria interna (1 unidad) dentro de una transaccion. */
async function reservarAuditoria(
  campanaId: string,
  prospectoId: string,
): Promise<void> {
  await prisma.$transaction((tx) =>
    reservarCupo(tx, {
      campanaId,
      prospectoId,
      proveedor: "AUDITORIA",
      cantidad: 1,
      llamadas: 1,
    }),
  )
}

function cargarProspecto(id: string) {
  return prisma.prospecto.findUnique({
    where: { id },
    select: {
      id: true,
      nombreNegocio: true,
      sitioWeb: true,
      dominioNormalizado: true,
      ciudad: true,
      rubro: true,
      email: true,
      telefono: true,
      emailFuenteUrl: true,
      emailFechaFuente: true,
      fuenteTipo: true,
      fuenteUrl: true,
      fechaFuente: true,
      estado: true,
      score: true,
      auditoriaResumen: true,
      auditoriaEstado: true,
      auditoriaFecha: true,
      posibleDuplicadoDeId: true,
      campanaOrigenId: true,
      campanaOrigen: {
        select: { id: true, nombre: true, rubro: true, zona: true },
      },
    },
  })
}

type ProspectoAnalizable = NonNullable<
  Awaited<ReturnType<typeof cargarProspecto>>
>

interface ResultadoExtraccion extends DatosContacto {
  /** Primera pagina donde aparecio un dato de contacto (o el home). */
  fuenteDatosUrl: string | null
}

/**
 * Extrae datos del home y, si aun falta email/telefono, de hasta 2 paginas de
 * contacto del mismo dominio. Las paginas extra son opcionales: si se agota su
 * cupo se corta la busqueda y se conserva lo del home.
 *
 * La decision combina el prospecto existente con lo extraido del home: un
 * email o telefono cargado a mano cuenta como cubierto y no dispara fetches
 * extra. Maximo 3 fetches totales (home + 2 paginas).
 */
async function extraerDatosDelSitio(
  prospecto: ProspectoAnalizable,
  resultadoHome: ResultadoWebOk,
  maxContactos: number,
): Promise<ResultadoExtraccion> {
  const datosHome = extraerDatosPublicados(
    resultadoHome.html,
    resultadoHome.finalUrl,
  )

  // Cualquier valor no vacio cuenta como cargado a mano (aunque sea legacy):
  // no se piden paginas extra para un dato que la ruta no va a reemplazar.
  const emailPrevio = recorteNombre(prospecto.email)
  const telefonoPrevio = recorteNombre(prospecto.telefono)

  let email = datosHome.email
  let emailFuenteUrl = datosHome.emailFuenteUrl
  let telefono = datosHome.telefono
  let nombre = datosHome.nombre
  let fuenteDatosUrl =
    datosHome.email !== null || datosHome.telefono !== null
      ? resultadoHome.finalUrl
      : null

  const emailCubierto = (): boolean => emailPrevio !== null || email !== null
  const telefonoCubierto = (): boolean =>
    telefonoPrevio !== null || telefono !== null

  if (!emailCubierto() || !telefonoCubierto()) {
    const paginas = descubrirPaginasContacto(
      resultadoHome.html,
      resultadoHome.finalUrl,
      Math.max(0, Math.min(MAX_PAGINAS_CONTACTO, maxContactos)),
    )

    const nombreMejorable = puedeMejorarNombre(prospecto)

    for (const pagina of paginas) {
      if (emailCubierto() && telefonoCubierto()) break

      try {
        await reservarPaginaWeb(prospecto.campanaOrigen.id, prospecto.id)
      } catch (error) {
        // El fetch extra es opcional: si no hay cupo se conserva el home.
        if (esErrorCupo(error)) break
        throw error
      }

      let extra: Awaited<ReturnType<typeof fetchHtmlSeguro>>
      try {
        extra = await fetchHtmlSeguro(pagina)
      } catch {
        continue
      }
      if (!extra.ok) continue

      const datos = extraerDatosPublicados(extra.html, extra.finalUrl)

      if (email === null && emailPrevio === null && datos.email !== null) {
        email = datos.email
        emailFuenteUrl = datos.emailFuenteUrl ?? extra.finalUrl
        fuenteDatosUrl = fuenteDatosUrl ?? extra.finalUrl
      }
      if (
        telefono === null &&
        telefonoPrevio === null &&
        datos.telefono !== null
      ) {
        telefono = datos.telefono
        fuenteDatosUrl = fuenteDatosUrl ?? extra.finalUrl
      }
      if (
        nombreMejorable &&
        (nombre === null || esNombreDeRespaldo(nombre, prospecto.sitioWeb)) &&
        datos.nombre !== null &&
        !esNombreDeRespaldo(datos.nombre, prospecto.sitioWeb)
      ) {
        nombre = datos.nombre
      }
    }
  }

  return {
    email,
    emailFuenteUrl,
    telefono,
    nombre,
    fuenteUrl: fuenteDatosUrl ?? resultadoHome.finalUrl,
    fuenteDatosUrl: fuenteDatosUrl ?? resultadoHome.finalUrl,
  }
}

interface CambiosAnalisis {
  motivoSinEnriquecer?: string | null
  nombreNegocio?: string
  email?: string
  emailFuenteUrl?: string
  emailFechaFuente?: Date
  telefono?: string
  fuenteUrl?: string
  fechaFuente?: Date
  posibleDuplicadoDeId?: string | null
  auditoriaResumen?: AuditoriaResumen | null
  auditoriaEstado?: string | null
  auditoriaFecha?: Date
  score?: number
  scoreDetalle?: ScoreResultado
}

interface ResultadoPersistencia {
  actualizado: boolean
  estadoActual: string | null
  transicionInvalida: boolean
}

function datosPersistidos(
  adminId: string,
  ahora: Date,
  cambios: CambiosAnalisis,
): Prisma.ProspectoUpdateManyMutationInput {
  const data: Prisma.ProspectoUpdateManyMutationInput = {
    ultimaInteraccionEn: ahora,
    actualizadoPor: adminId,
  }

  if (cambios.motivoSinEnriquecer !== undefined) {
    data.motivoSinEnriquecer = cambios.motivoSinEnriquecer
  }
  if (cambios.nombreNegocio !== undefined) {
    data.nombreNegocio = cambios.nombreNegocio
  }
  if (cambios.email !== undefined) data.email = cambios.email
  if (cambios.emailFuenteUrl !== undefined) {
    data.emailFuenteUrl = cambios.emailFuenteUrl
  }
  if (cambios.emailFechaFuente !== undefined) {
    data.emailFechaFuente = cambios.emailFechaFuente
  }
  if (cambios.telefono !== undefined) data.telefono = cambios.telefono
  if (cambios.fuenteUrl !== undefined) data.fuenteUrl = cambios.fuenteUrl
  if (cambios.fechaFuente !== undefined) data.fechaFuente = cambios.fechaFuente
  if (cambios.posibleDuplicadoDeId !== undefined) {
    data.posibleDuplicadoDeId = cambios.posibleDuplicadoDeId
  }
  if (cambios.auditoriaResumen !== undefined) {
    data.auditoriaResumen =
      cambios.auditoriaResumen as unknown as Prisma.InputJsonValue
  }
  if (cambios.auditoriaEstado !== undefined) {
    data.auditoriaEstado = cambios.auditoriaEstado
  }
  if (cambios.auditoriaFecha !== undefined) {
    data.auditoriaFecha = cambios.auditoriaFecha
  }
  if (cambios.score !== undefined) data.score = cambios.score
  if (cambios.scoreDetalle !== undefined) {
    data.scoreDetalle =
      cambios.scoreDetalle as unknown as Prisma.InputJsonValue
  }

  return data
}

/**
 * Persiste cambios sin pisar estados terminales ni los que ya avanzaron a
 * borrador/aprobacion/envio. `filtroEstado` se combina con el id.
 */
async function persistirCambios(
  id: string,
  adminId: string,
  ahora: Date,
  cambios: CambiosAnalisis,
  filtroEstado: Prisma.ProspectoWhereInput["estado"],
  estado?: EstadoProspecto,
): Promise<ResultadoPersistencia> {
  const data = datosPersistidos(adminId, ahora, cambios)
  if (estado !== undefined) data.estado = estado

  const resultado = await prisma.prospecto.updateMany({
    where: { id, estado: filtroEstado },
    data,
  })

  if (resultado.count > 0) {
    return {
      actualizado: true,
      estadoActual: null,
      transicionInvalida: false,
    }
  }

  const actual = await prisma.prospecto.findUnique({
    where: { id },
    select: { estado: true },
  })

  return {
    actualizado: false,
    estadoActual: actual?.estado ?? null,
    transicionInvalida: false,
  }
}

/**
 * Aplica una transicion valida de T-07 con guarda exacta del estado de origen.
 * Un estado igual no es una transicion: se persisten solo los datos.
 */
async function persistirTransicion(
  id: string,
  adminId: string,
  ahora: Date,
  desde: EstadoProspecto,
  hacia: EstadoProspecto,
  cambios: CambiosAnalisis,
): Promise<ResultadoPersistencia> {
  if (desde !== hacia && !transicionProspectoPermitida(desde, hacia)) {
    return {
      actualizado: false,
      estadoActual: desde,
      transicionInvalida: true,
    }
  }

  return persistirCambios(
    id,
    adminId,
    ahora,
    cambios,
    { equals: desde, notIn: [...ESTADOS_NO_PISABLES] },
    hacia,
  )
}

/**
 * Marca SUPRIMIDO respetando T-07: se permite desde cualquier estado no
 * terminal (incluido BORRADOR/APROBADO/ENVIADO). Limpia el motivo obsoleto.
 */
async function persistirSuprimido(
  id: string,
  adminId: string,
  ahora: Date,
  desde: EstadoProspecto,
  cambios: CambiosAnalisis = {},
): Promise<ResultadoPersistencia> {
  if (!transicionProspectoPermitida(desde, "SUPRIMIDO")) {
    return {
      actualizado: false,
      estadoActual: desde,
      transicionInvalida: true,
    }
  }

  return persistirCambios(
    id,
    adminId,
    ahora,
    { ...cambios, motivoSinEnriquecer: null },
    { notIn: ["SUPRIMIDO", "DESCARTADO"] },
    "SUPRIMIDO",
  )
}

/** SIN_ENRIQUECER solo se alcanza desde NUEVO; los demas conservan su estado. */
async function persistirSinEnriquecer(
  id: string,
  adminId: string,
  ahora: Date,
  desde: EstadoProspecto,
  cambios: CambiosAnalisis,
): Promise<ResultadoPersistencia> {
  if (desde === "NUEVO" || desde === "SIN_ENRIQUECER") {
    return persistirTransicion(
      id,
      adminId,
      ahora,
      desde,
      "SIN_ENRIQUECER",
      cambios,
    )
  }

  return persistirCambios(
    id,
    adminId,
    ahora,
    cambios,
    { equals: desde, notIn: [...ESTADOS_NO_PISABLES] },
  )
}

/** PUNTUADO exige pasar por ENRIQUECIDO cuando el prospecto es NUEVO. */
async function persistirPuntuado(
  id: string,
  adminId: string,
  ahora: Date,
  desde: EstadoProspecto,
  cambiosContacto: CambiosAnalisis,
  cambiosFinales: CambiosAnalisis,
): Promise<ResultadoPersistencia> {
  if (desde === "NUEVO") {
    const intermedio = await persistirTransicion(
      id,
      adminId,
      ahora,
      "NUEVO",
      "ENRIQUECIDO",
      cambiosContacto,
    )
    if (!intermedio.actualizado) return intermedio

    return persistirCambios(
      id,
      adminId,
      ahora,
      cambiosFinales,
      { equals: "ENRIQUECIDO", notIn: [...ESTADOS_NO_PISABLES] },
      "PUNTUADO",
    )
  }

  if (desde === "SIN_ENRIQUECER" || desde === "ENRIQUECIDO") {
    return persistirTransicion(
      id,
      adminId,
      ahora,
      desde,
      "PUNTUADO",
      cambiosFinales,
    )
  }

  return persistirCambios(
    id,
    adminId,
    ahora,
    cambiosFinales,
    { equals: "PUNTUADO", notIn: [...ESTADOS_NO_PISABLES] },
    "PUNTUADO",
  )
}

function puntajesParaScore(
  resumen: unknown,
  auditoriaEstado: string | null,
): { estado: string | null; scores: PuntajesAuditoria | null } {
  return {
    estado: auditoriaEstado ?? estadoDeResumen(resumen),
    scores: scoresDeResumen(resumen),
  }
}

function scoreDe(
  prospecto: ProspectoAnalizable,
  email: string | null,
  emailFuenteUrl: string | null,
  fuenteUrl: string | null,
  telefono: string | null,
  auditoriaEstado: string | null,
  auditoriaResumen: unknown,
): ScoreResultado {
  const auditoria = puntajesParaScore(auditoriaResumen, auditoriaEstado)

  return calcularScore({
    email,
    emailFuenteUrl,
    fuenteUrl,
    sitioWeb: prospecto.sitioWeb,
    telefono,
    ciudad: prospecto.ciudad,
    rubro: prospecto.rubro,
    campana: {
      rubro: prospecto.campanaOrigen.rubro,
      zona: prospecto.campanaOrigen.zona,
    },
    auditoria: auditoria.estado === null ? null : auditoria,
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await resolverAdminPropuestas()
  if (!admin.ok) {
    return admin.motivo === "SIN_SESION"
      ? errorJson(401, "NO_AUTORIZADO")
      : errorJson(403, "PROHIBIDO")
  }

  if (!origenPermitido(req, configPropuestas().urlPublica)) {
    return errorJson(403, "ORIGEN_INVALIDO")
  }

  const limiteAdmin = rateLimitDetalle(
    `propuestas:${admin.admin.userId}`,
    LIMITE_ADMIN,
    VENTANA_MS,
  )
  if (!limiteAdmin.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteAdmin.retryAfterSegundos),
    })
  }

  const limiteIp = rateLimitDetalle(
    `propuestas:ip:${ipDe(req)}`,
    LIMITE_IP,
    VENTANA_MS,
  )
  if (!limiteIp.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteIp.retryAfterSegundos),
    })
  }

  // Un analisis por admin cada 10/min ademas del limite general; evita que el
  // cliente encadene analisis en bucle.
  const limiteAnalisis = rateLimitDetalle(
    `propuestas:analisis:${admin.admin.userId}`,
    LIMITE_ANALISIS,
    VENTANA_MS,
  )
  if (!limiteAnalisis.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteAnalisis.retryAfterSegundos),
    })
  }

  const { id } = await params
  const adminId = admin.admin.userId

  try {
    const prospecto = await cargarProspecto(id)
    if (!prospecto) return errorJson(404, "NO_ENCONTRADO")

    const ahora = new Date()
    const config = configPropuestas()
    const secreto = config.supresion.disponible ? config.secreto : null
    const dominio =
      prospecto.dominioNormalizado ??
      (prospecto.sitioWeb ? dominioNegocio(prospecto.sitioWeb) : null)
    // Cualquier email no vacio cuenta como contacto cargado: un valor legacy o
    // invalido no se normaliza para el hash ni se pisa automaticamente.
    const emailExistente =
      prospecto.email !== null && prospecto.email.trim().length > 0
        ? prospecto.email
        : null
    const emailParaSupresion =
      emailExistente !== null ? normalizarEmail(emailExistente) : null

    // Solo se analizan prospectos en un estado de enriquecimiento. Los estados
    // terminales o ya avanzados (DESCARTADO/SUPRIMIDO/BORRADOR/APROBADO/
    // ENVIADO/RESPONDIO) no se reviven ni gastan red/cupo.
    const estadoActual = normalizarEstadoProspecto(prospecto.estado)
    if (!esEstadoAnalizable(estadoActual)) {
      return errorJson(409, "ESTADO")
    }

    // Supresion previa con los datos actuales. Con email y sin secreto no se
    // puede garantizar el bloqueo por hash: se falla cerrado.
    const supresionInicial = await comprobarSupresion({
      email: emailParaSupresion,
      secreto,
      dominioSitio: dominio,
    })
    if (supresionInicial.suprimido) {
      if (supresionInicial.codigo === "NO_CONFIGURADO") {
        return errorJson(503, "NO_CONFIGURADO")
      }

      const persistido = await persistirSuprimido(
        id,
        adminId,
        ahora,
        estadoActual,
      )
      if (!persistido.actualizado) {
        return respuestaPersistenciaFallida(
          persistido,
          emailExistente !== null,
          prospecto.auditoriaEstado,
          prospecto.score,
        )
      }

      logger.info("Prospecto suprimido antes del analisis", {
        prospectoId: id,
        campanaId: prospecto.campanaOrigen.id,
        adminId,
      })

      return respuestaAnalisis(
        "SUPRIMIDO",
        false,
        emailExistente !== null,
        prospecto.auditoriaEstado,
        prospecto.score,
      )
    }

    const auditoriaReutilizable =
      auditoriaVigente(prospecto.auditoriaFecha, ahora) &&
      resumenValido(prospecto.auditoriaResumen)

    // Sin sitio web no hay red ni cupo. Se puntua con los datos disponibles
    // (los faltantes suman 0 y agregan motivo) y se mantiene la auditoria que
    // ya existiera.
    if (!prospecto.sitioWeb) {
      const score = scoreDe(
        prospecto,
        prospecto.email,
        prospecto.emailFuenteUrl,
        prospecto.fuenteUrl,
        prospecto.telefono,
        prospecto.auditoriaEstado,
        prospecto.auditoriaResumen,
      )

      const persistido = await persistirSinEnriquecer(
        id,
        adminId,
        ahora,
        estadoActual,
        {
          motivoSinEnriquecer: "SIN_WEB",
          score: score.total,
          scoreDetalle: score,
        },
      )
      if (!persistido.actualizado) {
        return respuestaPersistenciaFallida(
          persistido,
          emailExistente !== null,
          prospecto.auditoriaEstado,
          prospecto.score,
        )
      }

      logger.info("Prospecto sin sitio web", {
        prospectoId: id,
        campanaId: prospecto.campanaOrigen.id,
        adminId,
        score: score.total,
      })

      const estadoFinal =
        estadoActual === "NUEVO" || estadoActual === "SIN_ENRIQUECER"
          ? "SIN_ENRIQUECER"
          : estadoActual

      return respuestaAnalisis(
        estadoFinal,
        false,
        emailExistente !== null,
        prospecto.auditoriaEstado,
        score.total,
      )
    }

    // Reserva obligatoria del home antes de tocar la red. El tope sale de la
    // configuracion; nunca se aceptan overrides del request.
    try {
      await reservarPaginaWeb(prospecto.campanaOrigen.id, id)
    } catch (error) {
      if (esErrorCupo(error)) return statusDeCupo(error)
      throw error
    }

    let home: Awaited<ReturnType<typeof fetchHtmlSeguro>>
    try {
      home = await fetchHtmlSeguro(prospecto.sitioWeb)
    } catch {
      home = {
        ok: false,
        motivo: "RED",
        mensaje: "No se pudo conectar con el sitio.",
        status: null,
        redirigido: false,
        redirects: [],
      }
    }

    if (!home.ok) {
      // No se guarda HTML. Un fallo TLS deja un resumen sintetico con el
      // hallazgo TLS_INVALIDO y ssl 0; el resto de fallos solo marca FALLIDA.
      // La marca se corrige sola en el proximo analisis exitoso.
      const resumenTls =
        home.motivo === "TLS"
          ? resumenTlsFallido(prospecto.sitioWeb, ahora)
          : undefined
      const score = scoreDe(
        prospecto,
        prospecto.email,
        prospecto.emailFuenteUrl,
        prospecto.fuenteUrl,
        prospecto.telefono,
        "FALLIDA",
        resumenTls ?? null,
      )

      const persistido = await persistirSinEnriquecer(
        id,
        adminId,
        ahora,
        estadoActual,
        {
          motivoSinEnriquecer: home.motivo,
          auditoriaEstado: "FALLIDA",
          auditoriaResumen: resumenTls,
          score: score.total,
          scoreDetalle: score,
        },
      )
      if (!persistido.actualizado) {
        return respuestaPersistenciaFallida(
          persistido,
          emailExistente !== null,
          prospecto.auditoriaEstado,
          prospecto.score,
        )
      }

      logger.info("Fetch web del prospecto fallido", {
        prospectoId: id,
        campanaId: prospecto.campanaOrigen.id,
        adminId,
        motivo: home.motivo,
        score: score.total,
      })

      const estadoFinal =
        estadoActual === "NUEVO" || estadoActual === "SIN_ENRIQUECER"
          ? "SIN_ENRIQUECER"
          : estadoActual

      return respuestaAnalisis(
        estadoFinal,
        false,
        emailExistente !== null,
        "FALLIDA",
        score.total,
      )
    }

    const maxContactos = Math.max(
      0,
      Math.min(MAX_PAGINAS_CONTACTO, config.limites.paginasPorProspecto - 1),
    )

    const extraido = await extraerDatosDelSitio(
      prospecto,
      home,
      maxContactos,
    )

    // Solo se completa lo vacio: email/telefono cargados a mano no se pisan.
    let emailFinal = emailExistente
    let emailFuenteFinal = prospecto.emailFuenteUrl
    let telefonoFinal = prospecto.telefono
    let fuenteUrlFinal = prospecto.fuenteUrl
    let posibleDuplicado = prospecto.posibleDuplicadoDeId
    let emailNuevoAsignado = false
    let suprimidoTrasExtraer = false

    const emailEncontrado = recorteEmail(extraido.email)

    if (emailEncontrado !== null) {
      const emailActual =
        emailExistente !== null ? normalizarEmail(emailExistente) : null

      if (emailExistente === null) {
        // El email encontrado podria pertenecer a otra ficha: se marca el
        // posible duplicado y no se asigna en silencio.
        const duplicado = await prisma.prospecto.findUnique({
          where: { email: emailEncontrado },
          select: { id: true },
        })

        if (duplicado && duplicado.id !== id) {
          posibleDuplicado = duplicado.id
        } else {
          // El email nuevo ya no duplica: no se deja un id viejo en la ficha.
          posibleDuplicado = null
          const chequeo = await comprobarSupresion({
            email: emailEncontrado,
            secreto,
            dominioSitio: dominio,
          })

          const fuenteEmail =
            extraido.emailFuenteUrl ?? extraido.fuenteDatosUrl

          if (chequeo.suprimido) {
            if (chequeo.codigo === "NO_CONFIGURADO") {
              return errorJson(503, "NO_CONFIGURADO")
            }
            suprimidoTrasExtraer = true
          } else if (fuenteEmail !== null) {
            // Sin fuente no se asigna un email publicado (AC-19): el dato no
            // tendria procedencia trazable.
            emailFinal = emailEncontrado
            emailFuenteFinal = fuenteEmail
            emailNuevoAsignado = true
          }
        }
      } else if (emailActual === emailEncontrado) {
        // Mismo contacto: se conserva y, si faltaba la fuente del email, se
        // completa con la pagina donde se publico.
        if (!emailFuenteFinal) {
          emailFuenteFinal =
            extraido.emailFuenteUrl ?? extraido.fuenteDatosUrl
        }
      }
    }

    if (telefonoFinal === null && extraido.telefono !== null) {
      telefonoFinal = extraido.telefono
    }

    // La fuente general solo se completa si estaba vacia; una fuente cargada a
    // mano se conserva. La fecha acompaña a la fuente nueva.
    if (!fuenteUrlFinal) {
      const fuente = extraido.fuenteUrl
      if (fuente !== null) {
        fuenteUrlFinal = fuente
      }
    }

    const nombreMejorable = puedeMejorarNombre(prospecto)
    const nombreWeb = recorteNombre(extraido.nombre)
    const nombreNegocio =
      nombreMejorable &&
      nombreWeb !== null &&
      nombreWeb !== prospecto.nombreNegocio
        ? nombreWeb
        : undefined

    if (suprimidoTrasExtraer) {
      const persistido = await persistirSuprimido(
        id,
        adminId,
        ahora,
        estadoActual,
        {
          nombreNegocio,
          telefono:
            telefonoFinal !== null && prospecto.telefono === null
              ? telefonoFinal
              : undefined,
          fuenteUrl:
            prospecto.fuenteUrl === null && fuenteUrlFinal !== null
              ? fuenteUrlFinal
              : undefined,
          fechaFuente:
            prospecto.fuenteUrl === null && fuenteUrlFinal !== null
              ? ahora
              : undefined,
          posibleDuplicadoDeId:
            posibleDuplicado !== prospecto.posibleDuplicadoDeId
              ? posibleDuplicado
              : undefined,
        },
      )
      if (!persistido.actualizado) {
        return respuestaPersistenciaFallida(
          persistido,
          emailExistente !== null,
          prospecto.auditoriaEstado,
          prospecto.score,
        )
      }

      logger.info("Prospecto suprimido al extraer email", {
        prospectoId: id,
        campanaId: prospecto.campanaOrigen.id,
        adminId,
      })

      return respuestaAnalisis(
        "SUPRIMIDO",
        false,
        emailExistente !== null,
        prospecto.auditoriaEstado,
        prospecto.score,
      )
    }

    // Auditoria: se reutiliza el HTML/cabeceras/tiempos del home. Si el
    // resumen tiene menos de 24 h, no se reserva ni se vuelve a auditar.
    let auditoriaEstadoFinal = prospecto.auditoriaEstado
    let auditoriaResumenFinal: AuditoriaResumen | undefined
    let auditoriaFechaFinal: Date | undefined

    if (auditoriaReutilizable) {
      auditoriaEstadoFinal =
        estadoDeResumen(prospecto.auditoriaResumen) ??
        prospecto.auditoriaEstado
    } else {
      try {
        await reservarAuditoria(prospecto.campanaOrigen.id, id)
      } catch (error) {
        if (esErrorCupo(error)) {
          // Sin cupo de auditoria no se persiste el analisis parcial: la
          // operacion queda atomica y se puede reintentar al renovarse el cupo.
          return statusDeCupo(error)
        }
        throw error
      }

      // Se inyecta solo el helper TLS: `auditarPagina` usa el HTML, las
      // cabeceras y los tiempos del home ya descargado, sin un segundo fetch.
      const resumen = await auditarPagina(home, { certDaysLeft })
      auditoriaResumenFinal = resumen
      auditoriaEstadoFinal = resumen.estado
      auditoriaFechaFinal = fechaDeResumen(resumen) ?? ahora
    }

    const score = scoreDe(
      prospecto,
      emailFinal,
      emailFuenteFinal,
      fuenteUrlFinal,
      telefonoFinal,
      auditoriaEstadoFinal,
      auditoriaResumenFinal ?? prospecto.auditoriaResumen,
    )

    const cambiosContacto: CambiosAnalisis = {
      motivoSinEnriquecer: null,
      nombreNegocio,
      email:
        emailNuevoAsignado && emailFinal !== null ? emailFinal : undefined,
      emailFuenteUrl:
        emailNuevoAsignado && emailFuenteFinal !== null
          ? emailFuenteFinal
          : !prospecto.emailFuenteUrl && emailFuenteFinal !== null
            ? emailFuenteFinal
            : undefined,
      emailFechaFuente:
        emailNuevoAsignado ||
        (!prospecto.emailFuenteUrl && emailFuenteFinal !== null)
          ? ahora
          : undefined,
      telefono:
        prospecto.telefono === null && telefonoFinal !== null
          ? telefonoFinal
          : undefined,
      fuenteUrl:
        prospecto.fuenteUrl === null && fuenteUrlFinal !== null
          ? fuenteUrlFinal
          : undefined,
      fechaFuente:
        prospecto.fuenteUrl === null && fuenteUrlFinal !== null
          ? ahora
          : undefined,
      posibleDuplicadoDeId:
        posibleDuplicado !== prospecto.posibleDuplicadoDeId
          ? posibleDuplicado
          : undefined,
    }

    const cambiosFinales: CambiosAnalisis = {
      ...cambiosContacto,
      auditoriaResumen: auditoriaResumenFinal,
      auditoriaEstado: auditoriaEstadoFinal,
      auditoriaFecha: auditoriaFechaFinal,
      score: score.total,
      scoreDetalle: score,
    }

    const persistido = await persistirPuntuado(
      id,
      adminId,
      ahora,
      estadoActual,
      cambiosContacto,
      cambiosFinales,
    )

    if (!persistido.actualizado) {
      return respuestaPersistenciaFallida(
        persistido,
        emailExistente !== null,
        prospecto.auditoriaEstado,
        prospecto.score,
      )
    }

    logger.info("Prospecto analizado", {
      prospectoId: id,
      campanaId: prospecto.campanaOrigen.id,
      adminId,
      estado: "PUNTUADO",
      emailEncontrado: emailNuevoAsignado,
      tieneEmail: emailFinal !== null,
      auditoriaEstado: auditoriaEstadoFinal,
      score: score.total,
    })

    return respuestaAnalisis(
      "PUNTUADO",
      emailNuevoAsignado,
      emailFinal !== null,
      auditoriaEstadoFinal,
      score.total,
    )
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    // Carrera con otra ficha que tomo el mismo email: no se pisa ni se
    // duplica en silencio; el proximo analisis lo marcara como duplicado.
    if (esErrorUnique(error)) return errorJson(409, "ESTADO")

    const sanitizado = sanitizarError(error, {
      codigo: "DESCONOCIDO",
      mensaje: "Error inesperado.",
    })

    logger.error("Error analizando prospecto", {
      codigo: sanitizado.codigo,
      prospectoId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}

function recorteEmail(valor: string | null): string | null {
  if (typeof valor !== "string") return null
  return normalizarEmail(valor)
}
