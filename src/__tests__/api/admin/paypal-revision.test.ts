import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-17 (AC-11, AC-17, AC-27): resolucion de pagos PayPal en revision.
 *
 * Se cubren permisos (solo admin), rate limit, validacion estricta del body,
 * pago inexistente/de otra pasarela/ya resuelto, aceptacion de hito y soporte,
 * ajuste del desglose para que el recibo reconcile, recibo solo al aceptar,
 * rechazo sin aplicar el concepto (limpia un recibo previo), moneda distinta de
 * USD (siempre rechazada, nunca aceptada ni con nota), referencia externa
 * obligatoria para aceptar, eventos de trazabilidad, resolucion concurrente sin
 * doble aplicacion, rollback ante fallos, ausencia de PII en logs/Sentry/eventos
 * y `Cache-Control: no-store` en todas las respuestas.
 *
 * Prisma, auth, rate limit, logger y Sentry estan mockeados: no hay base ni
 * red.
 */

type Fila = Record<string, unknown>

const mocks = vi.hoisted(() => {
  const store = {
    pagos: new Map<string, Fila>(),
    hitos: new Map<string, Fila>(),
    suscripciones: new Map<string, Fila>(),
    eventos: new Map<string, Fila>(),
  }

  const stress: {
    pagoStale: Fila | null
    pagoUpdateManyError: Error | null
    suscripcionConflicto: boolean
  } = {
    pagoStale: null,
    pagoUpdateManyError: null,
    suscripcionConflicto: false,
  }

  function snapshotStore() {
    return {
      pagos: new Map(
        [...store.pagos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      hitos: new Map(
        [...store.hitos].map(([id, fila]) => [id, structuredClone(fila)] as const)
      ),
      suscripciones: new Map(
        [...store.suscripciones].map(
          ([id, fila]) => [id, structuredClone(fila)] as const
        )
      ),
      eventos: new Map(
        [...store.eventos].map(
          ([id, fila]) => [id, structuredClone(fila)] as const
        )
      ),
    }
  }

  function restoreStore(snapshot: ReturnType<typeof snapshotStore>) {
    store.pagos = snapshot.pagos
    store.hitos = snapshot.hitos
    store.suscripciones = snapshot.suscripciones
    store.eventos = snapshot.eventos
  }

  type PagoFindUniqueArgs = { where: { id: string }; select?: Fila }

  const pagoFindUnique = vi.fn(async (args: PagoFindUniqueArgs) => {
    if (stress.pagoStale && stress.pagoStale.id === args.where.id) {
      const stale = structuredClone(stress.pagoStale)
      stress.pagoStale = null
      return stale
    }
    const pago = store.pagos.get(args.where.id)
    return pago ? structuredClone(pago) : null
  })

  type PagoUpdateManyArgs = {
    where: {
      id: string
      pasarela?: string
      estadoPago?: string
      revisionEstado?: string | null
    }
    data: Fila
  }

  const pagoUpdateMany = vi.fn(async (args: PagoUpdateManyArgs) => {
    if (stress.pagoUpdateManyError) {
      const err = stress.pagoUpdateManyError
      stress.pagoUpdateManyError = null
      throw err
    }

    const pago = store.pagos.get(args.where.id)
    if (!pago) return { count: 0 }
    if (
      args.where.pasarela !== undefined &&
      pago.pasarela !== args.where.pasarela
    ) {
      return { count: 0 }
    }
    if (
      args.where.estadoPago !== undefined &&
      pago.estadoPago !== args.where.estadoPago
    ) {
      return { count: 0 }
    }
    if (
      args.where.revisionEstado !== undefined &&
      pago.revisionEstado !== args.where.revisionEstado
    ) {
      return { count: 0 }
    }

    // `Pago.reciboId` es unico: el doble reproduce la constraint para que un
    // fallo de unicidad tambien revierta la transaccion.
    const reciboId = args.data.reciboId
    if (typeof reciboId === "string") {
      for (const otro of store.pagos.values()) {
        if (otro.id !== pago.id && otro.reciboId === reciboId) {
          const err = new Error(
            "Unique constraint failed on the fields: (`reciboId`)"
          ) as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
      }
    }

    Object.assign(pago, args.data)
    return { count: 1 }
  })

  type HitoUpdateManyArgs = {
    where: { id: string; estado?: string }
    data: Fila
  }

  const hitoUpdateMany = vi.fn(async (args: HitoUpdateManyArgs) => {
    const hito = store.hitos.get(args.where.id)
    if (!hito) return { count: 0 }
    if (args.where.estado !== undefined && hito.estado !== args.where.estado) {
      return { count: 0 }
    }
    Object.assign(hito, args.data)
    return { count: 1 }
  })

  type SuscripcionFindUniqueArgs = { where: { id: string }; select?: Fila }

  const suscripcionFindUnique = vi.fn(
    async (args: SuscripcionFindUniqueArgs) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      return suscripcion ? structuredClone(suscripcion) : null
    }
  )

  function mismaFecha(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }
    return (a ?? null) === (b ?? null)
  }

  type SuscripcionUpdateManyArgs = {
    where: { id: string; proximoPago?: Date | null }
    data: Fila
  }

  const suscripcionUpdateMany = vi.fn(
    async (args: SuscripcionUpdateManyArgs) => {
      const suscripcion = store.suscripciones.get(args.where.id)
      if (!suscripcion) return { count: 0 }
      if (stress.suscripcionConflicto) {
        // Simula otra transaccion que gano la carrera entre la lectura y el
        // update condicional por `proximoPago`.
        stress.suscripcionConflicto = false
        return { count: 0 }
      }
      if (
        "proximoPago" in args.where &&
        !mismaFecha(args.where.proximoPago, suscripcion.proximoPago)
      ) {
        return { count: 0 }
      }
      Object.assign(suscripcion, args.data)
      return { count: 1 }
    }
  )

  type EventoCreateArgs = { data: Fila }

  const eventoCreate = vi.fn(async (args: EventoCreateArgs) => {
    const eventoId = String(args.data.eventoId)
    if (store.eventos.has(eventoId)) {
      const err = new Error(
        "Unique constraint failed on the fields: (`eventoId`)"
      ) as Error & { code?: string }
      err.code = "P2002"
      throw err
    }
    const fila = {
      id: `evento_${store.eventos.size + 1}`,
      creadoEn: new Date(),
      ...args.data,
    }
    store.eventos.set(eventoId, fila)
    return structuredClone(fila)
  })

  const eventoFindUnique = vi.fn(
    async (args: { where: { eventoId: string } }) => {
      const evento = store.eventos.get(args.where.eventoId)
      return evento ? structuredClone(evento) : null
    }
  )

  const eventoPasarela = {
    create: eventoCreate,
    findUnique: eventoFindUnique,
  }

  const $transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = snapshotStore()
      try {
        return await fn({
          pago: {
            findUnique: pagoFindUnique,
            updateMany: pagoUpdateMany,
          },
          hito: { updateMany: hitoUpdateMany },
          suscripcion: {
            findUnique: suscripcionFindUnique,
            updateMany: suscripcionUpdateMany,
          },
          eventoPasarela,
        })
      } catch (error) {
        restoreStore(snapshot)
        throw error
      }
    }
  )

  return {
    store,
    stress,
    $transaction,
    pagoFindUnique,
    pagoUpdateMany,
    hitoUpdateMany,
    suscripcionFindUnique,
    suscripcionUpdateMany,
    eventoPasarela,
    requireAdmin: vi.fn(),
    rateLimit: vi.fn(),
    sentryCaptureException: vi.fn(),
    loggerDebug: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  }
})

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.sentryCaptureException,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    pago: {
      findUnique: mocks.pagoFindUnique,
      updateMany: mocks.pagoUpdateMany,
    },
    hito: { updateMany: mocks.hitoUpdateMany },
    suscripcion: {
      findUnique: mocks.suscripcionFindUnique,
      updateMany: mocks.suscripcionUpdateMany,
    },
    eventoPasarela: mocks.eventoPasarela,
  },
}))

import { POST } from "@/app/api/admin/paypal/revision/route"
import { addMonths } from "@/lib/pagos"
import {
  combinarNotaRevision,
  esRevisionPorMoneda,
  resolverRevisionPaypal,
} from "@/lib/paypal/review"

const PAGO_HITO = "pago_hito"
const PAGO_SOPORTE = "pago_soporte"
const PAGO_MONEDA = "pago_moneda"
const PAGO_MP = "pago_mp"
const PAGO_SUCCEEDED = "pago_succeeded"
const PAGO_ACEPTADO = "pago_aceptado"
const PAGO_RECHAZADO = "pago_rechazado"
const PAGO_HITO_OCUPADO = "pago_hito_ocupado"

const HITO_1 = "hito_1"
const HITO_2 = "hito_2"
const HITO_OCUPADO = "hito_ocupado"
const SUSC_1 = "suscripcion_1"

const PAGADO_EN = new Date("2026-10-01T12:00:00.000Z")
const PROXIMO_PAGO = new Date("2030-01-15T12:00:00.000Z")
const RECIBO_PREVIO = "PAY-20261001-ABCDEF123456"
const NOTA_MONEDA =
  "Moneda capturada ARS; moneda del link USD; esperado USD."

const ADMIN = {
  id: "admin_1",
  clerkUserId: "admin_1",
  nombre: "Ana Admin",
  email: "admin@example.com",
  activo: true,
}

const STAFF_RESUELTO = "Ana Admin (admin_1)"
const MOTIVO_MONEDA_DESCONOCIDA =
  "Moneda capturada desconocida; moneda del link USD; esperado USD."

function body(overrides: Fila = {}): Fila {
  return {
    pagoId: PAGO_HITO,
    accion: "ACEPTAR",
    ...overrides,
  }
}

function request(payload: unknown): Request {
  return new Request("https://pixelarch.dev/api/admin/paypal/revision", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function expectNoStore(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store")
}

function pago(id: string): Fila {
  return mocks.store.pagos.get(id) as Fila
}

function hito(id: string): Fila {
  return mocks.store.hitos.get(id) as Fila
}

function suscripcion(): Fila {
  return mocks.store.suscripciones.get(SUSC_1) as Fila
}

function eventos(): Fila[] {
  return [...mocks.store.eventos.values()]
}

function basePago(overrides: Fila): Fila {
  return {
    id: "pago_base",
    clienteId: "cliente_1",
    pasarela: "PAYPAL",
    estadoPago: "REVISION",
    revisionEstado: "PENDIENTE",
    revisionNota: null,
    revisionResueltaPor: null,
    revisionResueltaEn: null,
    monto: 10000,
    montoAcordado: 10050,
    comision: 606,
    montoEsperado: 10656,
    meses: null,
    hitoId: HITO_1,
    suscripcionId: null,
    enlacePagoId: "enlace_1",
    externalId: "CAPTURE-HITO",
    paypalOrderId: "ORDER-HITO",
    moneda: "usd",
    reciboId: null,
    reciboEmitidoEn: null,
    metodo: "PAYPAL",
    origen: "AUTOMATICO",
    ...overrides,
  }
}

function resetStore() {
  mocks.store.pagos.clear()
  mocks.store.hitos.clear()
  mocks.store.suscripciones.clear()
  mocks.store.eventos.clear()

  mocks.store.pagos.set(
    PAGO_HITO,
    basePago({ id: PAGO_HITO })
  )

  mocks.store.pagos.set(
    PAGO_SOPORTE,
    basePago({
      id: PAGO_SOPORTE,
      hitoId: null,
      suscripcionId: SUSC_1,
      meses: 2,
      monto: 19500,
      montoAcordado: 18868,
      comision: 1132,
      montoEsperado: 20000,
      externalId: "CAPTURE-SOPORTE",
      paypalOrderId: "ORDER-SOPORTE",
    })
  )

  mocks.store.pagos.set(
    PAGO_MONEDA,
    basePago({
      id: PAGO_MONEDA,
      hitoId: HITO_2,
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      revisionNota: NOTA_MONEDA,
      externalId: "CAPTURE-MONEDA",
      paypalOrderId: "ORDER-MONEDA",
    })
  )

  mocks.store.pagos.set(
    PAGO_MP,
    basePago({
      id: PAGO_MP,
      pasarela: "MERCADOPAGO",
      hitoId: HITO_1,
      moneda: "ars",
      externalId: "mp-123",
      paypalOrderId: null,
    })
  )

  mocks.store.pagos.set(
    PAGO_SUCCEEDED,
    basePago({
      id: PAGO_SUCCEEDED,
      estadoPago: "SUCCEEDED",
      revisionEstado: null,
      reciboId: RECIBO_PREVIO,
      reciboEmitidoEn: PAGADO_EN,
    })
  )

  mocks.store.pagos.set(
    PAGO_ACEPTADO,
    basePago({
      id: PAGO_ACEPTADO,
      estadoPago: "SUCCEEDED",
      revisionEstado: "ACEPTADO",
      reciboId: RECIBO_PREVIO,
      reciboEmitidoEn: PAGADO_EN,
    })
  )

  mocks.store.pagos.set(
    PAGO_RECHAZADO,
    basePago({
      id: PAGO_RECHAZADO,
      revisionEstado: "RECHAZADO",
      revisionNota: "Reembolsado fuera del CRM",
    })
  )

  mocks.store.pagos.set(
    PAGO_HITO_OCUPADO,
    basePago({
      id: PAGO_HITO_OCUPADO,
      hitoId: HITO_OCUPADO,
      externalId: "CAPTURE-OCUPADO",
      paypalOrderId: "ORDER-OCUPADO",
    })
  )

  mocks.store.hitos.set(HITO_1, {
    id: HITO_1,
    estado: "PENDIENTE",
    pagadoEn: null,
    monto: 10656,
    mpLink: "https://mp.example/hito-1",
  })

  mocks.store.hitos.set(HITO_2, {
    id: HITO_2,
    estado: "PENDIENTE",
    pagadoEn: null,
    monto: 10656,
    mpLink: null,
  })

  mocks.store.hitos.set(HITO_OCUPADO, {
    id: HITO_OCUPADO,
    estado: "PAGADO",
    pagadoEn: PAGADO_EN,
    monto: 10656,
    mpLink: null,
  })

  mocks.store.suscripciones.set(SUSC_1, {
    id: SUSC_1,
    estado: "ACTIVE",
    proximoPago: PROXIMO_PAGO,
    pastDueEn: null,
    canceladoEn: null,
    plan: "SOPORTE",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stress.pagoStale = null
  mocks.stress.pagoUpdateManyError = null
  mocks.stress.suscripcionConflicto = false
  resetStore()

  mocks.requireAdmin.mockResolvedValue(ADMIN)
  mocks.rateLimit.mockReturnValue(true)
})

describe("POST /api/admin/paypal/revision: permisos y rate limit (AC-17)", () => {
  it("responde 403 a la asistente o a un usuario sin rol admin sin tocar la base", async () => {
    mocks.requireAdmin.mockResolvedValue(null)

    const res = await POST(request(body()))

    expect(res.status).toBe(403)
    expectNoStore(res)
    expect(await json(res)).toEqual({ error: "No autorizado" })
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1)
    expect(mocks.$transaction).not.toHaveBeenCalled()
    expect(mocks.pagoFindUnique).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("REVISION")
  })

  it("aplica rate limit de 20/min antes de autenticar", async () => {
    mocks.rateLimit.mockReturnValue(false)

    const res = await POST(request(body()))

    expect(res.status).toBe(429)
    expectNoStore(res)
    expect(await json(res)).toEqual({ error: "Demasiadas solicitudes" })
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      expect.stringContaining("admin-paypal-revision:"),
      20,
      60_000
    )
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/revision: validacion del body (AC-17, AC-27)", () => {
  it("responde 400 con JSON invalido", async () => {
    const res = await POST(request("{"))

    expect(res.status).toBe(400)
    expectNoStore(res)
    expect(await json(res)).toEqual({ error: "JSON invalido" })
    expect(mocks.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["sin pagoId", { accion: "ACEPTAR" }],
    ["con pagoId vacio", body({ pagoId: "" })],
    ["con pagoId demasiado largo", body({ pagoId: "x".repeat(101) })],
    ["sin accion", { pagoId: PAGO_HITO }],
    ["con accion invalida", body({ accion: "APROBAR" })],
    ["con accion en minusculas", body({ accion: "aceptar" })],
    ["con nota demasiado larga", body({ nota: "x".repeat(2_001) })],
    ["con nota no textual", body({ nota: 123 })],
    ["con nota con caracteres de control", body({ nota: "ok\u0000" })],
    ["con PII del pagador", body({ pagadorEmail: "pagador@example.com" })],
    ["con nombre del pagador", body({ pagadorNombre: "Pagador Ejemplo" })],
    ["con un campo desconocido", body({ campoExtra: true })],
  ])("responde 400 %s sin resolver el pago", async (_caso, payload) => {
    const res = await POST(request(payload))

    expect(res.status).toBe(400)
    expectNoStore(res)
    expect(await json(res)).toEqual({ error: "Datos invalidos" })
    expect(mocks.$transaction).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_HITO).estadoPago).toBe("REVISION")
  })

  it("acepta una nota de 2000 caracteres y una nota null", async () => {
    const largo = await POST(
      request(body({ pagoId: PAGO_RECHAZADO, accion: "RECHAZAR", nota: "x".repeat(2_000) }))
    )
    // PAGO_RECHAZADO ya no esta PENDIENTE: la validacion del body pasa y el
    // rechazo funcional responde 409 antes de tocar nada.
    expect(largo.status).toBe(409)

    const nulo = await POST(
      request(body({ pagoId: PAGO_HITO, accion: "RECHAZAR", nota: null }))
    )
    expect(nulo.status).toBe(200)
  })
})

describe("POST /api/admin/paypal/revision: pago y estado (AC-11, AC-27)", () => {
  it("responde 404 si el pago no existe", async () => {
    const res = await POST(request(body({ pagoId: "no_existe" })))

    expect(res.status).toBe(404)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "Pago PayPal en revision no encontrado.",
    })
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })

  it("responde 404 y no toca un pago de Mercado Pago", async () => {
    const res = await POST(request(body({ pagoId: PAGO_MP })))

    expect(res.status).toBe(404)
    expectNoStore(res)
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_MP).estadoPago).toBe("REVISION")
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
  })

  it("responde 409 si el pago ya esta SUCCEEDED", async () => {
    const res = await POST(request(body({ pagoId: PAGO_SUCCEEDED })))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El pago no esta pendiente de revision.",
    })
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(pago(PAGO_SUCCEEDED).reciboId).toBe(RECIBO_PREVIO)
  })

  it.each([
    ["ACEPTADO", PAGO_ACEPTADO],
    ["RECHAZADO", PAGO_RECHAZADO],
  ])(
    "responde 409 si la revision ya fue %s sin volver a resolverla",
    async (_estado, pagoId) => {
      const antes = structuredClone(pago(pagoId))

      const res = await POST(request(body({ pagoId })))

      expect(res.status).toBe(409)
      expectNoStore(res)
      expect(pago(pagoId)).toEqual(antes)
      expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    }
  )

  it("responde 409 si un pago REVISION no tiene revisionEstado PENDIENTE", async () => {
    Object.assign(pago(PAGO_HITO), { revisionEstado: null })

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El pago no esta pendiente de revision.",
    })
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/revision: ACEPTAR hito (AC-11, AC-27)", () => {
  it("aplica el hito, ajusta el desglose al monto capturado y emite recibo", async () => {
    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expectNoStore(res)

    const payload = await json(res)
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        pagoId: PAGO_HITO,
        accion: "ACEPTAR",
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        revisionResueltaPor: STAFF_RESUELTO,
        hitoAplicado: true,
        mesesAcreditados: null,
        monto: 10000,
        montoAcordado: 9394,
        comision: 606,
        montoEsperado: 10656,
      })
    )
    expect(String(payload.reciboId)).toMatch(/^PAY-\d{8}-[A-F0-9]{12}$/)
    expect(typeof payload.reciboEmitidoEn).toBe("string")
    expect(typeof payload.revisionResueltaEn).toBe("string")

    const actualizado = pago(PAGO_HITO)
    expect(actualizado).toEqual(
      expect.objectContaining({
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        revisionResueltaPor: STAFF_RESUELTO,
        reciboId: payload.reciboId,
        monto: 10000,
        montoAcordado: 9394,
        comision: 606,
        // El monto esperado original se conserva para auditoria.
        montoEsperado: 10656,
        // El pago sigue siendo visible y filtrable por PayPal en el historial.
        pasarela: "PAYPAL",
        metodo: "PAYPAL",
        moneda: "usd",
        externalId: "CAPTURE-HITO",
        paypalOrderId: "ORDER-HITO",
      })
    )
    expect(actualizado.revisionResueltaEn).toBeInstanceOf(Date)
    expect(actualizado.reciboEmitidoEn).toBeInstanceOf(Date)
    // El recibo reconcile exactamente.
    expect(
      (actualizado.montoAcordado as number) + (actualizado.comision as number)
    ).toBe(actualizado.monto)

    expect(hito(HITO_1).estado).toBe("PAGADO")
    expect(hito(HITO_1).pagadoEn).toBeInstanceOf(Date)
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()

    // La reserva de la resolucion es condicional por pasarela/estado/revision.
    expect(mocks.pagoUpdateMany).toHaveBeenCalledWith({
      where: {
        id: PAGO_HITO,
        pasarela: "PAYPAL",
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
      },
      data: expect.objectContaining({
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        revisionResueltaPor: STAFF_RESUELTO,
        montoAcordado: 9394,
        comision: 606,
        reciboId: payload.reciboId,
      }),
    })
  })

  it("conserva el monto esperado y deja comision 0 si la comision no entra en el monto", async () => {
    Object.assign(pago(PAGO_HITO), {
      monto: 500,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
    })

    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    const payload = await json(res)
    expect(payload).toEqual(
      expect.objectContaining({
        monto: 500,
        montoAcordado: 500,
        comision: 0,
        montoEsperado: 10656,
      })
    )
    expect(pago(PAGO_HITO).montoAcordado).toBe(500)
    expect(pago(PAGO_HITO).comision).toBe(0)
    expect(pago(PAGO_HITO).montoEsperado).toBe(10656)
    expect(String(pago(PAGO_HITO).reciboId)).toMatch(/^PAY-/)
  })

  it("emite un recibo distinto por cada pago aceptado", async () => {
    const primero = await POST(request(body()))
    const primeroPayload = await json(primero)

    const segundo = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )
    const segundoPayload = await json(segundo)

    expect(primero.status).toBe(200)
    expect(segundo.status).toBe(200)
    expect(primeroPayload.reciboId).not.toBe(segundoPayload.reciboId)
    expect(pago(PAGO_HITO).reciboId).toBe(primeroPayload.reciboId)
    expect(pago(PAGO_SOPORTE).reciboId).toBe(segundoPayload.reciboId)
  })
})

describe("POST /api/admin/paypal/revision: ACEPTAR soporte (AC-11, AC-27)", () => {
  it("acredita los meses del pago, deja el soporte ACTIVE y emite recibo", async () => {
    const res = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )

    expect(res.status).toBe(200)
    expectNoStore(res)

    const payload = await json(res)
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        pagoId: PAGO_SOPORTE,
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        hitoAplicado: false,
        mesesAcreditados: 2,
        monto: 19500,
        montoAcordado: 18368,
        comision: 1132,
        montoEsperado: 20000,
      })
    )
    expect(String(payload.reciboId)).toMatch(/^PAY-/)

    expect(pago(PAGO_SOPORTE)).toEqual(
      expect.objectContaining({
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        montoAcordado: 18368,
        comision: 1132,
        montoEsperado: 20000,
        reciboId: payload.reciboId,
      })
    )
    expect(pago(PAGO_SOPORTE).reciboEmitidoEn).toBeInstanceOf(Date)
    // El recibo reconcile exactamente con el monto capturado.
    expect(
      (pago(PAGO_SOPORTE).montoAcordado as number) +
        (pago(PAGO_SOPORTE).comision as number)
    ).toBe(pago(PAGO_SOPORTE).monto)
    expect(pago(PAGO_SOPORTE).montoEsperado).toBe(20000)

    expect(suscripcion()).toEqual(
      expect.objectContaining({
        estado: "ACTIVE",
        proximoPago: addMonths(PROXIMO_PAGO, 2),
        pastDueEn: null,
        canceladoEn: null,
      })
    )
    expect(mocks.suscripcionUpdateMany).toHaveBeenCalledWith({
      where: { id: SUSC_1, proximoPago: PROXIMO_PAGO },
      data: {
        estado: "ACTIVE",
        proximoPago: addMonths(PROXIMO_PAGO, 2),
        pastDueEn: null,
        canceladoEn: null,
      },
    })
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
  })

  it.each([0, 13, 1.5])(
    "responde 409 y revierte todo si los meses guardados son %s",
    async (meses) => {
      Object.assign(pago(PAGO_SOPORTE), { meses })

      const res = await POST(
        request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
      )

      expect(res.status).toBe(409)
      expectNoStore(res)
      expect((await json(res)).error).toContain("meses")
      expect(pago(PAGO_SOPORTE)).toEqual(
        expect.objectContaining({
          estadoPago: "REVISION",
          revisionEstado: "PENDIENTE",
          reciboId: null,
          reciboEmitidoEn: null,
        })
      )
      expect(suscripcion().proximoPago).toEqual(PROXIMO_PAGO)
      expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()
    }
  )

  it("responde 409 y revierte el pago si el soporte no existe", async () => {
    Object.assign(pago(PAGO_SOPORTE), { suscripcionId: "suscripcion_inexistente" })

    const res = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El soporte vinculado al pago no existe.",
    })
    expect(pago(PAGO_SOPORTE)).toEqual(
      expect.objectContaining({
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        reciboId: null,
      })
    )
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })

  it("la segunda aceptacion no vuelve a acreditar meses ni emite otro recibo", async () => {
    const primera = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )
    expect(primera.status).toBe(200)

    const proximoPago = suscripcion().proximoPago
    const reciboId = pago(PAGO_SOPORTE).reciboId
    expect(reciboId).toBe((await json(primera)).reciboId)

    const segunda = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )

    expect(segunda.status).toBe(409)
    expectNoStore(segunda)
    expect(await json(segunda)).toEqual({
      error: "El pago no esta pendiente de revision.",
    })
    expect(suscripcion().proximoPago).toEqual(proximoPago)
    expect(pago(PAGO_SOPORTE).reciboId).toBe(reciboId)
    expect(mocks.suscripcionUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("revierte el pago y el recibo si el vencimiento cambio por otra operacion", async () => {
    // La lectura ve el vencimiento original, pero el CAS del update no coincide
    // porque otra transaccion ya acredito meses: se revierte todo.
    mocks.stress.suscripcionConflicto = true

    const res = await POST(
      request(body({ pagoId: PAGO_SOPORTE, accion: "ACEPTAR" }))
    )

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El pago ya fue resuelto por otra operacion.",
    })
    expect(pago(PAGO_SOPORTE)).toEqual(
      expect.objectContaining({
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        reciboId: null,
        reciboEmitidoEn: null,
      })
    )
    // El ajuste del desglose tambien se revierte.
    expect(pago(PAGO_SOPORTE).montoAcordado).toBe(18868)
    expect(pago(PAGO_SOPORTE).comision).toBe(1132)
    expect(suscripcion().proximoPago).toEqual(PROXIMO_PAGO)
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/paypal/revision: RECHAZAR (AC-11, AC-27)", () => {
  it("deja el pago en REVISION/RECHAZADO, registra nota/staff/fecha y no aplica nada", async () => {
    const res = await POST(
      request(
        body({
          accion: "RECHAZAR",
          nota: "El cliente pagara la diferencia por transferencia",
        })
      )
    )

    expect(res.status).toBe(200)
    expectNoStore(res)

    const payload = await json(res)
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        pagoId: PAGO_HITO,
        accion: "RECHAZAR",
        estadoPago: "REVISION",
        revisionEstado: "RECHAZADO",
        revisionNota: "El cliente pagara la diferencia por transferencia",
        revisionResueltaPor: STAFF_RESUELTO,
        reciboId: null,
        reciboEmitidoEn: null,
        hitoAplicado: false,
        mesesAcreditados: null,
      })
    )
    expect(typeof payload.revisionResueltaEn).toBe("string")

    expect(pago(PAGO_HITO)).toEqual(
      expect.objectContaining({
        estadoPago: "REVISION",
        revisionEstado: "RECHAZADO",
        revisionNota: "El cliente pagara la diferencia por transferencia",
        revisionResueltaPor: STAFF_RESUELTO,
        reciboId: null,
        reciboEmitidoEn: null,
      })
    )
    expect(pago(PAGO_HITO).revisionResueltaEn).toBeInstanceOf(Date)
    expect(pago(PAGO_HITO).montoAcordado).toBe(10050)
    expect(pago(PAGO_HITO).comision).toBe(606)

    // No se aplica el concepto ni se emite recibo.
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(hito(HITO_1).pagadoEn).toBeNull()
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()
  })

  it("limpia el recibo previo si el pago rechazado ya tenia uno", async () => {
    const RECIBO_PREVIO_REVISION = "PAY-20261020-PREVIO123456"
    Object.assign(pago(PAGO_HITO), {
      reciboId: RECIBO_PREVIO_REVISION,
      reciboEmitidoEn: PAGADO_EN,
    })

    const res = await POST(
      request(body({ pagoId: PAGO_HITO, accion: "RECHAZAR" }))
    )

    expect(res.status).toBe(200)
    expect(pago(PAGO_HITO).revisionEstado).toBe("RECHAZADO")
    expect(pago(PAGO_HITO).reciboId).toBeNull()
    expect(pago(PAGO_HITO).reciboEmitidoEn).toBeNull()
    expect((await json(res)).reciboId).toBeNull()
  })

  it("conserva el motivo original cuando no se envia nota", async () => {
    const res = await POST(
      request(body({ pagoId: PAGO_MONEDA, accion: "RECHAZAR" }))
    )

    expect(res.status).toBe(200)
    expect(pago(PAGO_MONEDA).revisionNota).toBe(NOTA_MONEDA)
    expect(pago(PAGO_MONEDA).revisionEstado).toBe("RECHAZADO")
    expect(hito(HITO_2).estado).toBe("PENDIENTE")
  })

  it("combina el motivo original y la nota del rechazo sin perder trazabilidad", async () => {
    const res = await POST(
      request(
        body({
          pagoId: PAGO_MONEDA,
          accion: "RECHAZAR",
          nota: "Se solicito reembolso",
        })
      )
    )

    expect(res.status).toBe(200)
    expect(pago(PAGO_MONEDA).revisionNota).toBe(
      `${NOTA_MONEDA} | Se solicito reembolso`
    )
  })
})

describe("POST /api/admin/paypal/revision: diferencia de moneda (AC-27)", () => {
  it("no acepta una revision por moneda aunque se envie una nota", async () => {
    const antes = structuredClone(pago(PAGO_MONEDA))

    const res = await POST(
      request(
        body({
          pagoId: PAGO_MONEDA,
          accion: "ACEPTAR",
          nota: "Confirmo la conversion y el monto informado por PayPal",
        })
      )
    )

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect((await json(res)).error).toContain("moneda")
    expect(pago(PAGO_MONEDA)).toEqual(antes)
    expect(pago(PAGO_MONEDA).reciboId).toBeNull()
    expect(pago(PAGO_MONEDA).estadoPago).toBe("REVISION")
    expect(hito(HITO_2).estado).toBe("PENDIENTE")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(eventos()).toHaveLength(0)
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "No se pudo resolver la revision del pago PayPal",
      expect.objectContaining({
        pasarela: "PAYPAL",
        externalId: "CAPTURE-MONEDA",
        enlaceId: "enlace_1",
        moneda: "usd",
        codigo: "MONEDA_NO_ACEPTABLE",
      })
    )
  })

  it("no acepta un pago con Pago.moneda distinto de usd", async () => {
    Object.assign(pago(PAGO_HITO), { moneda: "ars" })
    const antes = structuredClone(pago(PAGO_HITO))

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect((await json(res)).error).toContain("moneda")
    expect(pago(PAGO_HITO)).toEqual(antes)
    expect(pago(PAGO_HITO).reciboId).toBeNull()
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(eventos()).toHaveLength(0)

    // Una moneda no USD solo se puede rechazar, nunca aceptar.
    const rechazo = await POST(
      request(body({ pagoId: PAGO_HITO, accion: "RECHAZAR" }))
    )
    expect(rechazo.status).toBe(200)
    expect(pago(PAGO_HITO).revisionEstado).toBe("RECHAZADO")
    expect(pago(PAGO_HITO).moneda).toBe("ars")
  })

  it("detecta 'Moneda capturada desconocida' y 'MONEDA: EUR' sin aceptarlas", async () => {
    Object.assign(pago(PAGO_HITO), { revisionNota: MOTIVO_MONEDA_DESCONOCIDA })
    const antes = structuredClone(pago(PAGO_HITO))

    expect(esRevisionPorMoneda(MOTIVO_MONEDA_DESCONOCIDA)).toBe(true)

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect((await json(res)).error).toContain("moneda")
    expect(pago(PAGO_HITO)).toEqual(antes)
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(eventos()).toHaveLength(0)

    // La marca estructural alternativa `MONEDA:` tambien bloquea ACEPTAR.
    Object.assign(pago(PAGO_HITO), { revisionNota: "MONEDA: EUR" })
    const antesEur = structuredClone(pago(PAGO_HITO))

    const resEur = await POST(request(body()))

    expect(resEur.status).toBe(409)
    expectNoStore(resEur)
    expect((await json(resEur)).error).toContain("moneda")
    expect(pago(PAGO_HITO)).toEqual(antesEur)
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(eventos()).toHaveLength(0)
  })

  it("permite RECHAZAR una diferencia de moneda y conserva el motivo original", async () => {
    const res = await POST(
      request(body({ pagoId: PAGO_MONEDA, accion: "RECHAZAR" }))
    )

    expect(res.status).toBe(200)
    expectNoStore(res)
    expect(pago(PAGO_MONEDA).revisionEstado).toBe("RECHAZADO")
    expect(pago(PAGO_MONEDA).revisionNota).toBe(NOTA_MONEDA)
    expect(pago(PAGO_MONEDA).estadoPago).toBe("REVISION")
    expect(pago(PAGO_MONEDA).reciboId).toBeNull()
    expect(hito(HITO_2).estado).toBe("PENDIENTE")
    expect(eventos()).toHaveLength(1)
  })
})

describe("POST /api/admin/paypal/revision: referencia externa (AC-10, AC-27)", () => {
  it("no acepta un pago sin externalId ni paypalOrderId", async () => {
    Object.assign(pago(PAGO_HITO), {
      externalId: null,
      paypalOrderId: null,
    })
    const antes = structuredClone(pago(PAGO_HITO))

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect((await json(res)).error).toContain("referencia")
    expect(pago(PAGO_HITO)).toEqual(antes)
    expect(pago(PAGO_HITO).reciboId).toBeNull()
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(eventos()).toHaveLength(0)
  })

  it("acepta si el pago tiene solo paypalOrderId", async () => {
    Object.assign(pago(PAGO_HITO), {
      externalId: null,
      paypalOrderId: "ORDER-SOLO",
    })

    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expect(String(pago(PAGO_HITO).reciboId)).toMatch(/^PAY-/)
    expect(hito(HITO_1).estado).toBe("PAGADO")
  })
})

describe("POST /api/admin/paypal/revision: EventoPasarela (AC-11, AC-19)", () => {
  it("persiste la aceptacion con accion, staff, montos originales y resolucion", async () => {
    const res = await POST(
      request(
        body({
          nota: "Contacto del pagador: pagador@example.com",
        })
      )
    )

    expect(res.status).toBe(200)
    const payload = await json(res)
    expect(payload).toEqual(
      expect.objectContaining({
        pasarela: "PAYPAL",
        externalId: "CAPTURE-HITO",
        enlaceId: "enlace_1",
        moneda: "usd",
      })
    )

    expect(eventos()).toHaveLength(1)
    const evento = eventos()[0]
    expect(evento).toEqual(
      expect.objectContaining({
        pasarela: "PAYPAL",
        tipo: "REVISION.PAYPAL.ACEPTAR",
        resultado: "PROCESADO",
        externalId: "CAPTURE-HITO",
        enlacePagoId: "enlace_1",
        pagoId: PAGO_HITO,
        monto: 10000,
        moneda: "usd",
        requiereAccion: false,
      })
    )
    expect(evento.procesadoEn).toBeInstanceOf(Date)
    const motivo = String(evento.motivo)
    expect(motivo).toContain("ACEPTADO")
    expect(motivo).toContain("staff=admin_1")
    expect(motivo).toContain("monto=10000")
    expect(motivo).toContain("montoAcordado=10050")
    expect(motivo).toContain("comision=606")
    expect(motivo).toContain("montoEsperado=10656")
    // Sin PII del pagador ni el nombre visible del staff en el evento.
    expect(motivo).not.toContain("pagador@example.com")
    expect(motivo).not.toContain("Ana Admin")

    // Los logs estructurados incluyen pasarela, referencia y enlace.
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      "Revision de pago PayPal resuelta",
      expect.objectContaining({
        pasarela: "PAYPAL",
        externalId: "CAPTURE-HITO",
        enlaceId: "enlace_1",
        moneda: "usd",
      })
    )
  })

  it("persiste el rechazo como requiere accion sin incluir la nota", async () => {
    const res = await POST(
      request(
        body({
          pagoId: PAGO_MONEDA,
          accion: "RECHAZAR",
          nota: "Contacto del pagador: pagador@example.com",
        })
      )
    )

    expect(res.status).toBe(200)
    expect(eventos()).toHaveLength(1)
    const evento = eventos()[0]
    expect(evento).toEqual(
      expect.objectContaining({
        pasarela: "PAYPAL",
        tipo: "REVISION.PAYPAL.RECHAZAR",
        resultado: "REQUIERE_ACCION",
        externalId: "CAPTURE-MONEDA",
        enlacePagoId: "enlace_1",
        pagoId: PAGO_MONEDA,
        monto: 10656,
        moneda: "usd",
        requiereAccion: true,
      })
    )
    const motivo = String(evento.motivo)
    expect(motivo).toContain("RECHAZADO")
    expect(motivo).toContain("staff=admin_1")
    expect(motivo).toContain("montoAcordado=10050")
    expect(motivo).toContain("comision=606")
    expect(motivo).toContain("montoEsperado=10656")
    expect(motivo).not.toContain("pagador@example.com")
    expect(motivo).not.toContain("Se solicito")

    // El log del rechazo tambien identifica pasarela, referencia y enlace.
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      "Revision de pago PayPal resuelta",
      expect.objectContaining({
        pasarela: "PAYPAL",
        externalId: "CAPTURE-MONEDA",
        enlaceId: "enlace_1",
        moneda: "usd",
        estadoPago: "REVISION",
        revisionEstado: "RECHAZADO",
      })
    )
  })
})

describe("POST /api/admin/paypal/revision: sin doble aplicacion (AC-11)", () => {
  it("la segunda aceptacion responde 409 y no reaplica hito ni recibo", async () => {
    const primera = await POST(request(body()))
    expect(primera.status).toBe(200)
    const primerPayload = await json(primera)

    const pagadoEn = hito(HITO_1).pagadoEn
    const reciboId = pago(PAGO_HITO).reciboId
    expect(reciboId).toBe(primerPayload.reciboId)

    const segunda = await POST(request(body()))

    expect(segunda.status).toBe(409)
    expectNoStore(segunda)
    expect(await json(segunda)).toEqual({
      error: "El pago no esta pendiente de revision.",
    })
    expect(hito(HITO_1).pagadoEn).toEqual(pagadoEn)
    expect(pago(PAGO_HITO).reciboId).toBe(reciboId)
    expect(mocks.pagoUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.hitoUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("revierte si otra transaccion gano entre la lectura y el update condicional", async () => {
    // La lectura ve PENDIENTE (stale), pero el update condicional se encuentra
    // con un pago ya ACEPTADO por otra operacion: count 0 -> conflicto.
    mocks.stress.pagoStale = structuredClone(pago(PAGO_HITO))
    Object.assign(pago(PAGO_HITO), {
      estadoPago: "SUCCEEDED",
      revisionEstado: "ACEPTADO",
      reciboId: "PAY-20261026-OTRA123456",
      reciboEmitidoEn: PAGADO_EN,
    })

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El pago ya fue resuelto por otra operacion.",
    })
    expect(pago(PAGO_HITO).estadoPago).toBe("SUCCEEDED")
    expect(pago(PAGO_HITO).reciboId).toBe("PAY-20261026-OTRA123456")
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
  })

  it("revierte el pago y el recibo si el hito dejo de estar PENDIENTE", async () => {
    const res = await POST(request(body({ pagoId: PAGO_HITO_OCUPADO })))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El hito no esta pendiente y no se puede aplicar el pago.",
    })

    // La transaccion se revierte completa: el pago no queda SUCCEEDED ni con
    // recibo, y el hito conserva su fecha original.
    expect(pago(PAGO_HITO_OCUPADO)).toEqual(
      expect.objectContaining({
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        reciboId: null,
        reciboEmitidoEn: null,
      })
    )
    expect(pago(PAGO_HITO_OCUPADO).montoAcordado).toBe(10050)
    expect(pago(PAGO_HITO_OCUPADO).comision).toBe(606)
    expect(hito(HITO_OCUPADO).estado).toBe("PAGADO")
    expect(hito(HITO_OCUPADO).pagadoEn).toEqual(PAGADO_EN)
    expect(mocks.hitoUpdateMany).toHaveBeenCalledWith({
      where: { id: HITO_OCUPADO, estado: "PENDIENTE" },
      data: { estado: "PAGADO", pagadoEn: expect.any(Date) },
    })
  })
})

describe("POST /api/admin/paypal/revision: rollback y errores (AC-27)", () => {
  it("responde 409 y no toca nada si el monto capturado es invalido", async () => {
    Object.assign(pago(PAGO_HITO), { monto: 0 })

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "El monto capturado del pago no es un entero USD positivo.",
    })
    expect(pago(PAGO_HITO).estadoPago).toBe("REVISION")
    expect(pago(PAGO_HITO).reciboId).toBeNull()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["sin hito ni soporte", { hitoId: null, suscripcionId: null }],
    ["con hito y soporte a la vez", { hitoId: HITO_1, suscripcionId: SUSC_1 }],
  ])("responde 409 si el pago no tiene un unico concepto %s", async (_caso, overrides) => {
    Object.assign(pago(PAGO_HITO), overrides)

    const res = await POST(request(body()))

    expect(res.status).toBe(409)
    expectNoStore(res)
    expect((await json(res)).error).toContain("unico concepto")
    expect(pago(PAGO_HITO).estadoPago).toBe("REVISION")
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
  })

  it("responde 500, reporta a Sentry y revierte si la base falla", async () => {
    mocks.stress.pagoUpdateManyError = new Error("db caida")

    const res = await POST(
      request(
        body({
          nota: "pagador@example.com confirmo",
        })
      )
    )

    expect(res.status).toBe(500)
    expectNoStore(res)
    expect(await json(res)).toEqual({
      error: "Error al resolver la revision del pago de PayPal.",
    })
    expect(mocks.sentryCaptureException).toHaveBeenCalledTimes(1)
    // El reporte a Sentry no incluye la nota ni el email del pagador.
    expect(JSON.stringify(mocks.sentryCaptureException.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(pago(PAGO_HITO)).toEqual(
      expect.objectContaining({
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        reciboId: null,
      })
    )
    expect(hito(HITO_1).estado).toBe("PENDIENTE")
  })

  it("usa Admin y el id estable como resolvedor si el admin no tiene nombre visible", async () => {
    mocks.requireAdmin.mockResolvedValue({ ...ADMIN, nombre: "" })

    const res = await POST(request(body()))

    expect(res.status).toBe(200)
    expect(pago(PAGO_HITO).revisionResueltaPor).toBe("Admin (admin_1)")
  })
})

describe("POST /api/admin/paypal/revision: PII y no-store (AC-19)", () => {
  it("no loguea la nota, el email ni datos del pagador", async () => {
    const res = await POST(
      request(
        body({
          accion: "RECHAZAR",
          nota: "Contacto del pagador: pagador@example.com",
        })
      )
    )

    expect(res.status).toBe(200)
    // La nota se guarda en el CRM (acceso admin) pero nunca se loguea.
    expect(pago(PAGO_HITO).revisionNota).toContain("pagador@example.com")
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "pagador@example.com"
    )
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain("nota")
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain(
      "pagador"
    )
    // El evento tecnico tampoco guarda la nota ni PII del pagador.
    expect(JSON.stringify(eventos())).not.toContain("pagador@example.com")
    expect(JSON.stringify(eventos())).not.toContain("pagador")
  })

  it("mantiene Cache-Control: no-store en todas las respuestas", async () => {
    const exitos = await POST(request(body()))
    expect(exitos.status).toBe(200)
    expectNoStore(exitos)

    const badRequest = await POST(request("{"))
    expect(badRequest.status).toBe(400)
    expectNoStore(badRequest)

    mocks.requireAdmin.mockResolvedValueOnce(null)
    const forbidden = await POST(request(body({ pagoId: PAGO_SOPORTE })))
    expect(forbidden.status).toBe(403)
    expectNoStore(forbidden)

    const notFound = await POST(request(body({ pagoId: "no_existe" })))
    expect(notFound.status).toBe(404)
    expectNoStore(notFound)

    const conflict = await POST(request(body({ pagoId: PAGO_SUCCEEDED })))
    expect(conflict.status).toBe(409)
    expectNoStore(conflict)

    // 500 (fallo de base): la respuesta tambien es no-store.
    mocks.stress.pagoUpdateManyError = new Error("db caida")
    const serverError = await POST(
      request(body({ pagoId: PAGO_SOPORTE }))
    )
    expect(serverError.status).toBe(500)
    expectNoStore(serverError)
    expect(eventos()).toHaveLength(1)

    mocks.rateLimit.mockReturnValueOnce(false)
    const limited = await POST(request(body()))
    expect(limited.status).toBe(429)
    expectNoStore(limited)
  })
})

describe("utilidades de revision", () => {
  it("detecta el motivo de moneda por el prefijo estructural de T-10/T-11", () => {
    expect(esRevisionPorMoneda(NOTA_MONEDA)).toBe(true)
    expect(esRevisionPorMoneda("MONEDA CAPTURADA eur; esperado USD.")).toBe(true)
    expect(esRevisionPorMoneda(MOTIVO_MONEDA_DESCONOCIDA)).toBe(true)
    expect(esRevisionPorMoneda("MONEDA: EUR")).toBe(true)
    expect(esRevisionPorMoneda(null)).toBe(false)
    expect(esRevisionPorMoneda("Diferencia de monto")).toBe(false)
    expect(esRevisionPorMoneda("Diferencia de moneda")).toBe(false)
    // La marca debe estar al inicio: una nota que solo la menciona no cuenta.
    expect(esRevisionPorMoneda("Nota: moneda capturada ARS")).toBe(false)
  })

  it("combina notas sin perder el motivo original", () => {
    expect(combinarNotaRevision(null, null)).toBeNull()
    expect(combinarNotaRevision("Motivo", null)).toBe("Motivo")
    expect(combinarNotaRevision(null, "Nota")).toBe("Nota")
    expect(combinarNotaRevision("Motivo", "Nota")).toBe("Motivo | Nota")
  })

  it("el servicio valida la accion antes de abrir una transaccion", async () => {
    await expect(
      resolverRevisionPaypal({
        pagoId: PAGO_HITO,
        accion: "APROBAR" as unknown as "ACEPTAR",
      })
    ).rejects.toMatchObject({ codigo: "ARGUMENTOS_INVALIDOS" })
    expect(mocks.$transaction).not.toHaveBeenCalled()
  })
})
