import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetRateLimit } from "@/lib/rate-limit"
import { crearTokenBaja, hashEmail } from "@/lib/propuestas/supresion"

/**
 * T-19 (AC-16, AC-33, AC-34, AC-35; RF-51, RF-52, RF-56): baja publica
 * one-click.
 *
 * Rutas publicas ya cubiertas en `middleware-propuestas.test.ts` (T-01):
 * `/propuestas/baja` y `/api/opt-out` quedan fuera del guard admin y llevan
 * `noindex`/`no-store`. Aca no se duplica el middleware: se prueba la API.
 *
 * Reglas verificadas:
 * - POST valido por query o body: supresion global `EMAIL:<hash>`, motivo
 *   `OPT_OUT`, origen `ENLACE`, cancelacion de los envios BORRADOR/APROBADO
 *   cuyo destinatario coincide con el hash del token (no los del email nuevo)
 *   y `SUPRIMIDO` solo si el email actual coincide con ese hash.
 * - Idempotente; el historial no guarda PII.
 * - Token invalido/ausente/malformado, sin secreto y errores de base devuelven
 *   la misma respuesta generica sin mutar ni filtrar validez.
 * - GET no muta; 405 con `Allow: POST`.
 * - Rate limit 10/min IP y 5/min token, con clave SHA-256 del token.
 * - Headers `no-store`, `noindex` y `no-referrer` en todas las respuestas.
 * - Nunca se loguean email, token ni secreto.
 *
 * No hay llamadas reales a red: Prisma y logger estan mockeados.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    supresionProspecto: { upsert: vi.fn() },
    envioPropuesta: { findMany: vi.fn(), updateMany: vi.fn() },
    prospecto: { updateMany: vi.fn() },
  }

  return {
    prospectoFindUnique: vi.fn(),
    transaction: vi.fn(),
    tx,
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    clavesRateLimit: [] as string[],
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospecto: { findUnique: mocks.prospectoFindUnique },
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

// Se conserva el rate limiter real (misma ventana en memoria) pero se capturan
// las claves usadas para comprobar que el token nunca viaja en claro.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>()

  return {
    ...actual,
    rateLimitDetalle: (key: string, limit: number, windowMs: number) => {
      mocks.clavesRateLimit.push(key)
      return actual.rateLimitDetalle(key, limit, windowMs)
    },
  }
})

import { GET, POST } from "@/app/api/opt-out/route"

const SECRETO = "secreto-de-pruebas-t19-opt-out-0123456789"
const EMAIL = "info@consultora-ejemplo.com"
const EMAIL_OTRO = "otro@consultora-ejemplo.com"
const HASH = hashEmail(EMAIL, SECRETO)
const TOKEN = crearTokenBaja("pros_1", HASH, SECRETO)
const TOKEN_PROSPECTO_INEXISTENTE = crearTokenBaja(
  "pros_inexistente",
  HASH,
  SECRETO,
)
const TOKEN_MALFORMADO = `v1.pros_1.${"z".repeat(64)}.${"a".repeat(43)}`
const TOKEN_ALTERADO =
  TOKEN.slice(0, -1) + (TOKEN.endsWith("A") ? "B" : "A")
const TOKEN_LARGO = `v1.pros_1.${"a".repeat(64)}.${"b".repeat(500)}`
const IP = "203.0.113.77"
const IP_ALTERNATIVA = "203.0.113.88"

const CLAVES_RATE_LIMIT = [
  `opt-out:ip:${IP}`,
  `opt-out:ip:${IP_ALTERNATIVA}`,
  ...Array.from({ length: 12 }, (_, indice) => `opt-out:ip:203.0.113.${100 + indice}`),
  ...[TOKEN, TOKEN_MALFORMADO, TOKEN_ALTERADO, TOKEN_LARGO].map(
    (token) => `opt-out:token:${sha256(token)}`,
  ),
]

function sha256(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex")
}

interface OpcionesPedido {
  ip?: string
  body?: unknown
  contentType?: string | null
  usarQuery?: boolean
}

function pedido(
  token: string | null,
  opciones: OpcionesPedido = {},
): Request {
  const url = new URL("https://pixelarch.dev/api/opt-out")
  if (opciones.usarQuery !== false && token !== null) {
    url.searchParams.set("token", token)
  }

  const headers = new Headers({ "x-forwarded-for": opciones.ip ?? IP })
  let body: string | undefined

  if (opciones.body !== undefined) {
    headers.set(
      "content-type",
      opciones.contentType === null
        ? "text/plain"
        : (opciones.contentType ?? "application/json"),
    )
    body =
      typeof opciones.body === "string"
        ? opciones.body
        : JSON.stringify(opciones.body)
  }

  return new Request(url, { method: "POST", headers, body })
}

interface ProspectoFixture {
  id: string
  email: string | null
  estado: string
  historial: unknown
}

function prospectoFixture(
  overrides: Partial<ProspectoFixture> = {},
): ProspectoFixture {
  return {
    id: "pros_1",
    email: EMAIL,
    estado: "BORRADOR",
    historial: [],
    ...overrides,
  }
}

function argumento<T>(mock: ReturnType<typeof vi.fn>, indice = 0): T {
  const llamada = mock.mock.calls[indice] as unknown[] | undefined
  expect(llamada).toBeDefined()
  return llamada![0] as T
}

interface ArgsUpsert {
  where: { clave: string }
  create: Record<string, unknown>
  update: Record<string, unknown>
}

interface ArgsUpdateMany {
  where: Record<string, unknown>
  data: Record<string, unknown>
}

interface DatosProspectoActualizado {
  estado?: string
  actualizadoPor?: string
  ultimaInteraccionEn?: Date
  historial?: Array<Record<string, unknown>>
}

function esperarHeadersSeguros(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("no-store")
  expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  expect(res.headers.get("referrer-policy")).toBe("no-referrer")
}

async function jsonDe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function sinPii(texto: string): void {
  expect(texto).not.toContain(EMAIL)
  expect(texto).not.toContain(EMAIL_OTRO)
  expect(texto).not.toContain(TOKEN)
  expect(texto).not.toContain(SECRETO)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.clavesRateLimit.length = 0

  for (const clave of CLAVES_RATE_LIMIT) resetRateLimit(clave)

  vi.stubEnv("PROPUESTAS_SECRETO", SECRETO)
  vi.stubEnv("NEXT_PUBLIC_URL", "https://pixelarch.dev")

  mocks.prospectoFindUnique.mockResolvedValue(prospectoFixture())
  mocks.tx.supresionProspecto.upsert.mockResolvedValue({})
  // Envio pendiente del email del token: es el unico que se puede cancelar.
  mocks.tx.envioPropuesta.findMany.mockResolvedValue([
    { id: "env_1", destinatario: EMAIL },
  ])
  mocks.tx.envioPropuesta.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.prospecto.updateMany.mockResolvedValue({ count: 1 })
  mocks.transaction.mockImplementation(
    (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const clave of CLAVES_RATE_LIMIT) resetRateLimit(clave)
})

/* ------------------------------------------------------------------ */
/* AC-16 / AC-35: supresion global y cancelacion de pendientes          */
/* ------------------------------------------------------------------ */

describe("POST /api/opt-out: supresion global (T-19, AC-16, AC-35; RF-56)", () => {
  it("con token en el body crea EMAIL:<hash>, cancela pendientes y marca SUPRIMIDO", async () => {
    const res = await POST(pedido(null, { body: { token: TOKEN } }))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    esperarHeadersSeguros(res)

    const upsert = argumento<ArgsUpsert>(mocks.tx.supresionProspecto.upsert)
    expect(upsert.where).toEqual({ clave: `EMAIL:${HASH}` })
    expect(upsert.create).toMatchObject({
      ambito: "EMAIL",
      clave: `EMAIL:${HASH}`,
      emailHash: HASH,
      emailEnmascarado: "i***@consultora-ejemplo.com",
      motivo: "OPT_OUT",
      origen: "ENLACE",
      activa: true,
    })
    // La supresion no guarda el email en claro.
    expect(JSON.stringify(upsert.create)).not.toContain(EMAIL)
    // Repetir la baja reactiva sin pisar el motivo original.
    expect(upsert.update).toMatchObject({ activa: true })
    expect(upsert.update).not.toHaveProperty("motivo")
    expect(upsert.update).not.toHaveProperty("origen")

    expect(mocks.tx.envioPropuesta.findMany).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_1",
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      select: { id: true, destinatario: true },
    })

    const cancelados = argumento<ArgsUpdateMany>(
      mocks.tx.envioPropuesta.updateMany,
    )
    expect(cancelados.where).toEqual({
      id: { in: ["env_1"] },
      estado: { in: ["BORRADOR", "APROBADO"] },
    })
    expect(cancelados.data).toEqual({
      estado: "CANCELADO",
      motivoCancelacion: "SUPRESION",
    })

    const actualizado = argumento<ArgsUpdateMany>(
      mocks.tx.prospecto.updateMany,
    )
    expect(actualizado.where).toEqual({
      id: "pros_1",
      estado: { not: "SUPRIMIDO" },
    })
    const datos = actualizado.data as DatosProspectoActualizado
    expect(datos.estado).toBe("SUPRIMIDO")
    expect(datos.actualizadoPor).toBe("ENLACE")
    expect(datos.ultimaInteraccionEn).toBeInstanceOf(Date)
    expect(datos.historial).toEqual([
      {
        accion: "OPT_OUT",
        por: "ENLACE",
        en: expect.any(String),
        motivo: "ENLACE",
      },
    ])
    // El historial solo lleva nombres de accion, nunca email/token.
    expect(JSON.stringify(datos.historial)).not.toContain(EMAIL)
    expect(JSON.stringify(datos.historial)).not.toContain(TOKEN)

    // Logs: solo ids/estado interno, sin PII ni token.
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      "Baja publica procesada",
      expect.objectContaining({ prospectoId: "pros_1" }),
    )
    sinPii(JSON.stringify(mocks.loggerInfo.mock.calls))
    sinPii(JSON.stringify(mocks.loggerWarn.mock.calls))
    sinPii(JSON.stringify(mocks.loggerError.mock.calls))
  })

  it("acepta el token por query, como List-Unsubscribe one-click", async () => {
    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    expect(mocks.tx.supresionProspecto.upsert).toHaveBeenCalledTimes(1)
  })

  it("normaliza el email actual antes de compararlo con el hash", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoFixture({ email: "  INFO@Consultora-Ejemplo.COM " }),
    )
    // El destinatario guardado tambien se normaliza antes de compararlo.
    mocks.tx.envioPropuesta.findMany.mockResolvedValue([
      { id: "env_1", destinatario: "  INFO@Consultora-Ejemplo.COM " },
    ])

    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(200)
    const actualizado = argumento<ArgsUpdateMany>(
      mocks.tx.prospecto.updateMany,
    )
    expect(actualizado.data.estado).toBe("SUPRIMIDO")
    // El hash del token se calculo sobre el email normalizado.
    expect(HASH).toBe(hashEmail("info@consultora-ejemplo.com", SECRETO))
    expect(
      argumento<ArgsUpdateMany>(mocks.tx.envioPropuesta.updateMany).where,
    ).toEqual({
      id: { in: ["env_1"] },
      estado: { in: ["BORRADOR", "APROBADO"] },
    })
  })

  it("si el email actual no coincide, conserva la ficha pero deja la supresion global", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoFixture({ email: EMAIL_OTRO }),
    )

    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })

    const upsert = argumento<ArgsUpsert>(mocks.tx.supresionProspecto.upsert)
    expect(upsert.create).toMatchObject({
      ambito: "EMAIL",
      emailHash: HASH,
      motivo: "OPT_OUT",
      origen: "ENLACE",
    })
    // No hay email enmascarado porque el prospecto no coincide con el token.
    expect(upsert.create.emailEnmascarado).toBeNull()

    const actualizado = argumento<ArgsUpdateMany>(
      mocks.tx.prospecto.updateMany,
    )
    expect(actualizado.where).toEqual({ id: "pros_1" })
    expect(actualizado.data).not.toHaveProperty("estado")
    expect(actualizado.data.actualizadoPor).toBe("ENLACE")
    expect(
      (actualizado.data.historial as Array<Record<string, unknown>>).at(-1),
    ).toMatchObject({ accion: "OPT_OUT", por: "ENLACE" })

    // Se cancelan solo los pendientes del email del token; los del email
    // nuevo que conserva la ficha no se tocan (ver caso dedicado).
    expect(mocks.tx.envioPropuesta.updateMany).toHaveBeenCalledTimes(1)
    expect(
      argumento<ArgsUpdateMany>(mocks.tx.envioPropuesta.updateMany).where,
    ).toEqual({
      id: { in: ["env_1"] },
      estado: { in: ["BORRADOR", "APROBADO"] },
    })
  })

  it("cancela solo los envios del email del token y no los del email nuevo", async () => {
    // El prospecto cambio de direccion: el token pertenece al email anterior.
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoFixture({ email: EMAIL_OTRO }),
    )
    mocks.tx.envioPropuesta.findMany.mockResolvedValue([
      { id: "env_anterior", destinatario: EMAIL },
      { id: "env_nuevo", destinatario: EMAIL_OTRO },
    ])

    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })

    const cancelados = argumento<ArgsUpdateMany>(
      mocks.tx.envioPropuesta.updateMany,
    )
    expect(cancelados.where).toEqual({
      id: { in: ["env_anterior"] },
      estado: { in: ["BORRADOR", "APROBADO"] },
    })
    expect(cancelados.data).toEqual({
      estado: "CANCELADO",
      motivoCancelacion: "SUPRESION",
    })
    expect(JSON.stringify(cancelados.where)).not.toContain("env_nuevo")

    // La ficha conserva el email nuevo y solo registra el opt-out.
    const actualizado = argumento<ArgsUpdateMany>(
      mocks.tx.prospecto.updateMany,
    )
    expect(actualizado.where).toEqual({ id: "pros_1" })
    expect(actualizado.data).not.toHaveProperty("estado")
  })

  it.each([
    ["sin envios pendientes", []],
    [
      "solo envios de otro email",
      [{ id: "env_otro", destinatario: EMAIL_OTRO }],
    ],
    [
      "destinatarios sin email valido",
      [{ id: "env_invalido", destinatario: "sin-arroba" }],
    ],
  ] as Array<[string, Array<{ id: string; destinatario: string }>]>)(
    "sin ids coincidentes (%s) no ejecuta updateMany",
    async (_caso, pendientes) => {
      mocks.tx.envioPropuesta.findMany.mockResolvedValue(pendientes)

      const res = await POST(pedido(TOKEN))

      expect(res.status).toBe(200)
      expect(await jsonDe(res)).toEqual({ ok: true })
      expect(mocks.tx.envioPropuesta.findMany).toHaveBeenCalledTimes(1)
      expect(mocks.tx.envioPropuesta.updateMany).not.toHaveBeenCalled()
      expect(mocks.tx.supresionProspecto.upsert).toHaveBeenCalledTimes(1)
    },
  )

  it("si el prospecto ya no existe, igual registra la supresion sin cancelar", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(null)
    mocks.tx.envioPropuesta.findMany.mockResolvedValue([])

    const res = await POST(pedido(TOKEN_PROSPECTO_INEXISTENTE))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    expect(mocks.tx.supresionProspecto.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.tx.envioPropuesta.findMany).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_inexistente",
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      select: { id: true, destinatario: true },
    })
    expect(mocks.tx.envioPropuesta.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.prospecto.updateMany).not.toHaveBeenCalled()
  })

  it("es idempotente: repetir la baja no duplica supresion ni historial", async () => {
    mocks.prospectoFindUnique
      .mockResolvedValueOnce(prospectoFixture({ estado: "BORRADOR" }))
      .mockResolvedValueOnce(
        prospectoFixture({
          estado: "SUPRIMIDO",
          historial: [
            {
              accion: "OPT_OUT",
              por: "ENLACE",
              en: "2026-11-12T12:00:00.000Z",
              motivo: "ENLACE",
            },
          ],
        }),
      )
    // En la segunda pasada el pendiente ya esta CANCELADO y no se devuelve.
    mocks.tx.envioPropuesta.findMany
      .mockResolvedValueOnce([{ id: "env_1", destinatario: EMAIL }])
      .mockResolvedValueOnce([])
    mocks.tx.envioPropuesta.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const primera = await POST(pedido(TOKEN))
    const segunda = await POST(pedido(TOKEN))

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(200)
    expect(await jsonDe(segunda)).toEqual({ ok: true })

    // Upsert idempotente por la misma clave; nunca un create duplicado.
    expect(mocks.tx.supresionProspecto.upsert).toHaveBeenCalledTimes(2)
    expect(
      mocks.tx.supresionProspecto.upsert.mock.calls.map(([args]) => {
        return (args as ArgsUpsert).where.clave
      }),
    ).toEqual([`EMAIL:${HASH}`, `EMAIL:${HASH}`])
    // El envio pendiente del email del token se cancela una sola vez.
    expect(mocks.tx.envioPropuesta.updateMany).toHaveBeenCalledTimes(1)
    expect(
      argumento<ArgsUpdateMany>(mocks.tx.envioPropuesta.updateMany).where,
    ).toEqual({
      id: { in: ["env_1"] },
      estado: { in: ["BORRADOR", "APROBADO"] },
    })
    // En la segunda pasada no hay transicion ni envios cancelados: no reescribe.
    expect(mocks.tx.prospecto.updateMany).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ */
/* AC-33 / RF-51: respuesta generica, sin enumeracion                   */
/* ------------------------------------------------------------------ */

describe("POST /api/opt-out: respuesta generica (T-19, AC-33; RF-51)", () => {
  it.each([
    ["alterado", TOKEN_ALTERADO],
    ["malformado", TOKEN_MALFORMADO],
    ["demasiado largo", TOKEN_LARGO],
    ["basura", "esto-no-es-un-token"],
    ["vacio", ""],
  ])("un token %s responde 200 generico sin mutar", async (_caso, token) => {
    const res = await POST(pedido(token))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    esperarHeadersSeguros(res)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin token (ni query ni body) responde 200 generico sin mutar", async () => {
    const res = await POST(pedido(null))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("ignora un body no JSON o que no trae token", async () => {
    for (const body of [
      "{no-es-json",
      JSON.stringify({ otro: TOKEN }),
      JSON.stringify([TOKEN]),
    ]) {
      const res = await POST(pedido(null, { body }))

      expect(res.status).toBe(200)
      expect(await jsonDe(res)).toEqual({ ok: true })
    }

    const sinJson = await POST(
      pedido(null, { body: `token=${TOKEN}`, contentType: null }),
    )
    expect(sinJson.status).toBe(200)

    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("no procesa un body que supera el maximo declarado", async () => {
    const res = await POST(
      pedido(null, {
        body: JSON.stringify({ token: TOKEN, relleno: "x".repeat(5000) }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin secreto responde 202 generico y no muta", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", "")

    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(202)
    expect(await jsonDe(res)).toEqual({ ok: true })
    esperarHeadersSeguros(res)
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Baja publica sin configuracion",
      { codigo: "NO_CONFIGURADO" },
    )
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un error de base responde igual que un token invalido, sin filtrar validez", async () => {
    const invalido = await POST(pedido(TOKEN_ALTERADO))
    const invalidoTexto = await invalido.text()

    mocks.prospectoFindUnique.mockRejectedValue(
      new Error(`fallo ${EMAIL} token=${TOKEN}`),
    )
    const roto = await POST(pedido(TOKEN))
    const rotoTexto = await roto.text()

    expect(invalido.status).toBe(200)
    expect(roto.status).toBe(200)
    expect(rotoTexto).toBe(invalidoTexto)
    expect(JSON.parse(rotoTexto)).toEqual({ ok: true })
    esperarHeadersSeguros(roto)
    sinPii(rotoTexto)

    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Error procesando baja publica",
      expect.objectContaining({ codigo: "DESCONOCIDO" }),
    )
    sinPii(JSON.stringify(mocks.loggerError.mock.calls))
  })

  it("un fallo dentro de la transaccion tambien responde generico", async () => {
    mocks.transaction.mockRejectedValueOnce(
      new Error(`transaccion fallida ${EMAIL} ${TOKEN}`),
    )

    const res = await POST(pedido(TOKEN))

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toEqual({ ok: true })
    expect(res.headers.get("cache-control")).toBe("no-store")
    sinPii(JSON.stringify(mocks.loggerError.mock.calls))
  })

  it("la ruta no importa Clerk ni un guard admin: la baja es publica", () => {
    const fuente = readFileSync(
      path.join(process.cwd(), "src", "app", "api", "opt-out", "route.ts"),
      "utf8",
    )

    expect(fuente).not.toMatch(/@clerk|requireAdmin|@\/lib\/auth|@\/lib\/roles/)
    expect(fuente).not.toMatch(/\bcookies\s*\(/)
    // La unica salida visible es la respuesta generica, sin datos del token.
    expect(fuente).toMatch(/respuestaGenerica/)
    expect(fuente).not.toMatch(/\bconsole\./)
  })
})

/* ------------------------------------------------------------------ */
/* AC-33 / AC-34: rate limit y headers                                  */
/* ------------------------------------------------------------------ */

describe("rate limit de /api/opt-out (T-19, AC-33, AC-34; RF-52)", () => {
  it("permite 10/min por IP y responde 429 con Retry-After", async () => {
    for (let indice = 0; indice < 10; indice += 1) {
      const res = await POST(pedido(`basura-${indice}`))
      expect(res.status, `intento ${indice + 1}`).toBe(200)
    }

    const limite = await POST(pedido("basura-11"))
    expect(limite.status).toBe(429)
    expect(Number(limite.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    esperarHeadersSeguros(limite)
    expect(await jsonDe(limite)).toMatchObject({ codigo: "RATE_LIMIT" })
    expect(mocks.transaction).not.toHaveBeenCalled()

    // La clave por IP es la unica que se incremento en este escenario.
    expect(mocks.clavesRateLimit).toContain(`opt-out:ip:${IP}`)
  })

  it("permite 5/min por token (global entre IPs) con clave SHA-256", async () => {
    for (let indice = 0; indice < 5; indice += 1) {
      const res = await POST(
        pedido(TOKEN_MALFORMADO, {
          ip: `203.0.113.${100 + indice}`,
        }),
      )
      expect(res.status, `intento ${indice + 1}`).toBe(200)
    }

    const limite = await POST(
      pedido(TOKEN_MALFORMADO, { ip: IP_ALTERNATIVA }),
    )

    expect(limite.status).toBe(429)
    expect(Number(limite.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    esperarHeadersSeguros(limite)
    expect(await jsonDe(limite)).toMatchObject({ codigo: "RATE_LIMIT" })
    expect(mocks.transaction).not.toHaveBeenCalled()

    const claveHash = `opt-out:token:${sha256(TOKEN_MALFORMADO)}`
    expect(mocks.clavesRateLimit).toContain(claveHash)
    // Nunca se usa el token en claro como clave del rate limit.
    for (const clave of mocks.clavesRateLimit) {
      expect(clave).not.toContain(TOKEN_MALFORMADO)
    }
    expect(mocks.clavesRateLimit).toContain(`opt-out:ip:${IP_ALTERNATIVA}`)
  })
})

/* ------------------------------------------------------------------ */
/* GET y metodos                                                        */
/* ------------------------------------------------------------------ */

describe("GET /api/opt-out (T-19, AC-33; RF-51)", () => {
  it("responde 405 con Allow: POST, headers seguros y no muta", async () => {
    const res = GET()

    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
    esperarHeadersSeguros(res)
    expect(mocks.prospectoFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.supresionProspecto.upsert).not.toHaveBeenCalled()
  })
})
