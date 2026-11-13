import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import { hashEmail } from "@/lib/propuestas/supresion"

/**
 * T-22 (AC-37; RF-30, RF-65): atención de solicitudes ARCO.
 *
 * Rutas ejercitadas con Clerk, Prisma y logger mockeados:
 * - EXPORTAR: JSON descargable con datos/fuentes/auditoría/envíos/historial y
 *   sin tokens, hashes, idempotency keys, notas internas ni datos del CRM;
 * - ELIMINAR: crea la supresión `SOLICITUD_ARCO` antes de borrar cuando hay
 *   email, la conserva después, no crea supresión si no hay email, exige
 *   confirmación explícita, es idempotente/404 y no borra supresiones;
 * - RECTIFICAR: solo campos permitidos, motivo obligatorio, historial y
 *   arcoHistorial, email con fuente/supresión/duplicado, sin tocar estado,
 *   campaña ni score; 404/400/409/503.
 * - auth admin/asistente, origen, rate limit, `no-store` y logs sin PII.
 *
 * Ningún test hace red real: `fetch` queda stubbeado y las rutas no lo usan.
 */

const mocks = vi.hoisted(() => {
  const prospecto = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  }
  const supresionProspecto = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  }
  const tx = { prospecto, supresionProspecto }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    prospecto,
    supresionProspecto,
    tx,
    transaction: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  }
})

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospecto: mocks.prospecto,
    supresionProspecto: mocks.supresionProspecto,
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

import { POST as arcoApi } from "@/app/api/propuestas/arco/[prospectoId]/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.55"
const IP_RATE = "198.51.100.56"
const SECRETO = "secreto-de-pruebas-arco-0123456789abcdef"
const PROSPECTO_ID = "pros_1"
const EMAIL = "ventas@alfa.com.ar"
const EMAIL_NUEVO = "nuevo@alfa.com.ar"

const MARCADORES = {
  tokenBaja: "TOKEN_BAJA_MARCADOR",
  hashContenido: "HASH_CONTENIDO_MARCADOR",
  aprobadoHash: "APROBADO_HASH_MARCADOR",
  idempotencyKey: "IDEMPOTENCY_MARCADOR",
  emailHash: "EMAIL_HASH_MARCADOR",
  notas: "NOTA_INTERNA_MARCADOR",
  cuerpoHtml: "CUERPO_HTML_MARCADOR",
  cuerpoTexto: "CUERPO_TEXTO_MARCADOR",
  crm: "CRM_MARCADOR",
  crmPago: "CRM_PAGO_MARCADOR",
  nombre: "Consultora Alfa",
  telefono: "+541155551234",
} as const

function simularAdmin(
  role: unknown = "admin",
  userId = "user_1",
  nombre = "Ana Pérez",
): void {
  mocks.auth.mockResolvedValue({ userId })
  mocks.getUser.mockResolvedValue({
    id: userId,
    fullName: nombre,
    firstName: nombre.split(" ")[0],
    publicMetadata: { role },
  })
}

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function pedido(
  body: unknown,
  opciones: OpcionesPedido = {},
  id = PROSPECTO_ID,
): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (opciones.origin !== null) {
    headers.set("origin", opciones.origin ?? ORIGEN)
  }
  if (opciones.ip !== null) {
    headers.set("x-forwarded-for", opciones.ip ?? IP)
  }

  return new Request(`${ORIGEN}/api/propuestas/arco/${id}`, {
    method: "POST",
    headers,
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function contexto(id = PROSPECTO_ID): {
  params: Promise<{ prospectoId: string }>
} {
  return { params: Promise.resolve({ prospectoId: id }) }
}

async function jsonDe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function logsDeMocks(): string {
  return JSON.stringify([
    ...mocks.loggerInfo.mock.calls,
    ...mocks.loggerWarn.mock.calls,
    ...mocks.loggerError.mock.calls,
  ])
}

function sinPii(texto: string): void {
  expect(texto).not.toContain(EMAIL)
  expect(texto).not.toContain(EMAIL_NUEVO)
  expect(texto).not.toContain(MARCADORES.nombre)
  expect(texto).not.toContain(MARCADORES.telefono)
}

/** Hash de evidencia ARCO: SHA-256 del motivo ya recortado por el dominio. */
function hashMotivo(motivo: string): string {
  return createHash("sha256").update(motivo, "utf8").digest("hex")
}

function limpiarRateLimits(): void {
  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    `propuestas:ip:${IP}`,
    `propuestas:ip:${IP_RATE}`,
  ]) {
    resetRateLimit(clave)
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const FECHA = new Date("2026-11-10T12:00:00.000Z")

function prospectoExportFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PROSPECTO_ID,
    nombreNegocio: MARCADORES.nombre,
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    ciudad: "CABA",
    rubro: "Consultoría",
    placeId: "place_1",
    email: EMAIL,
    telefono: MARCADORES.telefono,
    contactoNombre: "Ana",
    contactoCargo: "Socia",
    emailFuenteUrl: "https://alfa.com.ar/contacto",
    emailFechaFuente: FECHA,
    fuenteTipo: "CARGA_MANUAL",
    fuenteUrl: "https://alfa.com.ar/contacto",
    fechaFuente: FECHA,
    estado: "PUNTUADO",
    score: 88,
    scoreDetalle: { total: 88, componentes: [] },
    auditoriaResumen: {
      estado: "OK",
      fecha: FECHA.toISOString(),
      scores: { velocidad: 40, ssl: 90, seo: 50, seguridad: 60 },
      findings: [{ type: "warn", text: "Mejorar velocidad." }],
    },
    auditoriaEstado: "OK",
    auditoriaFecha: FECHA,
    baseLegal: "Base legal aprobada.",
    notaLegal: "Aviso de privacidad.",
    motivoSinEnriquecer: null,
    historial: [
      {
        accion: "CREACION",
        por: "user_1",
        en: "2026-11-01T10:00:00.000Z",
        motivo: "Alta manual con fuente",
        campos: ["email", "sitioWeb"],
      },
      {
        accion: "CORRECCION",
        por: "user_1",
        en: "2026-11-02T10:00:00.000Z",
        motivo: "Corrección solicitada",
        campos: ["telefono"],
      },
    ],
    arcoHistorial: [
      {
        accion: "EXPORTACION",
        por: "user_1",
        en: "2026-11-09T10:00:00.000Z",
        campos: ["email"],
      },
    ],
    creadoEn: FECHA,
    actualizadoEn: FECHA,
    ultimaInteraccionEn: FECHA,
    ultimoEnvioEn: FECHA,
    campanaOrigen: {
      id: "camp_1",
      nombre: "Campaña Alfa",
      estado: "EN_CURSO",
    },
    envios: [
      {
        id: "env_1",
        secuencia: 1,
        version: 1,
        estado: "ENVIADO",
        creadoEn: FECHA,
        aprobadoEn: FECHA,
        enviadoEn: FECHA,
        proveedorMessageId: "msg_1",
        // Campos que la exportación debe excluir:
        tokenBaja: MARCADORES.tokenBaja,
        hashContenido: MARCADORES.hashContenido,
        aprobadoHash: MARCADORES.aprobadoHash,
        idempotencyKey: MARCADORES.idempotencyKey,
        cuerpoHtml: MARCADORES.cuerpoHtml,
        cuerpoTexto: MARCADORES.cuerpoTexto,
      },
    ],
    // Campos internos que no deben exportarse:
    notas: MARCADORES.notas,
    emailHash: MARCADORES.emailHash,
    posibleDuplicadoDeId: "pros_dup",
    actualizadoPor: "user_1",
    clienteId: MARCADORES.crm,
    pago: MARCADORES.crmPago,
    ...overrides,
  }
}

interface ProspectoRectificableFixture {
  id: string
  estado: string
  nombreNegocio: string
  sitioWeb: string | null
  dominioNormalizado: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  rubro: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
  historial: unknown[]
  arcoHistorial: unknown[]
}

function prospectoRectificableFixture(
  overrides: Partial<ProspectoRectificableFixture> = {},
): ProspectoRectificableFixture {
  return {
    id: PROSPECTO_ID,
    estado: "PUNTUADO",
    nombreNegocio: MARCADORES.nombre,
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    email: EMAIL,
    telefono: MARCADORES.telefono,
    ciudad: "CABA",
    rubro: "Consultoría",
    contactoNombre: "Ana",
    contactoCargo: "Socia",
    fuenteUrl: "https://alfa.com.ar/contacto",
    emailFuenteUrl: "https://alfa.com.ar/contacto",
    historial: [
      {
        accion: "CREACION",
        por: "user_1",
        en: "2026-11-01T10:00:00.000Z",
        campos: ["email"],
      },
    ],
    arcoHistorial: [],
    ...overrides,
  }
}

interface ArgsUpdateProspecto {
  where: Record<string, unknown>
  data: Record<string, unknown>
}

interface ArgsUpsertSupresion {
  where: { clave: string }
  create: Record<string, unknown>
  update: Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubEnv("NEXT_PUBLIC_URL", ORIGEN)
  vi.stubEnv("PROPUESTAS_SECRETO", SECRETO)

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })

  mocks.prospecto.findUnique.mockResolvedValue(null)
  mocks.prospecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.prospecto.deleteMany.mockResolvedValue({ count: 1 })

  mocks.supresionProspecto.findUnique.mockResolvedValue(null)
  mocks.supresionProspecto.findMany.mockResolvedValue([])
  mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_1" })
  mocks.supresionProspecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.supresionProspecto.deleteMany.mockResolvedValue({ count: 0 })

  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
      callback(mocks.tx),
  )

  vi.stubGlobal("fetch", vi.fn())
  limpiarRateLimits()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  limpiarRateLimits()
})

/* ------------------------------------------------------------------ */
/* Auth, origen y rate limit                                           */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/arco/[prospectoId]: guard y controles (AC-37)", () => {
  it("AC-37: sin sesión responde 401 y no consulta datos", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto(),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_AUTORIZADO" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
  })

  it("AC-37: un asistente recibe 403", async () => {
    simularAdmin("asistente", "user_2", "Asistente")

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto(),
    )

    expect(res.status).toBe(403)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "PROHIBIDO" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
  })

  it("AC-37: un origen distinto recibe 403", async () => {
    const res = await arcoApi(
      pedido(
        { tipo: "EXPORTAR" },
        { origin: "https://otro.example" },
      ),
      contexto(),
    )

    expect(res.status).toBe(403)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ORIGEN_INVALIDO" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
  })

  it("AC-37: aplica rate limit por admin con Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto(),
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(await jsonDe(res)).toMatchObject({ codigo: "RATE_LIMIT" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
  })

  it("AC-37: un body inválido responde 400 sin tocar datos", async () => {
    const res = await arcoApi(
      pedido({}, { rawBody: "{no-es-json" }),
      contexto(),
    )

    expect(res.status).toBe(400)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* EXPORTAR                                                            */
/* ------------------------------------------------------------------ */

describe("EXPORTAR (AC-37)", () => {
  it("AC-37: devuelve un JSON descargable con datos, fuentes, auditoría, envíos e historial", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoExportFixture())

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    )
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="arco-pros_1.json"',
    )
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")

    const body = (await jsonDe(res)) as {
      tipo: string
      formato: string
      prospecto: {
        id: string
        nombreNegocio: string
        contacto: Record<string, unknown>
        fuentes: Record<string, unknown>
        auditoria: Record<string, unknown>
        campana: Record<string, unknown>
        fechas: Record<string, unknown>
        envios: Array<Record<string, unknown>>
        historial: Array<Record<string, unknown>>
        arco: Array<Record<string, unknown>>
        [clave: string]: unknown
      }
    }

    expect(body.tipo).toBe("EXPORTAR")
    expect(body.formato).toBe("pixelarch-propuestas-arco-v1")
    expect(body.prospecto.id).toBe(PROSPECTO_ID)
    expect(body.prospecto.nombreNegocio).toBe(MARCADORES.nombre)
    expect(body.prospecto.contacto).toMatchObject({
      email: EMAIL,
      telefono: MARCADORES.telefono,
      contactoNombre: "Ana",
    })
    expect(body.prospecto.fuentes).toMatchObject({
      fuenteTipo: "CARGA_MANUAL",
      fuenteUrl: "https://alfa.com.ar/contacto",
      emailFuenteUrl: "https://alfa.com.ar/contacto",
      fechaFuente: FECHA.toISOString(),
      emailFechaFuente: FECHA.toISOString(),
    })
    expect(body.prospecto.auditoria).toMatchObject({
      estado: "OK",
      fecha: FECHA.toISOString(),
    })
    expect(body.prospecto.campana).toEqual({
      id: "camp_1",
      nombre: "Campaña Alfa",
      estado: "EN_CURSO",
    })
    expect(body.prospecto.fechas).toMatchObject({
      creadoEn: FECHA.toISOString(),
      ultimaInteraccionEn: FECHA.toISOString(),
      ultimoEnvioEn: FECHA.toISOString(),
    })
    expect(body.prospecto.envios).toHaveLength(1)
    expect(body.prospecto.envios[0]).toMatchObject({
      id: "env_1",
      secuencia: 1,
      version: 1,
      estado: "ENVIADO",
      messageId: "msg_1",
    })

    // Historial saneado: solo acción, fecha y nombres de campos.
    expect(body.prospecto.historial).toEqual([
      {
        accion: "CREACION",
        en: "2026-11-01T10:00:00.000Z",
        campos: ["email", "sitioWeb"],
      },
      {
        accion: "CORRECCION",
        en: "2026-11-02T10:00:00.000Z",
        campos: ["telefono"],
      },
    ])
    expect(body.prospecto.arco).toEqual([
      {
        accion: "EXPORTACION",
        en: "2026-11-09T10:00:00.000Z",
      },
    ])
  })

  it("AC-37: no exporta tokens, hashes, idempotency keys, notas internas ni CRM", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoExportFixture())

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto(),
    )
    const body = (await jsonDe(res)) as {
      prospecto: Record<string, unknown> & {
        envios: Array<Record<string, unknown>>
      }
    }
    const texto = JSON.stringify(body)

    for (const marcador of [
      MARCADORES.tokenBaja,
      MARCADORES.hashContenido,
      MARCADORES.aprobadoHash,
      MARCADORES.idempotencyKey,
      MARCADORES.emailHash,
      MARCADORES.notas,
      MARCADORES.cuerpoHtml,
      MARCADORES.cuerpoTexto,
      MARCADORES.crm,
      MARCADORES.crmPago,
    ]) {
      expect(texto).not.toContain(marcador)
    }

    expect(body.prospecto).not.toHaveProperty("notas")
    expect(body.prospecto).not.toHaveProperty("emailHash")
    expect(body.prospecto).not.toHaveProperty("tokenBaja")
    expect(body.prospecto).not.toHaveProperty("hashContenido")
    expect(body.prospecto).not.toHaveProperty("aprobadoHash")
    expect(body.prospecto).not.toHaveProperty("idempotencyKey")
    expect(body.prospecto.envios[0]).not.toHaveProperty("tokenBaja")
    expect(body.prospecto.envios[0]).not.toHaveProperty("hashContenido")
    expect(body.prospecto.envios[0]).not.toHaveProperty("aprobadoHash")
    expect(body.prospecto.envios[0]).not.toHaveProperty("idempotencyKey")
    expect(Object.keys(body.prospecto.envios[0]).sort()).toEqual(
      [
        "aprobadoEn",
        "creadoEn",
        "enviadoEn",
        "estado",
        "id",
        "messageId",
        "secuencia",
        "version",
      ].sort(),
    )
  })

  it("AC-37: el select de la consulta excluye los campos sensibles", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoExportFixture())

    await arcoApi(pedido({ tipo: "EXPORTAR" }), contexto())

    const args = mocks.prospecto.findUnique.mock.calls[0]?.[0] as {
      select: Record<string, unknown>
    }
    expect(args.select).toMatchObject({ id: true, email: true, historial: true })
    for (const campo of [
      "notas",
      "tokenBaja",
      "hashContenido",
      "aprobadoHash",
      "idempotencyKey",
      "emailHash",
    ]) {
      expect(args.select).not.toHaveProperty(campo)
    }
  })

  it("AC-37: registra la exportación en arcoHistorial sin PII en logs", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoExportFixture())

    await arcoApi(pedido({ tipo: "EXPORTAR" }), contexto())

    expect(mocks.prospecto.updateMany).toHaveBeenCalledTimes(1)
    const args = mocks.prospecto.updateMany.mock.calls[0]?.[0] as ArgsUpdateProspecto
    expect(args.where).toEqual({ id: PROSPECTO_ID })

    const historial = args.data.arcoHistorial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[historial.length - 1]).toMatchObject({
      accion: "EXPORTACION",
      por: "user_1",
    })
    expect(historial[historial.length - 1]?.en).toEqual(expect.any(String))

    expect(logsDeMocks()).toContain("ARCO exportacion")
    sinPii(logsDeMocks())
  })

  it("AC-37: 404 si el prospecto no existe", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(null)

    const res = await arcoApi(
      pedido({ tipo: "EXPORTAR" }),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_ENCONTRADO" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* ELIMINAR                                                            */
/* ------------------------------------------------------------------ */

describe("ELIMINAR (AC-37)", () => {
  it("AC-37: con email crea la supresión SOLICITUD_ARCO antes de borrar y la conserva", async () => {
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_arco" })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toEqual({
      eliminado: true,
      supresion: { id: "sup_arco", creada: true, reactivada: false },
    })

    // Orden: supresión primero, borrado después.
    expect(
      mocks.supresionProspecto.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.prospecto.deleteMany.mock.invocationCallOrder[0]!)

    const args = mocks.supresionProspecto.upsert.mock.calls[0]?.[0] as ArgsUpsertSupresion
    const hash = hashEmail(EMAIL, SECRETO)

    expect(args.where.clave).toBe(`EMAIL:${hash}`)
    expect(args.create).toMatchObject({
      ambito: "EMAIL",
      clave: `EMAIL:${hash}`,
      emailHash: hash,
      emailEnmascarado: "v***@alfa.com.ar",
      motivo: "SOLICITUD_ARCO",
      origen: "ARCO",
      activa: true,
      creadaPor: "user_1",
    })
    expect(JSON.stringify(args.create)).not.toContain(EMAIL)

    expect(mocks.prospecto.deleteMany).toHaveBeenCalledWith({
      where: { id: PROSPECTO_ID },
    })
    // La supresión no se borra ni se modifica desde la purga ARCO.
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()

    expect(logsDeMocks()).toContain("ARCO eliminacion")
    sinPii(logsDeMocks())
  })

  it("AC-37: con supresión ya activa agrega SOLICITUD_ARCO sin pisar motivo/origen/creador/fecha", async () => {
    const motivo = "Supresión pedida por el titular"
    const historialPrevio = [
      {
        accion: "CREADA",
        por: "user_9",
        en: "2026-11-01T10:00:00.000Z",
        motivo: "QUEJA",
        origen: "OPT_OUT",
      },
    ]
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_activa",
      activa: true,
      historial: historialPrevio,
      motivo: "QUEJA",
      origen: "OPT_OUT",
      creadaPor: "user_9",
      creadaPorNombre: "Beto Gómez",
      creadaEn: new Date("2026-11-01T10:00:00.000Z"),
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true, motivo }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      eliminado: true,
      supresion: { id: "sup_activa", creada: false, reactivada: false },
    })

    // La supresión existente se conserva: no se recrea, reactiva ni borra.
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).toHaveBeenCalledTimes(1)

    const args = mocks.supresionProspecto.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(args.where).toEqual({ id: "sup_activa" })
    // Solo se agrega historial: no se pisan motivo/origen/creadaPor/creadaEn.
    expect(Object.keys(args.data)).toEqual(["historial"])
    for (const campo of [
      "motivo",
      "origen",
      "creadaPor",
      "creadaPorNombre",
      "creadaEn",
      "activa",
    ]) {
      expect(args.data).not.toHaveProperty(campo)
    }

    const historial = args.data.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[0]).toEqual(historialPrevio[0])
    expect(historial[1]).toMatchObject({
      accion: "SOLICITUD_ARCO",
      motivoHash: hashMotivo(motivo),
      motivoLongitud: motivo.length,
      por: "user_1",
    })
    expect(historial[1]?.en).toEqual(expect.any(String))

    // Evidencia sin PII: el texto libre, el email y el token no se guardan.
    const serializado = JSON.stringify([args, logsDeMocks()])
    expect(serializado).not.toContain(motivo)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain(MARCADORES.tokenBaja)
    expect(serializado.toLowerCase()).not.toContain("ventas@alfa.com.ar")

    // La evidencia se agrega antes de borrar la ficha y la supresión sobrevive.
    expect(
      mocks.supresionProspecto.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.prospecto.deleteMany.mock.invocationCallOrder[0]!)
  })

  it("AC-37: con supresión revocada la reactiva y agrega REACTIVADA + SOLICITUD_ARCO", async () => {
    const motivo = "Solicitud ARCO del titular"
    const historialPrevio = [
      {
        accion: "CREADA",
        por: "user_9",
        en: "2026-11-01T10:00:00.000Z",
        motivo: "QUEJA",
        origen: "OPT_OUT",
      },
      {
        accion: "REVOCADA",
        por: "user_9",
        en: "2026-11-02T10:00:00.000Z",
        motivo: "Autorización expresa",
      },
    ]
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })
    mocks.supresionProspecto.findUnique.mockResolvedValue({
      id: "sup_revocada",
      activa: false,
      historial: historialPrevio,
      motivo: "QUEJA",
      origen: "OPT_OUT",
      creadaPor: "user_9",
      creadaPorNombre: "Beto Gómez",
      creadaEn: new Date("2026-11-01T10:00:00.000Z"),
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_revocada" })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true, motivo }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      eliminado: true,
      supresion: { id: "sup_revocada", creada: false, reactivada: true },
    })

    expect(mocks.supresionProspecto.upsert).toHaveBeenCalledTimes(1)
    const args = mocks.supresionProspecto.upsert.mock.calls[0]?.[0] as ArgsUpsertSupresion
    const update = args.update

    // Reactivación sin pisar los datos originales de la supresión.
    expect(update).toMatchObject({
      activa: true,
      revocadaPor: null,
      revocadaEn: null,
      motivoRevocacion: null,
    })
    for (const campo of [
      "motivo",
      "origen",
      "creadaPor",
      "creadaPorNombre",
      "creadaEn",
    ]) {
      expect(update).not.toHaveProperty(campo)
    }

    const historial = update.historial as Array<Record<string, unknown>>
    expect(historial.map((entrada) => entrada.accion)).toEqual([
      "CREADA",
      "REVOCADA",
      "REACTIVADA",
      "SOLICITUD_ARCO",
    ])
    expect(historial[2]).toMatchObject({
      accion: "REACTIVADA",
      por: "user_1",
      motivo: "SOLICITUD_ARCO",
    })
    expect(historial[3]).toMatchObject({
      accion: "SOLICITUD_ARCO",
      motivoHash: hashMotivo(motivo),
      motivoLongitud: motivo.length,
      por: "user_1",
    })

    const serializado = JSON.stringify([args, logsDeMocks()])
    expect(serializado).not.toContain(motivo)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain(MARCADORES.tokenBaja)

    // La supresión conservada no se borra y la ficha sí.
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).toHaveBeenCalledWith({
      where: { id: PROSPECTO_ID },
    })
  })

  it("AC-37: sin email no crea supresión y deja el log sanitizado como único rastro", async () => {
    const motivo = "Titular sin email cargado"
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: null,
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true, motivo }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ eliminado: true, supresion: null })

    // Sin email no se inventa una supresión: no hay fila durable donde anotar.
    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).toHaveBeenCalledWith({
      where: { id: PROSPECTO_ID },
    })

    // Único rastro documentado: el log operativo sanitizado, con hash y
    // longitud del motivo, autor y fecha; nunca el texto libre ni PII.
    const llamada = mocks.loggerInfo.mock.calls.find(
      ([evento]) => evento === "ARCO eliminacion",
    )
    expect(llamada).toBeDefined()
    const log = llamada?.[1] as Record<string, unknown>
    expect(log).toMatchObject({
      prospectoId: PROSPECTO_ID,
      adminId: "user_1",
      por: "user_1",
      motivoHash: hashMotivo(motivo),
      motivoLongitud: motivo.length,
      supresionId: null,
      supresionCreada: false,
      supresionReactivada: false,
    })
    expect(log).not.toHaveProperty("motivo")
    expect(logsDeMocks()).not.toContain(motivo)
    expect(logsDeMocks()).not.toContain(EMAIL)
  })

  it("AC-37: sin motivo responde 200 y registra motivoHash null con longitud 0", async () => {
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_arco" })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      eliminado: true,
      supresion: { id: "sup_arco", creada: true, reactivada: false },
    })

    // El contrato permite omitir el motivo: no falla y deja evidencia neutra.
    const args = mocks.supresionProspecto.upsert.mock.calls[0]?.[0] as ArgsUpsertSupresion
    const historial = args.create.historial as Array<Record<string, unknown>>
    const solicitud = historial.find(
      (entrada) => entrada.accion === "SOLICITUD_ARCO",
    )
    expect(solicitud).toMatchObject({
      accion: "SOLICITUD_ARCO",
      motivoHash: null,
      motivoLongitud: 0,
      por: "user_1",
    })
    expect(solicitud).not.toHaveProperty("motivo")

    const log = mocks.loggerInfo.mock.calls.find(
      ([evento]) => evento === "ARCO eliminacion",
    )?.[1] as Record<string, unknown>
    expect(log).toMatchObject({ motivoHash: null, motivoLongitud: 0 })
  })

  it("AC-37: un motivo con nombre, teléfono, email o token solo deja hash y longitud", async () => {
    const motivo = `Titular ${MARCADORES.nombre}, tel ${MARCADORES.telefono}, email ${EMAIL}, token ${MARCADORES.tokenBaja}`
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })
    mocks.supresionProspecto.upsert.mockResolvedValue({ id: "sup_arco" })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true, motivo }),
      contexto(),
    )

    expect(res.status).toBe(200)

    const args = mocks.supresionProspecto.upsert.mock.calls[0]?.[0] as ArgsUpsertSupresion
    const serializado = JSON.stringify([args, logsDeMocks()])

    // Ni el historial de la supresión ni los logs contienen el texto libre.
    for (const dato of [
      MARCADORES.nombre,
      MARCADORES.telefono,
      EMAIL,
      MARCADORES.tokenBaja,
    ]) {
      expect(serializado).not.toContain(dato)
    }

    const historial = args.create.historial as Array<Record<string, unknown>>
    const solicitud = historial.find(
      (entrada) => entrada.accion === "SOLICITUD_ARCO",
    )
    expect(solicitud).toMatchObject({
      motivoHash: hashMotivo(motivo.trim()),
      motivoLongitud: motivo.trim().length,
      por: "user_1",
    })
    expect(solicitud).not.toHaveProperty("motivo")
  })

  it("AC-37: sin email no crea supresión y borra la ficha", async () => {
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: null,
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      eliminado: true,
      supresion: null,
    })
    expect(mocks.supresionProspecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("AC-37: con email y sin secreto falla cerrado con 503 y no borra", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", "")
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(503)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-37: exige confirmación explícita antes de borrar", async () => {
    mocks.prospecto.findUnique.mockResolvedValue({
      id: PROSPECTO_ID,
      email: EMAIL,
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR" }),
      contexto(),
    )

    expect(res.status).toBe(400)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.supresionProspecto.upsert).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-37: rechaza confirmado distinto de true", async () => {
    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: false }),
      contexto(),
    )

    expect(res.status).toBe(400)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-37: devuelve 404 si el prospecto no existe", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(null)

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(404)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_ENCONTRADO" })
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-37: un segundo intento responde 404 y no vuelve a borrar", async () => {
    mocks.prospecto.findUnique
      .mockResolvedValueOnce({ id: PROSPECTO_ID, email: EMAIL })
      .mockResolvedValueOnce(null)

    const primera = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )
    const segunda = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(404)
    expect(mocks.prospecto.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("AC-37: un esquema no aplicado responde 503 sanitizado", async () => {
    mocks.prospecto.findUnique.mockRejectedValue({
      code: "P2021",
      message: 'relation "Prospecto" does not exist',
    })

    const res = await arcoApi(
      pedido({ tipo: "ELIMINAR", confirmado: true }),
      contexto(),
    )

    expect(res.status).toBe(503)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ESQUEMA_NO_APLICADO" })
    expect(logsDeMocks()).not.toMatch(/P2021|Prospecto/)
  })
})

/* ------------------------------------------------------------------ */
/* RECTIFICAR                                                          */
/* ------------------------------------------------------------------ */

describe("RECTIFICAR (AC-37)", () => {
  it("AC-37: aplica campos permitidos con motivo, historial y arcoHistorial sin tocar estado/campaña/score", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoRectificableFixture())

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: { telefono: "  +5491100001111 ", ciudad: "Rosario" },
        motivo: "Pedido ARCO del titular",
      }),
      contexto(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toEqual({
      id: PROSPECTO_ID,
      rectificado: true,
      campos: ["telefono", "ciudad"],
    })

    expect(mocks.prospecto.updateMany).toHaveBeenCalledTimes(1)
    const args = mocks.prospecto.updateMany.mock.calls[0]?.[0] as ArgsUpdateProspecto

    expect(args.where).toEqual({
      id: PROSPECTO_ID,
      estado: { not: "SUPRIMIDO" },
    })
    expect(args.data).toMatchObject({
      telefono: "+5491100001111",
      ciudad: "Rosario",
      actualizadoPor: "user_1",
    })
    expect(args.data.ultimaInteraccionEn).toEqual(expect.any(Date))

    const historial = args.data.historial as Array<Record<string, unknown>>
    expect(historial).toHaveLength(2)
    expect(historial[historial.length - 1]).toMatchObject({
      accion: "CORRECCION",
      campos: ["telefono", "ciudad"],
      motivo: "Pedido ARCO del titular",
      por: "user_1",
    })

    const arcoHistorial = args.data.arcoHistorial as Array<
      Record<string, unknown>
    >
    expect(arcoHistorial).toHaveLength(1)
    expect(arcoHistorial[0]).toMatchObject({
      accion: "RECTIFICACION",
      por: "user_1",
      campos: ["telefono", "ciudad"],
    })

    // No se tocan estado, campaña, score ni la procedencia del email.
    for (const campo of [
      "estado",
      "campanaOrigenId",
      "score",
      "scoreDetalle",
      "email",
      "emailFechaFuente",
    ]) {
      expect(args.data).not.toHaveProperty(campo)
    }

    expect(logsDeMocks()).toContain("ARCO rectificacion")
    sinPii(logsDeMocks())
  })

  it("AC-37: un email nuevo exige fuente, normaliza y la registra", async () => {
    mocks.prospecto.findUnique
      .mockResolvedValueOnce(prospectoRectificableFixture())
      .mockResolvedValueOnce(null)

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: {
          email: "  Nuevo@Alfa.com.ar ",
          emailFuenteUrl: "https://alfa.com.ar/contacto-nuevo",
        },
        motivo: "Correo actualizado por el titular",
      }),
      contexto(),
    )

    expect(res.status).toBe(200)
    const args = mocks.prospecto.updateMany.mock.calls[0]?.[0] as ArgsUpdateProspecto
    expect(args.data).toMatchObject({
      email: EMAIL_NUEVO,
      emailFuenteUrl: "https://alfa.com.ar/contacto-nuevo",
    })
    expect(args.data.emailFechaFuente).toEqual(expect.any(Date))
    expect(args.data.fechaFuente).toBeUndefined()
  })

  it("AC-37: un email suprimido responde 409 y no actualiza", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(prospectoRectificableFixture())
    mocks.supresionProspecto.findMany.mockResolvedValue([
      { ambito: "EMAIL", emailHash: hashEmail(EMAIL_NUEVO, SECRETO) },
    ])

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: {
          email: EMAIL_NUEVO,
          emailFuenteUrl: "https://alfa.com.ar/contacto",
        },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(409)
    expect(await jsonDe(res)).toMatchObject({ codigo: "SUPRIMIDO" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("AC-37: un email que ya pertenece a otro prospecto responde 409 sin fusionar", async () => {
    mocks.prospecto.findUnique
      .mockResolvedValueOnce(prospectoRectificableFixture())
      .mockResolvedValueOnce({ id: "pros_2" })

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: {
          email: EMAIL_NUEVO,
          emailFuenteUrl: "https://alfa.com.ar/contacto",
        },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(409)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ESTADO" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("AC-37: cambiar el email sin fuente responde 400 y no actualiza", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(
      prospectoRectificableFixture({
        emailFuenteUrl: null,
        fuenteUrl: null,
      }),
    )

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: { email: EMAIL_NUEVO },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(400)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("AC-37: cambiar el email sin secreto falla cerrado con 503", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", "")
    mocks.prospecto.findUnique.mockResolvedValue(prospectoRectificableFixture())

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: {
          email: EMAIL_NUEVO,
          emailFuenteUrl: "https://alfa.com.ar/contacto",
        },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(503)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("AC-37: un prospecto suprimido responde 409", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(
      prospectoRectificableFixture({ estado: "SUPRIMIDO" }),
    )

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: { telefono: "+5491100001111" },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(409)
    expect(await jsonDe(res)).toMatchObject({ codigo: "SUPRIMIDO" })
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("AC-37: 404 si el prospecto no existe", async () => {
    mocks.prospecto.findUnique.mockResolvedValue(null)

    const res = await arcoApi(
      pedido({
        tipo: "RECTIFICAR",
        cambios: { telefono: "+5491100001111" },
        motivo: "Correo actualizado",
      }),
      contexto(),
    )

    expect(res.status).toBe(404)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_ENCONTRADO" })
  })

  it.each([
    [
      "sin motivo",
      { tipo: "RECTIFICAR", cambios: { telefono: "+5491100001111" } },
    ],
    ["sin cambios", { tipo: "RECTIFICAR", motivo: "Motivo" }],
    [
      "con cambios vacíos",
      { tipo: "RECTIFICAR", cambios: {}, motivo: "Motivo" },
    ],
    [
      "con un campo no permitido",
      {
        tipo: "RECTIFICAR",
        cambios: { score: "99" },
        motivo: "Motivo",
      },
    ],
    [
      "con email inválido",
      {
        tipo: "RECTIFICAR",
        cambios: { email: "no-es-email" },
        motivo: "Motivo",
      },
    ],
  ])("AC-37: 400 %s", async (_caso, body) => {
    const res = await arcoApi(pedido(body), contexto())

    expect(res.status).toBe(400)
    expect(await jsonDe(res)).toMatchObject({ codigo: "VALIDACION" })
    expect(mocks.prospecto.findUnique).not.toHaveBeenCalled()
    expect(mocks.prospecto.updateMany).not.toHaveBeenCalled()
  })
})
