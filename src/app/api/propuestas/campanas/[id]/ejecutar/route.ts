/**
 * POST /api/propuestas/campanas/[id]/ejecutar (T-13; AC-8, AC-11, AC-12, AC-14;
 * RF-10..RF-12, RF-16, RF-17).
 *
 * Ejecuta la Fase A del plan §2.3 sobre una campana en `BORRADOR`:
 *
 *   1. guard admin Clerk-only, origen y rate limit (30/min admin, 60/min IP y
 *      una ventana extra de 10/min por admin para corridas de busqueda);
 *   2. transicion atomica `BORRADOR -> EN_CURSO` con `updateMany` (un doble
 *      clic recibe 409 y no duplica la corrida);
 *   3. reserva de 1 unidad y 1 llamada de `GOOGLE_PLACES` dentro de
 *      `prisma.$transaction` (el handoff de T-11 exige la transaccion para que
 *      el advisory lock proteja; los topes salen siempre de la config, nunca
 *      del request);
 *   4. revalidacion del estado antes de llamar al proveedor: si la campana
 *      dejo de estar `EN_CURSO` (cancelacion concurrente), no se llama a
 *      Places ni se crean prospectos;
 *   5. una sola llamada a Places Text Search (`pageSize = limiteCorrida`), sin
 *      paginacion ni reintentos;
 *   6. por cada lugar con web: normalizacion de URL y dominio de negocio
 *      (registrable, nunca proveedor publico), descarte de fuentes no
 *      prospectables, supresion por dominio, dedupe por `placeId` / dominio
 *      registrable y creacion del prospecto (nunca se persiste el nombre de
 *      Places);
 *   7. cierre `COMPLETADA | PARCIAL | FALLIDA` con `ultimoError` sanitizado y
 *      respuesta con candidatos transitorios para mostrar con atribucion.
 *
 * Ante un esquema faltante se cierra la campana `FALLIDA` (mejor esfuerzo,
 * sin pisar una cancelacion) antes de responder 503, para no dejarla colgada
 * en `EN_CURSO`.
 *
 * No hay scraping: solo la API oficial. La corrida no toca el CRM ni envia
 * emails. Logs solo con ids, estado, codigo y contadores; nunca consulta,
 * nombre de negocio, sitio ni PII.
 */

import { NextResponse } from "next/server"
import type { EstadoCampanaProspeccion } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { rateLimitDetalle } from "@/lib/rate-limit"
import { resolverAdminPropuestas } from "@/lib/propuestas/auth"
import { configPropuestas } from "@/lib/propuestas/config"
import { esErrorCupo, reservarCupo } from "@/lib/propuestas/consumo"
import { evaluarDedupe } from "@/lib/propuestas/dedupe"
import {
  esErrorTablaFaltante,
  sanitizarError,
  type CodigoError,
} from "@/lib/propuestas/errores"
import {
  dominioNegocio,
  esHostNoProspectable,
  limpiarNombreNegocio,
  normalizarDominio,
} from "@/lib/propuestas/normalizar"
import { origenPermitido } from "@/lib/propuestas/origen"
import {
  buscarLugaresPlaces,
  type CodigoErrorPlaces,
  type LugarPlaces,
} from "@/lib/propuestas/places"
import { dominioSuprimible } from "@/lib/propuestas/supresion"
import {
  CAMPANA_LIMITE_DEFAULT,
  CAMPANA_LIMITE_MAX,
  CAMPANA_LIMITE_MIN,
  campanaAccionSchema,
} from "@/lib/propuestas/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LIMITE_ADMIN = 30
const LIMITE_IP = 60
const LIMITE_BUSQUEDA = 10
const VENTANA_MS = 60_000

type ResultadoCandidato =
  | "CREADO"
  | "REUTILIZADO"
  | "POSIBLE_DUPLICADO"
  | "SIN_WEB"
  | "FUENTE_NO_PERMITIDA"
  | "SUPRIMIDO"
  | "ERROR"

interface CandidatoCorrida {
  placeId: string
  nombreTransitorio: string | null
  sitioWeb: string | null
  resultado: ResultadoCandidato
}

interface CampanaEjecutable {
  id: string
  consulta: string
  zona: string | null
  rubro: string | null
  estado: EstadoCampanaProspeccion
  limiteCorrida: number
}

interface ContadoresCorrida {
  creados: number
  reutilizados: number
  duplicados: number
  omitidos: number
}

interface ResultadoProcesamiento extends ContadoresCorrida {
  candidatos: CandidatoCorrida[]
  huboErrorCreacion: boolean
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

/** Normaliza el limite guardado; nunca acepta un valor del request. */
function limiteCorridaDe(campana: CampanaEjecutable): number {
  const valor = campana.limiteCorrida
  if (
    !Number.isSafeInteger(valor) ||
    valor < CAMPANA_LIMITE_MIN ||
    valor > CAMPANA_LIMITE_MAX
  ) {
    return CAMPANA_LIMITE_DEFAULT
  }
  return valor
}

/**
 * Normaliza la URL de la web del negocio y su dominio de negocio. Solo
 * HTTP/HTTPS publico, sin credenciales; el resto se descarta como fuente no
 * permitida.
 *
 * `sitioWeb` conserva el host canonico (lowercase, sin `www.`, sin puerto) y
 * `dominio` es el dominio registrable de negocio (`dominioNegocio`), nunca un
 * proveedor de email publico. Si no hay dominio de negocio, la fuente no es
 * prospectable (se descarta como `FUENTE_NO_PERMITIDA`).
 */
function normalizarSitioWeb(
  raw: string,
): { sitioWeb: string; host: string; dominio: string } | null {
  const valor = raw.trim()
  if (valor.length === 0) return null

  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null

  const host = normalizarDominio(url.toString())
  if (host === null) return null

  const dominio = dominioNegocio(url.toString())
  if (dominio === null) return null

  const canonica = new URL(url.toString())
  canonica.hash = ""
  canonica.hostname = host

  return { sitioWeb: canonica.toString(), host, dominio }
}

function statusDeErrorPlaces(codigo: CodigoErrorPlaces): number {
  switch (codigo) {
    case "NO_CONFIGURADO":
      return 503
    case "CONFIGURACION":
      return 503
    case "CUOTA":
      return 429
    case "VALIDACION":
      return 400
    default:
      return 502
  }
}

/**
 * Cierra la campana solo si sigue `EN_CURSO`. Si otra request la cancelo
 * durante la corrida, se respeta `CANCELADA` y no se sobreescribe.
 */
async function finalizarCampana(
  campanaId: string,
  estado: EstadoCampanaProspeccion,
  ultimoError: string | null,
): Promise<string> {
  const actualizada = await prisma.campanaProspeccion.updateMany({
    where: { id: campanaId, estado: "EN_CURSO" },
    data: { estado, finalizadaEn: new Date(), ultimoError },
  })

  if (actualizada.count > 0) return estado

  const actual = await prisma.campanaProspeccion.findUnique({
    where: { id: campanaId },
    select: { estado: true },
  })

  return actual?.estado ?? estado
}

async function procesarLugares(
  campana: CampanaEjecutable,
  lugares: LugarPlaces[],
): Promise<ResultadoProcesamiento> {
  const resultado: ResultadoProcesamiento = {
    creados: 0,
    reutilizados: 0,
    duplicados: 0,
    omitidos: 0,
    candidatos: [],
    huboErrorCreacion: false,
  }

  function agregar(lugar: LugarPlaces, salida: ResultadoCandidato): void {
    resultado.candidatos.push({
      placeId: lugar.placeId,
      nombreTransitorio: lugar.nombreTransitorio,
      sitioWeb: lugar.sitioWeb,
      resultado: salida,
    })
  }

  function omitir(lugar: LugarPlaces, salida: ResultadoCandidato): void {
    resultado.omitidos += 1
    agregar(lugar, salida)
  }

  for (const lugar of lugares) {
    if (!lugar.sitioWeb) {
      omitir(lugar, "SIN_WEB")
      continue
    }

    const sitio = normalizarSitioWeb(lugar.sitioWeb)
    if (sitio === null) {
      omitir(lugar, "FUENTE_NO_PERMITIDA")
      continue
    }
    if (esHostNoProspectable(sitio.dominio)) {
      omitir(lugar, "FUENTE_NO_PERMITIDA")
      continue
    }

    // Supresion por dominio: solo dominios de negocio (nunca proveedores
    // publicos ni plataformas multiinquilino). El email aun no existe.
    const dominioSuprimido = dominioSuprimible(sitio.dominio)
    if (dominioSuprimido !== null) {
      const supresion = await prisma.supresionProspecto.findFirst({
        where: {
          ambito: "DOMINIO",
          activa: true,
          dominioNegocio: dominioSuprimido,
        },
        select: { id: true },
      })
      if (supresion) {
        omitir(lugar, "SUPRIMIDO")
        continue
      }
    }

    // Dedupe contra lo ya guardado (incluye lo creado en esta misma corrida):
    // placeId exacto -> reutilizar; mismo dominio registrable de negocio con
    // otro placeId -> nuevo con `posibleDuplicadoDeId`, nunca fusion
    // automatica. `dominioNormalizado` guarda siempre el registrable, no el
    // host (`sucursal.alfa.com.ar` y `www.alfa.com.ar` deduplican igual).
    const existentes = await prisma.prospecto.findMany({
      where: {
        OR: [
          { placeId: lugar.placeId },
          { dominioNormalizado: sitio.dominio },
        ],
      },
      // Sin email: esta tarea no deduplica por email y no debe leer PII.
      select: { id: true, placeId: true, dominioNormalizado: true },
      take: 50,
    })

    const dedupe = evaluarDedupe(
      { placeId: lugar.placeId, dominioNormalizado: sitio.dominio },
      existentes,
    )

    if (dedupe.tipo === "REUTILIZAR") {
      resultado.reutilizados += 1
      agregar(lugar, "REUTILIZADO")
      continue
    }

    const posibleDuplicadoDeId =
      dedupe.tipo === "POSIBLE_DUPLICADO" ? dedupe.prospectoId : null

    try {
      await prisma.prospecto.create({
        data: {
          nombreNegocio: limpiarNombreNegocio("", sitio.host),
          sitioWeb: sitio.sitioWeb,
          dominioNormalizado: sitio.dominio,
          ciudad: campana.zona,
          rubro: campana.rubro,
          placeId: lugar.placeId,
          estado: "NUEVO",
          fuenteTipo: "PLACES",
          fuenteUrl: sitio.sitioWeb,
          fechaFuente: new Date(),
          posibleDuplicadoDeId,
          campanaOrigenId: campana.id,
        },
        select: { id: true },
      })

      if (posibleDuplicadoDeId !== null) {
        resultado.duplicados += 1
        agregar(lugar, "POSIBLE_DUPLICADO")
      } else {
        resultado.creados += 1
        agregar(lugar, "CREADO")
      }
    } catch (error) {
      if (esErrorTablaFaltante(error)) throw error

      // Carrera de unique por `placeId`: otro proceso lo creo primero. Se
      // reutiliza sin duplicar (misma regla de dedupe).
      if (esErrorUnique(error)) {
        const ganador = await prisma.prospecto.findUnique({
          where: { placeId: lugar.placeId },
          select: { id: true },
        })
        if (ganador) {
          resultado.reutilizados += 1
          agregar(lugar, "REUTILIZADO")
          continue
        }
      }

      resultado.omitidos += 1
      resultado.huboErrorCreacion = true
      agregar(lugar, "ERROR")
      logger.warn("No se pudo crear un prospecto de Places", {
        campanaId: campana.id,
        codigo: "DESCONOCIDO",
      })
    }
  }

  return resultado
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

  // Una corrida de busqueda por admin cada 10/min, ademas del limite general.
  const limiteBusqueda = rateLimitDetalle(
    `propuestas:busqueda:${admin.admin.userId}`,
    LIMITE_BUSQUEDA,
    VENTANA_MS,
  )
  if (!limiteBusqueda.permitido) {
    return errorJson(429, "RATE_LIMIT", {
      "Retry-After": String(limiteBusqueda.retryAfterSegundos),
    })
  }

  const { id } = await params
  const adminId = admin.admin.userId

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return errorJson(400, "VALIDACION")
  }

  const parsed = campanaAccionSchema.safeParse(payload)
  if (!parsed.success) return errorJson(400, "VALIDACION")

  let transicionada = false

  try {
    const campana = await prisma.campanaProspeccion.findUnique({
      where: { id },
      select: {
        id: true,
        consulta: true,
        zona: true,
        rubro: true,
        estado: true,
        limiteCorrida: true,
      },
    })

    if (!campana) return errorJson(404, "NO_ENCONTRADO")
    if (campana.estado !== "BORRADOR") return errorJson(409, "ESTADO")

    // Sin clave de Places se falla cerrado sin consumir cupo ni mover la
    // campana: queda en BORRADOR para reintentar cuando se configure.
    const config = configPropuestas()
    if (!config.places.disponible) return errorJson(503, "NO_CONFIGURADO")

    // Cupo de Places invalido/faltante (0 bloquea): tampoco se transiciona ni
    // se consume cupo. Un tope real agotado se detecta recien en
    // `reservarCupo` (429 CUPO/LIMITE).
    const cupoPlaces = config.cupos.placesDia
    if (!Number.isSafeInteger(cupoPlaces) || cupoPlaces <= 0) {
      return errorJson(503, "CONFIGURACION")
    }

    const transicion = await prisma.campanaProspeccion.updateMany({
      where: { id, estado: "BORRADOR" },
      data: { estado: "EN_CURSO", iniciadaEn: new Date() },
    })

    if (transicion.count === 0) {
      const existe = await prisma.campanaProspeccion.findUnique({
        where: { id },
        select: { id: true },
      })
      return existe
        ? errorJson(409, "ESTADO")
        : errorJson(404, "NO_ENCONTRADO")
    }
    transicionada = true

    // Reserva transaccional: el llamador debe proveer la transaccion para que
    // `pg_advisory_xact_lock` serialice las corridas concurrentes. Los topes
    // salen de la config (hard cap), nunca de este endpoint.
    try {
      await prisma.$transaction((tx) =>
        reservarCupo(tx, {
          campanaId: id,
          proveedor: "GOOGLE_PLACES",
          cantidad: 1,
          llamadas: 1,
        }),
      )
    } catch (error) {
      if (esErrorCupo(error)) {
        const sanitizado = sanitizarError(error, { codigo: error.codigo })
        await finalizarCampana(id, "FALLIDA", sanitizado.mensaje)
        logger.warn("Cupo de Places sin disponibilidad", {
          campanaId: id,
          adminId,
          codigo: error.codigo,
          ambito: error.ambito,
        })
        // Configuracion o entrada invalida no es un tope alcanzado: 503 de
        // configuracion, nunca 429 "cupo alcanzado".
        if (error.ambito === "CONFIGURACION" || error.ambito === "VALIDACION") {
          return errorJson(503, "CONFIGURACION")
        }
        return errorJson(429, error.codigo)
      }
      throw error
    }

    // Revalidacion antes de llamar al proveedor: una cancelacion concurrente
    // pudo sacar la campana de EN_CURSO mientras se reservaba cupo. En ese
    // caso no se llama a Places ni se crean prospectos.
    const estadoActual = await prisma.campanaProspeccion.findUnique({
      where: { id },
      select: { estado: true },
    })
    if (estadoActual?.estado !== "EN_CURSO") {
      logger.info("Corrida detenida antes de Places", {
        campanaId: id,
        adminId,
        estado: estadoActual?.estado ?? "NO_ENCONTRADO",
      })
      return estadoActual
        ? errorJson(409, "ESTADO")
        : errorJson(404, "NO_ENCONTRADO")
    }

    let places: Awaited<ReturnType<typeof buscarLugaresPlaces>>
    try {
      places = await buscarLugaresPlaces({
        textQuery: campana.consulta,
        pageSize: limiteCorridaDe(campana),
      })
    } catch (error) {
      if (esErrorTablaFaltante(error)) throw error
      // El cliente Places no lanza en fallos esperados; cualquier excepcion
      // inesperada se trata como fallo del proveedor, sin reintento.
      const sanitizado = sanitizarError(error, { codigo: "PROVEEDOR" })
      await finalizarCampana(id, "FALLIDA", sanitizado.mensaje)
      logger.error("Error inesperado llamando a Places", {
        campanaId: id,
        adminId,
        codigo: sanitizado.codigo,
      })
      return errorJson(502, "PROVEEDOR")
    }

    if (!places.ok) {
      const sanitizado = sanitizarError(null, { codigo: places.codigo })
      const estado = await finalizarCampana(id, "FALLIDA", sanitizado.mensaje)
      logger.warn("La busqueda en Places fallo", {
        campanaId: id,
        adminId,
        codigo: places.codigo,
        estado,
      })
      return errorJson(statusDeErrorPlaces(places.codigo), places.codigo)
    }

    let procesado: ResultadoProcesamiento
    try {
      procesado = await procesarLugares(campana, places.lugares)
    } catch (error) {
      if (esErrorTablaFaltante(error)) {
        await finalizarCampana(
          id,
          "FALLIDA",
          sanitizarError(null, { codigo: "ESQUEMA_NO_APLICADO" }).mensaje,
        )
        return errorJson(503, "ESQUEMA_NO_APLICADO")
      }
      throw error
    }

    const estadoFinal: EstadoCampanaProspeccion = procesado.huboErrorCreacion
      ? "PARCIAL"
      : "COMPLETADA"
    const ultimoError = procesado.huboErrorCreacion
      ? sanitizarError(null, {
          codigo: "DESCONOCIDO",
          mensaje: "Algunos resultados no se pudieron guardar.",
        }).mensaje
      : null

    const estado = await finalizarCampana(id, estadoFinal, ultimoError)

    logger.info("Corrida de prospeccion finalizada", {
      campanaId: id,
      adminId,
      estado,
      creados: procesado.creados,
      reutilizados: procesado.reutilizados,
      duplicados: procesado.duplicados,
      omitidos: procesado.omitidos,
    })

    return json(
      {
        estado,
        creados: procesado.creados,
        reutilizados: procesado.reutilizados,
        duplicados: procesado.duplicados,
        omitidos: procesado.omitidos,
        candidatos: procesado.candidatos,
      },
      200,
    )
  } catch (error) {
    const faltante = esErrorTablaFaltante(error)
    const sanitizado = faltante
      ? sanitizarError(null, { codigo: "ESQUEMA_NO_APLICADO" })
      : sanitizarError(error, {
          codigo: "DESCONOCIDO",
          mensaje: "Error inesperado.",
        })

    // Cierre de mejor esfuerzo antes de responder (incluye el esquema
    // faltante): no dejar la campana colgada en EN_CURSO. `finalizarCampana`
    // filtra por estado, asi que no pisa una cancelacion concurrente. Si el
    // cierre falla (por ejemplo, porque el propio cierre de un fallo de
    // Places lanzo P2021), la respuesta de error no depende de el.
    if (transicionada) {
      try {
        await finalizarCampana(id, "FALLIDA", sanitizado.mensaje)
      } catch {
        // Mejor esfuerzo: se responde igual.
      }
    }

    if (faltante) {
      return errorJson(503, "ESQUEMA_NO_APLICADO")
    }

    logger.error("Error ejecutando campana de propuestas", {
      codigo: sanitizado.codigo,
      campanaId: id,
      adminId,
    })

    return json({ error: sanitizado.mensaje, codigo: "DESCONOCIDO" }, 500)
  }
}
