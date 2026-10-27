import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-12, partes A y B (AC-5, AC-6, AC-8, AC-9, AC-13, AC-19, AC-27):
 * idempotencia de `EventoPasarela`, primer pago gana e invalidacion de links
 * hermanos.
 *
 * Prisma esta mockeado con stores falsos: no hay base ni red. Se cubren:
 * - eventoId unico (reintento y P2002 devuelven el existente/duplicado);
 * - resultados y `requiereAccion`;
 * - ausencia de payload crudo y PII en el evento;
 * - registro del evento en exito, duplicado, conflicto/segundo pago, REVISION
 *   y error, sin cambiar los resultados de T-10/T-11; el fallo al registrar el
 *   evento es best-effort (no revierte el pago y deja un log sanitizado);
 * - dos captures del mismo link, dos links del mismo grupo (PayPal + legacy
 *   MP) y dos pagos simultaneos: un solo Pago/credito y el intento descartado
 *   trazado como `REQUIERE_ACCION`;
 * - invalidacion condicional (tambien en REVISION: un capture COMPLETED ya es
 *   un pago confirmado), rollback si el `count` es invalido, propagacion de
 *   `enlacePagoId` en errores dentro de la transaccion y ausencia de cambios
 *   sobre Hito/Suscripcion de Mercado Pago.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { logger } from "@/lib/logger"
import {
  registrarEventoPasarela,
  type EventoPasarelaDb,
  type RegistrarEventoPasarelaInput,
} from "@/lib/paypal/events"
import {
  procesarCapturaPaypal,
  type CapturaPaypalProcesable,
  type PaypalProcessDb,
  type ProcesarCapturaOpciones,
} from "@/lib/paypal/process"

const AHORA = new Date("2026-10-20T12:00:00.000Z")
const CAPTURE = "CAPTURE-IDEM-1"
const ORDER = "ORDER-IDEM-1"
const CAPTURE_2 = "CAPTURE-IDEM-2"
const ORDER_2 = "ORDER-IDEM-2"
const RECIBO = "PAY-20261020-IDEM00000001"
const EVENTO_ID = "WH-EVENTO-1"
const GRUPO_HITO = "hito:hito_1"
const GRUPO_SOPORTE = "soporte:suscripcion_1"
const MOTIVO_INVALIDACION = "OTRO_PAGO_GANO"

type Fila = Record<string, unknown>

function errorUnico(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

function eventoRegistrado(overrides: Fila = {}): Fila {
  return {
    id: "evento_previo",
    pasarela: "PAYPAL",
    eventoId: EVENTO_ID,
    tipo: "PAYMENT.CAPTURE.COMPLETED",
    externalId: CAPTURE,
    enlacePagoId: "enlace_1",
    pagoId: "pago_1",
    resultado: "PROCESADO",
    motivo: null,
    monto: 10656,
    moneda: "usd",
    requiereAccion: false,
    creadoEn: AHORA,
    procesadoEn: AHORA,
    ...overrides,
  }
}

interface OpcionesDbEventos {
  /** Fuerza P2002 en el `create` (simula una carrera). */
  p2002?: boolean
  /** Fila que devuelve `findUnique`; `null` simula que no se puede releer. */
  existente?: Fila | null
  /** Falla la relectura posterior al P2002. */
  findUniqueFalla?: boolean
}

function montarDbEventos(opciones: OpcionesDbEventos = {}) {
  const filas: Fila[] = []

  const create = vi.fn(async (args: { data: Fila }) => {
    if (opciones.p2002) throw errorUnico()

    const data = args.data
    if (filas.some((fila) => fila.eventoId === data.eventoId)) {
      throw errorUnico()
    }

    const nuevo = { id: `evento_${filas.length + 1}`, creadoEn: AHORA, ...data }
    filas.push(nuevo)
    return nuevo
  })

  const findUnique = vi.fn(async (args: { where: { eventoId: string } }) => {
    if (opciones.findUniqueFalla) throw new Error("db caida")
    if (opciones.existente !== undefined) return opciones.existente
    return filas.find((fila) => fila.eventoId === args.where.eventoId) ?? null
  })

  const db = {
    eventoPasarela: { create, findUnique },
  } as unknown as EventoPasarelaDb

  return { db, create, findUnique, filas }
}

function entradaEvento(
  overrides: Partial<RegistrarEventoPasarelaInput> = {}
): RegistrarEventoPasarelaInput {
  return {
    eventoId: EVENTO_ID,
    pasarela: "PAYPAL",
    tipo: "PAYMENT.CAPTURE.COMPLETED",
    externalId: CAPTURE,
    enlacePagoId: "enlace_1",
    pagoId: "pago_1",
    resultado: "PROCESADO",
    motivo: null,
    monto: 10656,
    moneda: "USD",
    procesadoEn: AHORA,
    ...overrides,
  }
}

function dataDelEvento(
  fake: ReturnType<typeof montarDbEventos>,
  indice = 0
): Fila {
  const llamada = fake.create.mock.calls[indice]
  if (!llamada) throw new Error("No se registro un EventoPasarela")
  return llamada[0].data
}

function enlaceBase(overrides: Fila = {}): Fila {
  return {
    id: "enlace_idem_1",
    token: "token_idem_1",
    clienteId: "cliente_1",
    hitoId: "hito_1",
    suscripcionId: null,
    pasarela: "PAYPAL",
    concepto: "Sitio ACME — Anticipo",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    meses: null,
    feeBps: 540,
    feeFixedCents: 30,
    externalId: ORDER,
    estado: "ACTIVO",
    grupoCobroId: GRUPO_HITO,
    hito: { id: "hito_1", estado: "PENDIENTE" },
    ...overrides,
  }
}

function enlaceSoporte(overrides: Fila = {}): Fila {
  return {
    ...enlaceBase({
      id: "enlace_soporte_1",
      token: "token_soporte_1",
      hitoId: null,
      suscripcionId: "suscripcion_1",
      concepto: "Soporte — 1 mes",
      montoAcordado: 5000,
      comision: 300,
      total: 5300,
      meses: 1,
      externalId: "ORDER-SOP-1",
      grupoCobroId: GRUPO_SOPORTE,
      hito: null,
      ...overrides,
    }),
  }
}

function capturaBase(
  overrides: Partial<CapturaPaypalProcesable> = {}
): CapturaPaypalProcesable {
  return {
    captureId: CAPTURE,
    orderId: ORDER,
    amountCents: 10656,
    currency: "USD",
    status: "COMPLETED",
    ...overrides,
  }
}

function pagoPrevio(overrides: Fila = {}): Fila {
  return {
    id: "pago_previo",
    externalId: "CAPTURE-OTRA",
    paypalOrderId: "ORDER-OTRA",
    enlacePagoId: "enlace_previo",
    hitoId: "hito_1",
    estadoPago: "SUCCEEDED",
    ...overrides,
  }
}

interface OpcionesDbProceso {
  enlaces?: Fila[]
  pagos?: Fila[]
  suscripciones?: Fila[]
  /** Oculta el Pago en las primeras N consultas para simular una carrera. */
  ocultarPagoHasta?: number
}

function montarDbProceso(opciones: OpcionesDbProceso = {}) {
  const enlaces = opciones.enlaces ?? [enlaceBase()]
  const pagos = [...(opciones.pagos ?? [])]
  const suscripciones = (
    opciones.suscripciones ?? [{ id: "suscripcion_1", proximoPago: null }]
  ).map((fila) => ({ ...fila }))
  const eventos: Fila[] = []

  function coincidePago(pago: Fila, where: Fila & { OR?: Fila[] }): boolean {
    if (Array.isArray(where.OR)) {
      const coincide = where.OR.some((cond) => {
        if (cond.externalId !== undefined) {
          return pago.externalId === cond.externalId
        }
        if (cond.paypalOrderId !== undefined) {
          return pago.paypalOrderId === cond.paypalOrderId
        }
        return false
      })
      if (!coincide) return false
    }
    if (where.hitoId !== undefined && pago.hitoId !== where.hitoId) return false
    if (where.estadoPago !== undefined && pago.estadoPago !== where.estadoPago) {
      return false
    }
    return true
  }

  const enlacePago = {
    findFirst: vi.fn(
      async (args: { where: { pasarela?: string; OR?: Fila[] } }) => {
        const condiciones = args.where.OR ?? []
        const encontrado = enlaces.find((enlace) => {
          if (enlace.pasarela !== args.where.pasarela) return false
          return condiciones.some((cond) => {
            if (cond.externalId !== undefined) {
              return enlace.externalId === cond.externalId
            }
            if (cond.token !== undefined) return enlace.token === cond.token
            return false
          })
        })
        return encontrado ?? null
      }
    ),
    update: vi.fn(async (args: { where: { id: string }; data: Fila }) => {
      const encontrado = enlaces.find((enlace) => enlace.id === args.where.id)
      if (!encontrado) throw new Error("Enlace no encontrado")
      Object.assign(encontrado, args.data)
      return {}
    }),
    // Invalidacion condicional de links hermanos: solo toca ACTIVOS del mismo
    // grupo distintos del ganador.
    updateMany: vi.fn(async (args: { where: Fila; data: Fila }) => {
      const where = args.where
      const filtroId = where.id as { not?: string } | string | undefined
      const filtroEstado = where.estado as
        | string
        | { notIn?: string[] }
        | undefined

      let count = 0
      for (const enlace of enlaces) {
        if (
          where.grupoCobroId !== undefined &&
          enlace.grupoCobroId !== where.grupoCobroId
        ) {
          continue
        }
        if (typeof filtroEstado === "string") {
          if (enlace.estado !== filtroEstado) continue
        } else if (
          filtroEstado?.notIn &&
          filtroEstado.notIn.includes(String(enlace.estado))
        ) {
          continue
        }
        if (typeof filtroId === "string") {
          if (enlace.id !== filtroId) continue
        } else if (filtroId?.not !== undefined && enlace.id === filtroId.not) {
          continue
        }

        Object.assign(enlace, args.data)
        count += 1
      }
      return { count }
    }),
  }

  const pago = {
    findFirst: vi.fn(async (args: { where: Fila & { OR?: Fila[] } }) => {
      llamadasPago += 1
      if (
        opciones.ocultarPagoHasta &&
        llamadasPago <= opciones.ocultarPagoHasta
      ) {
        return null
      }
      return pagos.find((fila) => coincidePago(fila, args.where)) ?? null
    }),
    create: vi.fn(async (args: { data: Fila }) => {
      const data = args.data
      const duplicado = pagos.some(
        (fila) =>
          (data.externalId !== undefined && fila.externalId === data.externalId) ||
          (data.paypalOrderId !== undefined &&
            fila.paypalOrderId === data.paypalOrderId)
      )
      if (duplicado) throw errorUnico()

      const nueva = { id: `pago_${pagos.length + 1}`, ...data }
      pagos.push(nueva)
      return { id: String(nueva.id) }
    }),
  }

  const hito = {
    updateMany: vi.fn(async () => ({ count: 1 })),
  }

  const suscripcion = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return suscripciones.find((fila) => fila.id === args.where.id) ?? null
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Fila }) => {
      const encontrada = suscripciones.find((fila) => fila.id === args.where.id)
      if (!encontrada) throw new Error("Suscripcion no encontrada")
      Object.assign(encontrada, args.data)
      return {}
    }),
    // CAS por proximoPago: si otra transaccion ya lo actualizo, count 0.
    updateMany: vi.fn(async (args: { where: Fila; data: Fila }) => {
      let count = 0
      for (const fila of suscripciones) {
        if (fila.id !== args.where.id) continue
        if ("proximoPago" in args.where) {
          const esperado = args.where.proximoPago ?? null
          const actual = fila.proximoPago ?? null
          const coincide =
            esperado instanceof Date && actual instanceof Date
              ? esperado.getTime() === actual.getTime()
              : esperado === actual
          if (!coincide) continue
        }
        Object.assign(fila, args.data)
        count += 1
      }
      return { count }
    }),
  }

  let llamadasPago = 0

  const eventoPasarela = {
    create: vi.fn(async (args: { data: Fila }) => {
      const data = args.data
      if (eventos.some((fila) => fila.eventoId === data.eventoId)) {
        throw errorUnico()
      }
      const nuevo = { id: `evento_${eventos.length + 1}`, creadoEn: AHORA, ...data }
      eventos.push(nuevo)
      return nuevo
    }),
    findUnique: vi.fn(async (args: { where: { eventoId: string } }) => {
      return eventos.find((fila) => fila.eventoId === args.where.eventoId) ?? null
    }),
  }

  const tx = { enlacePago, pago, hito, suscripcion }

  // Las transacciones se serializan como en una ejecucion serializable: la
  // segunda ve los cambios ya confirmados por la primera. En produccion, las
  // constraints unicas y los updates condicionales son la ultima barrera.
  let cola: Promise<unknown> = Promise.resolve()

  const db = {
    ...tx,
    eventoPasarela,
    // Store falso: al lanzar, restaura los cambios para imitar el rollback de
    // la transaccion interactiva de Prisma.
    $transaction: vi.fn((fn: (cliente: typeof tx) => Promise<unknown>) => {
      const ejecutar = async () => {
        const pagosSnapshot = pagos.map((fila) => ({ ...fila }))
        const enlacesSnapshot = enlaces.map((fila) => ({ ...fila }))
        const suscripcionesSnapshot = suscripciones.map((fila) => ({ ...fila }))
        try {
          return await fn(tx)
        } catch (error) {
          pagos.length = 0
          pagos.push(...pagosSnapshot)
          enlaces.length = 0
          enlaces.push(...enlacesSnapshot)
          suscripciones.length = 0
          suscripciones.push(...suscripcionesSnapshot)
          throw error
        }
      }

      const resultado = cola.then(ejecutar, ejecutar)
      cola = resultado.then(
        () => undefined,
        () => undefined
      )
      return resultado
    }),
  }

  return {
    db: db as unknown as PaypalProcessDb,
    enlaces,
    pagos,
    eventos,
    eventoPasarela,
    enlacePago,
    pago,
    hito,
    suscripcion,
  }
}

function opcionesProceso(
  fake: ReturnType<typeof montarDbProceso>,
  overrides: Partial<ProcesarCapturaOpciones> = {}
): ProcesarCapturaOpciones {
  return {
    db: fake.db,
    ahora: AHORA,
    nuevoReciboId: () => RECIBO,
    evento: { eventoId: EVENTO_ID, tipo: "PAYMENT.CAPTURE.COMPLETED" },
    ...overrides,
  }
}

function dataEventoProcesado(
  fake: ReturnType<typeof montarDbProceso>,
  indice = 0
): Fila {
  const llamada = fake.eventoPasarela.create.mock.calls[indice]
  if (!llamada) throw new Error("No se registro un EventoPasarela")
  return llamada[0].data
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("EventoPasarela: idempotencia y datos minimos", () => {
  it("persiste solo campos tecnicos y descarta payload crudo y PII", async () => {
    const fake = montarDbEventos()
    const entrada = {
      ...entradaEvento({
        motivo: "Contacto pagador@example.com",
        moneda: "USD",
      }),
      payload: {
        payer: {
          email_address: "pagador@example.com",
          name: { given_name: "Pagador" },
        },
      },
      payerEmail: "pagador@example.com",
      nombre: "Pagador",
    } as RegistrarEventoPasarelaInput

    const resultado = await registrarEventoPasarela(entrada, {
      db: fake.db,
      ahora: AHORA,
    })

    expect(resultado.duplicado).toBe(false)
    expect(resultado.evento).toMatchObject({
      eventoId: EVENTO_ID,
      resultado: "PROCESADO",
    })

    const data = dataDelEvento(fake)
    expect(data).toEqual({
      eventoId: EVENTO_ID,
      pasarela: "PAYPAL",
      tipo: "PAYMENT.CAPTURE.COMPLETED",
      externalId: CAPTURE,
      enlacePagoId: "enlace_1",
      pagoId: "pago_1",
      resultado: "PROCESADO",
      motivo: "Contacto [REDACTED]",
      monto: 10656,
      moneda: "usd",
      requiereAccion: false,
      procesadoEn: AHORA,
    })

    const serializado = JSON.stringify(data)
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Pagador")
    expect(data).not.toHaveProperty("payload")
    expect(data).not.toHaveProperty("payerEmail")
    expect(data).not.toHaveProperty("nombre")
  })

  it("un eventoId repetido devuelve el existente sin crear un segundo evento", async () => {
    const fake = montarDbEventos()
    const entrada = entradaEvento()

    const primera = await registrarEventoPasarela(entrada, {
      db: fake.db,
      ahora: AHORA,
    })
    const segunda = await registrarEventoPasarela(entrada, {
      db: fake.db,
      ahora: AHORA,
    })

    expect(primera).toMatchObject({ duplicado: false })
    expect(segunda).toMatchObject({
      duplicado: true,
      evento: { eventoId: EVENTO_ID, resultado: "PROCESADO" },
    })
    expect(fake.create).toHaveBeenCalledTimes(2)
    expect(fake.filas).toHaveLength(1)
  })

  it("P2002 devuelve el evento existente marcado como duplicado", async () => {
    const existente = eventoRegistrado()
    const fake = montarDbEventos({ p2002: true, existente })

    const resultado = await registrarEventoPasarela(entradaEvento(), {
      db: fake.db,
      ahora: AHORA,
    })

    expect(resultado).toEqual({ evento: existente, duplicado: true })
    expect(fake.findUnique).toHaveBeenCalledWith({
      where: { eventoId: EVENTO_ID },
    })
  })

  it("P2002 sin fila legible no lanza y se informa como duplicado", async () => {
    const fake = montarDbEventos({ p2002: true, findUniqueFalla: true })

    const resultado = await registrarEventoPasarela(entradaEvento(), {
      db: fake.db,
      ahora: AHORA,
    })

    expect(resultado).toEqual({ evento: null, duplicado: true })
  })

  it.each([
    ["PROCESADO", false],
    ["IGNORADO", false],
    ["DUPLICADO", false],
    ["REQUIERE_ACCION", true],
    ["FIRMA_INVALIDA", false],
    ["ERROR", false],
  ] as const)(
    "el resultado %s infiere requiereAccion=%s",
    async (resultado, esperado) => {
      const fake = montarDbEventos()

      await registrarEventoPasarela(
        entradaEvento({ resultado, eventoId: `WH-${resultado}` }),
        { db: fake.db, ahora: AHORA }
      )

      expect(dataDelEvento(fake)).toMatchObject({
        resultado,
        requiereAccion: esperado,
      })
    }
  )

  it("respeta requiereAccion explicito aunque el resultado no lo implique", async () => {
    const fake = montarDbEventos()

    await registrarEventoPasarela(
      entradaEvento({ resultado: "ERROR", requiereAccion: true }),
      { db: fake.db, ahora: AHORA }
    )

    expect(dataDelEvento(fake)).toMatchObject({
      resultado: "ERROR",
      requiereAccion: true,
    })
  })
})

describe("Procesador: evento en cada camino (AC-5, AC-6, AC-19, AC-27)", () => {
  it("registra PROCESADO en el camino exitoso sin cambiar el Pago de T-10", async () => {
    const fake = montarDbProceso()

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake)
    )

    expect(resultado).toMatchObject({
      tipo: "PROCESADO",
      pagoId: "pago_1",
      enlaceId: "enlace_idem_1",
    })
    expect(fake.pagos).toHaveLength(1)
    expect(fake.enlaces[0].estado).toBe("PAGADO")

    expect(dataEventoProcesado(fake)).toEqual({
      eventoId: EVENTO_ID,
      pasarela: "PAYPAL",
      tipo: "PAYMENT.CAPTURE.COMPLETED",
      externalId: CAPTURE,
      enlacePagoId: "enlace_idem_1",
      pagoId: "pago_1",
      resultado: "PROCESADO",
      motivo: null,
      monto: 10656,
      moneda: "usd",
      requiereAccion: false,
      procesadoEn: AHORA,
    })
  })

  it("un fallo al registrar el evento no cambia el pago exitoso (best-effort)", async () => {
    const fake = montarDbProceso()
    fake.eventoPasarela.create.mockRejectedValueOnce(new Error("db caida"))
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})

    try {
      const capturaConPii = {
        ...capturaBase(),
        payer: {
          email_address: "pagador@example.com",
          name: { given_name: "Pagador" },
        },
        payerEmail: "pagador@example.com",
      } as CapturaPaypalProcesable

      const resultado = await procesarCapturaPaypal(
        capturaConPii,
        opcionesProceso(fake)
      )

      expect(resultado).toMatchObject({
        tipo: "PROCESADO",
        pagoId: "pago_1",
        enlaceId: "enlace_idem_1",
        reciboId: RECIBO,
      })
      expect(fake.pagos).toHaveLength(1)
      expect(enlacePorId(fake, "enlace_idem_1")).toMatchObject({
        estado: "PAGADO",
      })
      expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)

      // El fallo de trazabilidad queda visible y sin PII; nunca revierte el pago.
      expect(warn).toHaveBeenCalledTimes(1)
      const [mensaje, meta] = warn.mock.calls[0]
      expect(mensaje).toBe("No se pudo registrar el evento de pasarela PayPal")
      expect(meta).toMatchObject({
        eventoId: EVENTO_ID,
        tipo: "PAYMENT.CAPTURE.COMPLETED",
        pasarela: "PAYPAL",
        resultado: "PROCESADO",
        enlacePagoId: "enlace_idem_1",
        pagoId: "pago_1",
        monto: 10656,
        moneda: "usd",
      })
      const serializado = JSON.stringify({ mensaje, meta })
      expect(serializado).not.toContain("pagador@example.com")
      expect(serializado).not.toContain("Pagador")
    } finally {
      warn.mockRestore()
    }
  })

  it("propaga enlacePagoId en errores posteriores a resolver el link", async () => {
    const fakeSoporte = montarDbProceso({
      enlaces: [enlaceSoporte({ meses: 0 })],
    })

    await expect(
      procesarCapturaPaypal(
        capturaSoporte(),
        opcionesProceso(fakeSoporte, {
          evento: { eventoId: "WH-MESES-INVALIDOS" },
        })
      )
    ).rejects.toMatchObject({ codigo: "MESES_INVALIDOS" })

    expect(eventoPorId(fakeSoporte, "WH-MESES-INVALIDOS")).toMatchObject({
      resultado: "ERROR",
      motivo: "MESES_INVALIDOS",
      enlacePagoId: "enlace_soporte_1",
      requiereAccion: false,
    })

    const fakeSinConcepto = montarDbProceso({
      enlaces: [enlaceBase({ hitoId: null, hito: null, suscripcionId: null })],
    })

    await expect(
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fakeSinConcepto, {
          evento: { eventoId: "WH-ENLACE-INVALIDO" },
        })
      )
    ).rejects.toMatchObject({ codigo: "ENLACE_INVALIDO" })

    expect(eventoPorId(fakeSinConcepto, "WH-ENLACE-INVALIDO")).toMatchObject({
      resultado: "ERROR",
      motivo: "ENLACE_INVALIDO",
      enlacePagoId: "enlace_idem_1",
      requiereAccion: false,
    })
  })

  it("registra DUPLICADO si el capture u order ya tienen Pago", async () => {
    const fake = montarDbProceso({
      pagos: [pagoPrevio({ externalId: CAPTURE })],
    })

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake)
    )

    expect(resultado).toMatchObject({
      tipo: "DUPLICADO",
      pagoId: "pago_previo",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(dataEventoProcesado(fake)).toMatchObject({
      resultado: "DUPLICADO",
      motivo: "DUPLICADO",
      pagoId: "pago_previo",
      enlacePagoId: "enlace_previo",
      requiereAccion: false,
    })
  })

  it("registra REQUIERE_ACCION con requiereAccion=true en un segundo pago", async () => {
    const fake = montarDbProceso({ pagos: [pagoPrevio()] })

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake)
    )

    expect(resultado).toMatchObject({
      tipo: "CONFLICTO",
      motivo: "PAGO_GANADOR",
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
    expect(dataEventoProcesado(fake)).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "PAGO_GANADOR",
      pagoId: "pago_previo",
      requiereAccion: true,
    })
  })

  it("registra REQUIERE_ACCION con requiereAccion=true en REVISION", async () => {
    const fake = montarDbProceso()

    const resultado = await procesarCapturaPaypal(
      capturaBase({ amountCents: 5000 }),
      opcionesProceso(fake)
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONTO",
    })
    expect(dataEventoProcesado(fake)).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "MONTO",
      pagoId: "pago_1",
      monto: 5000,
      requiereAccion: true,
    })
  })

  it("registra ERROR cuando no encuentra el link, sin romper el error tipado", async () => {
    const fake = montarDbProceso({ enlaces: [] })

    await expect(
      procesarCapturaPaypal(capturaBase(), opcionesProceso(fake))
    ).rejects.toMatchObject({
      codigo: "ENLACE_NO_ENCONTRADO",
      httpStatus: 404,
    })

    expect(dataEventoProcesado(fake)).toMatchObject({
      resultado: "ERROR",
      motivo: "ENLACE_NO_ENCONTRADO",
      externalId: CAPTURE,
      monto: 10656,
      moneda: "usd",
      requiereAccion: false,
    })
    expect(fake.pago.create).not.toHaveBeenCalled()
  })

  it("registra ERROR de una captura invalida antes de abrir la transaccion", async () => {
    const fake = montarDbProceso()

    await expect(
      procesarCapturaPaypal(
        capturaBase({ amountCents: null }),
        opcionesProceso(fake)
      )
    ).rejects.toMatchObject({ codigo: "CAPTURA_INVALIDA" })

    expect(dataEventoProcesado(fake)).toMatchObject({
      resultado: "ERROR",
      motivo: "CAPTURA_INVALIDA",
      monto: null,
      moneda: "usd",
      requiereAccion: false,
    })
    expect(fake.db.$transaction).not.toHaveBeenCalled()
  })

  it("sin evento explicito usa un eventoId sintetico estable por capture", async () => {
    const fake = montarDbProceso()

    await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: undefined })
    )

    expect(dataEventoProcesado(fake)).toMatchObject({
      eventoId: `PAYPAL:CAPTURA:${CAPTURE}`,
      tipo: "PAYMENT.CAPTURE.COMPLETED",
      resultado: "PROCESADO",
    })
  })

  it("no copia PII del pagador al EventoPasarela", async () => {
    const fake = montarDbProceso()
    const capturaConPii = {
      ...capturaBase(),
      payer: {
        email_address: "pagador@example.com",
        name: { given_name: "Pagador" },
      },
      payerEmail: "pagador@example.com",
    } as CapturaPaypalProcesable

    await procesarCapturaPaypal(capturaConPii, opcionesProceso(fake))

    const data = dataEventoProcesado(fake)
    const serializado = JSON.stringify(data)
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Pagador")
    expect(data).not.toHaveProperty("payer")
    expect(data).not.toHaveProperty("payerEmail")
  })
})

function eventoPorId(
  fake: ReturnType<typeof montarDbProceso>,
  eventoId: string
): Fila | undefined {
  return fake.eventos.find((evento) => evento.eventoId === eventoId)
}

function enlacePorId(
  fake: ReturnType<typeof montarDbProceso>,
  id: string
): Fila {
  const enlace = fake.enlaces.find((fila) => fila.id === id)
  if (!enlace) throw new Error(`No existe el enlace ${id}`)
  return enlace
}

function capturaSoporte(
  overrides: Partial<CapturaPaypalProcesable> = {}
): CapturaPaypalProcesable {
  return {
    captureId: "CAPTURE-SOP-1",
    orderId: "ORDER-SOP-1",
    amountCents: 5300,
    currency: "USD",
    status: "COMPLETED",
    ...overrides,
  }
}

describe("primer pago gana: invalidacion de hermanos (AC-8, AC-13)", () => {
  it("invalida el link MP legacy ACTIVO del mismo grupo sin tocar su concepto", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_mp_legacy_1",
          token: "token_mp_legacy_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-1",
          estado: "ACTIVO",
        }),
      ],
    })

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-PP-GANA" } })
    )

    expect(resultado).toMatchObject({
      tipo: "PROCESADO",
      enlaceId: "enlace_idem_1",
      hitoId: "hito_1",
    })

    // El link MP legacy queda invalidado con su motivo y fecha, conservado.
    expect(enlacePorId(fake, "enlace_mp_legacy_1")).toMatchObject({
      estado: "INVALIDADO",
      invalidadoEn: AHORA,
      motivoInvalido: MOTIVO_INVALIDACION,
    })
    // El ganador queda PAGADO y el hito se marca una sola vez.
    expect(enlacePorId(fake, "enlace_idem_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.hito.updateMany).toHaveBeenCalledWith({
      where: { id: "hito_1", estado: "PENDIENTE" },
      data: { estado: "PAGADO", pagadoEn: AHORA },
    })
    // No se acredita ni modifica nada del soporte por el link descartado.
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(fake.pagos).toHaveLength(1)

    expect(eventoPorId(fake, "WH-PP-GANA")).toMatchObject({
      resultado: "PROCESADO",
      enlacePagoId: "enlace_idem_1",
      pagoId: "pago_1",
      requiereAccion: false,
    })
  })

  it("invalida un link PayPal hermano y rechaza su capture posterior", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_idem_2",
          token: "token_idem_2",
          externalId: ORDER_2,
        }),
      ],
    })

    const primera = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-HERMANO-1" } })
    )
    expect(primera).toMatchObject({ tipo: "PROCESADO" })

    const segunda = await procesarCapturaPaypal(
      capturaBase({
        captureId: "CAPTURE-IDEM-3",
        orderId: ORDER_2,
      }),
      opcionesProceso(fake, { evento: { eventoId: "WH-HERMANO-2" } })
    )

    expect(segunda).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_INVALIDADO",
      enlaceId: "enlace_idem_2",
      hitoId: "hito_1",
      pagoId: null,
    })
    expect(enlacePorId(fake, "enlace_idem_2")).toMatchObject({
      estado: "INVALIDADO",
      motivoInvalido: MOTIVO_INVALIDACION,
    })
    expect(fake.pagos).toHaveLength(1)
    expect(eventoPorId(fake, "WH-HERMANO-2")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "ENLACE_INVALIDADO",
      requiereAccion: true,
    })
  })

  it("no invalida links ACTIVOS de otro grupo", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_otro_grupo",
          token: "token_otro_grupo",
          externalId: ORDER_2,
          grupoCobroId: "hito:hito_2",
          hitoId: "hito_2",
          hito: { id: "hito_2", estado: "PENDIENTE" },
        }),
      ],
    })

    await procesarCapturaPaypal(capturaBase(), opcionesProceso(fake))

    expect(enlacePorId(fake, "enlace_otro_grupo")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(enlacePorId(fake, "enlace_otro_grupo")).not.toHaveProperty(
      "motivoInvalido"
    )
  })

  it("usa updateMany condicional y verifica el count", async () => {
    const fake = montarDbProceso()

    await procesarCapturaPaypal(capturaBase(), opcionesProceso(fake))

    // La marca del ganador solo pisa un link sin dueno (excluye INVALIDADO y
    // PAGADO) y exige count 1.
    expect(fake.enlacePago.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enlace_idem_1",
        estado: { notIn: ["INVALIDADO", "PAGADO"] },
      },
      data: { estado: "PAGADO" },
    })
    // La invalidacion de hermanos es condicional por grupo y ACTIVO.
    expect(fake.enlacePago.updateMany).toHaveBeenCalledWith({
      where: {
        grupoCobroId: GRUPO_HITO,
        id: { not: "enlace_idem_1" },
        estado: "ACTIVO",
      },
      data: {
        estado: "INVALIDADO",
        invalidadoEn: AHORA,
        motivoInvalido: MOTIVO_INVALIDACION,
      },
    })
    // Count 0 (sin hermanos) es valido: no aborta el pago.
    expect(fake.pagos).toHaveLength(1)
  })

  it("revierte el pago si la invalidacion devuelve un count invalido", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_mp_legacy_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-1",
        }),
      ],
    })
    // Primer updateMany: marca el ganador (count 1). Segundo: invalidacion
    // de hermanos con un count invalido.
    fake.enlacePago.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: Number.NaN })

    await expect(
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-COUNT-INVALIDO" } })
      )
    ).rejects.toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
    })

    // Rollback de la transaccion: no queda Pago ni link consumido/invalidado.
    expect(fake.pagos).toHaveLength(0)
    expect(enlacePorId(fake, "enlace_idem_1")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(enlacePorId(fake, "enlace_mp_legacy_1")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(eventoPorId(fake, "WH-COUNT-INVALIDO")).toMatchObject({
      resultado: "ERROR",
      motivo: "ERROR_INTERNO",
      enlacePagoId: "enlace_idem_1",
      requiereAccion: false,
    })
  })

  it("si otro pago consumio el link, revierte y devuelve conflicto", async () => {
    const fake = montarDbProceso()
    // La marca condicional del link ganador no encuentra el link ACTIVO:
    // otra transaccion lo pago/invalido en paralelo.
    fake.enlacePago.updateMany.mockResolvedValueOnce({ count: 0 })

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-CARRERA-LINK" } })
    )

    expect(resultado).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "ENLACE_PAGADO",
      enlaceId: "enlace_idem_1",
      hitoId: "hito_1",
      pagoId: null,
    })
    // Rollback: no queda Pago, no se invalida ningun hermano.
    expect(fake.pagos).toHaveLength(0)
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(eventoPorId(fake, "WH-CARRERA-LINK")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "ENLACE_PAGADO",
      requiereAccion: true,
    })
  })

  it("revierte el Pago si el count del link ganador es invalido", async () => {
    const fake = montarDbProceso()
    fake.enlacePago.updateMany.mockResolvedValueOnce({ count: Number.NaN })

    await expect(
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-COUNT-GANADOR" } })
      )
    ).rejects.toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
    })

    // Rollback: no queda Pago ni link consumido.
    expect(fake.pagos).toHaveLength(0)
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(eventoPorId(fake, "WH-COUNT-GANADOR")).toMatchObject({
      resultado: "ERROR",
      motivo: "ERROR_INTERNO",
      enlacePagoId: "enlace_idem_1",
      requiereAccion: false,
    })
  })

  it("en REVISION consume el link e invalida hermanos porque el capture ya ocurrio", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_mp_legacy_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-1",
        }),
      ],
    })

    const capturaConPii = {
      ...capturaBase({ amountCents: 5000 }),
      payer: {
        email_address: "pagador@example.com",
        name: { given_name: "Pagador" },
      },
      payerEmail: "pagador@example.com",
    } as CapturaPaypalProcesable

    const resultado = await procesarCapturaPaypal(
      capturaConPii,
      opcionesProceso(fake, { evento: { eventoId: "WH-REVISION-HERMANO" } })
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONTO",
    })
    // Un capture COMPLETED en REVISION ya es un pago confirmado: el link
    // ganador se consume y el hermano del grupo deja de ser cobrable.
    expect(enlacePorId(fake, "enlace_idem_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(enlacePorId(fake, "enlace_mp_legacy_1")).toMatchObject({
      estado: "INVALIDADO",
      invalidadoEn: AHORA,
      motivoInvalido: MOTIVO_INVALIDACION,
    })
    // Dos updateMany: marca del ganador (count 1) + invalidacion de hermanos.
    expect(fake.enlacePago.updateMany).toHaveBeenCalledTimes(2)
    expect(fake.enlacePago.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "enlace_idem_1",
        estado: { notIn: ["INVALIDADO", "PAGADO"] },
      },
      data: { estado: "PAGADO" },
    })
    expect(fake.enlacePago.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        grupoCobroId: GRUPO_HITO,
        id: { not: "enlace_idem_1" },
        estado: "ACTIVO",
      },
      data: {
        estado: "INVALIDADO",
        invalidadoEn: AHORA,
        motivoInvalido: MOTIVO_INVALIDACION,
      },
    })
    // Los links y el evento se conservan: nada se borra.
    expect(fake.enlaces).toHaveLength(2)
    expect(fake.pagos).toHaveLength(1)
    expect(fake.eventos).toHaveLength(1)
    const evento = eventoPorId(fake, "WH-REVISION-HERMANO")
    expect(evento).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "MONTO",
      requiereAccion: true,
    })
    // Sin PII del pagador en el evento ni en el resultado.
    const serializado = JSON.stringify({ evento, resultado })
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Pagador")
    expect(serializado).not.toContain("payer")
  })

  it("en REVISION de soporte invalida hermanos sin acreditar meses", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceSoporte(),
        enlaceSoporte({
          id: "enlace_mp_soporte_1",
          token: "token_mp_soporte_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-SOP-1",
        }),
      ],
      suscripciones: [{ id: "suscripcion_1", proximoPago: null }],
    })

    const resultado = await procesarCapturaPaypal(
      capturaSoporte({ amountCents: 1000 }),
      opcionesProceso(fake, {
        evento: { eventoId: "WH-SOP-REVISION-HERMANO" },
      })
    )

    expect(resultado).toMatchObject({
      tipo: "REVISION",
      motivoRevision: "MONTO",
      suscripcionId: "suscripcion_1",
      meses: 1,
    })
    // No se acreditan meses ni se toca la Suscripcion hasta resolver T-17.
    expect(fake.suscripcion.updateMany).not.toHaveBeenCalled()
    expect(fake.suscripcion.update).not.toHaveBeenCalled()
    expect(enlacePorId(fake, "enlace_soporte_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(enlacePorId(fake, "enlace_mp_soporte_1")).toMatchObject({
      estado: "INVALIDADO",
      invalidadoEn: AHORA,
      motivoInvalido: MOTIVO_INVALIDACION,
    })
    expect(fake.enlacePago.updateMany).toHaveBeenCalledTimes(2)
    expect(fake.pagos).toHaveLength(1)
    expect(eventoPorId(fake, "WH-SOP-REVISION-HERMANO")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "MONTO",
      requiereAccion: true,
    })
  })

  it("revierte la REVISION si la invalidacion devuelve un count invalido", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceBase(),
        enlaceBase({
          id: "enlace_mp_legacy_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-1",
        }),
      ],
    })
    // Primer updateMany: marca el ganador (count 1). Segundo: invalidacion
    // de hermanos con un count invalido.
    fake.enlacePago.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: Number.NaN })

    await expect(
      procesarCapturaPaypal(
        capturaBase({ amountCents: 5000 }),
        opcionesProceso(fake, { evento: { eventoId: "WH-REVISION-COUNT" } })
      )
    ).rejects.toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
    })

    // Rollback: no queda Pago ni link consumido/invalidado.
    expect(fake.pagos).toHaveLength(0)
    expect(enlacePorId(fake, "enlace_idem_1")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(enlacePorId(fake, "enlace_mp_legacy_1")).toMatchObject({
      estado: "ACTIVO",
    })
    expect(eventoPorId(fake, "WH-REVISION-COUNT")).toMatchObject({
      resultado: "ERROR",
      motivo: "ERROR_INTERNO",
      enlacePagoId: "enlace_idem_1",
      requiereAccion: false,
    })
  })
})

describe("concurrencia y segundo pago (AC-6, AC-9, AC-13)", () => {
  it("dos captures concurrentes del mismo link dejan un solo Pago", async () => {
    const fake = montarDbProceso()

    const [primera, segunda] = await Promise.all([
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-CONC-1" } })
      ),
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-CONC-2" } })
      ),
    ])

    const resultados = [primera, segunda]
    expect(resultados.filter((r) => r.tipo === "PROCESADO")).toHaveLength(1)
    expect(resultados.filter((r) => r.tipo === "DUPLICADO")).toHaveLength(1)
    expect(fake.pagos).toHaveLength(1)
    expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.enlaces[0].estado).toBe("PAGADO")

    const eventoDuplicado = fake.eventos.find(
      (evento) => evento.resultado === "DUPLICADO"
    )
    expect(eventoDuplicado).toMatchObject({
      motivo: "DUPLICADO",
      pagoId: "pago_1",
      requiereAccion: false,
    })
  })

  it("dos pagos simultaneos de links del mismo grupo: un Pago, un credito y el segundo REQUIERE_ACCION", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceSoporte(),
        enlaceSoporte({
          id: "enlace_soporte_2",
          token: "token_soporte_2",
          externalId: "ORDER-SOP-2",
        }),
      ],
      suscripciones: [{ id: "suscripcion_1", proximoPago: null }],
    })

    const [primera, segunda] = await Promise.all([
      procesarCapturaPaypal(
        capturaSoporte(),
        opcionesProceso(fake, { evento: { eventoId: "WH-SOP-CONC-1" } })
      ),
      procesarCapturaPaypal(
        capturaSoporte({
          captureId: "CAPTURE-SOP-2",
          orderId: "ORDER-SOP-2",
        }),
        opcionesProceso(fake, { evento: { eventoId: "WH-SOP-CONC-2" } })
      ),
    ])

    const resultados = [primera, segunda]
    expect(resultados.filter((r) => r.tipo === "PROCESADO")).toHaveLength(1)
    expect(
      resultados.filter(
        (r) => r.tipo === "CONFLICTO" && r.motivo === "ENLACE_INVALIDADO"
      )
    ).toHaveLength(1)

    // Un solo Pago y una sola acreditacion de meses (CAS por proximoPago).
    expect(fake.pagos).toHaveLength(1)
    expect(fake.suscripcion.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(
      fake.enlaces.map((enlace) => enlace.estado).sort()
    ).toEqual(["INVALIDADO", "PAGADO"])

    const eventoDescartado = fake.eventos.find(
      (evento) => evento.resultado === "REQUIERE_ACCION"
    )
    expect(eventoDescartado).toMatchObject({
      motivo: "ENLACE_INVALIDADO",
      monto: 5300,
      moneda: "usd",
      requiereAccion: true,
    })
  })

  it("dos notificaciones simultaneas con el mismo eventoId registran un solo evento", async () => {
    const fake = montarDbProceso()

    const [primera, segunda] = await Promise.all([
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-MISMO-EVENTO" } })
      ),
      procesarCapturaPaypal(
        capturaBase(),
        opcionesProceso(fake, { evento: { eventoId: "WH-MISMO-EVENTO" } })
      ),
    ])

    const resultados = [primera, segunda]
    expect(resultados.filter((r) => r.tipo === "PROCESADO")).toHaveLength(1)
    expect(resultados.filter((r) => r.tipo === "DUPLICADO")).toHaveLength(1)
    expect(fake.pagos).toHaveLength(1)
    expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.eventos).toHaveLength(1)
    expect(fake.eventos[0]).toMatchObject({
      eventoId: "WH-MISMO-EVENTO",
      resultado: "PROCESADO",
      requiereAccion: false,
    })
  })

  it("revierte el Pago si el CAS del soporte devuelve un count invalido", async () => {
    const fake = montarDbProceso({
      enlaces: [enlaceSoporte()],
      suscripciones: [{ id: "suscripcion_1", proximoPago: null }],
    })
    fake.suscripcion.updateMany.mockResolvedValueOnce({ count: Number.NaN })

    await expect(
      procesarCapturaPaypal(
        capturaSoporte(),
        opcionesProceso(fake, { evento: { eventoId: "WH-SOP-COUNT-INVALIDO" } })
      )
    ).rejects.toMatchObject({
      codigo: "ERROR_INTERNO",
      httpStatus: 500,
    })

    // Rollback: no queda Pago, no se consume el link ni se acredita el soporte.
    expect(fake.pagos).toHaveLength(0)
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(fake.suscripcion.updateMany).toHaveBeenCalledTimes(1)
    expect(eventoPorId(fake, "WH-SOP-COUNT-INVALIDO")).toMatchObject({
      resultado: "ERROR",
      motivo: "ERROR_INTERNO",
      requiereAccion: false,
    })
  })

  it("si otra transaccion ya acredito el soporte, revierte el Pago", async () => {
    const fake = montarDbProceso({
      enlaces: [enlaceSoporte()],
      suscripciones: [{ id: "suscripcion_1", proximoPago: null }],
    })
    // El CAS sobre proximoPago no encuentra el valor leido: otro pago gano.
    fake.suscripcion.updateMany.mockResolvedValueOnce({ count: 0 })

    const resultado = await procesarCapturaPaypal(
      capturaSoporte(),
      opcionesProceso(fake, { evento: { eventoId: "WH-SOP-CAS" } })
    )

    expect(resultado).toEqual({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "PAGO_GANADOR",
      enlaceId: "enlace_soporte_1",
      hitoId: null,
      pagoId: null,
    })
    expect(fake.pagos).toHaveLength(0)
    expect(fake.enlaces[0].estado).toBe("ACTIVO")
    expect(eventoPorId(fake, "WH-SOP-CAS")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "PAGO_GANADOR",
      requiereAccion: true,
    })
  })

  it("no invalida ni modifica dos veces la Suscripcion cuando gana un link PayPal con hermano MP", async () => {
    const fake = montarDbProceso({
      enlaces: [
        enlaceSoporte(),
        enlaceSoporte({
          id: "enlace_mp_soporte_1",
          token: "token_mp_soporte_1",
          pasarela: "MERCADOPAGO",
          externalId: "MP-PREF-SOP-1",
        }),
      ],
      suscripciones: [{ id: "suscripcion_1", proximoPago: null }],
    })

    const resultado = await procesarCapturaPaypal(
      capturaSoporte(),
      opcionesProceso(fake, { evento: { eventoId: "WH-SOP-MP" } })
    )

    expect(resultado).toMatchObject({
      tipo: "PROCESADO",
      enlaceId: "enlace_soporte_1",
      suscripcionId: "suscripcion_1",
      meses: 1,
    })
    expect(fake.suscripcion.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.hito.updateMany).not.toHaveBeenCalled()
    expect(enlacePorId(fake, "enlace_soporte_1")).toMatchObject({
      estado: "PAGADO",
    })
    expect(enlacePorId(fake, "enlace_mp_soporte_1")).toMatchObject({
      estado: "INVALIDADO",
      invalidadoEn: AHORA,
      motivoInvalido: MOTIVO_INVALIDACION,
    })
    expect(fake.pagos).toHaveLength(1)
  })
})

describe("segundos capture/order y trazabilidad (AC-6, AC-13, AC-19)", () => {
  it("un P2002 en el alta del Pago se traza como duplicado con requiereAccion", async () => {
    // El pago existente queda oculto en las dos lecturas de la transaccion y
    // aparece recien cuando el insert choca con la constraint unica.
    const fake = montarDbProceso({
      pagos: [pagoPrevio({ externalId: "CAPTURE-OTRA", paypalOrderId: ORDER })],
      ocultarPagoHasta: 2,
    })

    const resultado = await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-P2002-PAGO" } })
    )

    expect(resultado).toMatchObject({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_previo",
      requiereAccion: true,
    })
    expect(fake.pagos).toHaveLength(1)
    expect(eventoPorId(fake, "WH-P2002-PAGO")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "DUPLICADO",
      pagoId: "pago_previo",
      requiereAccion: true,
    })
  })

  it("un segundo capture de la misma orden no crea Pago y queda REQUIERE_ACCION", async () => {
    const fake = montarDbProceso()

    await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-ORDEN-1" } })
    )

    const segunda = await procesarCapturaPaypal(
      capturaBase({ captureId: CAPTURE_2 }),
      opcionesProceso(fake, { evento: { eventoId: "WH-ORDEN-2" } })
    )

    expect(segunda).toMatchObject({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_1",
      requiereAccion: true,
    })
    expect(fake.pagos).toHaveLength(1)
    expect(fake.hito.updateMany).toHaveBeenCalledTimes(1)
    expect(fake.suscripcion.update).not.toHaveBeenCalled()

    expect(eventoPorId(fake, "WH-ORDEN-2")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "DUPLICADO",
      externalId: CAPTURE_2,
      pagoId: "pago_1",
      requiereAccion: true,
    })
  })

  it("un capture posterior sobre el mismo link no crea un segundo Pago", async () => {
    const fake = montarDbProceso()

    await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-LINK-1" } })
    )

    const segunda = await procesarCapturaPaypal(
      capturaBase({
        captureId: CAPTURE_2,
        orderId: ORDER_2,
        customId: "token_idem_1",
      }),
      opcionesProceso(fake, { evento: { eventoId: "WH-LINK-2" } })
    )

    expect(segunda).toMatchObject({
      tipo: "CONFLICTO",
      motivo: "PAGO_GANADOR",
      pagoId: "pago_1",
    })
    expect(fake.pagos).toHaveLength(1)
    expect(eventoPorId(fake, "WH-LINK-2")).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "PAGO_GANADOR",
      requiereAccion: true,
    })
  })

  it("el intento descartado no persiste PII del pagador", async () => {
    const fake = montarDbProceso()

    await procesarCapturaPaypal(
      capturaBase(),
      opcionesProceso(fake, { evento: { eventoId: "WH-PII-1" } })
    )

    const capturaConPii = {
      ...capturaBase({ captureId: CAPTURE_2 }),
      payer: {
        email_address: "pagador@example.com",
        name: { given_name: "Pagador" },
      },
      payerEmail: "pagador@example.com",
    } as CapturaPaypalProcesable

    const segunda = await procesarCapturaPaypal(
      capturaConPii,
      opcionesProceso(fake, { evento: { eventoId: "WH-PII-2" } })
    )

    const evento = eventoPorId(fake, "WH-PII-2")
    expect(evento).toMatchObject({
      resultado: "REQUIERE_ACCION",
      motivo: "DUPLICADO",
      requiereAccion: true,
    })
    const serializado = JSON.stringify({ evento, segunda })
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Pagador")
    expect(serializado).not.toContain("payer")
  })
})
