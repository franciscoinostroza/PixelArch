import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PagoMp } from "@/lib/mercadopago"

/**
 * T-18 (AC-13, AC-20): coexistencia Mercado Pago / PayPal en backend.
 *
 * Se cubre:
 * - el link MP crea/actualiza un `EnlacePago` MERCADOPAGO con token, grupo
 *   estable, `externalId` = preference id, URL, ARS, fees en cero y metadata
 *   `enlaceId`;
 * - el webhook MP registra el `Pago` con pasarela/origen/desglose/moneda/meses
 *   y `enlacePagoId`, marca el enlace PAGADO, invalida los links PayPal
 *   hermanos y no duplica ni acredita dos veces;
 * - links legacy sin `EnlacePago` (adopcion perezosa) y links ya invalidados;
 * - el registro manual con `metodo=MERCADOPAGO` setea `pasarela=MERCADOPAGO`;
 * - regresion: hito PAGADO, soporte ACTIVE/proximoPago y recibo.
 *
 * Prisma, Mercado Pago, auth, rate limit, dolar, emails y Sentry estan
 * mockeados: no hay base ni red.
 */

type Fila = Record<string, unknown>

function esNot(valor: unknown): valor is { not: string } {
  return typeof valor === "object" && valor !== null && "not" in valor
}

function esNotIn(valor: unknown): valor is { notIn: string[] } {
  return typeof valor === "object" && valor !== null && "notIn" in valor
}

function esIn(valor: unknown): valor is { in: string[] } {
  return typeof valor === "object" && valor !== null && "in" in valor
}

const mocks = vi.hoisted(() => {
  const store = {
    hitos: new Map<string, Fila>(),
    suscripciones: new Map<string, Fila>(),
    enlaces: new Map<string, Fila>(),
    pagos: [] as Fila[],
    eventos: [] as Fila[],
  }

  let enlaceSeq = 0

  function snapshotStore() {
    return {
      hitos: new Map(
        [...store.hitos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      suscripciones: new Map(
        [...store.suscripciones].map(
          ([id, fila]) => [id, structuredClone(fila)] as const
        )
      ),
      enlaces: new Map(
        [...store.enlaces].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      pagos: store.pagos.map((fila) => structuredClone(fila)),
      eventos: store.eventos.map((fila) => structuredClone(fila)),
    }
  }

  function restoreStore(snapshot: ReturnType<typeof snapshotStore>) {
    store.hitos = snapshot.hitos
    store.suscripciones = snapshot.suscripciones
    store.enlaces = snapshot.enlaces
    store.pagos = snapshot.pagos
    store.eventos = snapshot.eventos
  }

  function coincideEnlace(enlace: Fila, where: Fila): boolean {
    if (where.id !== undefined) {
      if (typeof where.id === "string" && enlace.id !== where.id) return false
      if (esNot(where.id) && enlace.id === where.id.not) return false
    }
    if (where.grupoCobroId !== undefined && enlace.grupoCobroId !== where.grupoCobroId) {
      return false
    }
    if (where.pasarela !== undefined && enlace.pasarela !== where.pasarela) {
      return false
    }
    if (where.estado !== undefined) {
      if (typeof where.estado === "string" && enlace.estado !== where.estado) {
        return false
      }
      if (esNotIn(where.estado) && where.estado.notIn.includes(String(enlace.estado))) {
        return false
      }
      if (esIn(where.estado) && !where.estado.in.includes(String(enlace.estado))) {
        return false
      }
    }
    return true
  }

  function coincidePago(pago: Fila, where: Fila): boolean {
    if (where.hitoId !== undefined && pago.hitoId !== where.hitoId) return false
    if (
      where.suscripcionId !== undefined &&
      pago.suscripcionId !== where.suscripcionId
    ) {
      return false
    }
    if (where.estadoPago !== undefined && pago.estadoPago !== where.estadoPago) {
      return false
    }
    if (where.externalId !== undefined && pago.externalId !== where.externalId) {
      return false
    }
    return true
  }

  function fechaMs(fila: Fila): number {
    const valor = fila.creadoEn
    if (valor instanceof Date) return valor.getTime()
    return new Date(String(valor)).getTime()
  }

  const enlaceFindUnique = vi.fn(
    async (args: { where: { id: string } }) => {
      const fila = store.enlaces.get(args.where.id)
      return fila ? structuredClone(fila) : null
    }
  )

  const enlaceFindFirst = vi.fn(
    async (args: { where: Fila; orderBy?: { creadoEn?: "asc" | "desc" } }) => {
      const filas = [...store.enlaces.values()].filter((enlace) =>
        coincideEnlace(enlace, args.where)
      )
      if (args.orderBy?.creadoEn === "desc") {
        filas.sort((a, b) => fechaMs(b) - fechaMs(a))
      }
      return filas[0] ? structuredClone(filas[0]) : null
    }
  )

  const enlaceCreate = vi.fn(async (args: { data: Fila }) => {
    enlaceSeq += 1
    const fila: Fila = {
      id: `enlace_creado_${enlaceSeq}`,
      creadoEn: new Date(),
      ...args.data,
    }
    store.enlaces.set(String(fila.id), fila)
    return fila
  })

  const enlaceUpdate = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const fila = store.enlaces.get(args.where.id)
      if (!fila) throw new Error("Enlace no encontrado")
      Object.assign(fila, args.data)
      return fila
    }
  )

  const enlaceUpdateMany = vi.fn(
    async (args: { where: Fila; data: Fila }) => {
      let count = 0
      for (const fila of store.enlaces.values()) {
        if (!coincideEnlace(fila, args.where)) continue
        Object.assign(fila, args.data)
        count += 1
      }
      return { count }
    }
  )

  const pagoFindUnique = vi.fn(
    async (args: { where: { externalId: string } }) =>
      store.pagos.find((pago) => pago.externalId === args.where.externalId) ?? null
  )

  const pagoFindFirst = vi.fn(
    async (args: { where: Fila }) =>
      store.pagos.find((pago) => coincidePago(pago, args.where)) ?? null
  )

  const pagoCreate = vi.fn(async (args: { data: Fila }) => {
    const data = args.data
    const duplicado = store.pagos.some(
      (pago) =>
        (data.externalId !== undefined &&
          data.externalId !== null &&
          pago.externalId === data.externalId) ||
        (data.paypalOrderId !== undefined &&
          data.paypalOrderId !== null &&
          pago.paypalOrderId === data.paypalOrderId)
    )
    if (duplicado) {
      const error = new Error("Unique constraint failed") as Error & {
        code: string
      }
      error.code = "P2002"
      throw error
    }

    const pago: Fila = { id: `pago_${store.pagos.length + 1}`, ...data }
    store.pagos.push(pago)
    return { id: pago.id }
  })

  const hitoFindUnique = vi.fn(
    async (args: { where: { id: string } }) => store.hitos.get(args.where.id) ?? null
  )

  const hitoUpdate = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const hito = store.hitos.get(args.where.id)
      if (!hito) throw new Error("Hito no encontrado")
      Object.assign(hito, args.data)
      return hito
    }
  )

  const hitoUpdateMany = vi.fn(
    async (args: { where: Fila; data: Fila }) => {
      const hito = store.hitos.get(String(args.where.id))
      if (!hito) return { count: 0 }
      if (args.where.estado !== undefined && hito.estado !== args.where.estado) {
        return { count: 0 }
      }
      Object.assign(hito, args.data)
      return { count: 1 }
    }
  )

  const suscripcionFindUnique = vi.fn(
    async (args: { where: { id: string } }) =>
      store.suscripciones.get(args.where.id) ?? null
  )

  const suscripcionUpdate = vi.fn(
    async (args: { where: { id: string }; data: Fila }) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      if (!suscripcion) throw new Error("Suscripcion no encontrada")
      Object.assign(suscripcion, args.data)
      return suscripcion
    }
  )

  const eventoCreate = vi.fn(async (args: { data: Fila }) => {
    const data = args.data
    if (store.eventos.some((evento) => evento.eventoId === data.eventoId)) {
      const error = new Error("Unique constraint failed") as Error & {
        code: string
      }
      error.code = "P2002"
      throw error
    }
    const evento: Fila = { id: `evento_${store.eventos.length + 1}`, ...data }
    store.eventos.push(evento)
    return evento
  })

  const eventoFindUnique = vi.fn(
    async (args: { where: { eventoId: string } }) =>
      store.eventos.find((evento) => evento.eventoId === args.where.eventoId) ??
      null
  )

  type TxFalso = {
    enlacePago: {
      findUnique: typeof enlaceFindUnique
      findFirst: typeof enlaceFindFirst
      create: typeof enlaceCreate
      update: typeof enlaceUpdate
      updateMany: typeof enlaceUpdateMany
    }
    pago: {
      findUnique: typeof pagoFindUnique
      findFirst: typeof pagoFindFirst
      create: typeof pagoCreate
    }
    hito: {
      findUnique: typeof hitoFindUnique
      update: typeof hitoUpdate
      updateMany: typeof hitoUpdateMany
    }
    suscripcion: {
      findUnique: typeof suscripcionFindUnique
      update: typeof suscripcionUpdate
    }
  }

  const tx: TxFalso = {
    enlacePago: {
      findUnique: enlaceFindUnique,
      findFirst: enlaceFindFirst,
      create: enlaceCreate,
      update: enlaceUpdate,
      updateMany: enlaceUpdateMany,
    },
    pago: {
      findUnique: pagoFindUnique,
      findFirst: pagoFindFirst,
      create: pagoCreate,
    },
    hito: {
      findUnique: hitoFindUnique,
      update: hitoUpdate,
      updateMany: hitoUpdateMany,
    },
    suscripcion: {
      findUnique: suscripcionFindUnique,
      update: suscripcionUpdate,
    },
  }

  const $transaction = vi.fn(
    async (fn: (tx: TxFalso) => Promise<unknown>) => {
      const snapshot = snapshotStore()
      try {
        return await fn(tx)
      } catch (error) {
        restoreStore(snapshot)
        throw error
      }
    }
  )

  return {
    store,
    $transaction,
    enlaceFindUnique,
    enlaceFindFirst,
    enlaceCreate,
    enlaceUpdate,
    enlaceUpdateMany,
    pagoFindUnique,
    pagoFindFirst,
    pagoCreate,
    hitoFindUnique,
    hitoUpdate,
    hitoUpdateMany,
    suscripcionFindUnique,
    suscripcionUpdate,
    eventoCreate,
    eventoFindUnique,
    requireAdmin: vi.fn(),
    rateLimit: vi.fn(),
    rateLimitDetalle: vi.fn(),
    rateLimitEstado: vi.fn(),
    resetRateLimit: vi.fn(),
    crearLinkDePago: vi.fn(),
    obtenerPagoMp: vi.fn(),
    getDolar: vi.fn(),
    sendPaymentReceipt: vi.fn(),
    validarFirma: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    loggerDebug: vi.fn(),
  }
})

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  requireStaff: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  rateLimitDetalle: mocks.rateLimitDetalle,
  rateLimitEstado: mocks.rateLimitEstado,
  resetRateLimit: mocks.resetRateLimit,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: mocks.getDolar,
}))

vi.mock("@/lib/notifications", () => ({
  sendPaymentReceipt: mocks.sendPaymentReceipt,
}))

vi.mock("@/lib/mercadopago", () => ({
  crearLinkDePago: mocks.crearLinkDePago,
  obtenerPagoMp: mocks.obtenerPagoMp,
}))

vi.mock("mercadopago", () => {
  class InvalidWebhookSignatureError extends Error {}
  return {
    WebhookSignatureValidator: { validate: mocks.validarFirma },
    InvalidWebhookSignatureError,
  }
})

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    enlacePago: {
      findUnique: mocks.enlaceFindUnique,
      findFirst: mocks.enlaceFindFirst,
      create: mocks.enlaceCreate,
      update: mocks.enlaceUpdate,
      updateMany: mocks.enlaceUpdateMany,
    },
    pago: {
      findUnique: mocks.pagoFindUnique,
      findFirst: mocks.pagoFindFirst,
      create: mocks.pagoCreate,
    },
    hito: {
      findUnique: mocks.hitoFindUnique,
      update: mocks.hitoUpdate,
      updateMany: mocks.hitoUpdateMany,
    },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      update: mocks.suscripcionUpdate,
    },
    eventoPasarela: {
      create: mocks.eventoCreate,
      findUnique: mocks.eventoFindUnique,
    },
  },
}))

import { POST as linkPOST } from "@/app/api/admin/mp/link/route"
import { POST as pagosPOST } from "@/app/api/admin/pagos/route"
import { POST as webhookPOST } from "@/app/api/webhooks/mercadopago/route"

const ADMIN = {
  id: "user_admin",
  clerkUserId: "user_admin",
  nombre: "Ana Admin",
  email: "",
  activo: true,
}

const PROXIMO_PAGO = new Date("2026-11-01T12:00:00.000Z")
const MP_URL = "https://mp.com/checkout/123"
const MP_PREFERENCE = "pref_123"

function pagoMp(overrides: Partial<PagoMp> = {}): PagoMp {
  return {
    id: "mp_payment_1",
    status: "approved",
    externalReference: "hito_1",
    transactionAmount: 5000,
    tipo: "hito",
    meses: 1,
    enlaceId: "enlace_1",
    ...overrides,
  }
}

function resetStore() {
  mocks.store.hitos.clear()
  mocks.store.suscripciones.clear()
  mocks.store.enlaces.clear()
  mocks.store.pagos.length = 0
  mocks.store.eventos.length = 0
}

function crearHito(overrides: Fila = {}): Fila {
  const fila: Fila = {
    id: "hito_1",
    titulo: "Anticipo",
    monto: 500000,
    estado: "PENDIENTE",
    pagadoEn: null,
    mpLink: null,
    mpPreferenceId: null,
    mpLinkExpira: null,
    proyecto: {
      id: "proyecto_1",
      titulo: "Sitio web",
      clienteId: "cliente_1",
      cliente: {
        id: "cliente_1",
        nombre: "Cliente Demo",
        email: "cliente@example.com",
      },
    },
    ...overrides,
  }
  mocks.store.hitos.set(String(fila.id), fila)
  return fila
}

function crearSuscripcion(overrides: Fila = {}): Fila {
  const fila: Fila = {
    id: "susc_1",
    clienteId: "cliente_1",
    plan: "SOPORTE",
    estado: "ACTIVE",
    proximoPago: PROXIMO_PAGO,
    precioCustom: null,
    mpLink: null,
    mpPreferenceId: null,
    mpLinkExpira: null,
    mpLinkMeses: null,
    cliente: {
      id: "cliente_1",
      nombre: "Cliente Demo",
      email: "cliente@example.com",
    },
    servicio: {
      id: "serv_1",
      nombre: "Soporte mensual",
      precioMantenimiento: 100000,
    },
    ...overrides,
  }
  mocks.store.suscripciones.set(String(fila.id), fila)
  return fila
}

let enlaceSeed = 0

function crearEnlace(overrides: Fila = {}): Fila {
  enlaceSeed += 1
  const fila: Fila = {
    id: "enlace_1",
    token: "token_1",
    clienteId: "cliente_1",
    hitoId: "hito_1",
    suscripcionId: null,
    pasarela: "MERCADOPAGO",
    concepto: "Sitio web — Anticipo",
    descripcion: null,
    montoAcordado: 500000,
    comision: 0,
    total: 500000,
    moneda: "ars",
    meses: null,
    feeBps: 0,
    feeFixedCents: 0,
    url: "https://mp.com/checkout/1",
    checkoutUrl: "https://mp.com/checkout/1",
    externalId: "pref_1",
    estado: "ACTIVO",
    grupoCobroId: "hito:hito_1",
    expiraEn: new Date("2026-11-26T12:00:00.000Z"),
    creadoEn: new Date(2026, 0, enlaceSeed),
    ...overrides,
  }
  mocks.store.enlaces.set(String(fila.id), fila)
  return fila
}

function crearPago(overrides: Fila = {}): Fila {
  const fila: Fila = {
    id: `pago_previo_${mocks.store.pagos.length + 1}`,
    clienteId: "cliente_1",
    externalId: "mp_payment_previo",
    estadoPago: "SUCCEEDED",
    ...overrides,
  }
  mocks.store.pagos.push(fila)
  return fila
}

function linkRequest(body: unknown): Request {
  return new Request("https://pixelarch.dev/api/admin/mp/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function webhookRequest(dataId = "mp_payment_1"): Request {
  return new Request(
    `https://pixelarch.dev/api/webhooks/mercadopago?data.id=${dataId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": "ts=1,v1=firma",
        "x-request-id": "req_1",
      },
      body: JSON.stringify({ type: "payment", data: { id: dataId } }),
    }
  )
}

function pagosRequest(body: unknown): Request {
  return new Request("https://pixelarch.dev/api/admin/pagos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  process.env.MP_WEBHOOK_SECRET = "secret"

  mocks.requireAdmin.mockResolvedValue(ADMIN)
  mocks.rateLimit.mockReturnValue(true)
  mocks.rateLimitDetalle.mockReturnValue({
    permitido: true,
    restantes: 1,
    retryAfterSegundos: 0,
  })
  mocks.rateLimitEstado.mockReturnValue({
    excedido: false,
    retryAfterSegundos: 0,
  })
  mocks.crearLinkDePago.mockResolvedValue({
    url: MP_URL,
    preferenceId: MP_PREFERENCE,
  })
  mocks.obtenerPagoMp.mockResolvedValue(pagoMp())
  mocks.getDolar.mockResolvedValue(1000)
  mocks.sendPaymentReceipt.mockResolvedValue(undefined)
})

describe("POST /api/admin/mp/link: EnlacePago MERCADOPAGO (AC-13, AC-20)", () => {
  it("crea el enlace con token, grupo, preferencia, URL, ARS, fees en cero y metadata enlaceId", async () => {
    crearHito()

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, url: MP_URL })

    const enlaces = [...mocks.store.enlaces.values()]
    expect(enlaces).toHaveLength(1)
    const enlace = enlaces[0]

    expect(enlace).toMatchObject({
      pasarela: "MERCADOPAGO",
      clienteId: "cliente_1",
      hitoId: "hito_1",
      suscripcionId: null,
      grupoCobroId: "hito:hito_1",
      externalId: MP_PREFERENCE,
      url: MP_URL,
      checkoutUrl: MP_URL,
      moneda: "ars",
      montoAcordado: 500000,
      comision: 0,
      total: 500000,
      feeBps: 0,
      feeFixedCents: 0,
      estado: "ACTIVO",
      generadoPor: "user_admin",
    })
    expect(typeof enlace.token).toBe("string")
    expect(String(enlace.token).length).toBeGreaterThan(20)
    expect(enlace.expiraEn).toBeInstanceOf(Date)

    expect(mocks.crearLinkDePago).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: "hito_1",
        montoArsCents: 500000,
        metadata: { tipo: "hito", enlaceId: enlace.id },
      })
    )
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      mpLink: MP_URL,
      mpPreferenceId: MP_PREFERENCE,
    })
  })

  it("actualiza el EnlacePago del mismo grupo (legacy) sin duplicar y conserva el token", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_legacy",
      token: "token_legacy",
      externalId: "pref_old",
      url: "https://mp.com/old",
      checkoutUrl: "https://mp.com/old",
      moneda: "usd",
      montoAcordado: 100,
      total: 100,
    })

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 700000 })
    )

    expect(res.status).toBe(200)
    expect([...mocks.store.enlaces.values()]).toHaveLength(1)
    expect(mocks.store.enlaces.get("enlace_legacy")).toMatchObject({
      token: "token_legacy",
      externalId: MP_PREFERENCE,
      url: MP_URL,
      checkoutUrl: MP_URL,
      moneda: "ars",
      montoAcordado: 700000,
      total: 700000,
      estado: "ACTIVO",
    })
    expect(mocks.crearLinkDePago).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tipo: "hito", enlaceId: "enlace_legacy" },
      })
    )
  })

  it("crea el enlace de soporte con meses, grupo y metadata tipo soporte", async () => {
    crearSuscripcion()

    const res = await linkPOST(
      linkRequest({ suscripcionId: "susc_1", montoArsCents: 300000, meses: 3 })
    )

    expect(res.status).toBe(200)
    const enlace = [...mocks.store.enlaces.values()][0]
    expect(enlace).toMatchObject({
      pasarela: "MERCADOPAGO",
      hitoId: null,
      suscripcionId: "susc_1",
      grupoCobroId: "soporte:susc_1",
      meses: 3,
      moneda: "ars",
      montoAcordado: 300000,
      total: 300000,
      feeBps: 0,
      feeFixedCents: 0,
    })
    expect(mocks.crearLinkDePago).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: "susc_1",
        metadata: { tipo: "soporte", meses: 3, enlaceId: enlace.id },
      })
    )
    expect(mocks.store.suscripciones.get("susc_1")).toMatchObject({
      mpLink: MP_URL,
      mpPreferenceId: MP_PREFERENCE,
      mpLinkMeses: 3,
    })
  })

  it("si Mercado Pago no esta configurado responde 503 y deja el enlace FALLIDO", async () => {
    crearHito()
    mocks.crearLinkDePago.mockResolvedValue(null)

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(503)
    expect([...mocks.store.enlaces.values()][0]).toMatchObject({
      estado: "FALLIDO",
      url: null,
      externalId: null,
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ mpLink: null })
  })

  it("fija la expiracion del enlace MP a 30 dias sin crear pagos (AC-13, AC-20)", async () => {
    crearHito()
    const TTL = 30 * 24 * 60 * 60 * 1000
    const antes = Date.now()

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )
    const despues = Date.now()

    expect(res.status).toBe(200)
    const enlace = [...mocks.store.enlaces.values()][0]
    const expiraEn = enlace.expiraEn as Date
    expect(expiraEn).toBeInstanceOf(Date)
    expect(expiraEn.getTime()).toBeGreaterThanOrEqual(antes + TTL)
    expect(expiraEn.getTime()).toBeLessThanOrEqual(despues + TTL)

    // Generar el link no cobra ni cambia el estado del concepto (AC-13, AC-20).
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PENDIENTE",
    })
  })

  it("un link PayPal vigente del mismo cobro sigue ACTIVO al generar el link MP (AC-20)", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_paypal_vigente",
      pasarela: "PAYPAL",
      hitoId: "hito_1",
      grupoCobroId: "hito:hito_1",
      token: "token_paypal",
      externalId: "ORDER-1",
      moneda: "usd",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      url: "https://pixelarch.dev/pago/paypal/token_paypal",
      checkoutUrl: "https://www.paypal.com/checkoutnow?token=ORDER-1",
      estado: "ACTIVO",
    })

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(200)
    expect(mocks.store.enlaces.get("enlace_paypal_vigente")).toMatchObject({
      estado: "ACTIVO",
      url: "https://pixelarch.dev/pago/paypal/token_paypal",
      checkoutUrl: "https://www.paypal.com/checkoutnow?token=ORDER-1",
      moneda: "usd",
      montoAcordado: 10050,
      total: 10656,
    })
    expect(mocks.store.enlaces.size).toBe(2)
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PENDIENTE",
    })
  })

  it.each(["INVALIDADO", "VENCIDO", "FALLIDO"] as const)(
    "no reutiliza un enlace %s: crea una fila nueva y conserva el historial",
    async (estado) => {
      crearHito()
      const invalidadoEn = new Date("2026-10-01T12:00:00.000Z")
      crearEnlace({
        id: "enlace_previo",
        estado,
        invalidadoEn,
        motivoInvalido: "MOTIVO_PREVIO",
        ultimoError: "ERROR_PREVIO",
        url: "https://mp.com/previo",
        checkoutUrl: "https://mp.com/previo",
        externalId: "pref_previo",
      })

      const res = await linkPOST(
        linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
      )

      expect(res.status).toBe(200)
      expect(mocks.store.enlaces.size).toBe(2)

      // La fila previa queda intacta (no se revive ni se limpia su motivo).
      expect(mocks.store.enlaces.get("enlace_previo")).toMatchObject({
        estado,
        invalidadoEn,
        motivoInvalido: "MOTIVO_PREVIO",
        ultimoError: "ERROR_PREVIO",
        url: "https://mp.com/previo",
        checkoutUrl: "https://mp.com/previo",
        externalId: "pref_previo",
      })

      const nuevo = [...mocks.store.enlaces.values()].find(
        (enlace) => enlace.id !== "enlace_previo"
      )
      expect(nuevo).toMatchObject({
        pasarela: "MERCADOPAGO",
        hitoId: "hito_1",
        grupoCobroId: "hito:hito_1",
        estado: "ACTIVO",
        externalId: MP_PREFERENCE,
        url: MP_URL,
        montoAcordado: 500000,
      })
      expect(typeof nuevo?.token).toBe("string")
      expect(mocks.store.hitos.get("hito_1")).toMatchObject({ mpLink: MP_URL })
    }
  )

  it("si Mercado Pago no esta configurado, un enlace ACTIVO conserva URL y preferencia", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_activo",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
    })
    mocks.crearLinkDePago.mockResolvedValue(null)

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(503)
    expect(mocks.store.enlaces.get("enlace_activo")).toMatchObject({
      estado: "ACTIVO",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ mpLink: null })
  })

  it("si Mercado Pago lanza un error, restaura el enlace ACTIVO (snapshot)", async () => {
    crearHito()
    const expiraVigente = new Date("2026-11-15T12:00:00.000Z")
    crearEnlace({
      id: "enlace_activo",
      token: "token_vigente",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
      expiraEn: expiraVigente,
    })
    mocks.crearLinkDePago.mockRejectedValue(new Error("MP caido"))

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(500)
    expect(mocks.store.enlaces.get("enlace_activo")).toMatchObject({
      estado: "ACTIVO",
      token: "token_vigente",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
      expiraEn: expiraVigente,
      ultimoError: null,
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ mpLink: null })
  })

  it("no borra la URL ni la preferencia vigentes antes de confirmar (T-18, AC-13, AC-20)", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_activo",
      token: "token_vigente",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
    })

    let duranteLaCreacion: Fila | undefined
    mocks.crearLinkDePago.mockImplementation(async () => {
      duranteLaCreacion = structuredClone(
        mocks.store.enlaces.get("enlace_activo")
      )
      return { url: MP_URL, preferenceId: MP_PREFERENCE }
    })

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(200)
    // Mientras MP crea la preferencia, el link anterior sigue guardado: no se
    // borra ni se pierde el enlace vigente antes de tener el nuevo confirmado.
    expect(duranteLaCreacion).toMatchObject({
      token: "token_vigente",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
    })
    // Recien al confirmar se reemplazan URL y preferencia, conservando el token.
    expect(mocks.store.enlaces.get("enlace_activo")).toMatchObject({
      estado: "ACTIVO",
      token: "token_vigente",
      url: MP_URL,
      checkoutUrl: MP_URL,
      externalId: MP_PREFERENCE,
    })
  })

  it("no pisa PAGADO si el webhook confirma el pago durante la creacion", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_activo",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
      montoAcordado: 400000,
      total: 400000,
    })
    mocks.crearLinkDePago.mockImplementation(
      async (args: { metadata?: { enlaceId?: string } }) => {
        const enlaceId = args.metadata?.enlaceId
        const fila = enlaceId ? mocks.store.enlaces.get(enlaceId) : null
        // Simula el webhook que confirma el pago mientras se crea la preferencia.
        if (fila) Object.assign(fila, { estado: "PAGADO" })
        return { url: MP_URL, preferenceId: MP_PREFERENCE }
      }
    )

    const res = await linkPOST(
      linkRequest({ hitoId: "hito_1", montoArsCents: 500000 })
    )

    expect(res.status).toBe(409)
    expect(mocks.store.enlaces.size).toBe(1)
    expect(mocks.store.enlaces.get("enlace_activo")).toMatchObject({
      estado: "PAGADO",
      url: "https://mp.com/vigente",
      checkoutUrl: "https://mp.com/vigente",
      externalId: "pref_vigente",
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PENDIENTE",
      mpLink: null,
    })
    expect(mocks.store.pagos).toHaveLength(0)
  })
})

describe("POST /api/webhooks/mercadopago: pago MP con trazabilidad (AC-13, AC-20)", () => {
  it("registra el Pago con pasarela, origen, desglose, ARS y enlace; marca hito PAGADO", async () => {
    crearHito({ mpLink: "https://mp.com/old", mpPreferenceId: "pref_old" })
    crearEnlace()

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })

    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.store.pagos[0]).toMatchObject({
      clienteId: "cliente_1",
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
      externalId: "mp_payment_1",
      monto: 500000,
      montoAcordado: 500000,
      comision: 0,
      montoEsperado: 500000,
      meses: null,
      moneda: "ars",
      metodo: "MERCADOPAGO",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
      estadoPago: "SUCCEEDED",
    })
    expect(mocks.store.enlaces.get("enlace_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PAGADO",
      mpLink: null,
      mpPreferenceId: null,
      mpLinkExpira: null,
    })
    expect(mocks.sendPaymentReceipt).toHaveBeenCalledWith(
      "cliente@example.com",
      "Cliente Demo",
      500000,
      "ars",
      "Sitio web — Anticipo"
    )
    expect(mocks.store.eventos).toHaveLength(1)
    expect(mocks.store.eventos[0]).toMatchObject({
      pasarela: "MERCADOPAGO",
      eventoId: "MERCADOPAGO:PAGO:mp_payment_1",
      resultado: "PROCESADO",
      pagoId: "pago_1",
      enlacePagoId: "enlace_1",
      monto: 500000,
      moneda: "ars",
      requiereAccion: false,
    })
  })

  it("acredita los meses del soporte y registra Pago.meses", async () => {
    crearSuscripcion()
    crearEnlace({
      id: "enlace_soporte",
      hitoId: null,
      suscripcionId: "susc_1",
      grupoCobroId: "soporte:susc_1",
      meses: 3,
      concepto: "Soporte mensual — 3 meses",
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({
        externalReference: "susc_1",
        transactionAmount: 3000,
        tipo: "soporte",
        meses: 3,
        enlaceId: "enlace_soporte",
      })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      suscripcionId: "susc_1",
      enlacePagoId: "enlace_soporte",
      meses: 3,
      moneda: "ars",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
      estadoPago: "SUCCEEDED",
    })
    expect(mocks.store.enlaces.get("enlace_soporte")).toMatchObject({
      estado: "PAGADO",
    })
    const suscripcion = mocks.store.suscripciones.get("susc_1")
    expect(suscripcion).toMatchObject({
      estado: "ACTIVE",
      pastDueEn: null,
      canceladoEn: null,
    })
    expect((suscripcion?.proximoPago as Date).toISOString().slice(0, 10)).toBe(
      "2027-02-01"
    )
    expect(mocks.sendPaymentReceipt).toHaveBeenCalledWith(
      "cliente@example.com",
      "Cliente Demo",
      300000,
      "ars",
      "Soporte mensual"
    )
  })

  it("un webhook duplicado no crea otro Pago ni vuelve a acreditar", async () => {
    crearHito()
    crearEnlace()
    crearPago({
      id: "pago_previo",
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
      externalId: "mp_payment_1",
    })

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, duplicate: true })
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ estado: "PENDIENTE" })
    expect(mocks.store.eventos[0]).toMatchObject({
      eventoId: "MERCADOPAGO:DUPLICADO:mp_payment_1",
      resultado: "DUPLICADO",
      pagoId: "pago_previo",
    })
  })

  it("invalida los links PayPal hermanos del mismo grupo y conserva los de otro grupo", async () => {
    crearHito()
    crearEnlace({ id: "enlace_mp" })
    crearEnlace({
      id: "enlace_paypal",
      pasarela: "PAYPAL",
      hitoId: "hito_1",
      grupoCobroId: "hito:hito_1",
      token: "token_paypal",
      externalId: "ORDER-1",
      moneda: "usd",
      montoAcordado: 10050,
      total: 10656,
    })
    crearEnlace({
      id: "enlace_otro",
      pasarela: "PAYPAL",
      hitoId: "hito_2",
      grupoCobroId: "hito:hito_2",
      token: "token_otro",
      externalId: "ORDER-2",
      moneda: "usd",
      montoAcordado: 10050,
      total: 10656,
    })
    mocks.obtenerPagoMp.mockResolvedValue(pagoMp({ enlaceId: "enlace_mp" }))

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.enlaces.get("enlace_mp")).toMatchObject({
      estado: "PAGADO",
    })
    expect(mocks.store.enlaces.get("enlace_paypal")).toMatchObject({
      estado: "INVALIDADO",
      motivoInvalido: "OTRO_PAGO_GANO",
    })
    expect(mocks.store.enlaces.get("enlace_paypal")?.invalidadoEn).toBeInstanceOf(
      Date
    )
    expect(mocks.store.enlaces.get("enlace_otro")).toMatchObject({
      estado: "ACTIVO",
    })
  })

  it("un pago de soporte invalida el link PayPal hermano del mismo grupo (AC-13)", async () => {
    crearSuscripcion()
    crearEnlace({
      id: "enlace_soporte_mp",
      hitoId: null,
      suscripcionId: "susc_1",
      grupoCobroId: "soporte:susc_1",
      meses: 3,
      concepto: "Soporte mensual — 3 meses",
    })
    crearEnlace({
      id: "enlace_soporte_paypal",
      pasarela: "PAYPAL",
      hitoId: null,
      suscripcionId: "susc_1",
      grupoCobroId: "soporte:susc_1",
      token: "token_soporte",
      externalId: "ORDER-SOP",
      meses: 3,
      moneda: "usd",
      montoAcordado: 30000,
      comision: 1650,
      total: 31650,
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({
        externalReference: "susc_1",
        transactionAmount: 3000,
        tipo: "soporte",
        meses: 3,
        enlaceId: "enlace_soporte_mp",
      })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      suscripcionId: "susc_1",
      enlacePagoId: "enlace_soporte_mp",
      meses: 3,
      moneda: "ars",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
    })
    expect(mocks.store.enlaces.get("enlace_soporte_mp")).toMatchObject({
      estado: "PAGADO",
    })
    expect(mocks.store.enlaces.get("enlace_soporte_paypal")).toMatchObject({
      estado: "INVALIDADO",
      motivoInvalido: "OTRO_PAGO_GANO",
    })
    expect(
      mocks.store.enlaces.get("enlace_soporte_paypal")?.invalidadoEn
    ).toBeInstanceOf(Date)
  })

  it("resuelve el cobro por la metadata enlaceId cuando falta externalReference (AC-13, AC-20)", async () => {
    crearHito()
    crearEnlace()
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({ externalReference: null, tipo: null, enlaceId: "enlace_1" })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
    expect(mocks.store.pagos[0]).toMatchObject({
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
      monto: 500000,
      moneda: "ars",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
    })
    expect(mocks.store.enlaces.get("enlace_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ estado: "PAGADO" })
  })

  it("ignora un enlaceId de otro cobro y usa el link MP del grupo (AC-13)", async () => {
    crearHito()
    crearEnlace()
    crearEnlace({
      id: "enlace_ajeno",
      hitoId: "hito_2",
      grupoCobroId: "hito:hito_2",
      externalId: "pref_otro",
      url: "https://mp.com/otro",
      checkoutUrl: "https://mp.com/otro",
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({
        externalReference: "hito_1",
        tipo: "hito",
        enlaceId: "enlace_ajeno",
      })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
    })
    expect(mocks.store.enlaces.get("enlace_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(mocks.store.enlaces.get("enlace_ajeno")).toMatchObject({
      estado: "ACTIVO",
    })
  })

  it.each([null, 0])(
    "un pago sin monto (%s) no registra un Pago de 0 (AC-13)",
    async (transactionAmount) => {
      crearHito()
      crearEnlace()
      mocks.obtenerPagoMp.mockResolvedValue(pagoMp({ transactionAmount }))

      const res = await webhookPOST(webhookRequest())

      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ ok: true, ignored: true })
      expect(mocks.store.pagos).toHaveLength(0)
      expect(mocks.store.eventos).toHaveLength(0)
      expect(mocks.store.hitos.get("hito_1")).toMatchObject({
        estado: "PENDIENTE",
      })
      expect(mocks.store.enlaces.get("enlace_1")).toMatchObject({
        estado: "ACTIVO",
      })
      expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    }
  )

  it("adopta el link legacy resuelto por externalReference y lo vincula al Pago", async () => {
    crearHito({
      mpLink: "https://mp.com/legacy",
      mpPreferenceId: "pref_legacy",
      mpLinkExpira: new Date("2026-11-15T12:00:00.000Z"),
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({
        id: "mp_payment_legacy",
        enlaceId: null,
        externalReference: "hito_1",
      })
    )

    const res = await webhookPOST(webhookRequest("mp_payment_legacy"))

    expect(res.status).toBe(200)
    expect(mocks.store.enlaces.size).toBe(1)
    const enlace = [...mocks.store.enlaces.values()][0]
    expect(enlace).toMatchObject({
      pasarela: "MERCADOPAGO",
      hitoId: "hito_1",
      grupoCobroId: "hito:hito_1",
      montoAcordado: 500000,
      comision: 0,
      total: 500000,
      moneda: "ars",
      feeBps: 0,
      feeFixedCents: 0,
      estado: "PAGADO",
      url: "https://mp.com/legacy",
      externalId: null,
    })
    expect(mocks.store.pagos[0]).toMatchObject({
      enlacePagoId: enlace.id,
      externalId: "mp_payment_legacy",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
      moneda: "ars",
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({ estado: "PAGADO" })
  })

  it("corrige el snapshot USD del link legacy adoptado con el monto real en ARS", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_legacy_usd",
      moneda: "usd",
      montoAcordado: 10050,
      total: 10050,
      comision: 0,
      externalId: "pref_legacy",
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({ enlaceId: "enlace_legacy_usd" })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.enlaces.get("enlace_legacy_usd")).toMatchObject({
      estado: "PAGADO",
      moneda: "ars",
      montoAcordado: 500000,
      comision: 0,
      total: 500000,
      feeBps: 0,
      feeFixedCents: 0,
    })
  })

  it("si el link MP fue invalidado por otro pago, no registra Pago y traza REQUIERE_ACCION", async () => {
    crearHito()
    crearEnlace({ estado: "INVALIDADO", motivoInvalido: "OTRO_PAGO_GANO" })

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, discarded: true })
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    expect(mocks.store.eventos[0]).toMatchObject({
      eventoId: "MERCADOPAGO:DESCARTADO:mp_payment_1",
      resultado: "REQUIERE_ACCION",
      motivo: "ENLACE_INVALIDADO",
      enlacePagoId: "enlace_1",
      requiereAccion: true,
    })
  })

  it("si el hito ya esta PAGADO no registra un segundo Pago y traza REQUIERE_ACCION", async () => {
    crearHito({
      estado: "PAGADO",
      pagadoEn: new Date("2026-10-01T12:00:00.000Z"),
    })

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    expect(mocks.store.eventos[0]).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "HITO_PAGADO",
      requiereAccion: true,
    })
  })

  it("un pago rechazado crea un Pago FAILED sin marcar el hito ni consumir el enlace", async () => {
    crearHito()
    crearEnlace()
    mocks.obtenerPagoMp.mockResolvedValue(pagoMp({ status: "rejected" }))

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      estadoPago: "FAILED",
      pasarela: "MERCADOPAGO",
      origen: "AUTOMATICO",
      enlacePagoId: "enlace_1",
      moneda: "ars",
    })
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PENDIENTE",
    })
    expect(mocks.store.enlaces.get("enlace_1")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
  })

  it("ignora un enlaceId de PayPal si falta externalReference (no recibe el monto ARS)", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_paypal",
      pasarela: "PAYPAL",
      hitoId: "hito_1",
      grupoCobroId: "hito:hito_1",
      token: "token_paypal",
      externalId: "ORDER-1",
      moneda: "usd",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      url: "https://pixelarch.dev/pago/paypal/token_paypal",
      checkoutUrl: "https://www.paypal.com/checkoutnow?token=ORDER-1",
      estado: "ACTIVO",
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({ externalReference: null, tipo: null, enlaceId: "enlace_paypal" })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, ignored: true })
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.store.eventos).toHaveLength(0)
    expect(mocks.store.enlaces.get("enlace_paypal")).toMatchObject({
      estado: "ACTIVO",
      moneda: "usd",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      externalId: "ORDER-1",
    })
  })

  it("no vincula un pago MP a un enlace PayPal del mismo grupo", async () => {
    crearHito()
    crearEnlace({
      id: "enlace_paypal",
      pasarela: "PAYPAL",
      hitoId: "hito_1",
      grupoCobroId: "hito:hito_1",
      token: "token_paypal",
      externalId: "ORDER-1",
      moneda: "usd",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      url: "https://pixelarch.dev/pago/paypal/token_paypal",
      checkoutUrl: "https://www.paypal.com/checkoutnow?token=ORDER-1",
      estado: "ACTIVO",
    })
    mocks.obtenerPagoMp.mockResolvedValue(
      pagoMp({ externalReference: "hito_1", tipo: "hito", enlaceId: "enlace_paypal" })
    )

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.store.pagos[0]).toMatchObject({
      hitoId: "hito_1",
      monto: 500000,
      moneda: "ars",
      pasarela: "MERCADOPAGO",
    })
    expect(mocks.store.pagos[0].enlacePagoId).not.toBe("enlace_paypal")

    // El link PayPal conserva su monto USD (no recibe el monto ARS) y no se
    // marca PAGADO: queda invalidado porque el pago MP gano el cobro.
    expect(mocks.store.enlaces.get("enlace_paypal")).toMatchObject({
      estado: "INVALIDADO",
      motivoInvalido: "OTRO_PAGO_GANO",
      moneda: "usd",
      montoAcordado: 10050,
      comision: 606,
      total: 10656,
      externalId: "ORDER-1",
    })

    // Se adopta un EnlacePago MERCADOPAGO independiente para el pago.
    const enlaceMp = [...mocks.store.enlaces.values()].find(
      (enlace) => enlace.pasarela === "MERCADOPAGO"
    )
    expect(enlaceMp).toMatchObject({
      pasarela: "MERCADOPAGO",
      hitoId: "hito_1",
      estado: "PAGADO",
      moneda: "ars",
      montoAcordado: 500000,
      total: 500000,
    })
    expect(mocks.store.pagos[0].enlacePagoId).toBe(enlaceMp?.id)
  })

  it("traza P2002 de Pago.externalId como DUPLICADO (carrera de webhooks)", async () => {
    crearHito()
    crearEnlace()
    crearPago({
      id: "pago_ganador",
      hitoId: "hito_1",
      enlacePagoId: "enlace_1",
      externalId: "mp_payment_1",
    })
    // Simula que el pre-chequeo no vio el pago, que el "primer pago" tampoco y
    // que otro webhook gano la carrera de insercion.
    mocks.pagoFindUnique.mockResolvedValueOnce(null)
    mocks.pagoFindFirst.mockResolvedValueOnce(null)

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, duplicate: true })
    expect(mocks.store.pagos).toHaveLength(1)
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    expect(mocks.store.eventos[0]).toMatchObject({
      eventoId: "MERCADOPAGO:DUPLICADO:mp_payment_1",
      resultado: "DUPLICADO",
      motivo: "DUPLICADO",
      externalId: "mp_payment_1",
      pagoId: "pago_ganador",
      enlacePagoId: "enlace_1",
    })
  })

  it("devuelve 500 si falla el procesamiento (para que MP reintente)", async () => {
    crearHito()
    crearEnlace()
    mocks.getDolar.mockRejectedValueOnce(new Error("dolar caido"))

    const res = await webhookPOST(webhookRequest())

    expect(res.status).toBe(500)
    expect(mocks.store.pagos).toHaveLength(0)
    expect(mocks.store.hitos.get("hito_1")).toMatchObject({
      estado: "PENDIENTE",
    })
  })

  it("en produccion rechaza el webhook si falta MP_WEBHOOK_SECRET", async () => {
    crearHito()
    crearEnlace()

    try {
      vi.stubEnv("NODE_ENV", "production")
      vi.stubEnv("MP_WEBHOOK_SECRET", "")

      const res = await webhookPOST(webhookRequest())

      expect(res.status).toBe(503)
      expect(mocks.store.pagos).toHaveLength(0)
      expect(mocks.validarFirma).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("POST /api/admin/pagos: pasarela del registro manual (AC-20)", () => {
  it("con metodo=MERCADOPAGO setea pasarela MERCADOPAGO", async () => {
    crearHito()

    const res = await pagosPOST(
      pagosRequest({
        hitoId: "hito_1",
        monto: 500000,
        moneda: "ars",
        metodo: "MERCADOPAGO",
        enviarRecibo: false,
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      metodo: "MERCADOPAGO",
      pasarela: "MERCADOPAGO",
      monto: 500000,
      montoAcordado: 500000,
      comision: 0,
      montoEsperado: 500000,
      moneda: "ars",
      origen: "MANUAL",
    })
  })

  it("con TRANSFERENCIA sigue registrando pasarela MANUAL", async () => {
    crearHito()

    const res = await pagosPOST(
      pagosRequest({
        hitoId: "hito_1",
        monto: 500000,
        moneda: "ars",
        metodo: "TRANSFERENCIA",
        enviarRecibo: false,
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.store.pagos[0]).toMatchObject({
      metodo: "TRANSFERENCIA",
      pasarela: "MANUAL",
    })
  })
})
