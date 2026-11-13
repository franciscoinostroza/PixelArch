import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { ConfigConsumo } from "@/lib/propuestas/consumo"
import {
  ErrorCupo,
  PROVEEDORES_CONSUMO,
  UMBRAL_ALERTA_CUPO,
  claveConsumo,
  claveLockCupo,
  claveLockPresupuesto,
  esErrorCupo,
  estadoConsumoCampana,
  estadoConsumoProspecto,
  estadoCupos,
  evaluarCupo,
  fechaISOUTC,
  normalizarFechaUTC,
  reservarCupo,
} from "@/lib/propuestas/consumo"
import type {
  ClienteConsumo,
  OpcionesEstadoCupos,
  OpcionesReservaCupo,
  ProveedorConsumoCupo,
  ReservaCupo,
  ResultadoReservaCupo,
} from "@/lib/propuestas/consumo"

/**
 * T-11 (AC-11, AC-12, AC-38, AC-39; RF-17, RF-57, RF-58): cupos, consumo y
 * costos por proveedor/dia.
 *
 * No hay Prisma ni base de datos: `reservarCupo` y `estadoCupos` reciben un
 * cliente/transaccion falsos en memoria. El fake reproduce el `upsert`
 * incremental, el filtro por dia/mes y el `pg_advisory_xact_lock` (con un
 * gestor de locks FIFO por clave que serializa tanto el lock diario
 * `(proveedor, dia)` como el global del presupuesto
 * (`PROPUESTAS_PRESUPUESTO`, sin `YYYY-MM`)).
 * Un test estatico
 * comprueba que `consumo.ts` no importa el singleton de Prisma al cargar y que
 * `places.ts` no toca Prisma ni el CRM.
 */

const DIA = new Date("2026-11-12T00:00:00.000Z")
const DIA_CON_HORA = new Date("2026-11-12T23:59:59.999Z")

const CONFIG: ConfigConsumo = {
  cupos: {
    enviosDia: 20,
    placesDia: 20,
    fetchesDia: 100,
    auditoriasDia: 20,
    borradoresDia: 20,
  },
  costos: {
    placesCentavos: 0,
    resendCentavos: 0,
    presupuestoMensualCentavos: 0,
  },
}

/** Config aislada de `process.env`; el presupuesto solo cambia si el test lo pide. */
function configConPresupuesto(
  presupuestoMensualCentavos: number,
): ConfigConsumo {
  return {
    ...CONFIG,
    costos: { ...CONFIG.costos, presupuestoMensualCentavos },
  }
}

// ---------------------------------------------------------------------------
// evaluarCupo (puro)
// ---------------------------------------------------------------------------

describe("T-11 evaluarCupo: alerta 80% y bloqueo 100% (AC-11, AC-39)", () => {
  it("AC-39: cap 20 con usado 0/15/16/19/20 y cantidad 1", () => {
    expect(UMBRAL_ALERTA_CUPO).toBe(0.8)

    expect(evaluarCupo({ usado: 0, cantidad: 1, cap: 20 })).toEqual({
      permitido: true,
      restantes: 19,
      alerta: false,
    })

    expect(evaluarCupo({ usado: 15, cantidad: 1, cap: 20 })).toEqual({
      permitido: true,
      restantes: 4,
      alerta: true,
    })

    expect(evaluarCupo({ usado: 16, cantidad: 1, cap: 20 })).toEqual({
      permitido: true,
      restantes: 3,
      alerta: true,
    })

    expect(evaluarCupo({ usado: 19, cantidad: 1, cap: 20 })).toEqual({
      permitido: true,
      restantes: 0,
      alerta: true,
    })

    expect(evaluarCupo({ usado: 20, cantidad: 1, cap: 20 })).toEqual({
      permitido: false,
      restantes: 0,
      alerta: true,
    })
  })

  it("AC-39: la llamada 21 del dia (cap 20) queda bloqueada y no hay sobreconsumo", () => {
    const resultado = evaluarCupo({ usado: 20, cantidad: 1, cap: 20 })

    expect(resultado.permitido).toBe(false)
    expect(resultado.restantes).toBe(0)
    expect(resultado.restantes).toBeGreaterThanOrEqual(0)
  })

  it("AC-39: justo en el 80% avisa; por debajo no", () => {
    expect(evaluarCupo({ usado: 15, cantidad: 1, cap: 20 }).alerta).toBe(true)
    expect(evaluarCupo({ usado: 14, cantidad: 1, cap: 20 }).alerta).toBe(false)
    expect(evaluarCupo({ usado: 8, cantidad: 1, cap: 20 }).alerta).toBe(false)
  })

  it("AC-39: restantes nunca es negativo aunque ya este sobre el cap", () => {
    const resultado = evaluarCupo({ usado: 100, cantidad: 5, cap: 20 })

    expect(resultado.permitido).toBe(false)
    expect(resultado.restantes).toBe(0)
  })

  it("AC-39: cap 0 o negativo bloquea sin inventar restantes", () => {
    for (const cap of [0, -1, -100]) {
      expect(evaluarCupo({ usado: 0, cantidad: 1, cap })).toEqual({
        permitido: false,
        restantes: 0,
        alerta: false,
      })
    }
  })

  it.each([
    { usado: -1, cantidad: 1, cap: 20 },
    { usado: 1.5, cantidad: 1, cap: 20 },
    { usado: Number.NaN, cantidad: 1, cap: 20 },
    { usado: 0, cantidad: 0, cap: 20 },
    { usado: 0, cantidad: -1, cap: 20 },
    { usado: 0, cantidad: 1.5, cap: 20 },
    { usado: 0, cantidad: Number.NaN, cap: 20 },
    { usado: 0, cantidad: 1, cap: 1.5 },
    { usado: Number.POSITIVE_INFINITY, cantidad: 1, cap: 20 },
  ])(
    "AC-39: entradas invalidas (%j) fallan cerrado",
    (entrada) => {
      expect(evaluarCupo(entrada)).toEqual({
        permitido: false,
        restantes: 0,
        alerta: false,
      })
    },
  )

  it("AC-39: umbral custom se respeta y uno invalido falla cerrado", () => {
    expect(
      evaluarCupo({ usado: 4, cantidad: 1, cap: 10, umbral: 0.5 }).alerta,
    ).toBe(true)
    expect(
      evaluarCupo({ usado: 4, cantidad: 1, cap: 10, umbral: 0.8 }).alerta,
    ).toBe(false)

    for (const umbral of [0, -0.1, 1.1, Number.NaN]) {
      expect(
        evaluarCupo({ usado: 0, cantidad: 1, cap: 10, umbral }),
      ).toEqual({ permitido: false, restantes: 0, alerta: false })
    }
  })

  it("AC-39: no muta la entrada (objeto congelado)", () => {
    const entrada = Object.freeze({ usado: 3, cantidad: 2, cap: 10 })

    expect(evaluarCupo(entrada)).toEqual({
      permitido: true,
      restantes: 5,
      alerta: false,
    })
    expect(entrada).toEqual({ usado: 3, cantidad: 2, cap: 10 })
  })
})

// ---------------------------------------------------------------------------
// Fechas y claves
// ---------------------------------------------------------------------------

describe("T-11 fechas y claves de consumo (AC-38)", () => {
  it("AC-38: normalizarFechaUTC lleva a medianoche UTC", () => {
    expect(normalizarFechaUTC(new Date("2026-11-12T23:59:59.999Z"))).toEqual(
      DIA,
    )
    expect(normalizarFechaUTC(new Date("2026-11-12T00:00:00.001Z"))).toEqual(
      DIA,
    )
    // 23:30 -03:00 ya es el dia 13 en UTC.
    expect(normalizarFechaUTC(new Date("2026-11-12T23:30:00-03:00"))).toEqual(
      new Date("2026-11-13T00:00:00.000Z"),
    )
  })

  it("AC-38: normalizarFechaUTC es estable y devuelve objetos nuevos", () => {
    const primero = normalizarFechaUTC(DIA_CON_HORA)
    const segundo = normalizarFechaUTC(DIA_CON_HORA)

    expect(primero).toEqual(segundo)
    expect(primero).not.toBe(segundo)
  })

  it.each([
    new Date("fecha invalida"),
    "2026-11-12" as unknown as Date,
    42 as unknown as Date,
  ])("AC-38: fecha invalida (%j) -> ErrorCupo VALIDACION", (fecha) => {
    try {
      normalizarFechaUTC(fecha)
      throw new Error("Se esperaba ErrorCupo")
    } catch (error) {
      expect(esErrorCupo(error)).toBe(true)
      if (esErrorCupo(error)) {
        expect(error.codigo).toBe("LIMITE")
        expect(error.ambito).toBe("VALIDACION")
      }
    }
  })

  it("AC-38: fechaISOUTC devuelve YYYY-MM-DD estable en UTC", () => {
    expect(fechaISOUTC(DIA_CON_HORA)).toBe("2026-11-12")
    expect(fechaISOUTC(new Date("2026-01-05T12:00:00.000Z"))).toBe(
      "2026-01-05",
    )
    expect(fechaISOUTC(new Date("2026-01-05T12:00:00.000Z"))).toBe(
      fechaISOUTC(new Date("2026-01-05T12:00:00.000Z")),
    )
  })

  it("AC-38: claveConsumo usa campana/proveedor/dia/prospecto y GLOBAL por defecto", () => {
    const base = {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES" as const,
      fecha: DIA_CON_HORA,
    }

    expect(claveConsumo({ ...base, prospectoId: null })).toBe(
      "camp-1:GOOGLE_PLACES:2026-11-12:GLOBAL",
    )
    expect(claveConsumo(base)).toBe(
      "camp-1:GOOGLE_PLACES:2026-11-12:GLOBAL",
    )
    expect(claveConsumo({ ...base, prospectoId: "prospecto-9" })).toBe(
      "camp-1:GOOGLE_PLACES:2026-11-12:prospecto-9",
    )
  })

  it("AC-38: claveConsumo recorta ids y es estable ante la hora", () => {
    const a = claveConsumo({
      campanaId: "  camp-1  ",
      proveedor: "RESEND",
      fecha: new Date("2026-11-12T00:01:00.000Z"),
      prospectoId: " p-1 ",
    })
    const b = claveConsumo({
      campanaId: "camp-1",
      proveedor: "RESEND",
      fecha: new Date("2026-11-12T23:59:00.000Z"),
      prospectoId: "p-1",
    })

    expect(a).toBe("camp-1:RESEND:2026-11-12:p-1")
    expect(a).toBe(b)
  })

  it.each([
    { campanaId: "camp:1" },
    { campanaId: "   " },
    { campanaId: "" },
    { campanaId: "a".repeat(129) },
    { prospectoId: "p:1" },
    { prospectoId: "   " },
  ])("AC-38: claveConsumo rechaza ids invalidos (%j)", (parcial) => {
    try {
      claveConsumo({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        ...parcial,
      })
      throw new Error("Se esperaba ErrorCupo")
    } catch (error) {
      expect(esErrorCupo(error)).toBe(true)
      if (esErrorCupo(error)) expect(error.ambito).toBe("VALIDACION")
    }
  })

  it("AC-38: claveConsumo rechaza proveedor y fecha invalidos", () => {
    for (const invalida of [
      () =>
        claveConsumo({
          campanaId: "c",
          proveedor: "OTRO" as unknown as ProveedorConsumoCupo,
          fecha: DIA,
        }),
      () =>
        claveConsumo({
          campanaId: "c",
          proveedor: "GOOGLE_PLACES",
          fecha: new Date("no-es-fecha"),
        }),
    ]) {
      try {
        invalida()
        throw new Error("Se esperaba ErrorCupo")
      } catch (error) {
        expect(esErrorCupo(error)).toBe(true)
      }
    }
  })

  it("AC-38: claveLockCupo es proveedor + dia UTC estable", () => {
    expect(claveLockCupo("GOOGLE_PLACES", DIA_CON_HORA)).toEqual({
      proveedor: "GOOGLE_PLACES",
      fecha: "2026-11-12",
    })
    expect(
      claveLockCupo("GOOGLE_PLACES", new Date("2026-11-12T00:00:00.000Z")),
    ).toEqual(claveLockCupo("GOOGLE_PLACES", DIA_CON_HORA))
  })

  it("AC-39: claveLockPresupuesto es un helper sin argumentos y de valor constante", () => {
    const lock = claveLockPresupuesto()

    expect(lock).toEqual({ clave: "PROPUESTAS_PRESUPUESTO" })
    expect(lock.clave).toBe("PROPUESTAS_PRESUPUESTO")
    expect(Object.keys(lock)).toEqual(["clave"])
    // Estable: dos llamadas devuelven el mismo valor (objetos distintos).
    expect(claveLockPresupuesto()).toEqual(lock)
    expect(claveLockPresupuesto()).not.toBe(lock)
  })

  it("AC-39: el lock presupuestario es global: no incluye periodo YYYY-MM", () => {
    const { clave } = claveLockPresupuesto()

    // La clave no depende de fecha/mes: el presupuesto es global.
    expect(clave).not.toMatch(/\d{4}-\d{2}/)
    expect(clave).not.toContain(":")
    // Aunque cambie el dia o el mes, el helper (sin argumentos) no cambia.
    expect(claveLockPresupuesto().clave).toBe(clave)
  })
})

// ---------------------------------------------------------------------------
// Fake de transaccion/Prisma (sin base de datos)
// ---------------------------------------------------------------------------

interface FilaConsumoFake {
  clave: string
  campanaId: string
  prospectoId: string | null
  proveedor: ProveedorConsumoCupo
  fecha: Date
  llamadas: number
  unidades: number
  costoCentavos: number
}

type OperacionFake =
  | "queryRaw"
  | "lock"
  | "findManyDia"
  | "findManyMes"
  | "upsert"

interface LlamadaFake {
  operacion: OperacionFake
  detalle?: unknown
}

interface EstadoFake {
  filas: FilaConsumoFake[]
  llamadas: LlamadaFake[]
}

interface ArgsFindMany {
  where: {
    proveedor?: ProveedorConsumoCupo
    campanaId?: string
    prospectoId?: string
    fecha: Date | { gte: Date; lt: Date }
  }
  select?: unknown
}

interface ArgsUpsert {
  where: { clave: string }
  create: FilaConsumoFake
  update: {
    llamadas: { increment: number }
    unidades: { increment: number }
    costoCentavos: { increment: number }
  }
}

interface GestorLocks {
  adquirir: (clave: string, idTx: string) => Promise<() => void>
  /** Claves concedidas en orden; se repiten si hubo espera o reentrancia. */
  adquiridas: string[]
}

interface TxFalsa {
  tx: ClienteConsumo
  liberar: () => void
}

function crearEstado(filas: FilaConsumoFake[] = []): EstadoFake {
  return { filas: [...filas], llamadas: [] }
}

function crearFila(
  parcial: Partial<FilaConsumoFake> &
    Pick<FilaConsumoFake, "proveedor" | "unidades" | "costoCentavos">,
): FilaConsumoFake {
  const campanaId = parcial.campanaId ?? "camp-1"
  const prospectoId = parcial.prospectoId ?? null
  const fecha = parcial.fecha ?? DIA

  return {
    clave:
      parcial.clave ??
      claveConsumo({ campanaId, proveedor: parcial.proveedor, fecha, prospectoId }),
    campanaId,
    prospectoId,
    proveedor: parcial.proveedor,
    fecha,
    llamadas: parcial.llamadas ?? parcial.unidades,
    unidades: parcial.unidades,
    costoCentavos: parcial.costoCentavos,
  }
}

function coincidenDia(
  fila: FilaConsumoFake,
  where: ArgsFindMany["where"],
): boolean {
  if (!(where.fecha instanceof Date)) return false
  if (where.proveedor !== undefined && fila.proveedor !== where.proveedor) {
    return false
  }
  return fila.fecha.getTime() === where.fecha.getTime()
}

function coincidenMes(
  fila: FilaConsumoFake,
  rango: { gte: Date; lt: Date },
): boolean {
  const tiempo = fila.fecha.getTime()
  return tiempo >= rango.gte.getTime() && tiempo < rango.lt.getTime()
}

let secuenciaTx = 0

function crearTxFalsa(
  estado: EstadoFake,
  locks?: GestorLocks,
  idTx = `tx-${(secuenciaTx += 1)}`,
): TxFalsa {
  // `pg_advisory_xact_lock` se libera al cerrar la transaccion: se acumulan
  // todos los locks (global y diario) y `liberar()` suelta todo.
  const liberarLocks: Array<() => void> = []

  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...valores: unknown[]) => {
      estado.llamadas.push({ operacion: "queryRaw", detalle: valores })

      if (locks !== undefined) {
        // El lock global del presupuesto usa un solo argumento
        // (`hashtext(clave)`); el diario usa dos (`hashtext(proveedor)`,
        // `hashtext(fecha)`). No hay sufijo de periodo.
        const clave = valores.map((valor) => String(valor)).join(":")
        liberarLocks.push(await locks.adquirir(clave, idTx))
        estado.llamadas.push({ operacion: "lock", detalle: clave })
      }

      return [{ pg_advisory_xact_lock: null }]
    },
    consumoProveedor: {
      findMany: async (args: ArgsFindMany) => {
        const where = args.where

        if (where.fecha instanceof Date) {
          estado.llamadas.push({ operacion: "findManyDia", detalle: args })
          return estado.filas
            .filter((fila) => coincidenDia(fila, where))
            .map((fila) => ({
              campanaId: fila.campanaId,
              unidades: fila.unidades,
              costoCentavos: fila.costoCentavos,
            }))
        }

        estado.llamadas.push({ operacion: "findManyMes", detalle: args })
        return estado.filas
          .filter((fila) => coincidenMes(fila, where.fecha as { gte: Date; lt: Date }))
          .map((fila) => ({ costoCentavos: fila.costoCentavos }))
      },
      upsert: async (args: ArgsUpsert) => {
        estado.llamadas.push({ operacion: "upsert", detalle: args })

        const existente = estado.filas.find(
          (fila) => fila.clave === args.where.clave,
        )

        if (existente !== undefined) {
          existente.llamadas += args.update.llamadas.increment
          existente.unidades += args.update.unidades.increment
          existente.costoCentavos += args.update.costoCentavos.increment
          return existente
        }

        estado.filas.push({ ...args.create })
        return args.create
      },
    },
  }

  return {
    tx: tx as unknown as ClienteConsumo,
    liberar: () => {
      while (liberarLocks.length > 0) {
        liberarLocks.pop()?.()
      }
    },
  }
}

/**
 * Gestor de locks en memoria que modela `pg_advisory_xact_lock`: cola FIFO
 * por clave. Claves distintas (proveedor/dia y presupuesto global) no se
 * bloquean entre si; la exclusion del presupuesto la da la unica clave global
 * compartida, igual que en Postgres.
 *
 * La misma transaccion puede re-adquirir una clave que ya tiene (los advisory
 * locks transaccionales son reentrantes): se concede al instante y el lock
 * recien se libera cuando la transaccion lo suelta todas las veces. Esto es
 * clave para modelar dos reservas del mismo mes dentro de una transaccion.
 */
function crearGestorLocks(): GestorLocks {
  const adquiridas: string[] = []
  const titulares = new Map<string, { idTx: string; profundidad: number }>()
  const espera = new Map<
    string,
    Array<{ idTx: string; resolver: (soltar: () => void) => void }>
  >()

  function liberar(clave: string): void {
    const siguiente = espera.get(clave)?.shift()
    if (siguiente === undefined) {
      titulares.delete(clave)
      return
    }

    titulares.set(clave, { idTx: siguiente.idTx, profundidad: 1 })
    adquiridas.push(clave)
    siguiente.resolver(() => liberar(clave))
  }

  function soltar(clave: string, idTx: string): void {
    const titular = titulares.get(clave)
    if (titular === undefined || titular.idTx !== idTx) return

    titular.profundidad -= 1
    if (titular.profundidad <= 0) liberar(clave)
  }

  return {
    adquiridas,
    adquirir(clave, idTx) {
      const titular = titulares.get(clave)

      if (titular !== undefined && titular.idTx === idTx) {
        // Reentrante: la tx ya tiene el lock hasta su commit/rollback. No se
        // incrementa la profundidad: el lock se libera una sola vez al final.
        adquiridas.push(clave)
        return Promise.resolve(() => {})
      }

      if (titular === undefined) {
        titulares.set(clave, { idTx, profundidad: 1 })
        adquiridas.push(clave)
        return Promise.resolve(() => soltar(clave, idTx))
      }

      return new Promise((resolver) => {
        const cola = espera.get(clave) ?? []
        cola.push({
          idTx,
          resolver: (soltarLock) => resolver(soltarLock),
        })
        espera.set(clave, cola)
      })
    },
  }
}

async function capturarErrorCupo(
  promesa: Promise<unknown>,
): Promise<ErrorCupo> {
  try {
    await promesa
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorCupo)
    expect(esErrorCupo(error)).toBe(true)
    return error as ErrorCupo
  }

  throw new Error("Se esperaba un ErrorCupo y la promesa resolvio.")
}

function llamadasDe(estado: EstadoFake, operacion: OperacionFake): LlamadaFake[] {
  return estado.llamadas.filter((llamada) => llamada.operacion === operacion)
}

// ---------------------------------------------------------------------------
// reservarCupo
// ---------------------------------------------------------------------------

describe("T-11 reservarCupo: lock, upsert y topes (AC-11, AC-38, AC-39)", () => {
  it("AC-38: primera reserva toma el advisory lock antes de leer y crear", async () => {
    const estado = crearEstado()
    const { tx } = crearTxFalsa(estado)

    const resultado = await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA_CON_HORA,
      capDiario: 20,
      costoCentavos: 25,
    }, { config: CONFIG })

    expect(resultado).toEqual({ restantes: 19 })
    expect(estado.llamadas.map((llamada) => llamada.operacion)).toEqual([
      "queryRaw",
      "findManyDia",
      "upsert",
    ])

    expect(llamadasDe(estado, "queryRaw")[0]?.detalle).toEqual([
      "GOOGLE_PLACES",
      "2026-11-12",
    ])
    expect(llamadasDe(estado, "findManyDia")[0]?.detalle).toMatchObject({
      where: { proveedor: "GOOGLE_PLACES", fecha: DIA },
    })

    const upsert = llamadasDe(estado, "upsert")[0]?.detalle as ArgsUpsert
    expect(upsert.where).toEqual({
      clave: "camp-1:GOOGLE_PLACES:2026-11-12:GLOBAL",
    })
    expect(upsert.create).toEqual({
      clave: "camp-1:GOOGLE_PLACES:2026-11-12:GLOBAL",
      campanaId: "camp-1",
      prospectoId: null,
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      llamadas: 1,
      unidades: 1,
      costoCentavos: 25,
    })

    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({
      unidades: 1,
      llamadas: 1,
      costoCentavos: 25,
    })
  })

  it("AC-38: segunda reserva actualiza e incrementa llamadas/unidades/costo", async () => {
    const estado = crearEstado()
    const { tx } = crearTxFalsa(estado)

    await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      capDiario: 20,
      costoCentavos: 10,
    }, { config: CONFIG })

    const resultado = await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      cantidad: 2,
      llamadas: 1,
      capDiario: 20,
      costoCentavos: 5,
    }, { config: CONFIG })

    expect(resultado).toEqual({ restantes: 17 })

    const upserts = llamadasDe(estado, "upsert")
    expect(upserts).toHaveLength(2)
    expect((upserts[1]?.detalle as ArgsUpsert).update).toEqual({
      llamadas: { increment: 1 },
      unidades: { increment: 2 },
      costoCentavos: { increment: 5 },
    })

    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({
      unidades: 3,
      llamadas: 2,
      costoCentavos: 15,
    })
  })

  it("AC-11: el tope global suma todas las campanas del proveedor/dia", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "otra-campana",
        proveedor: "GOOGLE_PLACES",
        unidades: 19,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "WEB_FETCH",
        unidades: 500,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 19,
        costoCentavos: 0,
        fecha: new Date("2026-11-11T00:00:00.000Z"),
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const permitida = await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      cantidad: 1,
      capDiario: 20,
    }, { config: CONFIG })

    expect(permitida).toEqual({ restantes: 0 })

    const error = await capturarErrorCupo(
      reservarCupo(tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        cantidad: 1,
        capDiario: 20,
      }, { config: CONFIG }),
    )

    expect(error.codigo).toBe("CUPO")
    expect(error.ambito).toBe("GLOBAL")
    expect(error.restantes).toBe(0)
    expect(llamadasDe(estado, "upsert")).toHaveLength(1)
    expect(
      estado.filas
        .filter((fila) => fila.fecha.getTime() === DIA.getTime())
        .filter((fila) => fila.proveedor === "GOOGLE_PLACES")
        .reduce((total, fila) => total + fila.unidades, 0),
    ).toBe(20)
  })

  it("AC-11: el tope por campana es opcional y se aplica si se pasa", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        prospectoId: "p-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 4,
        costoCentavos: 0,
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const permitida = await reservarCupo(tx, {
      campanaId: "camp-1",
      prospectoId: "p-2",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      cantidad: 1,
      capDiario: 100,
      capCampana: 5,
    }, { config: CONFIG })

    expect(permitida).toEqual({ restantes: 95 })

    const error = await capturarErrorCupo(
      reservarCupo(tx, {
        campanaId: "camp-1",
        prospectoId: "p-3",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        cantidad: 1,
        capDiario: 100,
        capCampana: 5,
      }, { config: CONFIG }),
    )

    expect(error.codigo).toBe("CUPO")
    expect(error.ambito).toBe("CAMPANA")
  })

  it("AC-11: sin capCampana no se aplica el tope por campana", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        prospectoId: "p-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 4,
        costoCentavos: 0,
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const resultado = await reservarCupo(tx, {
      campanaId: "camp-1",
      prospectoId: "p-2",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      cantidad: 3,
      capDiario: 100,
    }, { config: CONFIG })

    expect(resultado).toEqual({ restantes: 93 })
  })

  it("AC-11: capDiario 0 o negativo -> CUPO; no entero -> LIMITE, sin tocar la base", async () => {
    for (const [capDiario, codigo] of [
      [0, "CUPO"],
      [-5, "CUPO"],
      [1.5, "LIMITE"],
      [Number.NaN, "LIMITE"],
    ] as const) {
      const estado = crearEstado()
      const { tx } = crearTxFalsa(estado)

      const error = await capturarErrorCupo(
        reservarCupo(tx, {
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          fecha: DIA,
          capDiario,
        }, { config: CONFIG }),
      )

      expect(error.codigo).toBe(codigo)
      expect(error.ambito).toBe("CONFIGURACION")
      expect(estado.llamadas).toHaveLength(0)
    }
  })

  it("AC-11: capCampana 0 -> CUPO sin tocar la base", async () => {
    const estado = crearEstado()
    const { tx } = crearTxFalsa(estado)

    const error = await capturarErrorCupo(
      reservarCupo(tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        capCampana: 0,
      }, { config: CONFIG }),
    )

    expect(error.codigo).toBe("CUPO")
    expect(error.ambito).toBe("CAMPANA")
    expect(estado.llamadas).toHaveLength(0)
  })

  it("AC-39: presupuesto mensual excedido -> LIMITE sin upsert", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 400,
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const error = await capturarErrorCupo(
      reservarCupo(tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 601,
        presupuestoMensualCentavos: 1_000,
      }, { config: CONFIG }),
    )

    expect(error.codigo).toBe("LIMITE")
    expect(error.ambito).toBe("PRESUPUESTO")
    expect(error.restantePresupuestoCentavos).toBe(600)
    expect(llamadasDe(estado, "findManyMes")).toHaveLength(1)
    expect(llamadasDe(estado, "upsert")).toHaveLength(0)
    expect(estado.filas).toHaveLength(1)
  })

  it("AC-39: presupuesto mensual dentro del limite -> upsert con costo en centavos", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 400,
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const resultado = await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      capDiario: 20,
      costoCentavos: 600,
      presupuestoMensualCentavos: 1_000,
    }, { config: CONFIG })

    expect(resultado).toEqual({ restantes: 19 })

    const upsert = llamadasDe(estado, "upsert")[0]?.detalle as ArgsUpsert
    expect(upsert.create.costoCentavos).toBe(600)
  })

  it("AC-39: el presupuesto excluye el gasto de meses anteriores y suma todos los proveedores", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 1,
        costoCentavos: 9_000,
        fecha: new Date("2026-10-31T00:00:00.000Z"),
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 200,
        fecha: new Date("2026-11-01T00:00:00.000Z"),
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "REDACTOR",
        unidades: 1,
        costoCentavos: 200,
        fecha: new Date("2026-11-30T00:00:00.000Z"),
      }),
    ])
    const { tx } = crearTxFalsa(estado)

    const permitida = await reservarCupo(tx, {
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      fecha: DIA,
      capDiario: 20,
      costoCentavos: 600,
      presupuestoMensualCentavos: 1_000,
    }, { config: CONFIG })

    expect(permitida).toEqual({ restantes: 19 })

    const error = await capturarErrorCupo(
      reservarCupo(tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 1,
        presupuestoMensualCentavos: 1_000,
      }, { config: CONFIG }),
    )

    expect(error.codigo).toBe("LIMITE")
    expect(error.ambito).toBe("PRESUPUESTO")
  })

  it("AC-38: costo unitario configurado se multiplica por la cantidad", async () => {
    const estado = crearEstado()
    const { tx } = crearTxFalsa(estado)

    await reservarCupo(
      tx,
      {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        cantidad: 3,
        capDiario: 20,
      },
      { config: CONFIG, costoUnidadCentavos: 7 },
    )

    const upsert = llamadasDe(estado, "upsert")[0]?.detalle as ArgsUpsert
    expect(upsert.create.costoCentavos).toBe(21)
  })

  it("AC-11/AC-39: dos reservas concurrentes se serializan y no hay sobreconsumo", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()

    const ejecutar = async (txFalsa: TxFalsa) => {
      try {
        return await reservarCupo(txFalsa.tx, {
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          fecha: DIA,
          cantidad: 1,
          capDiario: 1,
        }, { config: CONFIG })
      } finally {
        txFalsa.liberar()
      }
    }

    const resultados = await Promise.allSettled([
      ejecutar(crearTxFalsa(estado, locks)),
      ejecutar(crearTxFalsa(estado, locks)),
    ])

    const cumplidas = resultados.filter(
      (resultado) => resultado.status === "fulfilled",
    )
    const rechazadas = resultados.filter(
      (resultado) => resultado.status === "rejected",
    )

    expect(cumplidas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)

    const rechazada = rechazadas[0] as PromiseRejectedResult
    expect(esErrorCupo(rechazada.reason)).toBe(true)
    if (esErrorCupo(rechazada.reason)) {
      expect(rechazada.reason.codigo).toBe("CUPO")
      expect(rechazada.reason.ambito).toBe("GLOBAL")
    }

    const totalUnidades = estado.filas.reduce(
      (total, fila) => total + fila.unidades,
      0,
    )

    expect(totalUnidades).toBe(1)
    expect(totalUnidades).toBeLessThanOrEqual(1)
    expect(llamadasDe(estado, "upsert")).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Presupuesto mensual global: concurrencia y orden de locks
// ---------------------------------------------------------------------------

const PERIODO = "2026-11"
/** Clave unica del lock global del presupuesto: no depende de fecha ni mes. */
const CLAVE_LOCK_PRESUPUESTO = "PROPUESTAS_PRESUPUESTO"

/** Gasto del mes en el estado compartido (suma de todos los proveedores). */
function totalMes(estado: EstadoFake, periodo = PERIODO): number {
  return estado.filas
    .filter((fila) => fechaISOUTC(fila.fecha).slice(0, 7) === periodo)
    .reduce((total, fila) => total + fila.costoCentavos, 0)
}

/**
 * Corre `reservarCupo` con su propia tx falsa y libera los locks al terminar,
 * como haria el commit/rollback de la transaccion del llamador.
 */
async function reservarEnTx(
  estado: EstadoFake,
  locks: GestorLocks,
  reserva: ReservaCupo,
  opciones: OpcionesReservaCupo = { config: CONFIG },
): Promise<ResultadoReservaCupo> {
  const txFalsa = crearTxFalsa(estado, locks)

  try {
    return await reservarCupo(txFalsa.tx, reserva, opciones)
  } finally {
    txFalsa.liberar()
  }
}

/**
 * Simula una transaccion que hace varias reservas antes del commit: todos los
 * locks (incluido el global reentrante) se liberan recien al final.
 */
async function reservarVariasEnTx(
  estado: EstadoFake,
  locks: GestorLocks,
  reservas: ReservaCupo[],
  opciones: OpcionesReservaCupo = { config: CONFIG },
  idTx?: string,
): Promise<ResultadoReservaCupo[]> {
  const txFalsa = crearTxFalsa(estado, locks, idTx)

  try {
    const resultados: ResultadoReservaCupo[] = []
    for (const reserva of reservas) {
      resultados.push(await reservarCupo(txFalsa.tx, reserva, opciones))
    }
    return resultados
  } finally {
    txFalsa.liberar()
  }
}

function resumenResultados<T>(resultados: PromiseSettledResult<T>[]): {
  cumplidas: PromiseFulfilledResult<T>[]
  rechazadas: PromiseRejectedResult[]
} {
  return {
    cumplidas: resultados.filter(
      (resultado): resultado is PromiseFulfilledResult<T> =>
        resultado.status === "fulfilled",
    ),
    rechazadas: resultados.filter(
      (resultado): resultado is PromiseRejectedResult =>
        resultado.status === "rejected",
    ),
  }
}

describe("T-11 reservarCupo: presupuesto mensual global bajo concurrencia (AC-39)", () => {
  it("AC-39: dos proveedores distintos comparten el presupuesto (un solo upsert)", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const presupuestoMensualCentavos = 1_000

    // Lock diario distinto por proveedor: si no existiera el lock global,
    // ambos leerian el mes en 0 y harian dos upserts (1.200 > 1.000).
    const resultados = await Promise.allSettled([
      reservarEnTx(estado, locks, {
        campanaId: "camp-places",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos,
      }),
      reservarEnTx(estado, locks, {
        campanaId: "camp-resend",
        proveedor: "RESEND",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos,
      }),
    ])

    const { cumplidas, rechazadas } = resumenResultados(resultados)

    expect(cumplidas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)

    const rechazada = rechazadas[0] as PromiseRejectedResult
    expect(esErrorCupo(rechazada.reason)).toBe(true)
    if (esErrorCupo(rechazada.reason)) {
      expect(rechazada.reason.codigo).toBe("LIMITE")
      expect(rechazada.reason.ambito).toBe("PRESUPUESTO")
      expect(rechazada.reason.restantePresupuestoCentavos).toBe(400)
    }

    expect(llamadasDe(estado, "upsert")).toHaveLength(1)
    expect(totalMes(estado)).toBe(600)
    expect(totalMes(estado)).toBeLessThanOrEqual(presupuestoMensualCentavos)

    // Ambos esperaron el lock global compartido; los diarios no se cruzan.
    expect(
      locks.adquiridas.filter((clave) => clave === CLAVE_LOCK_PRESUPUESTO),
    ).toHaveLength(2)
  })

  it("AC-39: dos dias distintos del mismo mes tambien se serializan por el lock global", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const presupuestoMensualCentavos = 1_000

    // Mismo proveedor, dias distintos: los locks diarios no se bloquean entre
    // si; la exclusion la da la clave global.
    const resultados = await Promise.allSettled([
      reservarEnTx(estado, locks, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: new Date("2026-11-12T10:00:00.000Z"),
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos,
      }),
      reservarEnTx(estado, locks, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: new Date("2026-11-20T10:00:00.000Z"),
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos,
      }),
    ])

    const { cumplidas, rechazadas } = resumenResultados(resultados)

    expect(cumplidas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)

    const rechazada = rechazadas[0] as PromiseRejectedResult
    expect(esErrorCupo(rechazada.reason)).toBe(true)
    if (esErrorCupo(rechazada.reason)) {
      expect(rechazada.reason.codigo).toBe("LIMITE")
      expect(rechazada.reason.ambito).toBe("PRESUPUESTO")
    }

    expect(llamadasDe(estado, "upsert")).toHaveLength(1)
    expect(totalMes(estado)).toBe(600)
    expect(totalMes(estado)).toBeLessThanOrEqual(presupuestoMensualCentavos)

    expect(locks.adquiridas).toEqual(
      expect.arrayContaining([
        "GOOGLE_PLACES:2026-11-12",
        "GOOGLE_PLACES:2026-11-20",
        CLAVE_LOCK_PRESUPUESTO,
      ]),
    )
  })

  it("AC-39: dos reservas concurrentes dentro del presupuesto pasan (dos upserts)", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const presupuestoMensualCentavos = 1_000

    const resultados = await Promise.allSettled([
      reservarEnTx(estado, locks, {
        campanaId: "camp-places",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 400,
        presupuestoMensualCentavos,
      }),
      reservarEnTx(estado, locks, {
        campanaId: "camp-resend",
        proveedor: "RESEND",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 400,
        presupuestoMensualCentavos,
      }),
    ])

    const { cumplidas, rechazadas } = resumenResultados(resultados)

    expect(rechazadas).toHaveLength(0)
    expect(cumplidas.map((resultado) => resultado.value)).toEqual([
      { restantes: 19 },
      { restantes: 19 },
    ])

    expect(llamadasDe(estado, "upsert")).toHaveLength(2)
    expect(totalMes(estado)).toBe(800)
    expect(totalMes(estado)).toBeLessThanOrEqual(presupuestoMensualCentavos)
  })

  it("AC-39: el lock global se toma antes del diario y antes de leer el mes", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      await reservarCupo(txFalsa.tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos: 1_000,
      }, { config: CONFIG })
    } finally {
      txFalsa.liberar()
    }

    // Orden exacto: lock global -> lock diario -> lecturas -> upsert.
    expect(estado.llamadas.map((llamada) => llamada.operacion)).toEqual([
      "queryRaw",
      "lock",
      "queryRaw",
      "lock",
      "findManyDia",
      "findManyMes",
      "upsert",
    ])

    const [queryPresupuesto, queryDiario] = llamadasDe(estado, "queryRaw")
    expect(queryPresupuesto?.detalle).toEqual(["PROPUESTAS_PRESUPUESTO"])
    expect(queryDiario?.detalle).toEqual(["GOOGLE_PLACES", "2026-11-12"])

    const eventosLock = llamadasDe(estado, "lock").map(
      (llamada) => llamada.detalle,
    )
    expect(eventosLock).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])
    expect(locks.adquiridas).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])

    const indiceLockMensual = estado.llamadas.findIndex(
      (llamada) =>
        llamada.operacion === "lock" &&
        llamada.detalle === CLAVE_LOCK_PRESUPUESTO,
    )
    const indiceLockDiario = estado.llamadas.findIndex(
      (llamada) =>
        llamada.operacion === "lock" &&
        llamada.detalle === "GOOGLE_PLACES:2026-11-12",
    )
    const indiceLecturaDia = estado.llamadas.findIndex(
      (llamada) => llamada.operacion === "findManyDia",
    )
    const indiceLecturaMes = estado.llamadas.findIndex(
      (llamada) => llamada.operacion === "findManyMes",
    )
    const indiceUpsert = estado.llamadas.findIndex(
      (llamada) => llamada.operacion === "upsert",
    )

    // El mensual precede al diario, y el diario a las lecturas y al upsert.
    expect(indiceLockMensual).toBeGreaterThanOrEqual(0)
    expect(indiceLockDiario).toBeGreaterThan(indiceLockMensual)
    expect(indiceLecturaDia).toBeGreaterThan(indiceLockDiario)
    expect(indiceLecturaMes).toBeGreaterThan(indiceLockDiario)
    expect(indiceUpsert).toBeGreaterThan(indiceLecturaMes)
  })

  it("AC-39: sin presupuesto no toma el lock global ni lee el mes", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      await reservarCupo(txFalsa.tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 600,
        presupuestoMensualCentavos: 0,
      }, { config: CONFIG })
    } finally {
      txFalsa.liberar()
    }

    expect(estado.llamadas.map((llamada) => llamada.operacion)).toEqual([
      "queryRaw",
      "lock",
      "findManyDia",
      "upsert",
    ])
    expect(llamadasDe(estado, "findManyMes")).toHaveLength(0)
    expect(locks.adquiridas).toEqual(["GOOGLE_PLACES:2026-11-12"])
  })

  it("AC-39: costo 0 con presupuesto > 0 toma el lock global pero no lee el mes ni bloquea", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        // Gasto del mes ya por encima del presupuesto: si se leyera el mes,
        // esta reserva sin costo fallaria.
        costoCentavos: 5_000,
        fecha: new Date("2026-11-01T00:00:00.000Z"),
      }),
    ])
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      const resultado = await reservarCupo(txFalsa.tx, {
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        fecha: DIA,
        capDiario: 20,
        costoCentavos: 0,
        presupuestoMensualCentavos: 1_000,
      }, { config: CONFIG })

      expect(resultado).toEqual({ restantes: 19 })
    } finally {
      txFalsa.liberar()
    }

    // Conserva el orden global -> diario aunque no haya chequeo de gasto.
    expect(estado.llamadas.map((llamada) => llamada.operacion)).toEqual([
      "queryRaw",
      "lock",
      "queryRaw",
      "lock",
      "findManyDia",
      "upsert",
    ])
    expect(llamadasDe(estado, "findManyMes")).toHaveLength(0)
    expect(locks.adquiridas).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])

    const upsert = llamadasDe(estado, "upsert")[0]?.detalle as ArgsUpsert
    expect(upsert.create.costoCentavos).toBe(0)
  })

  it("AC-39: dos reservas en la misma tx y otra concurrente no hacen deadlock (global -> diario)", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const presupuestoMensualCentavos = 1_000_000
    const diaA = new Date("2026-11-12T10:00:00.000Z")
    const diaB = new Date("2026-11-20T10:00:00.000Z")
    const opciones = { config: CONFIG, presupuestoMensualCentavos }

    // Con el orden anterior (diario -> global), la tx A y la tx B tomaban
    // primero locks diarios cruzados y despues se esperaban mutuamente por el
    // global: deadlock. Con global -> diario, el global serializa cada
    // transaccion completa antes de cualquier lock diario.
    const resultados = await Promise.allSettled([
      reservarVariasEnTx(
        estado,
        locks,
        [
          {
            campanaId: "camp-1",
            proveedor: "GOOGLE_PLACES",
            fecha: diaA,
            capDiario: 20,
            costoCentavos: 100,
          },
          {
            campanaId: "camp-1",
            proveedor: "RESEND",
            fecha: diaB,
            capDiario: 20,
            costoCentavos: 100,
          },
        ],
        opciones,
        "tx-a",
      ),
      reservarVariasEnTx(
        estado,
        locks,
        [
          {
            campanaId: "camp-1",
            proveedor: "RESEND",
            fecha: diaB,
            capDiario: 20,
            costoCentavos: 100,
          },
          {
            campanaId: "camp-1",
            proveedor: "GOOGLE_PLACES",
            fecha: diaA,
            capDiario: 20,
            costoCentavos: 100,
          },
        ],
        opciones,
        "tx-b",
      ),
    ])

    const { cumplidas, rechazadas } = resumenResultados(resultados)

    // Si hubiera deadlock, ambas promesas quedarian pendientes y el test
    // fallaria por timeout.
    expect(rechazadas).toHaveLength(0)
    expect(cumplidas).toHaveLength(2)
    for (const resultado of cumplidas) {
      expect(resultado.value).toHaveLength(2)
    }

    // Cada tx re-adquirio el lock global sin liberarlo (reentrancia): cuatro
    // concesiones para cuatro reservas y ninguna tx se bloqueo a si misma.
    expect(locks.adquiridas[0]).toBe(CLAVE_LOCK_PRESUPUESTO)
    expect(
      locks.adquiridas.filter((clave) => clave === CLAVE_LOCK_PRESUPUESTO),
    ).toHaveLength(4)

    // Dos filas (una por proveedor/dia), cada una con las dos reservas.
    expect(estado.filas).toHaveLength(2)
    for (const fila of estado.filas) {
      expect(fila.unidades).toBe(2)
      expect(fila.unidades).toBeLessThanOrEqual(20)
      expect(fila.costoCentavos).toBe(200)
    }
    expect(llamadasDe(estado, "upsert")).toHaveLength(4)
    expect(totalMes(estado)).toBe(400)
    expect(totalMes(estado)).toBeLessThanOrEqual(presupuestoMensualCentavos)
  })

  it("AC-39: reservas en meses distintos en la misma tx con orden invertido no hacen deadlock y respetan el presupuesto", async () => {
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const presupuestoMensualCentavos = 1_000
    const diaNov = new Date("2026-11-12T10:00:00.000Z")
    const diaDic = new Date("2026-12-10T10:00:00.000Z")
    const opciones = { config: CONFIG, presupuestoMensualCentavos }

    // Con un lock por mes (YYYY-MM), la tx A tomaba 2026-11 y la tx B 2026-12
    // y despues cada una esperaba el mes de la otra: deadlock. El lock global
    // (sin periodo) serializa la transaccion completa antes de los diarios,
    // aunque una misma tx reserve meses distintos y el orden se invierta.
    const resultados = await Promise.allSettled([
      reservarVariasEnTx(
        estado,
        locks,
        [
          {
            campanaId: "camp-1",
            proveedor: "GOOGLE_PLACES",
            fecha: diaNov,
            capDiario: 20,
            costoCentavos: 200,
          },
          {
            campanaId: "camp-1",
            proveedor: "RESEND",
            fecha: diaDic,
            capDiario: 20,
            costoCentavos: 200,
          },
        ],
        opciones,
        "tx-nov-dic",
      ),
      reservarVariasEnTx(
        estado,
        locks,
        [
          {
            campanaId: "camp-1",
            proveedor: "RESEND",
            fecha: diaDic,
            capDiario: 20,
            costoCentavos: 200,
          },
          {
            campanaId: "camp-1",
            proveedor: "GOOGLE_PLACES",
            fecha: diaNov,
            capDiario: 20,
            costoCentavos: 200,
          },
        ],
        opciones,
        "tx-dic-nov",
      ),
    ])

    const { cumplidas, rechazadas } = resumenResultados(resultados)

    // Si hubiera deadlock, ambas promesas quedarian pendientes y el test
    // fallaria por timeout.
    expect(rechazadas).toHaveLength(0)
    expect(cumplidas).toHaveLength(2)
    for (const resultado of cumplidas) {
      expect(resultado.value).toHaveLength(2)
    }

    // Orden fijo por reserva: lock global -> lock diario. Sin el global, los
    // diarios de meses distintos se cruzarian.
    const claves = locks.adquiridas
    expect(claves[0]).toBe(CLAVE_LOCK_PRESUPUESTO)
    expect(
      claves.filter((clave) => clave === CLAVE_LOCK_PRESUPUESTO),
    ).toHaveLength(4)
    claves.forEach((clave, indice) => {
      if (clave !== CLAVE_LOCK_PRESUPUESTO) {
        expect(claves[indice - 1]).toBe(CLAVE_LOCK_PRESUPUESTO)
      }
    })

    // La clave global no lleva sufijo YYYY-MM aunque se reserven meses distintos.
    expect(CLAVE_LOCK_PRESUPUESTO).not.toMatch(/\d{4}-\d{2}/)
    expect(claves).toEqual(
      expect.arrayContaining([
        "GOOGLE_PLACES:2026-11-12",
        "RESEND:2026-12-10",
      ]),
    )

    // Dos filas (una por mes/proveedor) con las dos reservas cada una; ningun
    // mes supera el presupuesto global compartido.
    expect(estado.filas).toHaveLength(2)
    for (const fila of estado.filas) {
      expect(fila.unidades).toBe(2)
      expect(fila.costoCentavos).toBe(400)
    }
    expect(llamadasDe(estado, "upsert")).toHaveLength(4)
    expect(totalMes(estado, "2026-11")).toBe(400)
    expect(totalMes(estado, "2026-12")).toBe(400)
    expect(totalMes(estado, "2026-11")).toBeLessThanOrEqual(
      presupuestoMensualCentavos,
    )
    expect(totalMes(estado, "2026-12")).toBeLessThanOrEqual(
      presupuestoMensualCentavos,
    )
  })

  it("AC-39: config > 0 es autoritativa; el override 0 en la reserva no desactiva el lock ni el chequeo", async () => {
    const config = configConPresupuesto(500)
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 400,
      }),
    ])
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      const error = await capturarErrorCupo(
        reservarCupo(txFalsa.tx, {
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          fecha: DIA,
          capDiario: 20,
          costoCentavos: 200,
          presupuestoMensualCentavos: 0,
        }, { config }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("PRESUPUESTO")
      expect(error.restantePresupuestoCentavos).toBe(100)
    } finally {
      txFalsa.liberar()
    }

    expect(llamadasDe(estado, "findManyMes")).toHaveLength(1)
    expect(llamadasDe(estado, "upsert")).toHaveLength(0)
    expect(locks.adquiridas).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])
  })

  it("AC-39: config > 0 es autoritativa; el override 0 en opciones no desactiva el lock ni el chequeo", async () => {
    const config = configConPresupuesto(500)
    const estado = crearEstado()
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      const error = await capturarErrorCupo(
        reservarCupo(txFalsa.tx, {
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          fecha: DIA,
          capDiario: 20,
          costoCentavos: 600,
        }, { config, presupuestoMensualCentavos: 0 }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("PRESUPUESTO")
      expect(error.restantePresupuestoCentavos).toBe(500)
    } finally {
      txFalsa.liberar()
    }

    expect(llamadasDe(estado, "findManyMes")).toHaveLength(1)
    expect(llamadasDe(estado, "upsert")).toHaveLength(0)
    expect(locks.adquiridas).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])
  })

  it("AC-39: con config 0 el override del presupuesto si se aplica", async () => {
    const estado = crearEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 900,
      }),
    ])
    const locks = crearGestorLocks()
    const txFalsa = crearTxFalsa(estado, locks)

    try {
      const error = await capturarErrorCupo(
        reservarCupo(txFalsa.tx, {
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          fecha: DIA,
          capDiario: 20,
          costoCentavos: 200,
        }, { config: CONFIG, presupuestoMensualCentavos: 1_000 }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("PRESUPUESTO")
      expect(error.restantePresupuestoCentavos).toBe(100)
    } finally {
      txFalsa.liberar()
    }

    expect(llamadasDe(estado, "findManyMes")).toHaveLength(1)
    expect(llamadasDe(estado, "upsert")).toHaveLength(0)
    expect(locks.adquiridas).toEqual([
      CLAVE_LOCK_PRESUPUESTO,
      "GOOGLE_PLACES:2026-11-12",
    ])
  })
})

// ---------------------------------------------------------------------------
// estadoCupos
// ---------------------------------------------------------------------------

interface ClienteEstadoFake {
  cliente: NonNullable<OpcionesEstadoCupos["cliente"]>
  llamadas: ArgsFindMany[]
}

function crearClienteEstado(filas: FilaConsumoFake[]): ClienteEstadoFake {
  const llamadas: ArgsFindMany[] = []

  const cliente = {
    consumoProveedor: {
      findMany: async (args: ArgsFindMany) => {
        llamadas.push(args)

        const coincideAmbito = (fila: FilaConsumoFake): boolean => {
          if (
            args.where.campanaId !== undefined &&
            fila.campanaId !== args.where.campanaId
          ) {
            return false
          }
          if (
            args.where.prospectoId !== undefined &&
            fila.prospectoId !== args.where.prospectoId
          ) {
            return false
          }
          return true
        }

        if (args.where.fecha instanceof Date) {
          return filas
            .filter((fila) => coincidenDia(fila, args.where))
            .filter(coincideAmbito)
            .map((fila) => ({
              proveedor: fila.proveedor,
              unidades: fila.unidades,
              llamadas: fila.llamadas,
              costoCentavos: fila.costoCentavos,
            }))
        }

        return filas
          .filter((fila) =>
            coincidenMes(fila, args.where.fecha as { gte: Date; lt: Date }),
          )
          .map((fila) => ({ costoCentavos: fila.costoCentavos }))
      },
    },
  }

  return {
    cliente: cliente as unknown as NonNullable<
      OpcionesEstadoCupos["cliente"]
    >,
    llamadas,
  }
}

function filasEstado(): FilaConsumoFake[] {
  return [
    crearFila({
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      unidades: 10,
      llamadas: 10,
      costoCentavos: 100,
    }),
    crearFila({
      campanaId: "camp-2",
      proveedor: "GOOGLE_PLACES",
      unidades: 6,
      llamadas: 6,
      costoCentavos: 50,
    }),
    crearFila({
      campanaId: "camp-1",
      proveedor: "WEB_FETCH",
      unidades: 5,
      llamadas: 5,
      costoCentavos: 0,
    }),
    crearFila({
      campanaId: "camp-1",
      proveedor: "AUDITORIA",
      unidades: 1,
      llamadas: 1,
      costoCentavos: 0,
    }),
    crearFila({
      campanaId: "camp-1",
      proveedor: "RESEND",
      unidades: 2,
      llamadas: 2,
      costoCentavos: 200,
    }),
    crearFila({
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      unidades: 999,
      llamadas: 999,
      costoCentavos: 9_999,
      fecha: new Date("2026-10-31T00:00:00.000Z"),
    }),
  ]
}

describe("T-11 estadoCupos: agregados de solo lectura (AC-38, AC-39)", () => {
  it("AC-38: agrega por proveedor/dia, total y presupuesto mensual", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA_CON_HORA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    expect(estado.fecha).toEqual(DIA)
    expect(estado.proveedores.map((p) => p.proveedor)).toEqual([
      ...PROVEEDORES_CONSUMO,
    ])

    const places = estado.proveedores.find(
      (p) => p.proveedor === "GOOGLE_PLACES",
    )
    expect(places).toEqual({
      proveedor: "GOOGLE_PLACES",
      usado: 16,
      cap: 20,
      restante: 4,
      alerta: true,
      llamadas: 16,
      costoCentavos: 150,
    })

    const web = estado.proveedores.find((p) => p.proveedor === "WEB_FETCH")
    expect(web).toMatchObject({
      usado: 5,
      cap: 100,
      restante: 95,
      alerta: false,
    })

    const auditoria = estado.proveedores.find(
      (p) => p.proveedor === "AUDITORIA",
    )
    expect(auditoria).toMatchObject({
      usado: 1,
      cap: 20,
      restante: 19,
      alerta: false,
    })

    const resend = estado.proveedores.find((p) => p.proveedor === "RESEND")
    expect(resend).toMatchObject({
      usado: 2,
      cap: 20,
      restante: 18,
      alerta: false,
      costoCentavos: 200,
    })

    expect(estado.totalCostoCentavos).toBe(350)
    expect(estado.presupuestoMensualCentavos).toBe(1_000)
    expect(estado.gastadoMesCentavos).toBe(350)
    expect(estado.restanteMesCentavos).toBe(650)
    expect(estado.alertaPresupuesto).toBe(false)

    // Solo lectura: una consulta del dia y una del mes, sin upsert.
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0]?.where.fecha).toEqual(DIA)
  })

  it("AC-38: sin presupuesto configurado ni override el mes queda en null y no se consulta", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
    })

    expect(estado.presupuestoMensualCentavos).toBe(0)
    expect(estado.gastadoMesCentavos).toBeNull()
    expect(estado.restanteMesCentavos).toBeNull()
    expect(estado.alertaPresupuesto).toBe(false)
    expect(llamadas).toHaveLength(1)
  })

  it("AC-39: config > 0 es autoritativa en estadoCupos; el override 0 no la desactiva", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA, {
      cliente,
      config: configConPresupuesto(1_000),
      presupuestoMensualCentavos: 0,
    })

    expect(estado.presupuestoMensualCentavos).toBe(1_000)
    expect(estado.gastadoMesCentavos).toBe(350)
    expect(estado.restanteMesCentavos).toBe(650)
    expect(estado.alertaPresupuesto).toBe(false)

    // La config activa la lectura mensual igual que en `reservarCupo`:
    // consulta del dia + consulta del mes (sin upsert).
    expect(llamadas).toHaveLength(2)
    expect(llamadas[1]?.where.fecha).toMatchObject({
      gte: new Date("2026-11-01T00:00:00.000Z"),
      lt: new Date("2026-12-01T00:00:00.000Z"),
    })
  })

  it("AC-39: config > 0 con gasto sobre el umbral alerta aunque el override sea 0", async () => {
    const { cliente } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA, {
      cliente,
      config: configConPresupuesto(400),
      presupuestoMensualCentavos: 0,
    })

    expect(estado.presupuestoMensualCentavos).toBe(400)
    expect(estado.gastadoMesCentavos).toBe(350)
    expect(estado.restanteMesCentavos).toBe(50)
    // 350/400 = 87,5% >= 80%: el override 0 no silencia la alerta.
    expect(estado.alertaPresupuesto).toBe(true)
  })

  it("AC-39: con config 0 el override de presupuesto se usa para gasto, restante y alerta", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    expect(estado.presupuestoMensualCentavos).toBe(1_000)
    expect(estado.gastadoMesCentavos).toBe(350)
    expect(estado.restanteMesCentavos).toBe(650)
    expect(estado.alertaPresupuesto).toBe(false)
    expect(llamadas).toHaveLength(2)
  })

  it("AC-38: usa caps inyectados y recorta restante en cero", async () => {
    const { cliente } = crearClienteEstado(filasEstado())

    const estado = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
      caps: { GOOGLE_PLACES: 10, WEB_FETCH: 5 },
      presupuestoMensualCentavos: 0,
    })

    const places = estado.proveedores.find(
      (p) => p.proveedor === "GOOGLE_PLACES",
    )
    expect(places).toMatchObject({
      cap: 10,
      usado: 16,
      restante: 0,
      alerta: true,
    })

    const web = estado.proveedores.find((p) => p.proveedor === "WEB_FETCH")
    expect(web).toMatchObject({
      cap: 5,
      usado: 5,
      restante: 0,
      alerta: true,
    })
  })

  it("AC-39: umbral custom controla la alerta de cupo y de presupuesto", async () => {
    const filas = [
      crearFila({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 10,
        costoCentavos: 500,
        // 10/20 = 50%: no alerta con 80%, si con 50%.
      }),
    ]
    const { cliente } = crearClienteEstado(filas)

    const conDefault = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })
    expect(
      conDefault.proveedores.find((p) => p.proveedor === "GOOGLE_PLACES")
        ?.alerta,
    ).toBe(false)
    expect(conDefault.alertaPresupuesto).toBe(false)

    const conUmbral = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
      umbral: 0.5,
    })
    expect(
      conUmbral.proveedores.find((p) => p.proveedor === "GOOGLE_PLACES")
        ?.alerta,
    ).toBe(true)
    expect(conUmbral.alertaPresupuesto).toBe(true)
    expect(conUmbral.restanteMesCentavos).toBe(500)
  })

  it("AC-39: presupuesto al 80% alerta sin bloquear la lectura", async () => {
    const { cliente } = crearClienteEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 1,
        costoCentavos: 800,
      }),
    ])

    const estado = await estadoCupos(DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    expect(estado.alertaPresupuesto).toBe(true)
    expect(estado.restanteMesCentavos).toBe(200)
  })

  it("AC-38: un cap 0 en config no inventa cupo y no alerta", async () => {
    const { cliente } = crearClienteEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "AUDITORIA",
        unidades: 4,
        costoCentavos: 0,
      }),
    ])
    const configSinAuditorias: ConfigConsumo = {
      ...CONFIG,
      cupos: { ...CONFIG.cupos, auditoriasDia: 0 },
    }

    const estado = await estadoCupos(DIA, {
      cliente,
      config: configSinAuditorias,
      presupuestoMensualCentavos: 0,
    })

    const auditoria = estado.proveedores.find(
      (p) => p.proveedor === "AUDITORIA",
    )
    expect(auditoria).toMatchObject({
      usado: 4,
      cap: 0,
      restante: 0,
      alerta: false,
    })
  })

  it("AC-38: filas con unidades o costos invalidos -> ErrorCupo, no datos a medias", async () => {
    const invalidas: FilaConsumoFake[][] = [
      [
        crearFila({
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          unidades: -1,
          costoCentavos: 0,
        }),
      ],
      [
        crearFila({
          campanaId: "camp-1",
          proveedor: "GOOGLE_PLACES",
          unidades: 1,
          costoCentavos: -5,
        }),
      ],
      [
        {
          ...crearFila({
            campanaId: "camp-1",
            proveedor: "GOOGLE_PLACES",
            unidades: 1,
            costoCentavos: 0,
          }),
          proveedor: "OTRO" as unknown as ProveedorConsumoCupo,
        },
      ],
    ]

    for (const filas of invalidas) {
      const { cliente } = crearClienteEstado(filas)

      const error = await capturarErrorCupo(
        estadoCupos(DIA, {
          cliente,
          config: CONFIG,
          presupuestoMensualCentavos: 0,
        }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("CONFIGURACION")
    }
  })
})

// ---------------------------------------------------------------------------
// T-21: consumo acotado por campana/prospecto
// ---------------------------------------------------------------------------

function filasPorAmbito(): FilaConsumoFake[] {
  return [
    crearFila({
      campanaId: "camp-1",
      proveedor: "GOOGLE_PLACES",
      unidades: 16,
      llamadas: 16,
      costoCentavos: 160,
    }),
    crearFila({
      campanaId: "camp-2",
      proveedor: "GOOGLE_PLACES",
      unidades: 10,
      llamadas: 10,
      costoCentavos: 100,
    }),
    crearFila({
      campanaId: "camp-1",
      prospectoId: "pros-1",
      proveedor: "WEB_FETCH",
      unidades: 5,
      llamadas: 5,
      costoCentavos: 0,
    }),
    crearFila({
      campanaId: "camp-1",
      prospectoId: "pros-1",
      proveedor: "AUDITORIA",
      unidades: 1,
      llamadas: 1,
      costoCentavos: 0,
    }),
    crearFila({
      campanaId: "camp-1",
      prospectoId: "pros-2",
      proveedor: "RESEND",
      unidades: 2,
      llamadas: 2,
      costoCentavos: 200,
    }),
  ]
}

describe("T-21 estadoConsumoCampana: consumo por campaña (AC-38, AC-39)", () => {
  it("AC-38: filtra por campaña/día, agrega por proveedor y el presupuesto mensual sigue siendo global", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasPorAmbito())

    const estado = await estadoConsumoCampana("camp-1", DIA_CON_HORA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    expect(estado.fecha).toEqual(DIA)
    expect(llamadas).toHaveLength(2)

    // La consulta del dia se acota; la del mes no (presupuesto global).
    expect(llamadas[0]?.where).toEqual({ fecha: DIA, campanaId: "camp-1" })
    expect(llamadas[1]?.where).toMatchObject({
      fecha: {
        gte: new Date("2026-11-01T00:00:00.000Z"),
        lt: new Date("2026-12-01T00:00:00.000Z"),
      },
    })
    expect(llamadas[1]?.where).not.toHaveProperty("campanaId")

    const places = estado.proveedores.find(
      (fila) => fila.proveedor === "GOOGLE_PLACES",
    )
    expect(places).toMatchObject({
      usado: 16,
      cap: 20,
      restante: 4,
      alerta: true,
      bloqueado: false,
      costoCentavos: 160,
    })

    const resend = estado.proveedores.find(
      (fila) => fila.proveedor === "RESEND",
    )
    expect(resend).toMatchObject({ usado: 2, costoCentavos: 200 })

    // Solo el consumo de camp-1 en el dia; el gasto del mes suma todo.
    expect(estado.totalCostoCentavos).toBe(360)
    expect(estado.presupuestoMensualCentavos).toBe(1_000)
    expect(estado.gastadoMesCentavos).toBe(460)
    expect(estado.restanteMesCentavos).toBe(540)
    expect(estado.alertaPresupuesto).toBe(false)
    expect(estado.presupuestoBloqueado).toBe(false)
  })

  it("AC-39: 80% avisa, 100% bloquea y cap 0 no alerta ni inventa cupo", async () => {
    const { cliente } = crearClienteEstado([
      crearFila({
        campanaId: "camp-1",
        proveedor: "WEB_FETCH",
        unidades: 100,
        llamadas: 100,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "AUDITORIA",
        unidades: 16,
        llamadas: 16,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "REDACTOR",
        unidades: 3,
        llamadas: 3,
        costoCentavos: 0,
      }),
    ])
    const config: ConfigConsumo = {
      ...CONFIG,
      cupos: { ...CONFIG.cupos, borradoresDia: 0 },
    }

    const estado = await estadoConsumoCampana("camp-1", DIA, {
      cliente,
      config,
    })

    const web = estado.proveedores.find((fila) => fila.proveedor === "WEB_FETCH")
    expect(web).toMatchObject({
      usado: 100,
      cap: 100,
      restante: 0,
      alerta: true,
      bloqueado: true,
    })

    const auditoria = estado.proveedores.find(
      (fila) => fila.proveedor === "AUDITORIA",
    )
    expect(auditoria).toMatchObject({
      usado: 16,
      cap: 20,
      restante: 4,
      alerta: true,
      bloqueado: false,
    })

    const redactor = estado.proveedores.find(
      (fila) => fila.proveedor === "REDACTOR",
    )
    expect(redactor).toMatchObject({
      usado: 3,
      cap: 0,
      restante: 0,
      alerta: false,
      bloqueado: false,
    })
  })

  it("AC-39: el tope duro del presupuesto se refleja como bloqueado aunque no haya cupo de proveedor agotado", async () => {
    const { cliente } = crearClienteEstado(filasPorAmbito())

    const estado = await estadoConsumoCampana("camp-1", DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 300,
    })

    expect(estado.gastadoMesCentavos).toBe(460)
    expect(estado.restanteMesCentavos).toBe(0)
    expect(estado.alertaPresupuesto).toBe(true)
    expect(estado.presupuestoBloqueado).toBe(true)
  })

  it("AC-38: ids inválidos fallan cerrado antes de consultar y no hay escrituras", async () => {
    for (const id of ["", "   ", "camp:1", "a".repeat(129)]) {
      const { cliente, llamadas } = crearClienteEstado(filasPorAmbito())

      const error = await capturarErrorCupo(
        estadoConsumoCampana(id, DIA, { cliente, config: CONFIG }),
      )

      expect(error.ambito).toBe("VALIDACION")
      expect(llamadas).toHaveLength(0)
    }
  })
})

describe("T-21 estadoConsumoProspecto: consumo por prospecto (AC-38, AC-39)", () => {
  it("AC-38: filtra por prospecto/día y agrega fetches, auditoría y borrador sin Places global", async () => {
    const { cliente, llamadas } = crearClienteEstado(filasPorAmbito())

    const estado = await estadoConsumoProspecto("pros-1", DIA_CON_HORA, {
      cliente,
      config: CONFIG,
    })

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]?.where).toEqual({
      fecha: DIA,
      prospectoId: "pros-1",
    })

    const usados = estado.proveedores
      .filter((fila) => fila.usado > 0)
      .map((fila) => [fila.proveedor, fila.usado])
    expect(usados).toEqual([
      ["WEB_FETCH", 5],
      ["AUDITORIA", 1],
    ])
    expect(estado.totalCostoCentavos).toBe(0)
    expect(estado.presupuestoMensualCentavos).toBe(0)
    expect(estado.gastadoMesCentavos).toBeNull()
  })

  it("AC-39: el 100% del prospecto se marca bloqueado con restante 0", async () => {
    const { cliente } = crearClienteEstado([
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-1",
        proveedor: "WEB_FETCH",
        unidades: 100,
        llamadas: 100,
        costoCentavos: 0,
      }),
    ])

    const estado = await estadoConsumoProspecto("pros-1", DIA, {
      cliente,
      config: CONFIG,
    })

    const web = estado.proveedores.find((fila) => fila.proveedor === "WEB_FETCH")
    expect(web).toMatchObject({
      usado: 100,
      cap: 100,
      restante: 0,
      alerta: true,
      bloqueado: true,
    })
  })

  it("AC-38: ids inválidos fallan cerrado antes de consultar y no hay escrituras", async () => {
    for (const id of ["", "   ", "pros:1", "a".repeat(129)]) {
      const { cliente, llamadas } = crearClienteEstado(filasPorAmbito())

      const error = await capturarErrorCupo(
        estadoConsumoProspecto(id, DIA, { cliente, config: CONFIG }),
      )

      expect(error.ambito).toBe("VALIDACION")
      expect(llamadas).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// T-21: helpers de estado acotado (lectura pura, sin locks ni escrituras)
// ---------------------------------------------------------------------------

/**
 * Cliente inyectado de solo lectura. `findMany` reproduce el filtro por día y
 * el rango mensual; `upsert` y `$queryRaw` fallan si el helper intenta escribir
 * o tomar locks. Devuelve las espías para verificar llamadas exactas.
 */
function crearClienteSoloLectura(filas: FilaConsumoFake[]) {
  const findMany = vi.fn(async (args: ArgsFindMany) => {
    const where = args.where

    if (where.fecha instanceof Date) {
      return filas
        .filter((fila) => coincidenDia(fila, where))
        .filter(
          (fila) =>
            where.campanaId === undefined ||
            fila.campanaId === where.campanaId,
        )
        .filter(
          (fila) =>
            where.prospectoId === undefined ||
            fila.prospectoId === where.prospectoId,
        )
        .map((fila) => ({
          proveedor: fila.proveedor,
          unidades: fila.unidades,
          llamadas: fila.llamadas,
          costoCentavos: fila.costoCentavos,
        }))
    }

    return filas
      .filter((fila) =>
        coincidenMes(fila, where.fecha as { gte: Date; lt: Date }),
      )
      .map((fila) => ({ costoCentavos: fila.costoCentavos }))
  })

  const upsert = vi.fn(async () => {
    throw new Error("El estado de consumo no debe escribir.")
  })
  const queryRaw = vi.fn(async () => {
    throw new Error("El estado de consumo no debe tomar locks.")
  })

  const cliente = {
    $queryRaw: queryRaw,
    consumoProveedor: { findMany, upsert },
  } as unknown as NonNullable<OpcionesEstadoCupos["cliente"]>

  return { cliente, findMany, upsert, queryRaw }
}

describe("T-21 helpers de consumo: agregados acotados y solo lectura (AC-38, AC-39)", () => {
  it("AC-38/AC-39: campaña agrega por proveedor/día, respeta el tope y no escribe", async () => {
    const filas = [
      crearFila({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 16,
        llamadas: 14,
        costoCentavos: 160,
      }),
      crearFila({
        campanaId: "camp-2",
        proveedor: "GOOGLE_PLACES",
        unidades: 99,
        llamadas: 99,
        costoCentavos: 990,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "WEB_FETCH",
        unidades: 99,
        llamadas: 99,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "AUDITORIA",
        unidades: 1,
        llamadas: 1,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "REDACTOR",
        unidades: 20,
        llamadas: 20,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "RESEND",
        unidades: 2,
        llamadas: 2,
        costoCentavos: 200,
      }),
      // Mes anterior: no debe entrar ni en el día ni en el presupuesto mensual.
      crearFila({
        campanaId: "camp-1",
        proveedor: "GOOGLE_PLACES",
        unidades: 999,
        llamadas: 999,
        costoCentavos: 9_999,
        fecha: new Date("2026-10-31T00:00:00.000Z"),
      }),
    ]
    const { cliente, findMany, upsert, queryRaw } =
      crearClienteSoloLectura(filas)

    const estado = await estadoConsumoCampana("camp-1", DIA_CON_HORA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    // Una consulta del día acotada + una del mes global; sin locks ni upsert.
    expect(findMany).toHaveBeenCalledTimes(2)
    const llamadaDia = findMany.mock.calls[0]?.[0]
    const llamadaMes = findMany.mock.calls[1]?.[0]
    expect(llamadaDia?.where).toEqual({ fecha: DIA, campanaId: "camp-1" })
    expect(llamadaMes?.where).toMatchObject({
      fecha: {
        gte: new Date("2026-11-01T00:00:00.000Z"),
        lt: new Date("2026-12-01T00:00:00.000Z"),
      },
    })
    expect(llamadaMes?.where).not.toHaveProperty("campanaId")
    expect(upsert).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()

    expect(estado.fecha).toEqual(DIA)
    expect(estado.proveedores.map((fila) => fila.proveedor)).toEqual([
      ...PROVEEDORES_CONSUMO,
    ])

    const places = estado.proveedores.find(
      (fila) => fila.proveedor === "GOOGLE_PLACES",
    )
    expect(places).toMatchObject({
      usado: 16,
      cap: 20,
      restante: 4,
      alerta: true,
      bloqueado: false,
      llamadas: 14,
      costoCentavos: 160,
    })

    const web = estado.proveedores.find(
      (fila) => fila.proveedor === "WEB_FETCH",
    )
    expect(web).toMatchObject({
      usado: 99,
      cap: 100,
      restante: 1,
      alerta: true,
      bloqueado: false,
      costoCentavos: 0,
    })

    // Justo en el 100%: bloqueado sin depender de la UI.
    const redactor = estado.proveedores.find(
      (fila) => fila.proveedor === "REDACTOR",
    )
    expect(redactor).toMatchObject({
      usado: 20,
      cap: 20,
      restante: 0,
      alerta: true,
      bloqueado: true,
    })

    // Sin sobreconsumo silencioso: restante = max(0, cap - usado) siempre.
    for (const fila of estado.proveedores) {
      expect(fila.restante).toBe(Math.max(0, fila.cap - fila.usado))
      expect(fila.restante).toBeGreaterThanOrEqual(0)
    }

    expect(estado.totalCostoCentavos).toBe(360)
    expect(estado.presupuestoMensualCentavos).toBe(1_000)
    // El mes suma todas las campañas (camp-1 + camp-2) y excluye octubre.
    expect(estado.gastadoMesCentavos).toBe(1_350)
    expect(estado.restanteMesCentavos).toBe(0)
    expect(estado.alertaPresupuesto).toBe(true)
    expect(estado.presupuestoBloqueado).toBe(true)
  })

  it("AC-38/AC-39: prospecto agrega solo su consumo y reporta el exceso sin negativos", async () => {
    const filas = [
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-1",
        proveedor: "WEB_FETCH",
        unidades: 60,
        llamadas: 60,
        costoCentavos: 0,
      }),
      // Mismo prospecto en otra campaña (dato anómalo): se agrega igual.
      crearFila({
        campanaId: "camp-2",
        prospectoId: "pros-1",
        proveedor: "WEB_FETCH",
        unidades: 45,
        llamadas: 45,
        costoCentavos: 0,
      }),
      // Otro prospecto: no debe sumarse al ámbito pedido.
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-2",
        proveedor: "WEB_FETCH",
        unidades: 999,
        llamadas: 999,
        costoCentavos: 999,
      }),
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-1",
        proveedor: "AUDITORIA",
        unidades: 20,
        llamadas: 20,
        costoCentavos: 0,
      }),
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-1",
        proveedor: "RESEND",
        unidades: 1,
        llamadas: 1,
        costoCentavos: 100,
      }),
    ]
    const { cliente, findMany, upsert, queryRaw } =
      crearClienteSoloLectura(filas)

    const estado = await estadoConsumoProspecto("pros-1", DIA_CON_HORA, {
      cliente,
      config: CONFIG,
    })

    // Sin presupuesto configurado solo se consulta el día acotado.
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0]?.where).toEqual({
      fecha: DIA,
      prospectoId: "pros-1",
    })
    expect(upsert).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()

    const web = estado.proveedores.find(
      (fila) => fila.proveedor === "WEB_FETCH",
    )
    expect(web).toMatchObject({
      usado: 105,
      cap: 100,
      restante: 0,
      alerta: true,
      bloqueado: true,
      llamadas: 105,
      costoCentavos: 0,
    })

    const auditoria = estado.proveedores.find(
      (fila) => fila.proveedor === "AUDITORIA",
    )
    expect(auditoria).toMatchObject({
      usado: 20,
      cap: 20,
      restante: 0,
      alerta: true,
      bloqueado: true,
    })

    const resend = estado.proveedores.find(
      (fila) => fila.proveedor === "RESEND",
    )
    expect(resend).toMatchObject({
      usado: 1,
      cap: 20,
      restante: 19,
      alerta: false,
      bloqueado: false,
      costoCentavos: 100,
    })

    expect(estado.totalCostoCentavos).toBe(100)
    expect(estado.presupuestoMensualCentavos).toBe(0)
    expect(estado.gastadoMesCentavos).toBeNull()
    expect(estado.restanteMesCentavos).toBeNull()
    expect(estado.presupuestoBloqueado).toBe(false)
  })

  it("AC-38/AC-39: el presupuesto mensual es global aunque el ámbito no haya gastado", async () => {
    const filas = [
      crearFila({
        campanaId: "camp-2",
        proveedor: "RESEND",
        unidades: 1,
        llamadas: 1,
        costoCentavos: 1_000,
      }),
      crearFila({
        campanaId: "camp-1",
        proveedor: "WEB_FETCH",
        unidades: 1,
        llamadas: 1,
        costoCentavos: 0,
      }),
    ]
    const { cliente, findMany } = crearClienteSoloLectura(filas)

    const estado = await estadoConsumoCampana("camp-1", DIA, {
      cliente,
      config: CONFIG,
      presupuestoMensualCentavos: 1_000,
    })

    expect(findMany).toHaveBeenCalledTimes(2)
    // La campaña no gastó, pero el presupuesto global ya está agotado.
    expect(estado.totalCostoCentavos).toBe(0)
    expect(estado.gastadoMesCentavos).toBe(1_000)
    expect(estado.restanteMesCentavos).toBe(0)
    expect(estado.alertaPresupuesto).toBe(true)
    expect(estado.presupuestoBloqueado).toBe(true)
  })

  it("AC-38: ids invalidos (incluido cero) fallan cerrado antes de consultar", async () => {
    const idsInvalidos = [
      0,
      null,
      undefined,
      "",
      "   ",
      "a".repeat(129),
    ] as const

    for (const id of idsInvalidos) {
      const { cliente, findMany } = crearClienteSoloLectura(filasPorAmbito())

      const error = await capturarErrorCupo(
        estadoConsumoCampana(id as unknown as string, DIA, {
          cliente,
          config: CONFIG,
        }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("VALIDACION")
      expect(findMany).not.toHaveBeenCalled()
    }

    for (const id of [0, null, undefined, "", "   ", "p:1"] as const) {
      const { cliente, findMany } = crearClienteSoloLectura(filasPorAmbito())

      const error = await capturarErrorCupo(
        estadoConsumoProspecto(id as unknown as string, DIA, {
          cliente,
          config: CONFIG,
        }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("VALIDACION")
      expect(findMany).not.toHaveBeenCalled()
    }
  })

  it.each([-1, 1.5, Number.NaN])(
    "AC-39: presupuesto invalido (%j) falla cerrado sin consultar",
    async (presupuesto) => {
      const { cliente, findMany } = crearClienteSoloLectura([])

      const error = await capturarErrorCupo(
        estadoConsumoCampana("camp-1", DIA, {
          cliente,
          config: CONFIG,
          presupuestoMensualCentavos: presupuesto,
        }),
      )

      expect(error.codigo).toBe("LIMITE")
      expect(error.ambito).toBe("CONFIGURACION")
      expect(findMany).not.toHaveBeenCalled()
    },
  )

  it("AC-38: usa el cliente inyectado y no escribe ni toma locks", async () => {
    const { cliente, findMany, upsert, queryRaw } =
      crearClienteSoloLectura([])

    const estado = await estadoConsumoProspecto("pros-1", DIA, {
      cliente,
      config: CONFIG,
    })

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(upsert).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()
    expect(estado.proveedores).toHaveLength(PROVEEDORES_CONSUMO.length)
    expect(estado.proveedores.every((fila) => fila.usado === 0)).toBe(true)
  })

  it("AC-38: cap <= 0 se informa sin inventar cupo, restante ni alerta", async () => {
    const config: ConfigConsumo = {
      ...CONFIG,
      cupos: { ...CONFIG.cupos, fetchesDia: 0 },
    }
    const { cliente } = crearClienteSoloLectura([
      crearFila({
        campanaId: "camp-1",
        prospectoId: "pros-1",
        proveedor: "WEB_FETCH",
        unidades: 5,
        llamadas: 5,
        costoCentavos: 0,
      }),
    ])

    const estado = await estadoConsumoProspecto("pros-1", DIA, {
      cliente,
      config,
    })

    const web = estado.proveedores.find(
      (fila) => fila.proveedor === "WEB_FETCH",
    )
    expect(web).toMatchObject({
      usado: 5,
      cap: 0,
      restante: 0,
      alerta: false,
      bloqueado: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Test estatico: aislamiento de Prisma/CRM
// ---------------------------------------------------------------------------

describe("T-11 aislamiento estatico (AC-38, RF-58)", () => {
  const DIR = path.join(process.cwd(), "src", "lib", "propuestas")

  function fuente(nombre: string): string {
    return readFileSync(path.join(DIR, nombre), "utf8")
  }

  it("AC-38: consumo.ts no importa el singleton de Prisma en tiempo de carga", () => {
    const codigo = fuente("consumo.ts")

    // El tipo Prisma puede importarse con `import type` (se borra al compilar).
    expect(codigo).toMatch(
      /import\s+type\s*\{[^}]*\bPrisma\b[^}]*\}\s*from\s+["']@prisma\/client["']/,
    )

    // Nada de `import ... from "@/lib/prisma"` ni side-effect imports.
    expect(codigo).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
    expect(codigo).not.toMatch(/^\s*import\s+["']@\/lib\/prisma["']/m)

    // El singleton solo se carga de forma dinamica y como fallback.
    expect(codigo).toMatch(
      /await import\(\s*["']@\/lib\/prisma["']\s*\)/,
    )
    expect(codigo).not.toMatch(
      /prisma\s*\.\s*(prospecto|campana|cliente|pago|consumoProveedor)\b/,
    )
  })

  it("AC-38: places.ts no toca Prisma ni el CRM", () => {
    const codigo = fuente("places.ts")

    expect(codigo).not.toMatch(/@prisma\/client/)
    expect(codigo).not.toMatch(/@\/lib\/prisma/)
    expect(codigo).not.toMatch(/\bprisma\s*\./)
    expect(codigo).not.toMatch(/requireStaff|requireAdmin/)
    expect(codigo).not.toMatch(/\bclienteId\b|\bpagoId\b|\bsuscripcionId\b/)
  })

  it("AC-8: places.ts solo usa la API oficial (sin Maps scrapeado ni SERP)", () => {
    const codigo = fuente("places.ts")

    expect(codigo).toMatch(
      /https:\/\/places\.googleapis\.com\/v1\/places:searchText/,
    )
    expect(codigo).not.toMatch(/maps\.googleapis\.com|google\.com\/maps/)
    expect(codigo).not.toMatch(/puppeteer|playwright|cheerio|scrap/i)
  })
})
