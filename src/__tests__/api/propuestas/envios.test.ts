import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import {
  hashContenidoEnvio,
  hashSnapshotAprobado,
} from "@/lib/propuestas/envios"
import {
  ENDPOINT_RESEND,
  ErrorResend,
  enviarEmail,
} from "@/lib/propuestas/resend"
import { crearTokenBaja, hashEmail } from "@/lib/propuestas/supresion"

/**
 * T-16 (AC-22, AC-23, AC-24; RF-34..RF-39): plantillas, borrador determinista
 * y edicion versionada de envios.
 *
 * Rutas ejercitadas con Clerk, Prisma y logger mockeados:
 * - `POST /api/propuestas/plantillas`: 201 version 1 con variables canonicas,
 *   validacion de asunto/cuerpo/lista blanca, auth/origen/rate y P2002.
 * - `PATCH /api/propuestas/plantillas/[id]`: version+1, desactiva anteriores,
 *   conserva historial, reintenta ante P2002 y responde 404/409.
 * - `POST /api/propuestas/prospectos/[id]/borrador`: datos reales sin claims,
 *   hash estable, base legal, estados de error, `LLM` -> 503 sin escrituras,
 *   XSS escapado y asunto saneado.
 * - `PATCH /api/propuestas/envios/[id]`: BORRADOR en sitio con hash nuevo;
 *   APROBADO crea version+1 y cancela la anterior; otros estados 409.
 *
 * Ningun test hace fetch real ni importa Resend/LLM: ademas del `fetch`
 * stubbeado, se comprueba el codigo fuente de las rutas.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    plantillaPropuesta: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    prospecto: { updateMany: vi.fn() },
    envioPropuesta: { create: vi.fn(), updateMany: vi.fn() },
    consumoProveedor: { findMany: vi.fn(), upsert: vi.fn() },
    supresionProspecto: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
  }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    plantillaCreate: vi.fn(),
    plantillaFindFirst: vi.fn(),
    plantillaFindUnique: vi.fn(),
    prospectoFindUnique: vi.fn(),
    prospectoUpdateMany: vi.fn(),
    envioFindUnique: vi.fn(),
    envioFindFirst: vi.fn(),
    envioFindMany: vi.fn(),
    envioCreate: vi.fn(),
    envioUpdateMany: vi.fn(),
    supresionFindMany: vi.fn(),
    supresionUpsert: vi.fn(),
    consumoFindMany: vi.fn(),
    transaction: vi.fn(),
    tx,
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
    plantillaPropuesta: {
      create: mocks.plantillaCreate,
      findFirst: mocks.plantillaFindFirst,
      findUnique: mocks.plantillaFindUnique,
    },
    prospecto: {
      findUnique: mocks.prospectoFindUnique,
      updateMany: mocks.prospectoUpdateMany,
    },
    envioPropuesta: {
      findUnique: mocks.envioFindUnique,
      findFirst: mocks.envioFindFirst,
      findMany: mocks.envioFindMany,
      create: mocks.envioCreate,
      updateMany: mocks.envioUpdateMany,
    },
    supresionProspecto: {
      findMany: mocks.supresionFindMany,
      upsert: mocks.supresionUpsert,
    },
    consumoProveedor: { findMany: mocks.consumoFindMany },
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

import { POST as crearPlantilla } from "@/app/api/propuestas/plantillas/route"
import { PATCH as editarPlantilla } from "@/app/api/propuestas/plantillas/[id]/route"
import { POST as crearBorrador } from "@/app/api/propuestas/prospectos/[id]/borrador/route"
import { PATCH as editarEnvio } from "@/app/api/propuestas/envios/[id]/route"
import { POST as aprobarEnvio } from "@/app/api/propuestas/envios/[id]/aprobar/route"
import { POST as enviarEnvio } from "@/app/api/propuestas/envios/[id]/enviar/route"
import { POST as reintentarEnvio } from "@/app/api/propuestas/envios/[id]/reintentar/route"
import { POST as registrarResultado } from "@/app/api/propuestas/envios/[id]/resultado/route"
import { POST as reconciliarEnvio } from "@/app/api/propuestas/envios/[id]/reconciliar/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.51"
const SECRETO = "secreto-de-pruebas-propuestas-1234567890"
const BASE_LEGAL = "Base legal de prueba aprobada para prospeccion B2B."
const TEXTO_LEGAL = "Texto legal literal aprobado para el email de propuesta."
const FROM_EMAIL = "propuestas@pixelarch.dev"
const REPLY_TO = "hola@pixelarch.dev"
const FROM_NOMBRE = "PixelArch"

const ASUNTO_ENVIO = "Una idea para Consultora Alfa"
const CUERPO_TEXTO_ENVIO = "Hola Ana,\n\nTe escribo."
const CUERPO_HTML_ENVIO = "<p>Hola Ana,</p><p>Te escribo.</p>"

const ENVS = [
  "NEXT_PUBLIC_URL",
  "PROPUESTAS_SECRETO",
  "PROPUESTAS_BASE_LEGAL",
  "PROPUESTAS_TEXTO_LEGAL",
  "PROPUESTAS_ENVIO_HABILITADO",
  "PROPUESTAS_MAX_ENVIOS_PROSPECTO",
  "PROPUESTAS_FROM_EMAIL",
  "PROPUESTAS_REPLY_TO",
  "PROPUESTAS_FROM_NOMBRE",
  "PROPUESTAS_ETIQUETA_PUBLICIDAD",
  "PROPUESTAS_CUPO_ENVIOS_DIA",
  "RESEND_API_KEY",
] as const

type EntornoOriginal = Record<(typeof ENVS)[number], string | undefined>

let entornoOriginal: EntornoOriginal

const URL_PLANTILLAS = `${ORIGEN}/api/propuestas/plantillas`
const URL_PROSPECTOS = `${ORIGEN}/api/propuestas/prospectos`
const URL_ENVIOS = `${ORIGEN}/api/propuestas/envios`

interface OpcionesPedido {
  origin?: string | null
  ip?: string | null
  rawBody?: string
}

function pedido(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  opciones: OpcionesPedido = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (opciones.origin !== null) headers.set("origin", opciones.origin ?? ORIGEN)
  if (opciones.ip !== null) headers.set("x-forwarded-for", opciones.ip ?? IP)

  return new Request(url, {
    method,
    headers,
    body: opciones.rawBody ?? JSON.stringify(body),
  })
}

function contexto(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

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

async function jsonDe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function esperarNoStore(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("no-store")
}

function argumento(
  mock: ReturnType<typeof vi.fn>,
  indice = 0,
): Record<string, unknown> {
  const llamada = mock.mock.calls[indice] as unknown[] | undefined
  expect(llamada).toBeDefined()
  return llamada![0] as Record<string, unknown>
}

function datosDe(mock: ReturnType<typeof vi.fn>, indice = 0): Record<string, unknown> {
  const args = argumento(mock, indice)
  return (args.data ?? {}) as Record<string, unknown>
}

function cuerpoPlantilla(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nombre: "Primer contacto",
    idioma: "es",
    asunto: "Una idea para {{nombreNegocio}}",
    cuerpo:
      "Hola {{contactoNombre}},\n\nVi {{sitioWeb}} y noté: {{hallazgoPrincipal}}.\n\n{{remitenteNombre}}",
    variablesPermitidas: [
      "nombreNegocio",
      "contactoNombre",
      "sitioWeb",
      "hallazgoPrincipal",
      "remitenteNombre",
    ],
    ...overrides,
  }
}

function cuerpoPatchPlantilla(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    idioma: "es",
    asunto: "Propuesta para {{nombreNegocio}}",
    cuerpo: "Hola {{contactoNombre}},\n\nTe escribo de nuevo.",
    variablesPermitidas: ["nombreNegocio", "contactoNombre"],
    ...overrides,
  }
}

function prospectoBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pros_1",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    email: "Ventas@Alfa.com.ar",
    contactoNombre: "Ana",
    score: 88,
    auditoriaResumen: {
      findings: [
        { type: "warn", text: "La velocidad del sitio puede mejorar." },
      ],
    },
    estado: "PUNTUADO",
    baseLegal: null,
    campanaOrigenId: "camp_1",
    campanaOrigen: {
      id: "camp_1",
      nombre: "Estudios contables Palermo",
      rubro: "Consultoría",
      zona: "Palermo, CABA",
      plantillaId: "pl_1",
    },
    ...overrides,
  }
}

function plantillaBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pl_1",
    asunto: "Una idea para {{nombreNegocio}}",
    cuerpo:
      "{{saludo}},\n\nVi {{sitioWeb}} en {{ciudad}} ({{rubro}}): {{hallazgoPrincipal}}. Score: {{score}}.",
    variablesPermitidas: [
      "nombreNegocio",
      "saludo",
      "sitioWeb",
      "ciudad",
      "rubro",
      "hallazgoPrincipal",
      "score",
    ],
    version: 1,
    ...overrides,
  }
}

function envioBd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "env_1",
    prospectoId: "pros_1",
    campanaId: "camp_1",
    plantillaId: "pl_1",
    plantillaVersion: 1,
    secuencia: 1,
    version: 1,
    destinatario: "ventas@alfa.com.ar",
    estado: "BORRADOR",
    fromEmail: FROM_EMAIL,
    fromNombre: FROM_NOMBRE,
    replyTo: REPLY_TO,
    ...overrides,
  }
}

/**
 * Envio BORRADOR completo y con `hashContenido` real para la aprobacion.
 * Por defecto el hash se recomputa del contenido final; los tests de mutacion
 * pasan un `hashContenido` explicito distinto.
 */
function envioAprobable(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const contenido: Record<string, unknown> = {
    id: "env_1",
    prospectoId: "pros_1",
    campanaId: "camp_1",
    plantillaId: "pl_1",
    plantillaVersion: 1,
    secuencia: 1,
    version: 1,
    destinatario: "ventas@alfa.com.ar",
    asunto: ASUNTO_ENVIO,
    cuerpoTexto: CUERPO_TEXTO_ENVIO,
    cuerpoHtml: CUERPO_HTML_ENVIO,
    estado: "BORRADOR",
    fromEmail: FROM_EMAIL,
    fromNombre: FROM_NOMBRE,
    replyTo: REPLY_TO,
    ...overrides,
  }

  const hashContenido =
    typeof overrides.hashContenido === "string"
      ? overrides.hashContenido
      : hashContenidoEnvio({
          asunto: String(contenido.asunto),
          cuerpoTexto: String(contenido.cuerpoTexto),
          cuerpoHtml: String(contenido.cuerpoHtml),
          destinatario: String(contenido.destinatario),
          plantillaId: (contenido.plantillaId ?? null) as string | null,
          plantillaVersion: (contenido.plantillaVersion ?? null) as
            | number
            | null,
          secuencia: Number(contenido.secuencia),
        })

  return { ...contenido, hashContenido }
}

function tokenBajaDePrueba(email = "ventas@alfa.com.ar"): string {
  return crearTokenBaja(
    "pros_1",
    hashEmail(email, SECRETO),
    SECRETO,
  )
}

const ASUNTO_APROBADO = `[publicidad] ${ASUNTO_ENVIO}`
const TEXTO_APROBADO = `${CUERPO_TEXTO_ENVIO}\n\n--\nTexto legal aprobado.`
const HTML_APROBADO = `<html><body>${CUERPO_HTML_ENVIO}</body></html>`

function headersAprobados(
  tokenBaja = tokenBajaDePrueba(),
  replyTo = REPLY_TO,
): { "List-Unsubscribe": string; "List-Unsubscribe-Post": string } {
  // Las rutas normalizan el reply-to (trim + lowercase) antes de construir el
  // header. El helper replica esa normalizacion para que un reply-to con
  // mayusculas no invente un snapshot distinto al persistido.
  const canal = replyTo.trim().toLowerCase()

  return {
    "List-Unsubscribe": `<${ORIGEN}/api/opt-out?token=${encodeURIComponent(
      tokenBaja,
    )}>, <mailto:${canal}?subject=Baja>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}

/**
 * Snapshot APROBADO real: el `aprobadoHash` se recomputa igual que la ruta de
 * envio, para poder variar asunto/cuerpo/token sin inventar hashes.
 */
function envioAprobadoFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = envioAprobable({
    estado: "APROBADO",
    aprobadoAsunto: ASUNTO_APROBADO,
    aprobadoCuerpoTexto: TEXTO_APROBADO,
    aprobadoCuerpoHtml: HTML_APROBADO,
    tokenBaja: tokenBajaDePrueba(),
  })

  const tokenBaja =
    typeof overrides.tokenBaja === "string"
      ? overrides.tokenBaja
      : String(base.tokenBaja)
  const aprobadoAsunto =
    typeof overrides.aprobadoAsunto === "string"
      ? overrides.aprobadoAsunto
      : String(base.aprobadoAsunto)
  const aprobadoCuerpoTexto =
    typeof overrides.aprobadoCuerpoTexto === "string"
      ? overrides.aprobadoCuerpoTexto
      : String(base.aprobadoCuerpoTexto)
  const aprobadoCuerpoHtml =
    typeof overrides.aprobadoCuerpoHtml === "string"
      ? overrides.aprobadoCuerpoHtml
      : String(base.aprobadoCuerpoHtml)
  const destinatario =
    typeof overrides.destinatario === "string"
      ? overrides.destinatario
      : String(base.destinatario)

  const aprobadoHash =
    typeof overrides.aprobadoHash === "string"
      ? overrides.aprobadoHash
      : hashSnapshotAprobado({
          asunto: aprobadoAsunto,
          cuerpoHtml: aprobadoCuerpoHtml,
          cuerpoTexto: aprobadoCuerpoTexto,
          destinatario,
          fromEmail:
            typeof overrides.fromEmail === "string"
              ? overrides.fromEmail
              : FROM_EMAIL,
          fromNombre:
            typeof overrides.fromNombre === "string"
              ? overrides.fromNombre
              : FROM_NOMBRE,
          replyTo:
            typeof overrides.replyTo === "string"
              ? overrides.replyTo
              : REPLY_TO,
          tokenBaja,
          headers: headersAprobados(
            tokenBaja,
            typeof overrides.replyTo === "string"
              ? overrides.replyTo
              : REPLY_TO,
          ),
          plantillaId: (base.plantillaId ?? null) as string | null,
          plantillaVersion: (base.plantillaVersion ?? null) as number | null,
          secuencia: Number(base.secuencia),
        })

  return {
    ...base,
    ...overrides,
    aprobadoAsunto,
    aprobadoCuerpoTexto,
    aprobadoCuerpoHtml,
    tokenBaja,
    destinatario,
    aprobadoHash,
  }
}

function respuestaResend(messageId = "msg_123"): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: messageId }),
  }
}

function limpiarRateLimits(): void {
  for (const clave of [
    "propuestas:user_1",
    "propuestas:user_2",
    "propuestas:envio:user_1",
    "propuestas:envio:user_2",
    `propuestas:ip:${IP}`,
    `propuestas:ip:198.51.100.123`,
  ]) {
    resetRateLimit(clave)
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  entornoOriginal = {
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    PROPUESTAS_SECRETO: process.env.PROPUESTAS_SECRETO,
    PROPUESTAS_BASE_LEGAL: process.env.PROPUESTAS_BASE_LEGAL,
    PROPUESTAS_TEXTO_LEGAL: process.env.PROPUESTAS_TEXTO_LEGAL,
    PROPUESTAS_ENVIO_HABILITADO: process.env.PROPUESTAS_ENVIO_HABILITADO,
    PROPUESTAS_MAX_ENVIOS_PROSPECTO:
      process.env.PROPUESTAS_MAX_ENVIOS_PROSPECTO,
    PROPUESTAS_FROM_EMAIL: process.env.PROPUESTAS_FROM_EMAIL,
    PROPUESTAS_REPLY_TO: process.env.PROPUESTAS_REPLY_TO,
    PROPUESTAS_FROM_NOMBRE: process.env.PROPUESTAS_FROM_NOMBRE,
    PROPUESTAS_ETIQUETA_PUBLICIDAD:
      process.env.PROPUESTAS_ETIQUETA_PUBLICIDAD,
    PROPUESTAS_CUPO_ENVIOS_DIA: process.env.PROPUESTAS_CUPO_ENVIOS_DIA,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  }

  process.env.NEXT_PUBLIC_URL = ORIGEN
  process.env.PROPUESTAS_SECRETO = SECRETO
  process.env.PROPUESTAS_BASE_LEGAL = BASE_LEGAL
  process.env.PROPUESTAS_TEXTO_LEGAL = TEXTO_LEGAL
  // T-17: aprobar no envia. El gate y Resend son requisitos de T-18.
  process.env.PROPUESTAS_ENVIO_HABILITADO = "false"
  delete process.env.RESEND_API_KEY
  process.env.PROPUESTAS_MAX_ENVIOS_PROSPECTO = "2"
  process.env.PROPUESTAS_FROM_EMAIL = FROM_EMAIL
  process.env.PROPUESTAS_REPLY_TO = REPLY_TO
  process.env.PROPUESTAS_FROM_NOMBRE = FROM_NOMBRE
  process.env.PROPUESTAS_ETIQUETA_PUBLICIDAD = "true"

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })

  mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })
  mocks.plantillaFindUnique.mockResolvedValue(null)
  mocks.plantillaFindFirst.mockResolvedValue(plantillaBd())
  mocks.prospectoFindUnique.mockResolvedValue(prospectoBd())
  mocks.prospectoUpdateMany.mockResolvedValue({ count: 1 })
  mocks.envioFindUnique.mockResolvedValue(envioBd())
  mocks.envioFindFirst.mockResolvedValue(null)
  mocks.envioFindMany.mockResolvedValue([])
  mocks.envioCreate.mockResolvedValue({ id: "env_nuevo", version: 2 })
  mocks.envioUpdateMany.mockResolvedValue({ count: 1 })
  mocks.supresionFindMany.mockResolvedValue([])
  mocks.supresionUpsert.mockResolvedValue({})
  mocks.consumoFindMany.mockResolvedValue([])

  mocks.tx.plantillaPropuesta.findFirst.mockResolvedValue({ version: 1 })
  mocks.tx.plantillaPropuesta.create.mockResolvedValue({
    id: "pl_2",
    version: 2,
  })
  mocks.tx.plantillaPropuesta.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.envioPropuesta.create.mockResolvedValue({
    id: "env_1",
    secuencia: 1,
    version: 1,
  })
  mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.consumoProveedor.findMany.mockResolvedValue([])
  mocks.tx.consumoProveedor.upsert.mockResolvedValue({})
  mocks.tx.supresionProspecto.upsert.mockResolvedValue({})
  mocks.tx.$queryRaw.mockResolvedValue([])
  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )

  vi.stubGlobal("fetch", vi.fn())
  limpiarRateLimits()
})

afterEach(() => {
  for (const clave of ENVS) {
    const valor = entornoOriginal[clave]
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* POST /api/propuestas/plantillas                                     */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/plantillas (T-16, AC-22; RF-34, RF-37)", () => {
  it("crea la version 1 con la lista canonica de variables usadas", async () => {
    mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ id: "pl_1", version: 1 })

    expect(mocks.plantillaCreate).toHaveBeenCalledTimes(1)
    const data = datosDe(mocks.plantillaCreate)
    expect(data).toMatchObject({
      nombre: "Primer contacto",
      idioma: "es",
      asunto: "Una idea para {{nombreNegocio}}",
      cuerpo:
        "Hola {{contactoNombre}},\n\nVi {{sitioWeb}} y noté: {{hallazgoPrincipal}}.\n\n{{remitenteNombre}}",
      version: 1,
      activa: true,
      creadaPor: "user_1",
      creadaPorNombre: "Ana Pérez",
    })
    // La lista guardada es la usada realmente, no la declarada de mas.
    expect(data.variablesPermitidas).toEqual([
      "nombreNegocio",
      "contactoNombre",
      "sitioWeb",
      "hallazgoPrincipal",
      "remitenteNombre",
    ])
    expect(mocks.plantillaCreate.mock.calls[0][0]).not.toHaveProperty(
      "data.tokenBaja",
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Una idea para")
    expect(logs).not.toContain("Vi https://alfa.com.ar/")
  })

  it("normaliza el asunto (CR/LF y prefijos falsos) y descarta variables declaradas sin uso", async () => {
    mocks.plantillaCreate.mockResolvedValue({ id: "pl_1", version: 1 })

    const res = await crearPlantilla(
      pedido(
        URL_PLANTILLAS,
        "POST",
        cuerpoPlantilla({
          asunto: "Re: Fwd: Fw: Una propuesta\r\npara {{nombreNegocio}}",
          cuerpo: "Hola {{nombreNegocio}}, ¿te interesa?",
          variablesPermitidas: [
            "nombreNegocio",
            "ciudad",
            "rubro",
            "hallazgoPrincipal",
          ],
        }),
      ),
    )

    expect(res.status).toBe(201)
    const data = datosDe(mocks.plantillaCreate)
    expect(data.asunto).toBe("Una propuesta para {{nombreNegocio}}")
    expect(String(data.asunto)).not.toMatch(/[\r\n]/)
    expect(data.variablesPermitidas).toEqual(["nombreNegocio"])
  })

  it.each([
    ["asunto vacio", { asunto: "   " }, "VALIDACION"],
    ["cuerpo vacio", { cuerpo: "   " }, "VALIDACION"],
    [
      "variable desconocida",
      { asunto: "Propuesta", cuerpo: "Hola {{email}}" },
      "VALIDACION",
    ],
    [
      "variable no permitida",
      {
        asunto: "Propuesta",
        cuerpo: "Hola {{ciudad}}",
        variablesPermitidas: ["nombreNegocio"],
      },
      "VALIDACION",
    ],
    [
      "placeholder mal formado",
      { asunto: "Propuesta", cuerpo: "Hola {{nombreNegocio" },
      "VALIDACION",
    ],
    [
      "asunto demasiado largo antes de limpiar",
      { asunto: "a".repeat(121), cuerpo: "Hola" },
      "VALIDACION",
    ],
  ])("no guarda una plantilla invalida: %s", async (_caso, override, codigo) => {
    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla(override)),
    )

    expect(res.status).toBe(400)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo })
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("exige admin, origen same-origin y rate limit", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(anonimo.status).toBe(401)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    simularAdmin()
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await crearPlantilla(
        pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla(), opciones),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("bloquea la solicitud 31 por admin y la 61 por IP con 429 y Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        rateLimitDetalle("propuestas:user_1", 30, 60_000).permitido,
      ).toBe(true)
    }
    const porAdmin = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(porAdmin.status).toBe(429)
    expect((await jsonDe(porAdmin)).codigo).toBe("RATE_LIMIT")
    expect(Number(porAdmin.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()

    resetRateLimit("propuestas:user_1")
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )
    expect(porIp.status).toBe(429)
    expect((await jsonDe(porIp)).codigo).toBe("RATE_LIMIT")
    expect(mocks.plantillaCreate).not.toHaveBeenCalled()
  })

  it("un nombre+version duplicado responde 409 sin crear otra fila", async () => {
    mocks.plantillaCreate.mockRejectedValue({ code: "P2002" })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(409)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaCreate).toHaveBeenCalledTimes(1)
  })

  it("con el esquema faltante responde 503 y no filtra detalles", async () => {
    mocks.plantillaCreate.mockRejectedValue({ code: "P2021" })

    const res = await crearPlantilla(
      pedido(URL_PLANTILLAS, "POST", cuerpoPlantilla()),
    )

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/propuestas/plantillas/[id]                               */
/* ------------------------------------------------------------------ */

describe("PATCH /api/propuestas/plantillas/[id] (T-16, AC-22, AC-24; RF-37, RF-38)", () => {
  beforeEach(() => {
    mocks.plantillaFindUnique.mockResolvedValue({
      id: "pl_1",
      nombre: "Primer contacto",
    })
  })

  it("crea la version+1 con el mismo nombre y desactiva las anteriores", async () => {
    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ id: "pl_2", version: 2 })

    const findUnique = argumento(mocks.plantillaFindUnique)
    expect(findUnique).toMatchObject({ where: { id: "pl_1" } })
    // Solo se leen id y nombre: no se reescribe la version existente.
    expect(findUnique).not.toHaveProperty("data")

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.plantillaPropuesta.findFirst).toHaveBeenCalledWith({
      where: { nombre: "Primer contacto" },
      orderBy: { version: "desc" },
      select: { version: true },
    })

    const creada = datosDe(mocks.tx.plantillaPropuesta.create)
    expect(creada).toMatchObject({
      nombre: "Primer contacto",
      idioma: "es",
      asunto: "Propuesta para {{nombreNegocio}}",
      cuerpo: "Hola {{contactoNombre}},\n\nTe escribo de nuevo.",
      version: 2,
      activa: true,
      creadaPor: "user_1",
      creadaPorNombre: "Ana Pérez",
    })
    expect(creada.variablesPermitidas).toEqual([
      "nombreNegocio",
      "contactoNombre",
    ])

    const desactivadas = argumento(mocks.tx.plantillaPropuesta.updateMany)
    expect(desactivadas).toEqual({
      where: { nombre: "Primer contacto", activa: true, id: { not: "pl_2" } },
      data: { activa: false },
    })
    // El historial previo conserva sus filas: nunca se actualiza contenido.
    expect(mocks.tx.plantillaPropuesta.updateMany).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Propuesta para")
    expect(logs).not.toContain("Te escribo de nuevo")
  })

  it("ante P2002 reintenta con el maximo ya persistido", async () => {
    mocks.tx.plantillaPropuesta.findFirst
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 })
    mocks.tx.plantillaPropuesta.create
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({ id: "pl_3", version: 3 })

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ id: "pl_3", version: 3 })
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(mocks.tx.plantillaPropuesta.create).toHaveBeenCalledTimes(2)
    expect(
      datosDe(mocks.tx.plantillaPropuesta.create, 1).version,
    ).toBe(3)
    expect(mocks.tx.plantillaPropuesta.updateMany).toHaveBeenCalledTimes(1)
  })

  it("si el P2002 persiste en los 3 intentos responde 409", async () => {
    mocks.tx.plantillaPropuesta.create.mockRejectedValue({ code: "P2002" })

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.plantillaPropuesta.create).toHaveBeenCalledTimes(3)
    expect(mocks.tx.plantillaPropuesta.updateMany).not.toHaveBeenCalled()
  })

  it("responde 404 si la plantilla no existe y no abre transaccion", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(null)

    const res = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/no-existe`, "PATCH", cuerpoPatchPlantilla()),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    esperarNoStore(res)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["asunto vacio", { asunto: "   " }],
    ["cuerpo vacio", { cuerpo: "   " }],
    ["variable desconocida", { cuerpo: "Hola {{email}}" }],
    ["variable no permitida", { variablesPermitidas: ["nombreNegocio"] }],
  ])("no versiona una edicion invalida: %s", async (_caso, override) => {
    const res = await editarPlantilla(
      pedido(
        `${URL_PLANTILLAS}/pl_1`,
        "PATCH",
        cuerpoPatchPlantilla(override),
      ),
      contexto("pl_1"),
    )

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.plantillaFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit y no loguea contenido", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const sinOrigen = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla(), {
        origin: null,
      }),
      contexto("pl_1"),
    )
    expect(sinOrigen.status).toBe(403)
    expect((await jsonDe(sinOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await editarPlantilla(
      pedido(`${URL_PLANTILLAS}/pl_1`, "PATCH", cuerpoPatchPlantilla()),
      contexto("pl_1"),
    )
    expect(limitado.status).toBe(429)

    expect(mocks.plantillaFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()

    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("Propuesta para")
    expect(logs).not.toContain("Te escribo de nuevo")
  })
})

/* ------------------------------------------------------------------ */
/* POST /api/propuestas/prospectos/[id]/borrador                       */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/prospectos/[id]/borrador (T-16, AC-22, AC-23; RF-34..RF-39)", () => {
  it("crea un borrador BORRADOR con datos verificados, hash estable y base legal", async () => {
    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        modo: "PLANTILLA",
        plantillaId: "pl_1",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      envioId: "env_1",
      secuencia: 1,
      version: 1,
    })

    expect(mocks.plantillaFindFirst).toHaveBeenCalledWith({
      where: { id: "pl_1", activa: true },
      select: {
        id: true,
        asunto: true,
        cuerpo: true,
        variablesPermitidas: true,
        version: true,
      },
    })

    const data = datosDe(mocks.tx.envioPropuesta.create)
    expect(data).toMatchObject({
      prospectoId: "pros_1",
      campanaId: "camp_1",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      secuencia: 1,
      version: 1,
      destinatario: "ventas@alfa.com.ar",
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
      estado: "BORRADOR",
    })
    expect(data.asunto).toBe("Una idea para Consultora Alfa")

    const cuerpo = String(data.cuerpoTexto)
    expect(cuerpo).toContain("Hola Ana")
    expect(cuerpo).toContain("https://alfa.com.ar/")
    expect(cuerpo).toContain("Palermo, CABA")
    expect(cuerpo).toContain("Consultoría")
    expect(cuerpo).toContain("La velocidad del sitio puede mejorar.")
    expect(cuerpo).toContain("Score: 88.")
    // Sin claims inventados: el texto es exactamente la plantilla sustituida.
    expect(cuerpo).not.toMatch(/garantiz|100%|líder|nº1|mejor del mercado/i)

    expect(String(data.cuerpoHtml)).toContain("<p>Hola Ana")
    expect(String(data.cuerpoHtml)).not.toContain("{{")
    // El footer legal y el token de baja se materializan al aprobar (T-17).
    expect(data).not.toHaveProperty("tokenBaja")
    expect(data).not.toHaveProperty("aprobadoHash")
    expect(String(data.cuerpoHtml).toLowerCase()).not.toContain("unsubscribe")
    expect(String(data.cuerpoHtml).toLowerCase()).not.toContain("baja")

    const hash = String(data.hashContenido)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(
      hashContenidoEnvio({
        asunto: String(data.asunto),
        cuerpoTexto: String(data.cuerpoTexto),
        cuerpoHtml: String(data.cuerpoHtml),
        destinatario: String(data.destinatario),
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )

    const actualizado = argumento(mocks.tx.prospecto.updateMany)
    expect(actualizado.where).toEqual({ id: "pros_1", estado: "PUNTUADO" })
    const datosProspecto = (actualizado.data ?? {}) as Record<string, unknown>
    expect(datosProspecto).toMatchObject({
      estado: "BORRADOR",
      actualizadoPor: "user_1",
      baseLegal: BASE_LEGAL,
    })
    expect(datosProspecto.ultimaInteraccionEn).toBeInstanceOf(Date)

    expect(globalThis.fetch).not.toHaveBeenCalled()
    const logs = JSON.stringify([
      ...mocks.loggerInfo.mock.calls,
      ...mocks.loggerWarn.mock.calls,
      ...mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("ventas@alfa.com.ar")
    expect(logs).not.toContain("Consultora Alfa")
  })

  it("conserva la base legal existente y no la sobrescribe", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ baseLegal: "Base legal previa." }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        plantillaId: "pl_1",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    const datosProspecto = (argumento(mocks.tx.prospecto.updateMany).data ??
      {}) as Record<string, unknown>
    expect(datosProspecto).not.toHaveProperty("baseLegal")
  })

  it("modo LLM responde 503 NO_CONFIGURADO sin consultas ni escrituras", async () => {
    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", { modo: "LLM" }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit antes de tocar datos", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(anonimo.status).toBe(401)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    simularAdmin()
    const sinOrigen = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}, { origin: null }),
      contexto("pros_1"),
    )
    expect(sinOrigen.status).toBe(403)
    expect((await jsonDe(sinOrigen)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )
    expect(limitado.status).toBe(429)
    expect(Number(limitado.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin email responde 409 SIN_EMAIL sin consultar plantilla ni escribir", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoBd({ email: null }))

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SIN_EMAIL")
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un contacto suprimido responde 409 SUPRIMIDO sin escribir", async () => {
    mocks.supresionFindMany.mockResolvedValue([
      {
        ambito: "DOMINIO",
        emailHash: null,
        dominioNegocio: "alfa.com.ar",
      },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin secreto para verificar supresion falla cerrado con 503", async () => {
    delete process.env.PROPUESTAS_SECRETO

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("NO_CONFIGURADO")
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin plantilla activa o inexistente responde 409 ESTADO", async () => {
    mocks.plantillaFindFirst.mockResolvedValue(null)

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {
        plantillaId: "pl_inexistente",
      }),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin plantilla en el body ni en la campana responde 409 sin consultar", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({
        campanaOrigen: {
          id: "camp_1",
          nombre: "Estudios contables Palermo",
          rubro: "Consultoría",
          zona: "Palermo, CABA",
          plantillaId: null,
        },
      }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.plantillaFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("con un BORRADOR/APROBADO abierto responde 409 BORRADOR_ABIERTO", async () => {
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_prev", estado: "BORRADOR", secuencia: 1 },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("BORRADOR_ABIERTO")
    expect(mocks.envioFindMany).toHaveBeenCalledWith({
      where: { prospectoId: "pros_1" },
      select: { id: true, estado: true, secuencia: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("al alcanzar el maximo de mensajes responde 409 MAX_MENSAJES", async () => {
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_1", estado: "ENVIADO", secuencia: 1 },
      { id: "env_2", estado: "RESPONDIDO", secuencia: 2 },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("MAX_MENSAJES")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un estado no transicionable a BORRADOR responde 409 ESTADO", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoBd({ estado: "NUEVO" }))

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("escapa XSS de los datos y sanea asunto sin CR/LF ni prefijos falsos", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({
        nombreNegocio: '<script>alert("x")</script>',
        ciudad: '<img src=x onerror="alert(1)">',
        contactoNombre: '<b onmouseover="alert(1)">Ana</b>',
        auditoriaResumen: {
          findings: [
            { type: "fail", text: "<script>robaCookies()</script>" },
          ],
        },
      }),
    )
    mocks.plantillaFindFirst.mockResolvedValue(
      plantillaBd({
        asunto: "Fw: Oferta\r\npara {{nombreNegocio}}",
        cuerpo:
          "Hola {{contactoNombre}} de {{ciudad}}: {{hallazgoPrincipal}}. {{nombreNegocio}}. Plantilla dice: <script>plantilla()</script>",
        variablesPermitidas: [
          "nombreNegocio",
          "contactoNombre",
          "ciudad",
          "hallazgoPrincipal",
        ],
      }),
    )

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    const data = datosDe(mocks.tx.envioPropuesta.create)
    const asunto = String(data.asunto)
    const html = String(data.cuerpoHtml)
    const texto = String(data.cuerpoTexto)

    expect(asunto).toBe('Oferta para <script>alert("x")</script>')
    expect(asunto).not.toMatch(/[\r\n]/)
    expect(asunto).not.toMatch(/^(?:re|fwd|fw)\s*:/i)

    // El HTML nunca interpreta el contenido hostil: todo queda escapado.
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<b ")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;img")
    expect(html).toContain("&lt;b ")
    // El HTML hostil de la propia plantilla tampoco se interpreta.
    expect(html).toContain("&lt;script&gt;plantilla()&lt;/script&gt;")
    // En texto plano el contenido hostil es solo texto, no se evalua.
    expect(texto).toContain("<script>alert")
    expect(texto).toContain("<script>plantilla()</script>")
    expect(texto).toContain("robaCookies")
    expect(texto).toContain("onerror")
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("responde 404 si el prospecto no existe", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/no-existe/borrador`, "POST", {}),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("si el prospecto cambia de estado en la transaccion responde 409 y no deja borrador", async () => {
    mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 0 })

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
  })

  it("no importa Resend ni realiza llamadas de red", () => {
    const borrador = readFileSync(
      join(
        process.cwd(),
        "src/app/api/propuestas/prospectos/[id]/borrador/route.ts",
      ),
      "utf8",
    )
    const envio = readFileSync(
      join(process.cwd(), "src/app/api/propuestas/envios/[id]/route.ts"),
      "utf8",
    )

    for (const fuente of [borrador, envio]) {
      expect(fuente).not.toMatch(/@\/lib\/propuestas\/resend/)
      expect(fuente).not.toMatch(/sendEmail|enviarEmail|sendPaymentReceipt/)
      expect(fuente).not.toMatch(/\bfetch\s*\(/)
    }
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/propuestas/envios/[id]                                   */
/* ------------------------------------------------------------------ */

describe("PATCH /api/propuestas/envios/[id] (T-16, AC-24; RF-38)", () => {
  it("en BORRADOR edita en sitio y recomputa el hash", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioBd())
    mocks.envioUpdateMany.mockResolvedValue({ count: 1 })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Re: Fw: Propuesta\r\npara vos",
        cuerpoTexto: "Hola Ana,\n\nTe escribo de nuevo.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ envioId: "env_1", version: 1 })

    const actualizacion = argumento(mocks.envioUpdateMany)
    expect(actualizacion.where).toEqual({ id: "env_1", estado: "BORRADOR" })
    const data = (actualizacion.data ?? {}) as Record<string, unknown>
    expect(data.asunto).toBe("Propuesta para vos")
    expect(data.cuerpoTexto).toBe("Hola Ana,\n\nTe escribo de nuevo.")
    expect(String(data.cuerpoHtml)).toContain("<p>Hola Ana,")
    expect(String(data.cuerpoHtml)).toContain("<p>Te escribo de nuevo.</p>")
    expect(String(data.cuerpoHtml)).not.toContain("{{")
    expect(data.hashContenido).toBe(
      hashContenidoEnvio({
        asunto: "Propuesta para vos",
        cuerpoTexto: "Hola Ana,\n\nTe escribo de nuevo.",
        cuerpoHtml: String(data.cuerpoHtml),
        destinatario: "ventas@alfa.com.ar",
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.envioPropuesta.create).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("un APROBADO crea version+1 en la misma secuencia y cancela la anterior", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioBd({ estado: "APROBADO", version: 2 }),
    )
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.envioPropuesta.create.mockResolvedValue({
      id: "env_2",
      version: 3,
    })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta actualizada",
        cuerpoTexto: "Hola Ana,\n\nCambié el texto.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ envioId: "env_2", version: 3 })

    const cancelado = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(cancelado.where).toEqual({ id: "env_1", estado: "APROBADO" })
    expect(cancelado.data).toEqual({
      estado: "CANCELADO",
      motivoCancelacion: "EDITADO",
    })

    const nueva = datosDe(mocks.tx.envioPropuesta.create)
    expect(nueva).toMatchObject({
      prospectoId: "pros_1",
      campanaId: "camp_1",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      secuencia: 1,
      version: 3,
      destinatario: "ventas@alfa.com.ar",
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
      asunto: "Propuesta actualizada",
      estado: "BORRADOR",
    })
    expect(nueva).not.toHaveProperty("aprobadoHash")
    expect(nueva).not.toHaveProperty("tokenBaja")
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it.each([
    "ENVIANDO",
    "ENVIADO",
    "FALLIDO",
    "REBOTADO",
    "QUEJA",
    "RESPONDIDO",
    "CANCELADO",
  ])("en %s responde 409 ESTADO y no escribe", async (estado) => {
    mocks.envioFindUnique.mockResolvedValue(envioBd({ estado }))

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("responde 404 si el envio no existe", async () => {
    mocks.envioFindUnique.mockResolvedValue(null)

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/no-existe`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("no-existe"),
    )

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["asunto vacio", { asunto: "   " }],
    ["cuerpo vacio", { cuerpoTexto: "   " }],
    ["variable pendiente", { cuerpoTexto: "Hola {{nombreNegocio}}" }],
    ["placeholder mal formado", { cuerpoTexto: "Hola {{nombre" }],
    ["asunto largo", { asunto: "a".repeat(121) }],
  ])("no guarda una edicion invalida: %s", async (_caso, override) => {
    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
        ...override,
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(400)
    expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("escapa HTML del cuerpo editado", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioBd())

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: '<img src=x onerror="alert(1)">',
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    const data = (argumento(mocks.envioUpdateMany).data ?? {}) as Record<
      string,
      unknown
    >
    expect(String(data.cuerpoHtml)).not.toContain("<img")
    expect(String(data.cuerpoHtml)).toContain("&lt;img")
  })

  it("exige admin, origen y rate limit", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const cross = await editarEnvio(
      pedido(
        `${URL_ENVIOS}/env_1`,
        "PATCH",
        { asunto: "Propuesta", cuerpoTexto: "Hola." },
        { origin: "https://evil.test" },
      ),
      contexto("env_1"),
    )
    expect(cross.status).toBe(403)
    expect((await jsonDe(cross)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )
    expect(limitado.status).toBe(429)
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
  })

  it("un P2002 al crear la version responde 409 sin duplicar", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioBd({ estado: "APROBADO", version: 2 }),
    )
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.envioPropuesta.create.mockRejectedValue({ code: "P2002" })

    const res = await editarEnvio(
      pedido(`${URL_ENVIOS}/env_1`, "PATCH", {
        asunto: "Propuesta",
        cuerpoTexto: "Hola.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.envioPropuesta.create).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ */
/* POST /api/propuestas/envios/[id]/aprobar                            */
/* ------------------------------------------------------------------ */

const URL_APROBAR = `${URL_ENVIOS}/env_1/aprobar`

function pedidoAprobacion(
  body: unknown = { confirmado: true },
  opciones: OpcionesPedido = {},
): Request {
  return pedido(URL_APROBAR, "POST", body, opciones)
}

function logsDeMocks(): string {
  return JSON.stringify([
    ...mocks.loggerInfo.mock.calls,
    ...mocks.loggerWarn.mock.calls,
    ...mocks.loggerError.mock.calls,
  ])
}

describe("POST /api/propuestas/envios/[id]/aprobar (T-17, AC-25; RF-40..RF-42)", () => {
  beforeEach(() => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "BORRADOR" }),
    )
    mocks.envioFindUnique.mockResolvedValue(envioAprobable())
    mocks.envioFindMany.mockResolvedValue([])
    mocks.supresionFindMany.mockResolvedValue([])
    mocks.plantillaFindFirst.mockResolvedValue({ version: 1 })
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
  })

  it("aprueba en seco: snapshot exacto, aprobador/fecha, token y hash (AC-25)", async () => {
    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(200)
    esperarNoStore(res)
    const cuerpo = await jsonDe(res)
    expect(cuerpo.estado).toBe("APROBADO")
    expect(typeof cuerpo.aprobadoEn).toBe("string")

    const actualizacion = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(actualizacion.where).toEqual({ id: "env_1", estado: "BORRADOR" })
    const data = (actualizacion.data ?? {}) as Record<string, unknown>

    const tokenEsperado = tokenBajaDePrueba()
    const headers = {
      "List-Unsubscribe": `<${ORIGEN}/api/opt-out?token=${tokenEsperado}>, <mailto:${REPLY_TO}?subject=Baja>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }

    expect(data).toMatchObject({
      estado: "APROBADO",
      aprobadoAsunto: `[publicidad] ${ASUNTO_ENVIO}`,
      aprobadoPor: "user_1",
      aprobadoPorNombre: "Ana Pérez",
      tokenBaja: tokenEsperado,
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
    })
    expect(data.aprobadoEn).toBeInstanceOf(Date)
    expect(String(data.tokenBaja)).toMatch(
      /^v1\.pros_1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/,
    )

    // Footer legal, fuente, canal ARCO y enlace visible de baja.
    const texto = String(data.aprobadoCuerpoTexto)
    expect(texto).toContain(CUERPO_TEXTO_ENVIO)
    expect(texto).toContain("PixelArch")
    expect(texto).toContain(
      "Propuesta de servicios de diseño y desarrollo web.",
    )
    expect(texto).toContain("Fuente de los datos: https://alfa.com.ar/")
    expect(texto).toContain(
      `Derechos de acceso, rectificación y supresión: ${REPLY_TO}`,
    )
    expect(texto).toContain(TEXTO_LEGAL)
    expect(texto).toContain(
      "Este mensaje es publicidad directa no solicitada.",
    )
    expect(texto).toContain(
      `Darse de baja: ${ORIGEN}/propuestas/baja/${tokenEsperado}`,
    )

    const html = String(data.aprobadoCuerpoHtml)
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Fuente de los datos:")
    expect(html).toContain(`mailto:${REPLY_TO}`)
    expect(html).toContain(TEXTO_LEGAL)
    expect(html).toContain("Darse de baja")

    // `aprobadoHash` cubre todo el snapshot, headers incluidos, y se puede
    // recomputar desde los campos persistidos.
    expect(data.aprobadoHash).toBe(
      hashSnapshotAprobado({
        asunto: String(data.aprobadoAsunto),
        cuerpoHtml: String(data.aprobadoCuerpoHtml),
        cuerpoTexto: String(data.aprobadoCuerpoTexto),
        destinatario: "ventas@alfa.com.ar",
        fromEmail: FROM_EMAIL,
        fromNombre: FROM_NOMBRE,
        replyTo: REPLY_TO,
        tokenBaja: String(data.tokenBaja),
        headers,
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )

    // Prospecto APROBADO con la base legal guardada si faltaba.
    const prospectoActualizado = argumento(mocks.tx.prospecto.updateMany)
    expect(prospectoActualizado.where).toEqual({
      id: "pros_1",
      estado: "BORRADOR",
    })
    const datosProspecto = (prospectoActualizado.data ?? {}) as Record<
      string,
      unknown
    >
    expect(datosProspecto).toMatchObject({
      estado: "APROBADO",
      actualizadoPor: "user_1",
      baseLegal: BASE_LEGAL,
    })
    expect(datosProspecto.ultimaInteraccionEn).toBeInstanceOf(Date)

    // Aprobar no envia ni programa nada.
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(data).not.toHaveProperty("enviadoEn")
    expect(data).not.toHaveProperty("proveedorMessageId")
    expect(data).not.toHaveProperty("scheduledAt")

    const logs = logsDeMocks()
    expect(logs).not.toContain("ventas@alfa.com.ar")
    expect(logs).not.toContain(ASUNTO_ENVIO)
    expect(logs).not.toContain("Hola Ana")
    expect(logs).not.toContain(tokenEsperado)
    expect(logs).not.toContain(TEXTO_LEGAL)
  })

  it("aprueba con PROPUESTAS_ENVIO_HABILITADO=false y sin RESEND_API_KEY (AC-25)", async () => {
    process.env.PROPUESTAS_ENVIO_HABILITADO = "false"
    delete process.env.RESEND_API_KEY

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(process.env.RESEND_API_KEY).toBeUndefined()
    expect(res.status).toBe(200)
    const data = datosDe(mocks.tx.envioPropuesta.updateMany)
    expect(data.estado).toBe("APROBADO")
    expect(String(data.aprobadoHash)).toMatch(/^[0-9a-f]{64}$/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("conserva la base legal existente del prospecto", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "BORRADOR", baseLegal: "Base legal previa." }),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(200)
    const datosProspecto = (argumento(mocks.tx.prospecto.updateMany).data ??
      {}) as Record<string, unknown>
    expect(datosProspecto).not.toHaveProperty("baseLegal")
  })

  it("exige admin, origen same-origin y rate limit antes de tocar datos", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(anonimo.status).toBe(401)
    esperarNoStore(anonimo)
    expect((await jsonDe(anonimo)).codigo).toBe("NO_AUTORIZADO")

    simularAdmin("asistente")
    const asistente = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(asistente.status).toBe(403)
    expect((await jsonDe(asistente)).codigo).toBe("PROHIBIDO")

    simularAdmin()
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await aprobarEnvio(
        pedidoAprobacion({ confirmado: true }, opciones),
        contexto("env_1"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const porAdmin = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(porAdmin.status).toBe(429)
    expect((await jsonDe(porAdmin)).codigo).toBe("RATE_LIMIT")
    expect(Number(porAdmin.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)

    resetRateLimit("propuestas:user_1")
    resetRateLimit(`propuestas:ip:${IP}`)
    for (let i = 0; i < 60; i += 1) {
      rateLimitDetalle(`propuestas:ip:${IP}`, 60, 60_000)
    }
    const porIp = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(porIp.status).toBe(429)
    expect((await jsonDe(porIp)).codigo).toBe("RATE_LIMIT")

    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("exige confirmacion explicita en el body", async () => {
    for (const body of [{}, { confirmado: false }, { confirmado: "true" }]) {
      const res = await aprobarEnvio(pedidoAprobacion(body), contexto("env_1"))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    const roto = await aprobarEnvio(
      pedido(URL_APROBAR, "POST", null, { rawBody: "{" }),
      contexto("env_1"),
    )
    expect(roto.status).toBe(400)
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
  })

  it("responde 404 si el envio o el prospecto no existen", async () => {
    mocks.envioFindUnique.mockResolvedValueOnce(null)
    const sinEnvio = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(sinEnvio.status).toBe(404)
    esperarNoStore(sinEnvio)
    expect((await jsonDe(sinEnvio)).codigo).toBe("NO_ENCONTRADO")

    mocks.envioFindUnique.mockResolvedValueOnce(envioAprobable())
    mocks.prospectoFindUnique.mockResolvedValueOnce(null)
    const sinProspecto = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))
    expect(sinProspecto.status).toBe(404)
    expect((await jsonDe(sinProspecto)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each(["APROBADO", "ENVIANDO", "ENVIADO", "CANCELADO"])(
    "en %s responde 409 ESTADO y no reescribe el snapshot",
    async (estado) => {
      mocks.envioFindUnique.mockResolvedValue(envioAprobable({ estado }))

      const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

      expect(res.status).toBe(409)
      esperarNoStore(res)
      expect((await jsonDe(res)).codigo).toBe("ESTADO")
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      "sin secreto",
      "PROPUESTAS_SECRETO",
      null,
      /PROPUESTAS_SECRETO/i,
    ],
    [
      "URL no https",
      "NEXT_PUBLIC_URL",
      "http://pixelarch.dev",
      /NEXT_PUBLIC_URL/i,
    ],
    [
      "URL con path",
      "NEXT_PUBLIC_URL",
      "https://pixelarch.dev/portal",
      /NEXT_PUBLIC_URL/i,
    ],
    [
      "from invalido",
      "PROPUESTAS_FROM_EMAIL",
      "no-es-email",
      /PROPUESTAS_FROM_EMAIL/i,
    ],
    [
      "reply-to invalido",
      "PROPUESTAS_REPLY_TO",
      "reply-invalido",
      /PROPUESTAS_REPLY_TO/i,
    ],
    [
      "sin texto legal",
      "PROPUESTAS_TEXTO_LEGAL",
      null,
      /PROPUESTAS_TEXTO_LEGAL/i,
    ],
    [
      "sin base legal",
      "PROPUESTAS_BASE_LEGAL",
      null,
      /PROPUESTAS_BASE_LEGAL/i,
    ],
  ])(
    "rechaza con 409 CONFIGURACION %s sin tocar datos",
    async (_caso, clave, valor, motivo) => {
      if (valor === null) delete process.env[clave]
      else process.env[clave] = valor

      const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

      expect(res.status).toBe(409)
      esperarNoStore(res)
      const cuerpo = await jsonDe(res)
      expect(cuerpo.codigo).toBe("CONFIGURACION")
      expect(JSON.stringify(cuerpo.motivos)).toMatch(motivo)
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
      expect(logsDeMocks()).not.toContain("ventas@alfa.com.ar")
    },
  )

  it("sin email responde 409 SIN_EMAIL sin escribir", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "BORRADOR", email: null }),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SIN_EMAIL")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("un contacto suprimido responde 409 SUPRIMIDO sin escribir", async () => {
    mocks.supresionFindMany.mockResolvedValue([
      {
        ambito: "DOMINIO",
        emailHash: null,
        dominioNegocio: "alfa.com.ar",
      },
    ])

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("SUPRIMIDO")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("si falta el secreto para verificar supresion falla con 409 CONFIGURACION", async () => {
    // Se elimina el secreto despues de la carga del envio: la configuracion se
    // evalua antes que la supresion, por lo que el motivo es CONFIGURACION.
    delete process.env.PROPUESTAS_SECRETO

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("CONFIGURACION")
    expect(mocks.supresionFindMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un borrador mutado (hash distinto) responde 409 REVALIDACION", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobable({ hashContenido: "f".repeat(64) }),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    const cuerpo = await jsonDe(res)
    expect(cuerpo.codigo).toBe("REVALIDACION")
    expect(JSON.stringify(cuerpo.motivos)).toMatch(/cambio desde que se genero/i)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("otro envio APROBADO/ENVIANDO de la misma secuencia responde 409", async () => {
    mocks.envioFindMany.mockResolvedValue([{ id: "env_otro" }])

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("REVALIDACION")
    expect(mocks.envioFindMany).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_1",
        secuencia: 1,
        id: { not: "env_1" },
        estado: { in: ["APROBADO", "ENVIANDO"] },
      },
      select: { id: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("una plantilla inactiva responde 409 REVALIDACION", async () => {
    mocks.plantillaFindFirst.mockResolvedValue(null)

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("REVALIDACION")
    expect(mocks.plantillaFindFirst).toHaveBeenCalledWith({
      where: { id: "pl_1", activa: true },
      select: { version: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un destinatario distinto al email actual del prospecto responde 409", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobable({ destinatario: "otro@alfa.com.ar" }),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    const cuerpo = await jsonDe(res)
    expect(cuerpo.codigo).toBe("REVALIDACION")
    expect(JSON.stringify(cuerpo.motivos)).toMatch(
      /no coincide con el email actual/i,
    )
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un prospecto en un estado sin transicion a APROBADO responde 409", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "NUEVO" }),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    const cuerpo = await jsonDe(res)
    expect(cuerpo.codigo).toBe("REVALIDACION")
    expect(JSON.stringify(cuerpo.motivos)).toMatch(
      /no esta en un estado que permita aprobar/i,
    )
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un doble clic pierde la guarda atomica y responde 409 ESTADO", async () => {
    mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 0 })

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.tx.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("si el prospecto cambia de estado en la transaccion responde 409 ESTADO", async () => {
    mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 0 })

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
  })

  it("con el esquema faltante responde 503 sin filtrar detalles", async () => {
    mocks.envioFindUnique.mockRejectedValue({ code: "P2021" })

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("un error inesperado responde 500 sanitizado y sin PII en logs", async () => {
    mocks.envioFindUnique.mockRejectedValue(
      new Error(
        "fallo con ventas@alfa.com.ar y token v1.pros_1.deadbeef",
      ),
    )

    const res = await aprobarEnvio(pedidoAprobacion(), contexto("env_1"))

    expect(res.status).toBe(500)
    esperarNoStore(res)
    const cuerpo = await jsonDe(res)
    expect(cuerpo).toEqual({
      error: "Error inesperado.",
      codigo: "DESCONOCIDO",
    })
    const logs = logsDeMocks()
    expect(logs).not.toContain("ventas@alfa.com.ar")
    expect(logs).not.toContain("v1.pros_1.deadbeef")
  })

  it("no importa Resend, no hace fetch y no programa envios", () => {
    const ruta = readFileSync(
      join(
        process.cwd(),
        "src/app/api/propuestas/envios/[id]/aprobar/route.ts",
      ),
      "utf8",
    )

    expect(ruta).not.toMatch(/@\/lib\/propuestas\/resend/)
    expect(ruta).not.toMatch(/sendEmail|enviarEmail|sendPaymentReceipt/)
    expect(ruta).not.toMatch(/\bfetch\s*\(/)
    expect(ruta).not.toMatch(/scheduledAt\s*:/)
    expect(ruta).not.toMatch(/\benviarEmail\b|\benviar\s*\(/)
  })
})

/* ------------------------------------------------------------------ */
/* T-18: wrapper de Resend (AC-26, AC-28, AC-29; RF-43..RF-48)         */
/* ------------------------------------------------------------------ */

const API_KEY_RESEND = "re_test_key_123456789"
const URL_ENVIAR = `${URL_ENVIOS}/env_1/enviar`
const URL_REINTENTAR = `${URL_ENVIOS}/env_1/reintentar`
const URL_RESULTADO = `${URL_ENVIOS}/env_1/resultado`
const URL_RECONCILIAR = `${URL_ENVIOS}/env_1/reconciliar`

function entradaResend(
  overrides: Record<string, unknown> = {},
): Parameters<typeof enviarEmail>[0] {
  const tokenBaja = tokenBajaDePrueba()

  return {
    fromEmail: FROM_EMAIL,
    fromNombre: FROM_NOMBRE,
    replyTo: REPLY_TO,
    to: "ventas@alfa.com.ar",
    subject: ASUNTO_ENVIO,
    html: "<p>Hola Ana</p>",
    text: "Hola Ana",
    headers: {
      "List-Unsubscribe": `<${ORIGEN}/api/opt-out?token=${encodeURIComponent(
        tokenBaja,
      )}>, <mailto:${REPLY_TO}?subject=Baja>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: "envio:env_1:v1",
    ...overrides,
  } as Parameters<typeof enviarEmail>[0]
}

function fetchResendOk(messageId = "msg_123") {
  return vi.fn().mockResolvedValue(respuestaResend(messageId))
}

describe("Resend wrapper (T-18, AC-26, AC-28, AC-29; RF-43..RF-48)", () => {
  it("hace un unico POST al endpoint exacto con Authorization e Idempotency-Key (AC-26, AC-29)", async () => {
    const fetchImpl = fetchResendOk("msg_abc")

    const resultado = await enviarEmail(entradaResend(), {
      apiKey: API_KEY_RESEND,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(resultado).toEqual({ messageId: "msg_abc" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT_RESEND)
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY_RESEND}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "envio:env_1:v1",
    })

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      "click_tracking",
      "from",
      "headers",
      "html",
      "open_tracking",
      "reply_to",
      "subject",
      "text",
      "to",
    ])
    expect(body).toMatchObject({
      from: "PixelArch <propuestas@pixelarch.dev>",
      reply_to: REPLY_TO,
      to: "ventas@alfa.com.ar",
      subject: ASUNTO_ENVIO,
      html: "<p>Hola Ana</p>",
      text: "Hola Ana",
      headers: headersAprobados(),
      open_tracking: false,
      click_tracking: false,
    })
    // Solo lo aprobado: ni programacion, adjuntos ni copias ocultas. El
    // tracking se apaga explicitamente para que la cuenta no lo active.
    for (const prohibido of [
      "scheduledAt",
      "scheduled_at",
      "attachments",
      "cc",
      "bcc",
      "send_at",
      "tracking",
    ]) {
      expect(body).not.toHaveProperty(prohibido)
    }
  })

  it.each([
    [400, "VALIDACION"],
    [422, "VALIDACION"],
    [429, "LIMITE"],
    [401, "PROVEEDOR"],
    [403, "PROVEEDOR"],
    [500, "PROVEEDOR"],
    [503, "PROVEEDOR"],
    [418, "DESCONOCIDO"],
  ] as const)(
    "mapea HTTP %s a un codigo sanitizado %s (AC-28)",
    async (status, codigo) => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ message: "detalle crudo del proveedor" }),
      })

      const promesa = enviarEmail(entradaResend(), {
        apiKey: API_KEY_RESEND,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(promesa).rejects.toBeInstanceOf(ErrorResend)
      await expect(promesa).rejects.toMatchObject({ codigo })
      await expect(promesa).rejects.not.toThrow(/detalle crudo/i)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )

  it("solo acepta exito con data.id; 200 sin id, id vacio o JSON roto es PROVEEDOR (AC-29)", async () => {
    const respuestas: Array<Record<string, unknown>> = [
      { ok: true, status: 200, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ id: "" }) },
      { ok: true, status: 200, json: async () => ({ id: 123 }) },
      { ok: true, status: 200, json: async () => ({ id: "   " }) },
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("sin json")
        },
      },
    ]

    for (const respuesta of respuestas) {
      const fetchImpl = vi.fn().mockResolvedValue(respuesta)
      const promesa = enviarEmail(entradaResend(), {
        apiKey: API_KEY_RESEND,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(promesa, JSON.stringify(respuesta)).rejects.toMatchObject({
        codigo: "PROVEEDOR",
      })
    }
  })

  it("un fallo de red se convierte en RED sin retry (AC-28)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"))

    const promesa = enviarEmail(entradaResend(), {
      apiKey: API_KEY_RESEND,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(promesa).rejects.toMatchObject({ codigo: "RED" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("un timeout aborta y responde RED sin retry (AC-28)", async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"))
            })
          }),
      )

      // El handler de rechazo se adjunta antes de avanzar el reloj para que
      // Vitest no lo vea como una promesa rechazada sin manejar.
      const expectativa = expect(
        enviarEmail(entradaResend(), {
          apiKey: API_KEY_RESEND,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ codigo: "RED" })

      await vi.advanceTimersByTimeAsync(1_000)
      await expectativa
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("falla cerrado con configuracion invalida sin llamar a fetch", async () => {
    const fetchImpl = vi.fn()

    await expect(
      enviarEmail(entradaResend(), {
        apiKey: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ codigo: "VALIDACION" })

    await expect(
      enviarEmail(entradaResend({ idempotencyKey: " " }), {
        apiKey: API_KEY_RESEND,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ codigo: "VALIDACION" })

    await expect(
      enviarEmail(
        entradaResend({
          headers: { "List-Unsubscribe": "<https://x.test>" },
        }),
        {
          apiKey: API_KEY_RESEND,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ codigo: "VALIDACION" })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("no loguea PII ni la API key y no expone el crudo del proveedor (AC-29)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error(`fallo ${API_KEY_RESEND} ventas@alfa.com.ar`),
    )

    try {
      const promesa = enviarEmail(entradaResend(), {
        apiKey: API_KEY_RESEND,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      const error = await promesa.catch((capturado: unknown) => capturado)
      expect(error).toBeInstanceOf(ErrorResend)
      const serializado = String((error as Error).message)
      expect(serializado).not.toContain(API_KEY_RESEND)
      expect(serializado).not.toContain("ventas@alfa.com.ar")
      expect(serializado).not.toContain("fallo")
      expect(consoleError).not.toHaveBeenCalled()
      expect(consoleWarn).not.toHaveBeenCalled()
      expect(consoleLog).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
      consoleWarn.mockRestore()
      consoleLog.mockRestore()
    }
  })

  it("el codigo fuente no importa SDKs, no usa red propia ni scheduler", () => {
    const fuente = readFileSync(
      join(process.cwd(), "src/lib/propuestas/resend.ts"),
      "utf8",
    )

    expect(fuente).not.toMatch(/from "resend"|require\("resend"\)/i)
    expect(fuente).not.toMatch(/node:(?:https?|net|tls|dns)/)
    expect(fuente).not.toMatch(/\bconsole\.|\blogger\./)
    expect(fuente).not.toMatch(/scheduledAt\s*:/)
    expect(fuente).not.toMatch(/setInterval\s*\(/)
  })
})

/* ------------------------------------------------------------------ */
/* T-18: POST /api/propuestas/envios/[id]/enviar                       */
/* ------------------------------------------------------------------ */

function prepararEnvioReal(): void {
  process.env.PROPUESTAS_ENVIO_HABILITADO = "true"
  process.env.RESEND_API_KEY = API_KEY_RESEND
  mocks.envioFindUnique.mockResolvedValue(envioAprobadoFixture())
  mocks.plantillaFindFirst.mockResolvedValue({ version: 1 })
  mocks.consumoFindMany.mockResolvedValue([])
  mocks.tx.consumoProveedor.findMany.mockResolvedValue([])
  mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
  mocks.envioUpdateMany.mockResolvedValue({ count: 1 })
  mocks.prospectoUpdateMany.mockResolvedValue({ count: 1 })
}

function pedidoEnviar(
  body: unknown = { confirmacion: "ENVIAR" },
  opciones: OpcionesPedido = {},
): Request {
  return pedido(URL_ENVIAR, "POST", body, opciones)
}

describe("POST /api/propuestas/envios/[id]/enviar (T-18, AC-26, AC-28..AC-30)", () => {
  it("envia una sola vez con Idempotency-Key y registra ENVIADO + messageId (AC-26, AC-29)", async () => {
    prepararEnvioReal()
    const fetchMock = fetchResendOk("msg_live_1")
    vi.stubGlobal("fetch", fetchMock)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(200)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({
      estado: "ENVIADO",
      messageId: "msg_live_1",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT_RESEND)
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY_RESEND}`,
      "Idempotency-Key": "envio:env_1:v1",
    })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      to: "ventas@alfa.com.ar",
      subject: ASUNTO_APROBADO,
      text: TEXTO_APROBADO,
      html: HTML_APROBADO,
      headers: headersAprobados(),
      open_tracking: false,
      click_tracking: false,
    })
    expect(body).not.toHaveProperty("scheduledAt")
    expect(body).not.toHaveProperty("attachments")
    expect(body).not.toHaveProperty("cc")
    expect(body).not.toHaveProperty("bcc")

    const reservado = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(reservado.where).toEqual({ id: "env_1", estado: "APROBADO" })
    expect((reservado.data ?? {}) as Record<string, unknown>).toMatchObject({
      estado: "ENVIANDO",
      idempotencyKey: "envio:env_1:v1",
      intentos: { increment: 1 },
    })

    const marcado = argumento(mocks.envioUpdateMany)
    expect(marcado.where).toEqual({ id: "env_1", estado: "ENVIANDO" })
    expect((marcado.data ?? {}) as Record<string, unknown>).toMatchObject({
      estado: "ENVIADO",
      proveedorMessageId: "msg_live_1",
      error: null,
    })

    const prospecto = argumento(mocks.prospectoUpdateMany)
    expect(prospecto.where).toEqual({ id: "pros_1", estado: "APROBADO" })
    const datosProspecto = (prospecto.data ?? {}) as Record<string, unknown>
    expect(datosProspecto).toMatchObject({ estado: "ENVIADO" })
    expect(datosProspecto.ultimoEnvioEn).toBeInstanceOf(Date)
    expect(datosProspecto.ultimaInteraccionEn).toBeInstanceOf(Date)

    const logs = logsDeMocks()
    expect(logs).not.toContain("ventas@alfa.com.ar")
    expect(logs).not.toContain(API_KEY_RESEND)
    expect(logs).not.toContain(ASUNTO_APROBADO)
    expect(logs).not.toContain(TEXTO_APROBADO)
  })

  it("normaliza un reply-to con mayúsculas y el snapshot sigue coincidiendo (AC-26)", async () => {
    process.env.PROPUESTAS_REPLY_TO = "HOLA@PIXELARCH.DEV"
    prepararEnvioReal()
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ replyTo: "HOLA@PIXELARCH.DEV" }),
    )
    const fetchMock = fetchResendOk("msg_mayusculas")
    vi.stubGlobal("fetch", fetchMock)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      estado: "ENVIADO",
      messageId: "msg_mayusculas",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
    ) as Record<string, unknown>
    // Resend recibe el reply-to normalizado, aunque la env este en mayúsculas.
    expect(body.reply_to).toBe("hola@pixelarch.dev")
    expect(body.headers).toMatchObject({
      "List-Unsubscribe": expect.stringContaining(
        "<mailto:hola@pixelarch.dev?subject=Baja>",
      ),
    })
    expect(JSON.stringify(body)).not.toContain("HOLA@")

    const reservado = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(reservado.where).toEqual({ id: "env_1", estado: "APROBADO" })
  })

  it("si el prospecto ya no está APROBADO, igual registra las fechas del envío (AC-29)", async () => {
    prepararEnvioReal()
    const fetchMock = fetchResendOk("msg_sin_estado")
    vi.stubGlobal("fetch", fetchMock)
    mocks.prospectoUpdateMany.mockReset()
    mocks.prospectoUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      estado: "ENVIADO",
      messageId: "msg_sin_estado",
    })
    expect(mocks.prospectoUpdateMany).toHaveBeenCalledTimes(2)

    const transicion = argumento(mocks.prospectoUpdateMany, 0)
    expect(transicion.where).toEqual({ id: "pros_1", estado: "APROBADO" })
    const datosTransicion = (transicion.data ?? {}) as Record<string, unknown>
    expect(datosTransicion.estado).toBe("ENVIADO")
    expect(datosTransicion.ultimoEnvioEn).toBeInstanceOf(Date)
    expect(datosTransicion.ultimaInteraccionEn).toBeInstanceOf(Date)

    // Carrera de estado: el email ya salió, se conserva la fecha real aunque
    // el prospecto haya cambiado de estado en paralelo.
    const fechas = argumento(mocks.prospectoUpdateMany, 1)
    expect(fechas.where).toEqual({ id: "pros_1" })
    const datosFechas = (fechas.data ?? {}) as Record<string, unknown>
    expect(datosFechas).not.toHaveProperty("estado")
    expect(datosFechas.ultimoEnvioEn).toBeInstanceOf(Date)
    expect(datosFechas.ultimaInteraccionEn).toBeInstanceOf(Date)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("un doble clic pierde la transicion atomica: 409 y no duplica el email (AC-26)", async () => {
    prepararEnvioReal()
    const fetchMock = fetchResendOk("msg_unico")
    vi.stubGlobal("fetch", fetchMock)
    mocks.tx.envioPropuesta.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const primero = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    const segundo = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(primero.status).toBe(200)
    expect(segundo.status).toBe(409)
    expect((await jsonDe(segundo)).codigo).toBe("ESTADO")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("solo APROBADO puede enviarse; el resto responde 409 sin red (AC-30)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    for (const estado of [
      "BORRADOR",
      "ENVIANDO",
      "ENVIADO",
      "FALLIDO",
      "RESPONDIDO",
      "CANCELADO",
    ]) {
      prepararEnvioReal()
      mocks.envioFindUnique.mockResolvedValue(
        envioAprobadoFixture({ estado }),
      )

      const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

      expect(res.status, estado).toBe(409)
      expect((await jsonDe(res)).codigo, estado).toBe("ESTADO")
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("exige body exacto { confirmacion: 'ENVIAR' } (AC-26, AC-30)", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    for (const body of [
      {},
      { confirmacion: "enviar" },
      { confirmacion: true },
      { enviar: true },
      { confirmacion: "ENVIAR", extra: true },
    ]) {
      const res = await enviarEnvio(pedidoEnviar(body), contexto("env_1"))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    const roto = await enviarEnvio(
      pedido(URL_ENVIAR, "POST", null, { rawBody: "{" }),
      contexto("env_1"),
    )
    expect(roto.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin email o con supresion responde 409 y nunca llama a Resend", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    mocks.prospectoFindUnique.mockResolvedValueOnce(prospectoBd({ email: null }))
    const sinEmail = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(sinEmail.status).toBe(409)
    expect((await jsonDe(sinEmail)).codigo).toBe("SIN_EMAIL")

    prepararEnvioReal()
    mocks.supresionFindMany.mockResolvedValue([
      {
        ambito: "DOMINIO",
        emailHash: null,
        dominioNegocio: "alfa.com.ar",
      },
    ])
    const suprimido = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(suprimido.status).toBe(409)
    expect((await jsonDe(suprimido)).codigo).toBe("SUPRIMIDO")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("un snapshot, header o token cambiado responde 409 REVALIDACION (AC-26, AC-30)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    prepararEnvioReal()
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ aprobadoHash: "f".repeat(64) }),
    )
    const hashDistinto = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(hashDistinto.status).toBe(409)
    expect((await jsonDe(hashDistinto)).codigo).toBe("REVALIDACION")

    prepararEnvioReal()
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ hashContenido: "e".repeat(64) }),
    )
    const contenidoDistinto = await enviarEnvio(
      pedidoEnviar(),
      contexto("env_1"),
    )
    expect(contenidoDistinto.status).toBe(409)
    expect((await jsonDe(contenidoDistinto)).codigo).toBe("REVALIDACION")

    prepararEnvioReal()
    process.env.PROPUESTAS_REPLY_TO = "otro@pixelarch.dev"
    const headerCambiado = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(headerCambiado.status).toBe(409)
    expect((await jsonDe(headerCambiado)).codigo).toBe("REVALIDACION")

    prepararEnvioReal()
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({
        tokenBaja: crearTokenBaja(
          "pros_1",
          hashEmail("otro@alfa.com.ar", SECRETO),
          SECRETO,
        ),
      }),
    )
    const tokenCambiado = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(tokenCambiado.status).toBe(409)
    expect((await jsonDe(tokenCambiado)).codigo).toBe("REVALIDACION")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["gate off", "PROPUESTAS_ENVIO_HABILITADO", "false", /ENVIO_HABILITADO/i],
    ["sin Resend", "RESEND_API_KEY", null, /RESEND_API_KEY/i],
    [
      "from invalido",
      "PROPUESTAS_FROM_EMAIL",
      "no-es-email",
      /FROM_EMAIL/i,
    ],
    [
      "reply-to invalido",
      "PROPUESTAS_REPLY_TO",
      "reply-invalido",
      /REPLY_TO/i,
    ],
    ["sin secreto", "PROPUESTAS_SECRETO", null, /SECRETO/i],
    ["URL no https", "NEXT_PUBLIC_URL", "http://pixelarch.dev", /NEXT_PUBLIC_URL/i],
    [
      "URL con path",
      "NEXT_PUBLIC_URL",
      "https://pixelarch.dev/portal",
      /NEXT_PUBLIC_URL/i,
    ],
    ["sin texto legal", "PROPUESTAS_TEXTO_LEGAL", null, /TEXTO_LEGAL/i],
    ["sin base legal", "PROPUESTAS_BASE_LEGAL", null, /BASE_LEGAL/i],
  ])(
    "rechaza con 409 CONFIGURACION %s sin tocar datos ni red (AC-30)",
    async (_caso, clave, valor, motivo) => {
      prepararEnvioReal()
      if (valor === null) delete process.env[clave]
      else process.env[clave] = valor
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

      expect(res.status).toBe(409)
      esperarNoStore(res)
      const cuerpo = await jsonDe(res)
      expect(cuerpo.codigo).toBe("CONFIGURACION")
      expect(JSON.stringify(cuerpo.motivos)).toMatch(motivo)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
      expect(logsDeMocks()).not.toContain("ventas@alfa.com.ar")
    },
  )

  it("sin cupo responde 429 CUPO y no encola ni llama a Resend (AC-31)", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    mocks.consumoFindMany.mockResolvedValue([
      {
        proveedor: "RESEND",
        unidades: 20,
        llamadas: 20,
        costoCentavos: 0,
      },
    ])

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("CUPO")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("el 21.º envio del dia responde 429 sin crear cola (AC-31)", async () => {
    prepararEnvioReal()
    process.env.PROPUESTAS_CUPO_ENVIOS_DIA = "20"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const filas = Array.from({ length: 20 }, (_, indice) => ({
      proveedor: "RESEND",
      unidades: 1,
      llamadas: 1,
      costoCentavos: 0,
      _indice: indice,
    }))
    mocks.consumoFindMany.mockResolvedValue(filas)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(429)
    expect((await jsonDe(res)).codigo).toBe("CUPO")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.tx.envioPropuesta.updateMany).not.toHaveBeenCalled()
  })

  it("un fallo de Resend deja FALLIDO, error saneado y sin retry (AC-28)", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "detalle crudo con ventas@alfa.com.ar" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(502)
    esperarNoStore(res)
    expect(await jsonDe(res)).toMatchObject({
      codigo: "PROVEEDOR",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const fallido = argumento(mocks.envioUpdateMany)
    expect(fallido.where).toEqual({ id: "env_1", estado: "ENVIANDO" })
    const data = (fallido.data ?? {}) as Record<string, unknown>
    expect(data.estado).toBe("FALLIDO")
    expect(String(data.error)).toMatch(/^PROVEEDOR: /)
    expect(String(data.error)).not.toContain("detalle crudo")
    expect(String(data.error)).not.toContain("ventas@alfa.com.ar")

    // El prospecto no se marca como enviado y no hay reintento automatico.
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("un fallo de red tambien deja FALLIDO sin retry (AC-28)", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const data = (argumento(mocks.envioUpdateMany).data ?? {}) as Record<
      string,
      unknown
    >
    expect(data.estado).toBe("FALLIDO")
    expect(String(data.error)).toMatch(/^RED: /)
    expect(mocks.prospectoUpdateMany).not.toHaveBeenCalled()
  })

  it("exige admin, origen same-origin y el rate limit adicional de envios", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(asistente.status).toBe(403)

    simularAdmin()
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await enviarEnvio(
        pedidoEnviar({ confirmacion: "ENVIAR" }, opciones),
        contexto("env_1"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    for (let i = 0; i < 10; i += 1) {
      rateLimitDetalle("propuestas:envio:user_1", 10, 60_000)
    }
    const limitado = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(limitado.status).toBe(429)
    expect((await jsonDe(limitado)).codigo).toBe("RATE_LIMIT")
    expect(Number(limitado.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
  })

  it("responde 404 si el envio o el prospecto no existen", async () => {
    prepararEnvioReal()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    mocks.envioFindUnique.mockResolvedValueOnce(null)
    const sinEnvio = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(sinEnvio.status).toBe(404)
    expect((await jsonDe(sinEnvio)).codigo).toBe("NO_ENCONTRADO")

    prepararEnvioReal()
    mocks.prospectoFindUnique.mockResolvedValueOnce(null)
    const sinProspecto = await enviarEnvio(pedidoEnviar(), contexto("env_1"))
    expect(sinProspecto.status).toBe(404)
    expect((await jsonDe(sinProspecto)).codigo).toBe("NO_ENCONTRADO")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("con esquema faltante responde 503 y no filtra detalles", async () => {
    prepararEnvioReal()
    mocks.envioFindUnique.mockRejectedValue({ code: "P2021" })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await enviarEnvio(pedidoEnviar(), contexto("env_1"))

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("ESQUEMA_NO_APLICADO")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no hay scheduler, scheduledAt ni envio automatico en las rutas", () => {
    for (const archivo of [
      "src/app/api/propuestas/envios/[id]/enviar/route.ts",
      "src/app/api/propuestas/envios/[id]/reintentar/route.ts",
      "src/app/api/propuestas/envios/[id]/resultado/route.ts",
      "src/app/api/propuestas/envios/[id]/reconciliar/route.ts",
    ]) {
      const fuente = readFileSync(join(process.cwd(), archivo), "utf8")
      expect(fuente, archivo).not.toMatch(/scheduledAt\s*:/)
      expect(fuente, archivo).not.toMatch(/setInterval\s*\(/)
      expect(fuente, archivo).not.toMatch(/\b(?:node-cron|bullmq|agenda)\b/i)
    }
  })
})

/* ------------------------------------------------------------------ */
/* T-18: POST /api/propuestas/envios/[id]/reintentar                   */
/* ------------------------------------------------------------------ */

function envioFallidoFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return envioAprobable({
    estado: "FALLIDO",
    asunto: ASUNTO_ENVIO,
    cuerpoTexto: CUERPO_TEXTO_ENVIO,
    cuerpoHtml: CUERPO_HTML_ENVIO,
    ...overrides,
  })
}

describe("POST /api/propuestas/envios/[id]/reintentar (T-18, AC-28, AC-31)", () => {
  it("crea una version+1 BORRADOR con el mismo contenido y sin llamar a Resend (AC-28, AC-31)", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioFallidoFixture({ version: 3 }),
    )
    mocks.envioFindFirst.mockResolvedValue(null)
    mocks.envioCreate.mockResolvedValue({ id: "env_4", version: 4 })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )

    expect(res.status).toBe(201)
    esperarNoStore(res)
    expect(await jsonDe(res)).toEqual({ envioId: "env_4", version: 4 })

    const creado = datosDe(mocks.envioCreate)
    expect(creado).toMatchObject({
      prospectoId: "pros_1",
      campanaId: "camp_1",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      secuencia: 1,
      version: 4,
      destinatario: "ventas@alfa.com.ar",
      fromEmail: FROM_EMAIL,
      fromNombre: FROM_NOMBRE,
      replyTo: REPLY_TO,
      asunto: ASUNTO_ENVIO,
      cuerpoTexto: CUERPO_TEXTO_ENVIO,
      cuerpoHtml: CUERPO_HTML_ENVIO,
      estado: "BORRADOR",
    })
    // Hash recomputado desde el contenido: no se copia el snapshot aprobado.
    expect(creado.hashContenido).toBe(
      hashContenidoEnvio({
        asunto: ASUNTO_ENVIO,
        cuerpoTexto: CUERPO_TEXTO_ENVIO,
        cuerpoHtml: CUERPO_HTML_ENVIO,
        destinatario: "ventas@alfa.com.ar",
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia: 1,
      }),
    )
    expect(creado).not.toHaveProperty("aprobadoHash")
    expect(creado).not.toHaveProperty("aprobadoAsunto")
    expect(creado).not.toHaveProperty("tokenBaja")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    "BORRADOR",
    "APROBADO",
    "ENVIANDO",
    "ENVIADO",
    "REBOTADO",
    "QUEJA",
    "RESPONDIDO",
    "CANCELADO",
  ])("en %s responde 409 y no crea nada", async (estado) => {
    mocks.envioFindUnique.mockResolvedValue(envioFallidoFixture({ estado }))

    const res = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioCreate).not.toHaveBeenCalled()
  })

  it("si ya hay un BORRADOR/APROBADO/ENVIANDO abierto no duplica (AC-31)", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioFallidoFixture())
    mocks.envioFindFirst.mockResolvedValue({ id: "env_abierto" })

    const res = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("BORRADOR_ABIERTO")
    expect(mocks.envioFindFirst).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_1",
        secuencia: 1,
        estado: { in: ["BORRADOR", "APROBADO", "ENVIANDO"] },
      },
      select: { id: true },
    })
    expect(mocks.envioCreate).not.toHaveBeenCalled()
  })

  it("un prospecto SUPRIMIDO responde 409 SUPRIMIDO y uno DESCARTADO 409 ESTADO (AC-31)", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioFallidoFixture())

    mocks.prospectoFindUnique.mockResolvedValueOnce(
      prospectoBd({ estado: "SUPRIMIDO" }),
    )
    const suprimido = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )
    expect(suprimido.status).toBe(409)
    expect((await jsonDe(suprimido)).codigo).toBe("SUPRIMIDO")
    expect(mocks.envioCreate).not.toHaveBeenCalled()

    mocks.prospectoFindUnique.mockResolvedValueOnce(
      prospectoBd({ estado: "DESCARTADO" }),
    )
    const descartado = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )
    expect(descartado.status).toBe(409)
    expect((await jsonDe(descartado)).codigo).toBe("ESTADO")
    expect(mocks.envioCreate).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit antes de tocar datos", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioFallidoFixture())

    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const cross = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}, { origin: "https://evil.test" }),
      contexto("env_1"),
    )
    expect(cross.status).toBe(403)
    expect((await jsonDe(cross)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )
    expect(limitado.status).toBe(429)
    expect(mocks.envioFindUnique).not.toHaveBeenCalled()
  })

  it("responde 404 si el envio no existe", async () => {
    mocks.envioFindUnique.mockResolvedValue(null)

    const res = await reintentarEnvio(
      pedido(URL_REINTENTAR, "POST", {}),
      contexto("env_1"),
    )

    expect(res.status).toBe(404)
    expect((await jsonDe(res)).codigo).toBe("NO_ENCONTRADO")
    expect(mocks.envioCreate).not.toHaveBeenCalled()
  })
})

describe("follow-up manual tras ENVIADO (T-18, AC-31; RF-50)", () => {
  it("permite crear el segundo borrador (secuencia 2) sin enviar nada", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "ENVIADO" }),
    )
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_1", estado: "ENVIADO", secuencia: 1 },
    ])
    mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.envioPropuesta.create.mockResolvedValue({
      id: "env_2",
      secuencia: 2,
      version: 1,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(201)
    expect(await jsonDe(res)).toEqual({
      envioId: "env_2",
      secuencia: 2,
      version: 1,
    })
    const creado = datosDe(mocks.tx.envioPropuesta.create)
    expect(creado).toMatchObject({
      secuencia: 2,
      estado: "BORRADOR",
    })
    const prospecto = argumento(mocks.tx.prospecto.updateMany)
    expect(prospecto.where).toEqual({ id: "pros_1", estado: "ENVIADO" })
    expect((prospecto.data ?? {}) as Record<string, unknown>).toMatchObject({
      estado: "BORRADOR",
    })
    // El follow-up no se envia: solo queda en borrador para aprobar.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("el tercer mensaje del prospecto responde 409 MAX_MENSAJES", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "ENVIADO" }),
    )
    mocks.envioFindMany.mockResolvedValue([
      { id: "env_1", estado: "ENVIADO", secuencia: 1 },
      { id: "env_2", estado: "RESPONDIDO", secuencia: 2 },
    ])

    const res = await crearBorrador(
      pedido(`${URL_PROSPECTOS}/pros_1/borrador`, "POST", {}),
      contexto("pros_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("MAX_MENSAJES")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-18: POST /api/propuestas/envios/[id]/resultado                    */
/* ------------------------------------------------------------------ */

function pedidoResultado(body: unknown): Request {
  return pedido(URL_RESULTADO, "POST", body)
}

describe("POST /api/propuestas/envios/[id]/resultado (T-18, AC-29, AC-31)", () => {
  it("RESPONDIDO marca envio y prospecto RESPONDIO sin red (AC-29)", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado: "ENVIADO" }),
    )
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "ENVIADO" }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({
      estado: "RESPONDIDO",
      suprimido: false,
    })

    const envio = argumento(mocks.tx.envioPropuesta.updateMany)
    expect(envio.where).toEqual({ id: "env_1", estado: "ENVIADO" })
    expect((envio.data ?? {}) as Record<string, unknown>).toEqual({
      estado: "RESPONDIDO",
    })

    const prospecto = argumento(mocks.tx.prospecto.updateMany)
    expect(prospecto.where).toEqual({ id: "pros_1", estado: "ENVIADO" })
    const datos = (prospecto.data ?? {}) as Record<string, unknown>
    expect(datos.estado).toBe("RESPONDIO")
    expect(datos.ultimaInteraccionEn).toBeInstanceOf(Date)
    expect(datos.actualizadoPor).toBe("user_1")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["REBOTE_DURO", "REBOTADO", "REBOTE_DURO"],
    ["QUEJA", "QUEJA", "QUEJA"],
  ] as const)(
    "%s suprime el email, cancela pendientes y marca el prospecto SUPRIMIDO (AC-31)",
    async (tipo, estadoFinal, motivo) => {
      mocks.envioFindUnique.mockResolvedValue(
        envioAprobadoFixture({ estado: "ENVIADO" }),
      )
      mocks.prospectoFindUnique.mockResolvedValue(
        prospectoBd({ estado: "ENVIADO" }),
      )
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      const res = await registrarResultado(
        pedidoResultado({ tipo, detalle: "Verificado por el admin." }),
        contexto("env_1"),
      )

      expect(res.status).toBe(200)
      expect(await jsonDe(res)).toEqual({
        estado: estadoFinal,
        suprimido: true,
      })

      const envio = argumento(mocks.tx.envioPropuesta.updateMany, 0)
      expect(envio.where).toEqual({ id: "env_1", estado: "ENVIADO" })
      expect((envio.data ?? {}) as Record<string, unknown>).toEqual({
        estado: estadoFinal,
      })

      const upsert = argumento(mocks.tx.supresionProspecto.upsert)
      const emailHash = hashEmail("ventas@alfa.com.ar", SECRETO)
      expect(upsert).toMatchObject({
        where: { clave: `EMAIL:${emailHash}` },
        create: {
          ambito: "EMAIL",
          clave: `EMAIL:${emailHash}`,
          emailHash,
          emailEnmascarado: "v***@alfa.com.ar",
          motivo,
          origen: "MANUAL",
          activa: true,
          notas: "Verificado por el admin.",
          creadaPor: "user_1",
          creadaPorNombre: "Ana Pérez",
        },
      })
      expect(upsert.update).toMatchObject({ activa: true })

      const cancelados = argumento(mocks.tx.envioPropuesta.updateMany, 1)
      expect(cancelados.where).toEqual({
        prospectoId: "pros_1",
        estado: { in: ["BORRADOR", "APROBADO"] },
      })
      expect(cancelados.data).toEqual({
        estado: "CANCELADO",
        motivoCancelacion: "SUPRESION",
      })

      const prospecto = argumento(mocks.tx.prospecto.updateMany)
      expect(prospecto.where).toEqual({
        id: "pros_1",
        estado: { not: "SUPRIMIDO" },
      })
      expect((prospecto.data ?? {}) as Record<string, unknown>).toMatchObject({
        estado: "SUPRIMIDO",
        actualizadoPor: "user_1",
      })

      const historial = ((prospecto.data ?? {}) as Record<string, unknown>)
        .historial as Array<Record<string, unknown>>
      expect(historial).toHaveLength(1)
      expect(historial[0]).toMatchObject({
        accion: "RESULTADO_ENVIO",
        motivo,
        por: "user_1",
      })
      expect(typeof historial[0].en).toBe("string")
      // El historial no guarda email, detalle libre ni PII.
      const serializado = JSON.stringify(historial)
      expect(serializado).not.toContain("ventas@alfa.com.ar")
      expect(serializado).not.toContain("Verificado por el admin.")

      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["REBOTE_DURO", "REBOTADO", "REBOTE_DURO"],
    ["QUEJA", "QUEJA", "QUEJA"],
  ] as const)(
    "%s suprime el destinatario enviado aunque el prospecto tenga un email nuevo (AC-31)",
    async (tipo, estadoFinal, motivo) => {
      mocks.envioFindUnique.mockResolvedValue(
        envioAprobadoFixture({ estado: "ENVIADO" }),
      )
      // El prospecto cambió de email después del envío: el rebote/queja debe
      // suprimir la dirección que salió, no la nueva.
      mocks.prospectoFindUnique.mockResolvedValue(
        prospectoBd({ estado: "ENVIADO", email: "nueva@alfa.com.ar" }),
      )
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      const res = await registrarResultado(
        pedidoResultado({ tipo, detalle: "Verificado por el admin." }),
        contexto("env_1"),
      )

      expect(res.status).toBe(200)
      expect(await jsonDe(res)).toEqual({
        estado: estadoFinal,
        suprimido: true,
      })

      const envio = argumento(mocks.tx.envioPropuesta.updateMany, 0)
      expect(envio.where).toEqual({ id: "env_1", estado: "ENVIADO" })
      expect((envio.data ?? {}) as Record<string, unknown>).toEqual({
        estado: estadoFinal,
      })

      // La supresión usa el hash/clave del destinatario enviado.
      const upsert = argumento(mocks.tx.supresionProspecto.upsert)
      const emailHash = hashEmail("ventas@alfa.com.ar", SECRETO)
      expect(upsert).toMatchObject({
        where: { clave: `EMAIL:${emailHash}` },
        create: {
          ambito: "EMAIL",
          clave: `EMAIL:${emailHash}`,
          emailHash,
          emailEnmascarado: "v***@alfa.com.ar",
          motivo,
          origen: "MANUAL",
          activa: true,
          notas: "Verificado por el admin.",
          creadaPor: "user_1",
          creadaPorNombre: "Ana Pérez",
        },
      })

      const cancelados = argumento(mocks.tx.envioPropuesta.updateMany, 1)
      expect(cancelados.where).toEqual({
        prospectoId: "pros_1",
        estado: { in: ["BORRADOR", "APROBADO"] },
      })
      expect(cancelados.data).toEqual({
        estado: "CANCELADO",
        motivoCancelacion: "SUPRESION",
      })

      // El prospecto conserva su ficha y su email nuevo: no se marca SUPRIMIDO.
      const prospecto = argumento(mocks.tx.prospecto.updateMany)
      expect(prospecto.where).toEqual({ id: "pros_1" })
      const datos = (prospecto.data ?? {}) as Record<string, unknown>
      expect(datos).not.toHaveProperty("estado")
      expect(datos).not.toHaveProperty("email")
      expect(datos.actualizadoPor).toBe("user_1")
      expect(datos.ultimaInteraccionEn).toBeInstanceOf(Date)

      const historial = datos.historial as Array<Record<string, unknown>>
      expect(historial).toHaveLength(1)
      expect(historial[0]).toMatchObject({
        accion: "RESULTADO_ENVIO",
        motivo,
        por: "user_1",
      })
      // Sin email viejo, email nuevo, destinatario ni detalle libre.
      const serializado = JSON.stringify(datos)
      expect(serializado).not.toContain("ventas@alfa.com.ar")
      expect(serializado).not.toContain("nueva@alfa.com.ar")
      expect(serializado).not.toContain("Verificado por el admin.")

      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("repetir un rebote con email nuevo es idempotente y no duplica el historial (AC-31)", async () => {
    mocks.envioFindUnique
      .mockResolvedValueOnce(envioAprobadoFixture({ estado: "ENVIADO" }))
      .mockResolvedValueOnce(envioAprobadoFixture({ estado: "REBOTADO" }))
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "ENVIADO", email: "nueva@alfa.com.ar" }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const primera = await registrarResultado(
      pedidoResultado({ tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )
    const segunda = await registrarResultado(
      pedidoResultado({ tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(200)
    expect(await jsonDe(segunda)).toEqual({
      estado: "REBOTADO",
      suprimido: true,
    })

    const upserts = mocks.tx.supresionProspecto.upsert.mock.calls.map(
      (llamada) =>
        (llamada[0] as { where: { clave: string } }).where.clave,
    )
    expect(upserts).toHaveLength(2)
    expect(new Set(upserts).size).toBe(1)
    expect(upserts[0]).toMatch(/^EMAIL:[0-9a-f]{64}$/)

    const actualizaciones = mocks.tx.prospecto.updateMany.mock.calls.map(
      (llamada) =>
        (llamada[0] as { data?: Record<string, unknown> }).data ?? {},
    )
    expect(actualizaciones).toHaveLength(2)
    expect(actualizaciones[0].historial).toHaveLength(1)
    // La repetición no agrega otra entrada ni cambia el estado del prospecto.
    expect(actualizaciones[1]).not.toHaveProperty("historial")
    for (const datos of actualizaciones) {
      expect(datos).not.toHaveProperty("estado")
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("la supresion es idempotente por clave: repetir el mismo resultado no crea otra (AC-31)", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado: "REBOTADO" }),
    )
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoBd({ estado: "SUPRIMIDO" }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const primera = await registrarResultado(
      pedidoResultado({ tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )
    const segunda = await registrarResultado(
      pedidoResultado({ tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(200)
    expect(await jsonDe(segunda)).toEqual({
      estado: "REBOTADO",
      suprimido: true,
    })
    expect(mocks.tx.supresionProspecto.upsert).toHaveBeenCalledTimes(2)
    const claves = mocks.tx.supresionProspecto.upsert.mock.calls.map(
      (llamada) =>
        (llamada[0] as { where: { clave: string } }).where.clave,
    )
    expect(new Set(claves).size).toBe(1)
    expect(claves[0]).toMatch(/^EMAIL:[0-9a-f]{64}$/)
    // El envio ya esta en el estado final: no se vuelve a transicionar; solo
    // se cancelan los pendientes (upsert idempotente + cancelacion).
    const transiciones = mocks.tx.envioPropuesta.updateMany.mock.calls.filter(
      (llamada) =>
        (llamada[0] as { where?: { estado?: unknown } }).where?.estado ===
        "ENVIADO",
    )
    expect(transiciones).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    "BORRADOR",
    "APROBADO",
    "ENVIANDO",
    "FALLIDO",
    "CANCELADO",
  ])("en %s responde 409 y no escribe (AC-29)", async (estado) => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado }),
    )

    const res = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.supresionUpsert).not.toHaveBeenCalled()
  })

  it("un tipo incoherente con el estado final responde 409 (AC-29)", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado: "QUEJA" }),
    )

    const res = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
  })

  it("valida el body exacto sin llamar a Resend", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    for (const body of [
      {},
      { tipo: "OTRO" },
      { tipo: "RESPONDIDO", extra: true },
      { tipo: "RESPONDIDO", detalle: "x".repeat(501) },
    ]) {
      const res = await registrarResultado(
        pedidoResultado(body),
        contexto("env_1"),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin secreto no puede suprimir y responde 503 NO_CONFIGURADO", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado: "ENVIADO" }),
    )
    mocks.prospectoFindUnique.mockResolvedValue(prospectoBd())
    delete process.env.PROPUESTAS_SECRETO

    const res = await registrarResultado(
      pedidoResultado({ tipo: "REBOTE_DURO" }),
      contexto("env_1"),
    )

    expect(res.status).toBe(503)
    expect((await jsonDe(res)).codigo).toBe("NO_CONFIGURADO")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("exige admin, origen y rate limit", async () => {
    mocks.envioFindUnique.mockResolvedValue(
      envioAprobadoFixture({ estado: "ENVIADO" }),
    )

    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    for (const opciones of [{ origin: null }, { origin: "https://evil.test" }]) {
      const res = await registrarResultado(
        pedido(URL_RESULTADO, "POST", { tipo: "RESPONDIDO" }, opciones),
        contexto("env_1"),
      )
      expect(res.status, JSON.stringify(opciones)).toBe(403)
      expect((await jsonDe(res)).codigo).toBe("ORIGEN_INVALIDO")
    }

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await registrarResultado(
      pedidoResultado({ tipo: "RESPONDIDO" }),
      contexto("env_1"),
    )
    expect(limitado.status).toBe(429)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-18: POST /api/propuestas/envios/[id]/reconciliar                  */
/* ------------------------------------------------------------------ */

function envioEnviandoFixture(
  minutos: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const referencia = new Date(Date.now() - minutos * 60_000)
  return {
    id: "env_1",
    estado: "ENVIANDO",
    enviadoEn: referencia,
    actualizadoEn: referencia,
    ...overrides,
  }
}

describe("POST /api/propuestas/envios/[id]/reconciliar (T-18, AC-28)", () => {
  it("un ENVIANDO de mas de 10 minutos pasa a FALLIDO con la nota, sin consultar Resend", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(11))
    mocks.envioUpdateMany.mockResolvedValue({ count: 1 })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", {
        nota: "Verificado en Resend: no figura envio.",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ estado: "FALLIDO" })
    const actualizado = argumento(mocks.envioUpdateMany)
    expect(actualizado.where).toEqual({ id: "env_1", estado: "ENVIANDO" })
    expect((actualizado.data ?? {}) as Record<string, unknown>).toEqual({
      estado: "FALLIDO",
      error: "Verificado en Resend: no figura envio.",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un ENVIANDO de menos de 10 minutos responde 409 y no escribe", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(5))

    const res = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "Intento prematuro." }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it.each(["APROBADO", "ENVIADO", "FALLIDO", "RESPONDIDO"])(
    "en %s responde 409 y no escribe",
    async (estado) => {
      mocks.envioFindUnique.mockResolvedValue(
        envioEnviandoFixture(30, { estado }),
      )

      const res = await reconciliarEnvio(
        pedido(URL_RECONCILIAR, "POST", { nota: "No aplica." }),
        contexto("env_1"),
      )

      expect(res.status).toBe(409)
      expect((await jsonDe(res)).codigo).toBe("ESTADO")
      expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
    },
  )

  it("exige una nota valida", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(11))

    for (const body of [{}, { nota: "   " }, { nota: "ok", extra: true }]) {
      const res = await reconciliarEnvio(
        pedido(URL_RECONCILIAR, "POST", body),
        contexto("env_1"),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await jsonDe(res)).codigo).toBe("VALIDACION")
    }

    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("si otro proceso cambia el estado, responde 409 sin sobrescribir", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(11))
    mocks.envioUpdateMany.mockResolvedValue({ count: 0 })

    const res = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "Carrera con otro admin." }),
      contexto("env_1"),
    )

    expect(res.status).toBe(409)
    expect((await jsonDe(res)).codigo).toBe("ESTADO")
  })

  it("exige admin, origen y rate limit", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(11))

    mocks.auth.mockResolvedValueOnce({ userId: null })
    const anonimo = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "x" }),
      contexto("env_1"),
    )
    expect(anonimo.status).toBe(401)

    simularAdmin("asistente")
    const asistente = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "x" }),
      contexto("env_1"),
    )
    expect(asistente.status).toBe(403)

    simularAdmin()
    const cross = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "x" }, { origin: null }),
      contexto("env_1"),
    )
    expect(cross.status).toBe(403)
    expect((await jsonDe(cross)).codigo).toBe("ORIGEN_INVALIDO")

    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }
    const limitado = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", { nota: "x" }),
      contexto("env_1"),
    )
    expect(limitado.status).toBe(429)
    expect(mocks.envioUpdateMany).not.toHaveBeenCalled()
  })

  it("no muestra PII en logs al reconciliar", async () => {
    mocks.envioFindUnique.mockResolvedValue(envioEnviandoFixture(11))
    const res = await reconciliarEnvio(
      pedido(URL_RECONCILIAR, "POST", {
        nota: "Fallo con ventas@alfa.com.ar",
      }),
      contexto("env_1"),
    )

    expect(res.status).toBe(200)
    const data = (argumento(mocks.envioUpdateMany).data ?? {}) as Record<
      string,
      unknown
    >
    expect(String(data.error)).not.toContain("ventas@alfa.com.ar")
    expect(logsDeMocks()).not.toContain("ventas@alfa.com.ar")
  })
})
