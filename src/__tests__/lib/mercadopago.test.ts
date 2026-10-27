import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-18 (AC-13, AC-20): el webhook MP resuelve el `EnlacePago` que origino la
 * preferencia leyendo `metadata.enlaceId` con `obtenerPagoMp`.
 *
 * El SDK de Mercado Pago se mockea: no hay red ni credenciales reales. Se
 * verifica el mapeo del pago (incluido `enlaceId` recortado y los legacy sin
 * metadata) que consumen las rutas de admin y el webhook.
 */

const mocks = vi.hoisted(() => {
  const get = vi.fn()
  const Payment = vi.fn(function (this: unknown) {
    return { get }
  })
  const MercadoPagoConfig = vi.fn(function (this: unknown) {
    return {}
  })
  const Preference = vi.fn(function (this: unknown) {
    return {}
  })

  return { get, Payment, MercadoPagoConfig, Preference }
})

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: mocks.MercadoPagoConfig,
  Preference: mocks.Preference,
  Payment: mocks.Payment,
}))

import { obtenerPagoMp } from "@/lib/mercadopago"

function pagoSdk(overrides: Record<string, unknown> = {}) {
  return {
    id: 987654,
    status: "approved",
    external_reference: "hito_1",
    transaction_amount: 5000,
    metadata: { tipo: "hito", meses: 3, enlaceId: " enlace_1 " },
    ...overrides,
  }
}

const TOKEN_PREVIO = process.env.MP_ACCESS_TOKEN

describe("obtenerPagoMp: metadata de la preferencia (T-18, AC-13, AC-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MP_ACCESS_TOKEN = "mp_access_token_test"
    mocks.get.mockResolvedValue(pagoSdk())
  })

  afterAll(() => {
    if (TOKEN_PREVIO === undefined) delete process.env.MP_ACCESS_TOKEN
    else process.env.MP_ACCESS_TOKEN = TOKEN_PREVIO
  })

  it("mapea el pago y recorta el enlaceId de la metadata", async () => {
    const pago = await obtenerPagoMp("987654")

    expect(mocks.Payment).toHaveBeenCalledTimes(1)
    expect(mocks.get).toHaveBeenCalledWith({ id: "987654" })
    expect(pago).toEqual({
      id: "987654",
      status: "approved",
      externalReference: "hito_1",
      transactionAmount: 5000,
      tipo: "hito",
      meses: 3,
      enlaceId: "enlace_1",
    })
  })

  it("un link legacy sin enlaceId en la metadata devuelve enlaceId null", async () => {
    mocks.get.mockResolvedValue(
      pagoSdk({ metadata: { tipo: "hito", meses: 1 } })
    )

    const pago = await obtenerPagoMp("987654")

    expect(pago).toMatchObject({ tipo: "hito", meses: 1, enlaceId: null })
  })

  it("ignora enlaceId vacio o de otro tipo y usa meses=1 por defecto", async () => {
    mocks.get.mockResolvedValue(
      pagoSdk({ metadata: { tipo: "soporte", enlaceId: "   " } })
    )

    const pago = await obtenerPagoMp("987654")

    expect(pago).toMatchObject({
      tipo: "soporte",
      meses: 1,
      enlaceId: null,
    })
  })

  it("no inventa tipo ni enlaceId cuando la metadata no es un objeto valido", async () => {
    mocks.get.mockResolvedValue(
      pagoSdk({ metadata: null, transaction_amount: null })
    )

    const pago = await obtenerPagoMp("987654")

    expect(pago).toEqual({
      id: "987654",
      status: "approved",
      externalReference: "hito_1",
      transactionAmount: null,
      tipo: null,
      meses: 1,
      enlaceId: null,
    })
  })
})
