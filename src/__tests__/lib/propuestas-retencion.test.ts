import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rateLimitDetalle, resetRateLimit } from "@/lib/rate-limit"
import {
  CLAVE_LOCK_RETENCION,
  ErrorRetencion,
  LOTE_RETENCION,
  MAX_LOTES_RETENCION,
  MESES_RETENCION_DEFAULT,
  calcularCorteRetencion,
  purgarProspectosVencidos,
  seleccionarProspectosVencidos,
  type ClienteRetencion,
  type ProspectoVencido,
} from "@/lib/propuestas/retencion"

/**
 * T-22 (AC-37, AC-40; RF-30, RF-65): retención de prospectos.
 *
 * Cubre:
 * - corte calendario en UTC (12 meses, borde exacto, fin de mes y bisiesto);
 * - fechas inválidas y meses <= 0 fallan cerrado antes de tocar datos;
 * - selección pura estable por fecha/id y acotada al lote;
 * - purga con advisory lock, lotes de 100, `deleteMany` con el mismo corte,
 *   tope de lotes y errores de esquema sanitizados;
 * - cascada de envíos, `ConsumoProveedor.prospectoId = null` y supresión
 *   intacta (contrato del esquema Prisma);
 * - cron con `CRON_SECRET` (401/200/no-store/sin PII), admin con guard,
 *   origen, rate limit y sin borrar supresiones.
 *
 * Los tests de ruta usan Prisma y Clerk mockeados. Ninguno hace red real.
 */

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn()
  const prospecto = {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  }
  const supresionProspecto = {
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  }
  const tx = { $queryRaw: queryRaw, prospecto, supresionProspecto }

  return {
    auth: vi.fn(),
    clerkClient: vi.fn(),
    getUser: vi.fn(),
    queryRaw,
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
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    prospecto: mocks.prospecto,
    supresionProspecto: mocks.supresionProspecto,
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

import { GET as cronRetencion } from "@/app/api/cron/propuestas-retencion/route"
import { POST as purgaAdmin } from "@/app/api/propuestas/retencion/route"

const ORIGEN = "https://pixelarch.dev"
const IP = "203.0.113.90"
const IP_RATE = "198.51.100.91"
const SECRETO_CRON = "cron-secreto-de-pruebas-0123456789abcdef"
const SECRETO_ADMIN = "secreto-de-pruebas-retencion-0123456789abcdef"

const URL_CRON = `${ORIGEN}/api/cron/propuestas-retencion`
const URL_ADMIN = `${ORIGEN}/api/propuestas/retencion`

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

function pedidoCron(headers: Record<string, string> = {}): Request {
  return new Request(URL_CRON, { method: "GET", headers })
}

interface OpcionesPedidoAdmin {
  origin?: string | null
  ip?: string | null
}

function pedidoAdmin(opciones: OpcionesPedidoAdmin = {}): Request {
  const headers = new Headers()
  if (opciones.origin !== null) {
    headers.set("origin", opciones.origin ?? ORIGEN)
  }
  if (opciones.ip !== null) {
    headers.set("x-forwarded-for", opciones.ip ?? IP)
  }

  return new Request(URL_ADMIN, { method: "POST", headers })
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

/** Cliente inyectable mínimo que imita la consulta y el borrado reales. */
interface FilaProspecto {
  id: string
  ultimaInteraccionEn: Date
}

interface ArgsFindMany {
  where: { ultimaInteraccionEn: { lt: Date } }
  orderBy: unknown
  take: number
  select: unknown
}

interface ArgsDeleteMany {
  where: { id: { in: string[] }; ultimaInteraccionEn: { lt: Date } }
}

interface OpcionesFake {
  lock?: unknown
  prospectos?: FilaProspecto[]
  /** Deja las filas en su lugar y reporta el conteo como borrado. */
  borrarSinEliminar?: boolean
  /** Reporta siempre `count: 0` sin borrar. */
  borrarCero?: boolean
  onDelete?: (ids: string[], count: number) => void
}

function crearClienteFake(opciones: OpcionesFake = {}) {
  let filas = [...(opciones.prospectos ?? [])]

  const queryRaw = vi.fn(async () =>
    opciones.lock === undefined ? [{ obtenido: true }] : opciones.lock,
  )

  const findMany = vi.fn(async (args: ArgsFindMany) => {
    const corte = args.where.ultimaInteraccionEn.lt.getTime()

    return filas
      .filter(
        (fila) =>
          Number.isFinite(fila.ultimaInteraccionEn.getTime()) &&
          fila.ultimaInteraccionEn.getTime() < corte,
      )
      .slice()
      .sort((a, b) => {
        const porFecha =
          a.ultimaInteraccionEn.getTime() - b.ultimaInteraccionEn.getTime()
        return porFecha !== 0 ? porFecha : a.id.localeCompare(b.id)
      })
      .slice(0, args.take)
      .map((fila) => ({ id: fila.id }))
  })

  const deleteMany = vi.fn(async (args: ArgsDeleteMany) => {
    if (opciones.borrarCero) return { count: 0 }

    const ids = new Set(args.where.id.in)
    const corte = args.where.ultimaInteraccionEn.lt.getTime()
    const antes = filas.length

    if (opciones.borrarSinEliminar) {
      const count = args.where.id.in.length
      opciones.onDelete?.(args.where.id.in, count)
      return { count }
    }

    filas = filas.filter(
      (fila) =>
        !(ids.has(fila.id) && fila.ultimaInteraccionEn.getTime() < corte),
    )
    const count = antes - filas.length
    opciones.onDelete?.(args.where.id.in, count)

    return { count }
  })

  const cliente: ClienteRetencion = {
    $queryRaw:
      queryRaw as unknown as ClienteRetencion["$queryRaw"],
    prospecto: {
      findMany: findMany as unknown as ClienteRetencion["prospecto"]["findMany"],
      deleteMany:
        deleteMany as unknown as ClienteRetencion["prospecto"]["deleteMany"],
    },
  }

  return {
    cliente,
    queryRaw,
    findMany,
    deleteMany,
    filas: () => filas,
  }
}

function prospectoViejo(
  id: string,
  fecha = new Date("2024-01-10T10:00:00.000Z"),
): FilaProspecto {
  return { id, ultimaInteraccionEn: fecha }
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubEnv("NEXT_PUBLIC_URL", ORIGEN)
  vi.stubEnv("PROPUESTAS_SECRETO", SECRETO_ADMIN)
  vi.stubEnv("CRON_SECRET", SECRETO_CRON)

  simularAdmin()
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })

  mocks.queryRaw.mockResolvedValue([{ obtenido: true }])
  mocks.prospecto.findMany.mockResolvedValue([])
  mocks.prospecto.deleteMany.mockResolvedValue({ count: 0 })
  mocks.supresionProspecto.deleteMany.mockResolvedValue({ count: 0 })
  mocks.supresionProspecto.updateMany.mockResolvedValue({ count: 0 })
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
/* Corte de retención                                                  */
/* ------------------------------------------------------------------ */

describe("calcularCorteRetencion (AC-40)", () => {
  it("AC-40: usa 12 meses calendario en UTC y conserva hora y milisegundos", () => {
    const ahora = new Date("2026-11-13T12:34:56.789Z")

    expect(calcularCorteRetencion(ahora).toISOString()).toBe(
      "2025-11-13T12:34:56.789Z",
    )
    expect(calcularCorteRetencion(ahora, MESES_RETENCION_DEFAULT).toISOString()).toBe(
      "2025-11-13T12:34:56.789Z",
    )
  })

  it("AC-40: si el día no existe en el mes destino usa el último día (UTC)", () => {
    expect(
      calcularCorteRetencion(new Date("2026-03-31T10:20:30.400Z"), 1).toISOString(),
    ).toBe("2026-02-28T10:20:30.400Z")

    expect(
      calcularCorteRetencion(new Date("2024-03-31T10:20:30.400Z"), 1).toISOString(),
    ).toBe("2024-02-29T10:20:30.400Z")
  })

  it("AC-40: no usa la zona horaria local del servidor", () => {
    const ahora = new Date("2026-01-01T00:00:00.000Z")

    expect(calcularCorteRetencion(ahora, 12).toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    )
  })

  it("AC-40: una fecha inválida falla cerrada con VALIDACION", () => {
    expect(() => calcularCorteRetencion(new Date("no-es-fecha"))).toThrow(
      ErrorRetencion,
    )

    try {
      calcularCorteRetencion(new Date("no-es-fecha"))
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorRetencion)
      expect((error as ErrorRetencion).codigo).toBe("VALIDACION")
    }
  })

  it.each([0, -1, 1.5, 121, Number.NaN])(
    "AC-40: meses=%s falla cerrado con CONFIGURACION (nunca borra todo)",
    (meses) => {
      expect(() =>
        calcularCorteRetencion(new Date("2026-11-13T00:00:00.000Z"), meses),
      ).toThrow(ErrorRetencion)

      try {
        calcularCorteRetencion(
          new Date("2026-11-13T00:00:00.000Z"),
          meses,
        )
      } catch (error) {
        expect((error as ErrorRetencion).codigo).toBe("CONFIGURACION")
      }
    },
  )
})

/* ------------------------------------------------------------------ */
/* Selección pura                                                      */
/* ------------------------------------------------------------------ */

describe("seleccionarProspectosVencidos (AC-40)", () => {
  const ahora = new Date("2026-11-13T00:00:00.000Z")
  const corte = calcularCorteRetencion(ahora)

  it("AC-40: excluye el borde exacto y los posteriores; incluye 1 ms antes", () => {
    const antes = new Date(corte.getTime() - 1)
    const exacto = new Date(corte.getTime())
    const despues = new Date(corte.getTime() + 1)

    const vencidos = seleccionarProspectosVencidos(
      {
        ahora,
        prospectos: [
          { id: "exacto", ultimaInteraccionEn: exacto },
          { id: "despues", ultimaInteraccionEn: despues },
          { id: "antes", ultimaInteraccionEn: antes },
        ],
      },
    )

    expect(vencidos.map((fila) => fila.id)).toEqual(["antes"])
    expect(vencidos[0]?.ultimaInteraccionEn.toISOString()).toBe(
      antes.toISOString(),
    )
  })

  it("AC-40: descarta fechas inválidas", () => {
    const vencidos = seleccionarProspectosVencidos(
      {
        ahora,
        prospectos: [
          { id: "invalida", ultimaInteraccionEn: new Date("x") },
          prospectoViejo("vieja"),
        ],
      },
    )

    expect(vencidos.map((fila) => fila.id)).toEqual(["vieja"])
  })

  it("AC-40: orden estable por fecha ascendente y luego por id", () => {
    const mismaFecha = new Date("2024-05-01T00:00:00.000Z")
    const masAntigua = new Date("2024-04-01T00:00:00.000Z")

    const vencidos = seleccionarProspectosVencidos(
      { ahora },
      [
        { id: "pros_c", ultimaInteraccionEn: mismaFecha },
        { id: "pros_b", ultimaInteraccionEn: mismaFecha },
        { id: "pros_a", ultimaInteraccionEn: mismaFecha },
        { id: "pros_z", ultimaInteraccionEn: masAntigua },
      ],
    )

    expect(vencidos.map((fila) => fila.id)).toEqual([
      "pros_z",
      "pros_a",
      "pros_b",
      "pros_c",
    ])
  })

  it("AC-40: acota a 100 por defecto y respeta un límite menor", () => {
    const candidatos: ProspectoVencido[] = Array.from({ length: 150 }, (_, i) => ({
      id: `pros_${String(i).padStart(3, "0")}`,
      ultimaInteraccionEn: new Date(2020, 0, 1 + (i % 20)),
    }))

    expect(
      seleccionarProspectosVencidos({ ahora, prospectos: candidatos }),
    ).toHaveLength(LOTE_RETENCION)
    expect(
      seleccionarProspectosVencidos({
        ahora,
        prospectos: candidatos,
        limite: 2,
      }),
    ).toHaveLength(2)
  })

  it("AC-40: no muta el arreglo de entrada", () => {
    const candidatos = [
      prospectoViejo("pros_b", new Date("2024-01-01T00:00:00.000Z")),
      prospectoViejo("pros_a", new Date("2024-01-01T00:00:00.000Z")),
    ]
    const copia = [...candidatos]

    seleccionarProspectosVencidos({ ahora }, candidatos)

    expect(candidatos).toEqual(copia)
    expect(candidatos.map((fila) => fila.id)).toEqual(["pros_b", "pros_a"])
  })

  it("AC-40: meses y límite inválidos fallan cerrado", () => {
    expect(() =>
      seleccionarProspectosVencidos({
        ahora,
        meses: 0,
        prospectos: [],
      }),
    ).toThrow(ErrorRetencion)

    try {
      seleccionarProspectosVencidos({
        ahora,
        meses: 0,
        prospectos: [],
      })
    } catch (error) {
      expect((error as ErrorRetencion).codigo).toBe("CONFIGURACION")
    }

    try {
      seleccionarProspectosVencidos({
        ahora,
        limite: 0,
        prospectos: [],
      })
    } catch (error) {
      expect((error as ErrorRetencion).codigo).toBe("VALIDACION")
    }
  })
})

/* ------------------------------------------------------------------ */
/* Purga por lotes                                                     */
/* ------------------------------------------------------------------ */

describe("purgarProspectosVencidos (AC-40)", () => {
  const ahora = new Date("2026-11-13T00:00:00.000Z")
  const corte = calcularCorteRetencion(ahora)

  it("AC-40: borra en lotes de 100 con el mismo corte y orden estable", async () => {
    const filas = Array.from({ length: 250 }, (_, i) =>
      prospectoViejo(
        `pros_${String(i).padStart(3, "0")}`,
        new Date(2024, 0, 1 + (i % 20)),
      ),
    )
    filas.push(
      prospectoViejo("pros_reciente", new Date("2026-10-01T00:00:00.000Z")),
    )

    const fake = crearClienteFake({ prospectos: filas })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
      meses: 12,
      lote: LOTE_RETENCION,
    })

    expect(resultado).toEqual({ omitido: false, eliminados: 250, lotes: 3 })
    expect(fake.findMany).toHaveBeenCalledTimes(3)
    expect(fake.deleteMany).toHaveBeenCalledTimes(3)

    const finds = fake.findMany.mock.calls.map(
      ([args]) => args as ArgsFindMany,
    )
    for (const args of finds) {
      expect(args.take).toBe(100)
      expect(args.where.ultimaInteraccionEn.lt.toISOString()).toBe(
        corte.toISOString(),
      )
      expect(args.orderBy).toEqual([
        { ultimaInteraccionEn: "asc" },
        { id: "asc" },
      ])
    }

    const borrados = fake.deleteMany.mock.calls.map(
      ([args]) => args as ArgsDeleteMany,
    )
    expect(borrados.map((args) => args.where.id.in.length)).toEqual([
      100, 100, 50,
    ])
    for (const args of borrados) {
      expect(args.where.ultimaInteraccionEn.lt.toISOString()).toBe(
        corte.toISOString(),
      )
    }

    expect(fake.filas().map((fila) => fila.id)).toEqual(["pros_reciente"])
  })

  it("AC-40: usa 12 meses por defecto y lote de 100", async () => {
    const fake = crearClienteFake({
      prospectos: [
        prospectoViejo("pros_vencido", new Date("2025-11-12T23:59:59.999Z")),
        prospectoViejo("pros_borde", new Date("2025-11-13T00:00:00.000Z")),
      ],
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
    })

    expect(resultado.eliminados).toBe(1)
    expect(fake.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 100 })
    expect(
      (fake.findMany.mock.calls[0]?.[0] as ArgsFindMany).where
        .ultimaInteraccionEn.lt.toISOString(),
    ).toBe("2025-11-13T00:00:00.000Z")
  })

  it("AC-40: si el advisory lock está ocupado devuelve omitido sin borrar", async () => {
    const fake = crearClienteFake({
      lock: [{ obtenido: false }],
      prospectos: [prospectoViejo("pros_1")],
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
    })

    expect(resultado).toEqual({ omitido: true, eliminados: 0, lotes: 0 })
    expect(fake.queryRaw).toHaveBeenCalledTimes(1)
    expect(fake.findMany).not.toHaveBeenCalled()
    expect(fake.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-40: acepta la columna cruda del driver cuando no hay alias", async () => {
    const fake = crearClienteFake({
      lock: [{ pg_try_advisory_xact_lock: true }],
      prospectos: [prospectoViejo("pros_1")],
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
    })

    expect(resultado.omitido).toBe(false)
    expect(resultado.eliminados).toBe(1)
    expect(fake.findMany).toHaveBeenCalledTimes(1)
  })

  it("AC-40: se detiene al agotar los vencidos o si el borrado no afectó filas", async () => {
    const fake = crearClienteFake({
      prospectos: [prospectoViejo("pros_1")],
      borrarCero: true,
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
    })

    expect(resultado).toEqual({ omitido: false, eliminados: 0, lotes: 1 })
    expect(fake.findMany).toHaveBeenCalledTimes(1)
    expect(fake.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("AC-40: respeta el tope máximo de lotes por corrida", async () => {
    const fake = crearClienteFake({
      prospectos: [prospectoViejo("pros_1")],
      borrarSinEliminar: true,
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
      lote: 1,
    })

    expect(resultado.lotes).toBe(MAX_LOTES_RETENCION)
    expect(resultado.eliminados).toBe(MAX_LOTES_RETENCION)
    expect(fake.deleteMany).toHaveBeenCalledTimes(MAX_LOTES_RETENCION)
  })

  it("AC-40: un error de esquema se reporta sanitizado como ESQUEMA_NO_APLICADO", async () => {
    const fake = crearClienteFake({
      prospectos: [prospectoViejo("pros_1")],
    })
    fake.findMany.mockRejectedValue({
      code: "P2021",
      message: 'The table "Prospecto" does not exist',
    })

    await expect(
      purgarProspectosVencidos({ cliente: fake.cliente, ahora }),
    ).rejects.toMatchObject({ codigo: "ESQUEMA_NO_APLICADO" })

    try {
      await purgarProspectosVencidos({ cliente: fake.cliente, ahora })
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorRetencion)
      expect((error as ErrorRetencion).codigo).toBe("ESQUEMA_NO_APLICADO")
      expect((error as ErrorRetencion).message).not.toMatch(/P2021|Prospecto/)
    }
  })

  it("AC-40: no enmascara errores que no son de esquema", async () => {
    const fake = crearClienteFake({
      prospectos: [prospectoViejo("pros_1")],
    })
    const error = new Error("base caida")
    fake.queryRaw.mockRejectedValueOnce(error)

    await expect(
      purgarProspectosVencidos({ cliente: fake.cliente, ahora }),
    ).rejects.toBe(error)
  })

  it("AC-40: valida el lote y los meses antes de tocar datos", async () => {
    const fake = crearClienteFake()

    await expect(
      purgarProspectosVencidos({ cliente: fake.cliente, ahora, lote: 0 }),
    ).rejects.toMatchObject({ codigo: "VALIDACION" })
    await expect(
      purgarProspectosVencidos({ cliente: fake.cliente, ahora, lote: 1001 }),
    ).rejects.toMatchObject({ codigo: "VALIDACION" })
    await expect(
      purgarProspectosVencidos({ cliente: fake.cliente, ahora, meses: 0 }),
    ).rejects.toMatchObject({ codigo: "CONFIGURACION" })

    expect(fake.queryRaw).not.toHaveBeenCalled()
    expect(fake.findMany).not.toHaveBeenCalled()
    expect(fake.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-40: el lock se toma dentro de una transacción con timeout", async () => {
    await purgarProspectosVencidos({ ahora })

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ timeout: 60_000 })
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)

    const [plantilla, ...valores] = mocks.queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ]
    expect(plantilla.join("?")).toMatch(/pg_try_advisory_xact_lock/)
    expect(valores).toContain(CLAVE_LOCK_RETENCION)
  })
})

/* ------------------------------------------------------------------ */
/* Cascada y supresión                                                 */
/* ------------------------------------------------------------------ */

describe("contrato de borrado en cascada (AC-40)", () => {
  it("AC-40: borra prospecto y envíos, deja ConsumoProveedor.prospectoId en null y conserva la supresión", async () => {
    const ahora = new Date("2026-11-13T00:00:00.000Z")
    const store = {
      prospectos: [prospectoViejo("pros_1")],
      envios: [
        { id: "env_1", prospectoId: "pros_1" },
        { id: "env_2", prospectoId: "pros_1" },
        { id: "env_3", prospectoId: "pros_otro" },
      ],
      consumos: [
        { id: "cons_1", prospectoId: "pros_1" as string | null },
        { id: "cons_2", prospectoId: "pros_otro" as string | null },
      ],
      supresiones: [
        { id: "sup_1", ambito: "EMAIL", emailHash: "hash", activa: true },
      ],
    }

    const fake = crearClienteFake({
      prospectos: store.prospectos,
      onDelete: (ids) => {
        // Réplica del contrato declarado en prisma/schema.prisma:
        // EnvioPropuesta.prospecto onDelete: Cascade
        // ConsumoProveedor.prospecto onDelete: SetNull
        // SupresionProspecto no tiene relación con Prospecto.
        store.envios = store.envios.filter(
          (envio) => !ids.includes(envio.prospectoId),
        )
        for (const consumo of store.consumos) {
          if (consumo.prospectoId && ids.includes(consumo.prospectoId)) {
            consumo.prospectoId = null
          }
        }
      },
    })

    const resultado = await purgarProspectosVencidos({
      cliente: fake.cliente,
      ahora,
    })

    expect(resultado.eliminados).toBe(1)
    expect(fake.filas()).toHaveLength(0)
    expect(store.envios.map((envio) => envio.id)).toEqual(["env_3"])
    expect(store.consumos).toEqual([
      { id: "cons_1", prospectoId: null },
      { id: "cons_2", prospectoId: "pros_otro" },
    ])
    expect(store.supresiones).toEqual([
      { id: "sup_1", ambito: "EMAIL", emailHash: "hash", activa: true },
    ])

    // La purga no ejecuta deletes propios sobre la supresión ni consume.
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(fake.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("AC-40: el esquema declara Cascade en envíos, SetNull en consumo y ninguna relación de supresión al prospecto", () => {
    const schema = readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    )

    function bloque(nombre: string): string {
      const inicio = schema.indexOf(`model ${nombre}`)
      expect(inicio).toBeGreaterThanOrEqual(0)
      const siguiente = schema.indexOf("\nmodel ", inicio + 1)
      return schema.slice(inicio, siguiente === -1 ? undefined : siguiente)
    }

    expect(bloque("EnvioPropuesta")).toMatch(
      /prospecto\s+Prospecto\s+@relation\([\s\S]*?onDelete:\s*Cascade/,
    )
    expect(bloque("ConsumoProveedor")).toMatch(
      /prospecto\s+Prospecto\?\s+@relation\([\s\S]*?onDelete:\s*SetNull/,
    )

    const supresion = bloque("SupresionProspecto")
    expect(supresion).not.toMatch(/\bprospectoId\b/)
    expect(supresion).not.toMatch(/\bProspecto\s+@relation/)
  })
})

/* ------------------------------------------------------------------ */
/* Cron                                                                */
/* ------------------------------------------------------------------ */

describe("GET /api/cron/propuestas-retencion (AC-40)", () => {
  it("AC-40: sin CRON_SECRET configurado responde 401 sin consultar la base", async () => {
    vi.stubEnv("CRON_SECRET", "")

    const res = await cronRetencion(pedidoCron())

    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_AUTORIZADO" })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    ["sin header", {}],
    ["con token incorrecto", { authorization: "Bearer token-incorrecto" }],
    ["con esquema distinto", { authorization: `Basic ${SECRETO_CRON}` }],
  ])("AC-40: 401 %s", async (_caso, headers) => {
    const res = await cronRetencion(pedidoCron(headers))

    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("AC-40: con el secreto correcto purga, responde contadores y no expone PII", async () => {
    mocks.prospecto.findMany.mockResolvedValue([{ id: "pros_1" }])
    mocks.prospecto.deleteMany.mockResolvedValue({ count: 1 })

    const res = await cronRetencion(
      pedidoCron({ authorization: `Bearer ${SECRETO_CRON}` }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toEqual({
      ok: true,
      omitido: false,
      eliminados: 1,
      lotes: 1,
    })

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.prospecto.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.prospecto.deleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(logsDeMocks()).not.toMatch(/@|Consultora|Alfa|ventas/i)
  })

  it("AC-40: si el lock está ocupado responde 200 con omitido y no borra", async () => {
    mocks.queryRaw.mockResolvedValue([{ obtenido: false }])

    const res = await cronRetencion(
      pedidoCron({ authorization: `Bearer ${SECRETO_CRON}` }),
    )

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({ omitido: true, eliminados: 0 })
    expect(mocks.prospecto.findMany).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-40: un esquema no aplicado responde 503 sanitizado", async () => {
    mocks.queryRaw.mockRejectedValueOnce({
      code: "P2021",
      message: 'relation "Prospecto" does not exist',
    })

    const res = await cronRetencion(
      pedidoCron({ authorization: `Bearer ${SECRETO_CRON}` }),
    )

    expect(res.status).toBe(503)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await jsonDe(res)
    expect(body).toMatchObject({ codigo: "ESQUEMA_NO_APLICADO" })
    expect(JSON.stringify(body)).not.toMatch(/P2021|Prospecto|relation/i)
    expect(logsDeMocks()).not.toMatch(/P2021|Prospecto/)
  })

  it("AC-40: una retención inválida (0) falla cerrada con 503 y no purga", async () => {
    vi.stubEnv("PROPUESTAS_RETENCION_MESES", "0")

    const res = await cronRetencion(
      pedidoCron({ authorization: `Bearer ${SECRETO_CRON}` }),
    )

    expect(res.status).toBe(503)
    expect(await jsonDe(res)).toMatchObject({ codigo: "CONFIGURACION" })
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* Purga manual admin                                                  */
/* ------------------------------------------------------------------ */

describe("POST /api/propuestas/retencion (AC-40)", () => {
  it("AC-40: sin sesión responde 401 y no toca datos", async () => {
    mocks.auth.mockResolvedValue({ userId: null })

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "NO_AUTORIZADO" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("AC-40: un asistente recibe 403", async () => {
    simularAdmin("asistente", "user_2", "Asistente")

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(403)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toMatchObject({ codigo: "PROHIBIDO" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("AC-40: un origen distinto recibe 403 antes de purgar", async () => {
    const res = await purgaAdmin(
      pedidoAdmin({ origin: "https://otro.example" }),
    )

    expect(res.status).toBe(403)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ORIGEN_INVALIDO" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("AC-40: aplica rate limit por admin con Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      rateLimitDetalle("propuestas:user_1", 30, 60_000)
    }

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(await jsonDe(res)).toMatchObject({ codigo: "RATE_LIMIT" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("AC-40: el admin purga, responde contadores y no borra supresiones", async () => {
    mocks.prospecto.findMany.mockResolvedValue([{ id: "pros_1" }])
    mocks.prospecto.deleteMany.mockResolvedValue({ count: 1 })

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await jsonDe(res)).toEqual({
      eliminados: 1,
      lotes: 1,
      omitido: false,
    })
    expect(mocks.supresionProspecto.deleteMany).not.toHaveBeenCalled()
    expect(mocks.supresionProspecto.updateMany).not.toHaveBeenCalled()
    expect(logsDeMocks()).not.toMatch(/@|Consultora|Alfa|ventas/i)
  })

  it("AC-40: un lock ocupado se informa como omitido sin borrar", async () => {
    mocks.queryRaw.mockResolvedValue([{ obtenido: false }])

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(200)
    expect(await jsonDe(res)).toMatchObject({ omitido: true, eliminados: 0 })
    expect(mocks.prospecto.deleteMany).not.toHaveBeenCalled()
  })

  it("AC-40: un esquema no aplicado responde 503 sin PII", async () => {
    mocks.queryRaw.mockRejectedValueOnce({
      code: "P2021",
      message: 'relation "Prospecto" does not exist',
    })

    const res = await purgaAdmin(pedidoAdmin())

    expect(res.status).toBe(503)
    expect(await jsonDe(res)).toMatchObject({ codigo: "ESQUEMA_NO_APLICADO" })
    expect(logsDeMocks()).not.toMatch(/P2021|Prospecto/)
  })
})
