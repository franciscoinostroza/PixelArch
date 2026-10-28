import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-14 (AC-1, AC-8, AC-14, AC-15, AC-26, AC-28; AC-29 es manual/sandbox):
 * rutas publicas de PayPal.
 *
 * Parte A:
 * - `/pago/paypal/[token]`: rate limit IP/token, validacion del link y del
 *   concepto, reuso/renovacion de la orden y redirect a estado o checkout
 *   (AC-1, AC-14, AC-15, AC-26, AC-28).
 * - `/pago/paypal/estado`: pagina informativa sin PII, dinamica y noindex
 *   (AC-1, AC-14, AC-15, AC-26, AC-28).
 * - middleware: `/pago` es publica sin abrir `/admin`, `/api` ni `/monitoring`
 *   (plan §7.4).
 *
 * Parte B:
 * - `/pago/paypal/retorno`: valida la orden, captura si hace falta y procesa la
 *   captura; `token` es el order id de PayPal y `enlace` el token local
 *   (AC-8, AC-14, AC-15).
 * - `/pago/paypal/cancelado`: registra el intento sin tocar el link
 *   (AC-15).
 *
 * Prisma, PayPal y los servicios de procesamiento/eventos estan mockeados: no
 * hay base ni llamadas reales. El rate limit se prueba con la implementacion
 * real y claves unicas por test.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  createOrder: vi.fn(),
  getOrder: vi.fn(),
  captureOrder: vi.fn(),
  procesarCapturaPaypal: vi.fn(),
  registrarEventoPasarela: vi.fn(),
  paypalConfig: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  getUser: vi.fn(),
  routePatterns: [] as string[][],
}))

function patronARegExp(patron: string): RegExp {
  if (patron.endsWith("(.*)")) {
    const base = patron.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`^${base}(.*)$`)
  }
  return new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
}

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (routes: string[]) => {
    mocks.routePatterns.push(routes)
    const patterns = routes.map(patronARegExp)
    return (req: { nextUrl: URL }) =>
      patterns.some((pattern) => pattern.test(req.nextUrl.pathname))
  },
  clerkClient: vi.fn(async () => ({ users: { getUser: mocks.getUser } })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enlacePago: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@/lib/paypal/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/config")>()
  return { ...actual, paypalConfig: mocks.paypalConfig }
})

vi.mock("@/lib/paypal/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/client")>()
  return {
    ...actual,
    createOrder: mocks.createOrder,
    getOrder: mocks.getOrder,
    captureOrder: mocks.captureOrder,
  }
})

vi.mock("@/lib/paypal/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/process")>()
  return { ...actual, procesarCapturaPaypal: mocks.procesarCapturaPaypal }
})

vi.mock("@/lib/paypal/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/events")>()
  return { ...actual, registrarEventoPasarela: mocks.registrarEventoPasarela }
})

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))

vi.mock("next/link", async () => {
  const React = await import("react")
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      React.createElement("a", { href }, children),
  }
})

import { GET } from "@/app/pago/paypal/[token]/route"
import { GET as GETRetorno } from "@/app/pago/paypal/retorno/route"
import { GET as GETCancelado } from "@/app/pago/paypal/cancelado/route"
import EstadoPage, {
  dynamic as pageDynamic,
  metadata as pageMetadata,
} from "@/app/pago/paypal/estado/page"
import middleware, { config as middlewareConfig } from "@/middleware"
import { PaypalError } from "@/lib/paypal/client"
import { PaypalProcessError } from "@/lib/paypal/process"
import { unstable_noStore } from "next/cache"

const BASE_URL = "https://pixelarch.dev"
const ORDEN_NUEVA = {
  id: "ORDER-NEW",
  status: "CREATED",
  customId: null,
  invoiceId: null,
  amountCents: 10656,
  currencyCode: "USD",
  payerActionUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-NEW",
  createTime: null,
  captures: [],
}

function contexto(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) }
}

function request(token: string, ip = "198.51.100.10"): Request {
  return new Request(`${BASE_URL}/pago/paypal/${encodeURIComponent(token)}`, {
    headers: { "x-forwarded-for": ip },
  })
}

function requestRetorno(
  params: { enlace?: string | null; token?: string | null; ip?: string } = {}
): Request {
  const url = new URL(`${BASE_URL}/pago/paypal/retorno`)
  if (params.enlace) url.searchParams.set("enlace", params.enlace)
  if (params.token) url.searchParams.set("token", params.token)
  return new Request(url, {
    headers: { "x-forwarded-for": params.ip ?? "198.51.100.11" },
  })
}

function requestCancelado(
  params: { enlace?: string | null; token?: string | null; ip?: string } = {}
): Request {
  const url = new URL(`${BASE_URL}/pago/paypal/cancelado`)
  if (params.enlace) url.searchParams.set("enlace", params.enlace)
  if (params.token) url.searchParams.set("token", params.token)
  return new Request(url, {
    headers: { "x-forwarded-for": params.ip ?? "198.51.100.12" },
  })
}

function ordenAprobada(orderId: string, tokenLocal: string) {
  return {
    ...ORDEN_NUEVA,
    id: orderId,
    status: "APPROVED",
    customId: tokenLocal,
    invoiceId: tokenLocal,
    payerActionUrl: null,
    captures: [],
  }
}

function capturaCompletada(
  orderId: string,
  tokenLocal: string,
  captureId = "CAPTURA-1"
) {
  return {
    id: captureId,
    status: "COMPLETED",
    amountCents: 10656,
    currencyCode: "USD",
    orderId,
    customId: tokenLocal,
    invoiceId: tokenLocal,
    createTime: null,
    finalCapture: true,
  }
}

function ordenCapturada(orderId: string, tokenLocal: string) {
  return {
    ...ordenAprobada(orderId, tokenLocal),
    status: "COMPLETED",
    captures: [capturaCompletada(orderId, tokenLocal)],
  }
}

function resultadoProcesado(overrides: Record<string, unknown> = {}) {
  return {
    tipo: "PROCESADO",
    duplicado: false,
    pagoId: "pago_1",
    enlaceId: "enlace_1",
    hitoId: "hito_1",
    reciboId: "REC-1",
    monto: 10656,
    montoAcordado: 10050,
    comision: 606,
    moneda: "usd",
    ...overrides,
  }
}

function configDisponible() {
  return {
    disponible: true,
    motivo: null,
    env: "sandbox",
    baseUrl: "https://api-m.sandbox.paypal.com",
    clientId: "client-id-de-prueba",
    clientSecret: "client-secret-de-prueba",
    webhookId: "webhook-id-de-prueba",
    fee: { bps: 540, fixedCents: 30 },
  }
}

function configDeshabilitada() {
  return {
    disponible: false,
    motivo: "PayPal no disponible: configuracion incompleta.",
    env: null,
    baseUrl: null,
    clientId: null,
    clientSecret: null,
    webhookId: null,
    fee: { bps: 540, fixedCents: 30 },
  }
}

function enlace(overrides: Record<string, unknown> = {}) {
  const ahora = Date.now()
  return {
    id: "enlace_1",
    token: "token_valido",
    clienteId: "cliente_1",
    hitoId: "hito_1",
    suscripcionId: null,
    pasarela: "PAYPAL",
    concepto: "Sitio ACME — Anticipo",
    descripcion: "Anticipo del proyecto",
    notaInterna: "Nota interna que no debe salir",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    meses: null,
    feeBps: 540,
    feeFixedCents: 30,
    url: `${BASE_URL}/pago/paypal/token_valido`,
    checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    externalId: "ORDER-1",
    estado: "ACTIVO",
    grupoCobroId: "hito:hito_1",
    expiraEn: new Date(ahora + 24 * 60 * 60 * 1000),
    orderExpiraEn: new Date(ahora + 60 * 60 * 1000),
    generadoPor: "user_admin",
    generadoPorNombre: "Ana Admin",
    idioma: "es",
    hito: { estado: "PENDIENTE" },
    suscripcion: null,
    cliente: { nombre: "Cliente Demo", email: "cliente@example.com" },
    ...overrides,
  }
}

function redirect(res: Response): URL {
  const location = res.headers.get("location")
  expect(location).toBeTruthy()
  return new URL(location as string)
}

function estadoDeRedirect(res: Response): string | null {
  return redirect(res).searchParams.get("estado")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue(enlace())
  mocks.update.mockResolvedValue({})
  mocks.paypalConfig.mockReturnValue(configDisponible())
  mocks.createOrder.mockResolvedValue(ORDEN_NUEVA)
  mocks.getOrder.mockResolvedValue(ordenAprobada("ORDER-1", "token_valido"))
  mocks.captureOrder.mockResolvedValue(ordenCapturada("ORDER-1", "token_valido"))
  mocks.procesarCapturaPaypal.mockResolvedValue(resultadoProcesado())
  mocks.registrarEventoPasarela.mockResolvedValue({
    evento: null,
    duplicado: false,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe("GET /pago/paypal/[token]", () => {
  it("reutiliza el checkout vigente y responde con cabeceras seguras", async () => {
    const res = await GET(request("token_valido"), contexto("token_valido"))

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1"
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("crea una orden cuando falta el checkout y guarda externalId/checkoutUrl/vencimiento", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, externalId: null, orderExpiraEn: null })
    )

    const res = await GET(request("token_nuevo"), contexto("token_nuevo"))

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(ORDEN_NUEVA.payerActionUrl)
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)

    const [input, options] = mocks.createOrder.mock.calls[0]
    expect(input).toMatchObject({
      montoCents: 10656,
      referencia: "token_nuevo",
      // PayPal agrega `token=<orderId>` al volver; el token local va en
      // `enlace` para que no colisionen ambos parametros.
      returnUrl: `${BASE_URL}/pago/paypal/retorno?enlace=token_nuevo`,
      cancelUrl: `${BASE_URL}/pago/paypal/cancelado?enlace=token_nuevo`,
      locale: "es-AR",
    })
    expect(input.returnUrl).not.toContain("?token=")
    expect(input.cancelUrl).not.toContain("?token=")
    expect(options.requestId).toContain("enlace_1")
    expect(options.timeoutMs).toBe(8_000)

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: expect.objectContaining({
        externalId: "ORDER-NEW",
        checkoutUrl: ORDEN_NUEVA.payerActionUrl,
        ultimoError: null,
      }),
    })

    const data = mocks.update.mock.calls[0][0].data
    expect(data.orderExpiraEn).toBeInstanceOf(Date)
    expect(data.orderExpiraEn.getTime()).toBeGreaterThan(Date.now())
  })

  it("renueva la orden cuando orderExpiraEn vencio", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ orderExpiraEn: new Date(Date.now() - 1_000) })
    )

    const res = await GET(request("token_vencido"), contexto("token_vencido"))

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(ORDEN_NUEVA.payerActionUrl)
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })

  it("no redirige a una URL de checkout que no pertenece a PayPal", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: "https://evil.example/checkout" })
    )

    const res = await GET(request("token_open_redirect"), contexto("token_open_redirect"))

    expect(res.status).toBe(302)
    const location = res.headers.get("location") ?? ""
    expect(location).toBe(ORDEN_NUEVA.payerActionUrl)
    expect(location).not.toContain("evil.example")
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  })

  it("no sigue un checkout guardado que no sea HTTPS de PayPal (AC-1, AC-14)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: "http://www.paypal.com/checkoutnow?token=ORDER-1" })
    )

    const res = await GET(
      request("token_checkout_http", "198.51.100.31"),
      contexto("token_checkout_http")
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(ORDEN_NUEVA.payerActionUrl)
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  })

  it("permite cobrar un soporte ACTIVE o PAST_DUE (AC-1)", async () => {
    const estados = ["ACTIVE", "PAST_DUE"] as const

    for (const [indice, estado] of estados.entries()) {
      const token = `token_soporte_${indice}`
      mocks.findUnique.mockResolvedValueOnce(
        enlace({
          token,
          hitoId: null,
          hito: null,
          suscripcionId: "susc_1",
          suscripcion: { estado, plan: "SOPORTE" },
        })
      )

      const res = await GET(request(token, "198.51.100.34"), contexto(token))

      expect(res.status, estado).toBe(302)
      expect(res.headers.get("location"), estado).toBe(
        "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1"
      )
    }

    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado invalidado si el link no tiene concepto asociado (AC-1)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({
        hitoId: null,
        hito: null,
        suscripcionId: null,
        suscripcion: null,
      })
    )

    const res = await GET(
      request("token_sin_concepto", "198.51.100.35"),
      contexto("token_sin_concepto")
    )

    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("deja pendiente un link que todavia se esta creando (AC-15)", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ estado: "CREANDO" }))

    const res = await GET(
      request("token_creando", "198.51.100.36"),
      contexto("token_creando")
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado error si el link quedo fallido (AC-14, AC-15)", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ estado: "FALLIDO" }))

    const res = await GET(
      request("token_fallido", "198.51.100.37"),
      contexto("token_fallido")
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado error si falla la consulta del link (AC-14)", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db caida"))

    const res = await GET(
      request("token_db_error", "198.51.100.32"),
      contexto("token_db_error")
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado error si no puede guardar la orden nueva (AC-14)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )
    mocks.update.mockRejectedValue(new Error("db caida"))

    const res = await GET(
      request("token_update_error", "198.51.100.33"),
      contexto("token_update_error")
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  })

  it("manda a estado invalidado cuando el token no existe", async () => {
    mocks.findUnique.mockResolvedValue(null)

    const res = await GET(request("token_inexistente"), contexto("token_inexistente"))

    expect(res.status).toBe(302)
    expect(redirect(res).pathname).toBe("/pago/paypal/estado")
    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(redirect(res).searchParams.get("token")).toBe("token_inexistente")
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(res.headers.get("cache-control")).toContain("no-store")
  })

  it("manda a estado invalidado si la pasarela no es PayPal", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ pasarela: "MERCADOPAGO" }))

    const res = await GET(request("token_mp"), contexto("token_mp"))

    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado invalidado si el token tiene formato invalido", async () => {
    const token = "token con espacios"

    const res = await GET(request(token), contexto(token))

    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("vence el link de forma perezosa y manda a estado vencido", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ expiraEn: new Date(Date.now() - 1_000) })
    )

    const res = await GET(request("token_vencido_link"), contexto("token_vencido_link"))

    expect(estadoDeRedirect(res)).toBe("vencido")
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: { estado: "VENCIDO" },
    })
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado pagado si el link ya fue pagado", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ estado: "PAGADO" }))

    const res = await GET(request("token_pagado"), contexto("token_pagado"))

    expect(estadoDeRedirect(res)).toBe("pagado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado invalidado si el link fue invalidado", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ estado: "INVALIDADO" }))

    const res = await GET(request("token_invalidado"), contexto("token_invalidado"))

    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado pagado si el hito ya esta pagado aunque el link siga ACTIVO", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ hito: { estado: "PAGADO" } })
    )

    const res = await GET(request("token_hito_pagado"), contexto("token_hito_pagado"))

    expect(estadoDeRedirect(res)).toBe("pagado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado invalidado si el soporte no es elegible", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({
        hitoId: null,
        hito: null,
        suscripcionId: "susc_1",
        suscripcion: { estado: "PAUSED", plan: "SOPORTE" },
      })
    )

    const res = await GET(request("token_soporte_pausado"), contexto("token_soporte_pausado"))

    expect(estadoDeRedirect(res)).toBe("invalidado")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("manda a estado error si PayPal no esta configurado", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )
    mocks.paypalConfig.mockReturnValue(configDeshabilitada())

    const res = await GET(request("token_sin_config"), contexto("token_sin_config"))

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no reutiliza un checkout vigente si PayPal ya no esta configurado (rollback)", async () => {
    // Rollback = quitar las envs de PayPal. Aunque la orden guardada siga
    // vigente, no debe redirigirse a PayPal porque el retorno no puede capturar.
    mocks.paypalConfig.mockReturnValue(configDeshabilitada())

    const res = await GET(
      request("token_rollback", "198.51.100.62"),
      contexto("token_rollback")
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(res.headers.get("location")).not.toContain("paypal.com")
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("usa NEXT_PUBLIC_URL como base canonica de returnUrl/cancelUrl", async () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "https://staging.pixelarch.dev/")
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )

    const res = await GET(
      request("token_base_env", "198.51.100.63"),
      contexto("token_base_env")
    )

    expect(res.headers.get("location")).toBe(ORDEN_NUEVA.payerActionUrl)
    const [input] = mocks.createOrder.mock.calls[0]
    expect(input.returnUrl).toBe(
      "https://staging.pixelarch.dev/pago/paypal/retorno?enlace=token_base_env"
    )
    expect(input.cancelUrl).toBe(
      "https://staging.pixelarch.dev/pago/paypal/cancelado?enlace=token_base_env"
    )
  })

  it("no llama a PayPal si la base canonica configurada es invalida", async () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "http://staging.pixelarch.dev")
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )

    const res = await GET(
      request("token_base_invalida", "198.51.100.64"),
      contexto("token_base_invalida")
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it("no crea orden si el link no esta en USD o el total no es un entero positivo (AC-1, AC-18)", async () => {
    // Los casos conservan un checkout valido a proposito: la defensa debe
    // evaluarse antes de reutilizar la orden y nunca redirigir a PayPal.
    const casos = [
      enlace({ moneda: "ars" }),
      enlace({ total: 0 }),
      enlace({ total: 10.5 }),
    ]

    for (const [indice, datos] of casos.entries()) {
      const token = `token_monto_invalido_${indice}`
      mocks.findUnique.mockResolvedValueOnce(datos)

      const res = await GET(
        request(token, `198.51.100.7${indice}`),
        contexto(token)
      )

      expect(estadoDeRedirect(res), `caso ${indice}`).toBe("invalidado")
      expect(
        res.headers.get("location") ?? "",
        `caso ${indice}`
      ).not.toContain("paypal.com")
    }

    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("manda a estado error si PayPal falla al crear la orden", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )
    mocks.createOrder.mockRejectedValue(
      new PaypalError({
        code: "RED",
        message: "No se pudo conectar con PayPal al crear la orden.",
      })
    )

    const res = await GET(request("token_error_paypal"), contexto("token_error_paypal"))

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: {
        ultimoError: "No se pudo conectar con PayPal al crear la orden.",
      },
    })
  })

  it("manda a estado error si PayPal devuelve un checkout invalido", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )
    mocks.createOrder.mockResolvedValue({
      ...ORDEN_NUEVA,
      payerActionUrl: "javascript:alert(1)",
    })

    const res = await GET(request("token_checkout_invalido"), contexto("token_checkout_invalido"))

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: {
        ultimoError: "PayPal no devolvio un link de checkout valido.",
      },
    })
  })

  it("no expone PII ni la nota interna en la respuesta ni en los logs", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ checkoutUrl: null, orderExpiraEn: null })
    )

    const res = await GET(request("token_privacidad"), contexto("token_privacidad"))
    const location = res.headers.get("location") ?? ""

    expect(location).not.toContain("cliente@example.com")
    expect(location).not.toContain("Cliente Demo")
    expect(location).not.toContain("Nota interna")
    expect(await res.text()).not.toContain("cliente@example.com")

    const logs = JSON.stringify([
      mocks.loggerInfo.mock.calls,
      mocks.loggerWarn.mock.calls,
      mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("cliente@example.com")
    expect(logs).not.toContain("Cliente Demo")
    expect(logs).not.toContain("token_privacidad")

    const consulta = mocks.findUnique.mock.calls[0][0]
    expect(consulta.include).not.toHaveProperty("cliente")
  })

  it("limita a 5 solicitudes por minuto por token", async () => {
    const token = `token_rl_${Date.now()}`
    mocks.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 5; i++) {
      const res = await GET(request(token, "198.51.100.201"), contexto(token))
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const res = await GET(request(token, "198.51.100.201"), contexto(token))
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
  })

  it("limita a 30 solicitudes por minuto por IP", async () => {
    const ip = "198.51.100.202"
    mocks.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 30; i++) {
      const token = `token_ip_${Date.now()}_${i}`
      const res = await GET(request(token, ip), contexto(token))
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const token = `token_ip_${Date.now()}_30`
    const res = await GET(request(token, ip), contexto(token))
    expect(res.status).toBe(429)
  })
})

describe("GET /pago/paypal/retorno (parte B)", () => {
  it("captura la orden aprobada, procesa la captura y redirige a estado pagado", async () => {
    const token = "token_ret_ok"
    const orderId = "ORDER-RET-OK"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenAprobada(orderId, token))
    mocks.captureOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(res.status).toBe(302)
    const location = redirect(res)
    expect(location.pathname).toBe("/pago/paypal/estado")
    expect(location.searchParams.get("token")).toBe(token)
    expect(location.searchParams.get("estado")).toBe("pagado")
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")

    expect(mocks.getOrder).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({ timeoutMs: 8_000 })
    )
    expect(mocks.captureOrder).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({ timeoutMs: 8_000 })
    )
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledWith({
      captureId: "CAPTURA-1",
      orderId,
      amountCents: 10656,
      currency: "USD",
      status: "COMPLETED",
      customId: token,
      invoiceId: token,
    })
    // El retorno no escribe el link directamente: lo hace el procesador.
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no vuelve a capturar una orden ya capturada y trata el reintento como pagado", async () => {
    const token = "token_ret_dup"
    const orderId = "ORDER-RET-DUP"

    mocks.findUnique.mockResolvedValue(
      enlace({ id: "enlace_dup", token, externalId: orderId })
    )
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_dup",
      enlaceId: "enlace_dup",
      hitoId: "hito_1",
    })

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).toHaveBeenCalledTimes(1)
    expect(estadoDeRedirect(res)).toBe("pagado")
  })

  it("deja pendiente un segundo capture de la misma orden", async () => {
    const token = "token_ret_dup_accion"
    const orderId = "ORDER-RET-DUP-ACCION"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "DUPLICADO",
      duplicado: true,
      pagoId: "pago_dup",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      requiereAccion: true,
    })

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
  })

  it("redirige a pendiente cuando la captura queda en REVISION", async () => {
    const token = "token_ret_revision"
    const orderId = "ORDER-RET-REVISION"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "REVISION",
      duplicado: false,
      pagoId: "pago_revision",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      monto: 100,
      montoAcordado: 10050,
      comision: 606,
      montoEsperado: 10656,
      moneda: "usd",
      motivoRevision: "MONTO",
    })

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe(token)
  })

  it("redirige a pendiente cuando otro pago gano el cobro", async () => {
    const token = "token_ret_conflicto"
    const orderId = "ORDER-RET-CONFLICTO"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))
    mocks.procesarCapturaPaypal.mockResolvedValue({
      tipo: "CONFLICTO",
      duplicado: false,
      motivo: "PAGO_GANADOR",
      enlaceId: "enlace_1",
      hitoId: "hito_1",
      pagoId: "pago_ganador",
    })

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
  })

  it("sin configuracion PayPal redirige a error sin consultar ni capturar", async () => {
    const token = "token_ret_sin_config"
    const orderId = "ORDER-RET-SIN-CONFIG"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.paypalConfig.mockReturnValue(configDeshabilitada())

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si PayPal no encuentra la orden", async () => {
    const token = "token_ret_orden_404"
    const orderId = "ORDER-RET-404"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockRejectedValue(
      new PaypalError({
        code: "HTTP",
        httpStatus: 404,
        message: "PayPal rechazo consultar la orden (HTTP 404).",
      })
    )

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si la orden no pertenece al link", async () => {
    const token = "token_ret_ajeno"
    const orderId = "ORDER-RET-AJENO"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: "ORDER-DE-OTRO" })
    )
    mocks.getOrder.mockResolvedValue(
      ordenCapturada(orderId, "token_ajeno")
    )

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si la captura de PayPal falla", async () => {
    const token = "token_ret_captura_falla"
    const orderId = "ORDER-RET-CAPTURA-FALLA"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenAprobada(orderId, token))
    mocks.captureOrder.mockRejectedValue(
      new PaypalError({
        code: "HTTP",
        httpStatus: 422,
        message: "PayPal rechazo capturar la orden (HTTP 422).",
      })
    )

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si el procesamiento de la captura falla", async () => {
    const token = "token_ret_proceso_falla"
    const orderId = "ORDER-RET-PROCESO-FALLA"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))
    mocks.procesarCapturaPaypal.mockRejectedValue(
      new PaypalProcessError({
        codigo: "ENLACE_NO_ENCONTRADO",
        mensaje: "No se encontro el link de pago de PayPal.",
      })
    )

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )

    expect(estadoDeRedirect(res)).toBe("error")
  })

  it("resuelve el link por externalId cuando falta enlace", async () => {
    const token = "token_ret_external"
    const orderId = "ORDER-RET-EXTERNAL"

    mocks.findUnique.mockImplementation(
      (args: { where: { token?: string; externalId?: string } }) =>
        Promise.resolve(
          args.where.externalId === orderId
            ? enlace({ token, externalId: orderId })
            : null
        )
    )
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await GETRetorno(requestRetorno({ token: orderId }))

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { externalId: orderId },
      select: expect.any(Object),
    })
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(estadoDeRedirect(res)).toBe("pagado")
    expect(mocks.captureOrder).not.toHaveBeenCalled()
  })

  it("resuelve el link por custom_id de la orden cuando no hay token local", async () => {
    const token = "token_ret_custom"
    const orderId = "ORDER-RET-CUSTOM"

    mocks.findUnique.mockImplementation(
      (args: { where: { token?: string; externalId?: string } }) => {
        if (args.where.externalId) return Promise.resolve(null)
        if (args.where.token === token) {
          return Promise.resolve(enlace({ token, externalId: "ORDER-VIEJO" }))
        }
        return Promise.resolve(null)
      }
    )
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await GETRetorno(requestRetorno({ token: orderId }))

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { token },
      select: expect.any(Object),
    })
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(estadoDeRedirect(res)).toBe("pagado")
  })

  it("no expone PII ni el token local en logs", async () => {
    const token = "token_ret_pii"
    const orderId = "ORDER-RET-PII"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId })
    )
    const location = res.headers.get("location") ?? ""

    expect(location).not.toContain("cliente@example.com")
    expect(location).not.toContain("Cliente Demo")
    expect(location).not.toContain("Nota interna")

    const logs = JSON.stringify([
      mocks.loggerInfo.mock.calls,
      mocks.loggerWarn.mock.calls,
      mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("cliente@example.com")
    expect(logs).not.toContain("Cliente Demo")
    expect(logs).not.toContain("Nota interna")
    expect(logs).not.toContain(token)

    const consulta = mocks.findUnique.mock.calls[0][0]
    expect(consulta.select).not.toHaveProperty("cliente")
    expect(consulta.select).not.toHaveProperty("notaInterna")
    expect(consulta.select).not.toHaveProperty("concepto")
  })

  it("limita a 5 solicitudes por minuto por token local", async () => {
    const token = `token_ret_rl_${Date.now()}`
    const ip = "198.51.100.240"
    mocks.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 5; i++) {
      const res = await GETRetorno(
        requestRetorno({ enlace: token, token: `ORDER-RL-${i}`, ip })
      )
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: "ORDER-RL-5", ip })
    )
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
  })

  it("limita a 30 solicitudes por minuto por IP", async () => {
    const ip = "198.51.100.241"

    for (let i = 0; i < 30; i++) {
      const res = await GETRetorno(requestRetorno({ ip }))
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const res = await GETRetorno(requestRetorno({ ip }))
    expect(res.status).toBe(429)
  })

  it("redirige a error si falta el order id de PayPal (AC-15)", async () => {
    const token = "token_ret_sin_order"

    const res = await GETRetorno(
      requestRetorno({ enlace: token, ip: "198.51.100.42" })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.getOrder).not.toHaveBeenCalled()
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si el order id tiene formato invalido (AC-15)", async () => {
    const token = "token_ret_order_invalido"

    const res = await GETRetorno(
      requestRetorno({
        enlace: token,
        token: "ORDER CON ESPACIOS",
        ip: "198.51.100.43",
      })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.getOrder).not.toHaveBeenCalled()
  })

  it("redirige a error si no encuentra el link ni por token ni por order id (AC-15)", async () => {
    const token = "token_ret_fantasma"
    const orderId = "ORDER-RET-FANTASMA"

    mocks.findUnique.mockResolvedValue(null)
    mocks.getOrder.mockResolvedValue(ordenAprobada(orderId, "otro-token"))

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId, ip: "198.51.100.44" })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    // token local -> externalId -> custom_id de la orden consultada.
    expect(mocks.findUnique).toHaveBeenCalledTimes(3)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si el link no es de PayPal (AC-15)", async () => {
    const token = "token_ret_mp"
    const orderId = "ORDER-RET-MP"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, pasarela: "MERCADOPAGO", externalId: orderId })
    )
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId, ip: "198.51.100.45" })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.captureOrder).not.toHaveBeenCalled()
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })

  it("redirige a error si la captura no devuelve ninguna captura (AC-14, AC-15)", async () => {
    const token = "token_ret_sin_captura"
    const orderId = "ORDER-RET-SIN-CAPTURA"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenAprobada(orderId, token))
    mocks.captureOrder.mockResolvedValue({
      ...ordenAprobada(orderId, token),
      status: "COMPLETED",
      captures: [],
    })

    const res = await GETRetorno(
      requestRetorno({ enlace: token, token: orderId, ip: "198.51.100.46" })
    )

    expect(estadoDeRedirect(res)).toBe("error")
    expect(mocks.captureOrder).toHaveBeenCalledTimes(1)
    expect(mocks.procesarCapturaPaypal).not.toHaveBeenCalled()
  })
})

describe("GET /pago/paypal/cancelado (parte B)", () => {
  it("registra el intento cancelado sin alterar el link y redirige a pendiente", async () => {
    const token = "token_cancel_ok"
    const orderId = "ORDER-CANCEL-OK"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))

    const res = await GETCancelado(
      requestCancelado({ enlace: token, token: orderId })
    )

    expect(res.status).toBe(302)
    const location = redirect(res)
    expect(location.pathname).toBe("/pago/paypal/estado")
    expect(location.searchParams.get("token")).toBe(token)
    expect(location.searchParams.get("estado")).toBe("pendiente")
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")

    expect(mocks.registrarEventoPasarela).toHaveBeenCalledWith({
      eventoId: `PAYPAL:CANCELADO:${orderId}`,
      pasarela: "PAYPAL",
      tipo: "PAYPAL.CANCELADO",
      externalId: orderId,
      enlacePagoId: "enlace_1",
      resultado: "IGNORADO",
      motivo: "CANCELADO_POR_PAGADOR",
      monto: 10656,
      moneda: "usd",
      requiereAccion: false,
      procesadoEn: expect.any(Date),
    })
    // La orden del link se expira para que el proximo intento cree una nueva.
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "enlace_1" },
      data: { orderExpiraEn: expect.any(Date), checkoutUrl: null },
    })
  })

  it("expira solo la orden cancelada y el proximo acceso al link crea una nueva (AC-15, AC-26)", async () => {
    const token = `token_cancel_renueva_${Date.now()}`
    const orderId = "ORDER-CANCEL-RENUEVA"
    const ip = "198.51.100.245"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))

    const cancelRes = await GETCancelado(
      requestCancelado({ enlace: token, token: orderId, ip })
    )

    expect(estadoDeRedirect(cancelRes)).toBe("pendiente")
    expect(mocks.update).toHaveBeenCalledTimes(1)

    const cancelacion = mocks.update.mock.calls[0][0]
    expect(cancelacion.where).toEqual({ id: "enlace_1" })
    expect(cancelacion.data.checkoutUrl).toBeNull()
    expect(cancelacion.data.orderExpiraEn).toBeInstanceOf(Date)
    // Se expira "ahora": el proximo acceso ya no puede reutilizar el checkout.
    expect(cancelacion.data.orderExpiraEn.getTime()).toBeLessThanOrEqual(Date.now())

    const renovada = {
      ...ORDEN_NUEVA,
      id: "ORDER-RENOVADA",
      payerActionUrl:
        "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-RENOVADA",
    }
    mocks.createOrder.mockResolvedValue(renovada)
    mocks.findUnique.mockResolvedValue(
      enlace({
        token,
        externalId: orderId,
        checkoutUrl: null,
        orderExpiraEn: cancelacion.data.orderExpiraEn,
      })
    )

    const res = await GET(request(token, ip), contexto(token))

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(renovada.payerActionUrl)
    expect(mocks.createOrder).toHaveBeenCalledTimes(1)
    expect(mocks.createOrder.mock.calls[0][0]).toMatchObject({
      referencia: token,
    })
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: "enlace_1" },
      data: expect.objectContaining({
        externalId: "ORDER-RENOVADA",
        checkoutUrl: renovada.payerActionUrl,
      }),
    })
  })

  it("no registra ni expira una cancelacion con order id ajeno (AC-15)", async () => {
    const token = "token_cancel_ajeno"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: "ORDER-PROPIO" })
    )

    const res = await GETCancelado(
      requestCancelado({
        enlace: token,
        token: "ORDER-AJENO",
        ip: "198.51.100.18",
      })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no registra un order id si el link todavia no tiene orden guardada (AC-15)", async () => {
    const token = "token_cancel_sin_external"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: null, checkoutUrl: null })
    )

    const res = await GETCancelado(
      requestCancelado({
        enlace: token,
        token: "ORDER-NO-GUARDADA",
        ip: "198.51.100.19",
      })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no registra evento para un link inexistente ni altera nada", async () => {
    mocks.findUnique.mockResolvedValue(null)

    const res = await GETCancelado(
      requestCancelado({ enlace: "token_cancel_noexiste", ip: "198.51.100.13" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe("token_cancel_noexiste")
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no registra evento si el link no es de PayPal", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ token: "token_cancel_mp", pasarela: "MERCADOPAGO" })
    )

    const res = await GETCancelado(
      requestCancelado({ enlace: "token_cancel_mp", ip: "198.51.100.14" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("la cancelacion sigue redirigiendo si falla el registro del evento", async () => {
    const token = "token_cancel_evento_falla"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: "ORDER-CANCEL-FALLA" })
    )
    mocks.registrarEventoPasarela.mockRejectedValue(new Error("db caida"))

    const res = await GETCancelado(
      requestCancelado({ enlace: token, ip: "198.51.100.15" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe(token)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("no expone PII en el evento ni en los logs", async () => {
    const token = "token_cancel_pii"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: "ORDER-CANCEL-PII" })
    )

    await GETCancelado(
      requestCancelado({ enlace: token, ip: "198.51.100.16" })
    )

    const evento = JSON.stringify(mocks.registrarEventoPasarela.mock.calls)
    expect(evento).not.toContain("cliente@example.com")
    expect(evento).not.toContain("Cliente Demo")
    expect(evento).not.toContain("Nota interna")

    const logs = JSON.stringify([
      mocks.loggerInfo.mock.calls,
      mocks.loggerWarn.mock.calls,
      mocks.loggerError.mock.calls,
    ])
    expect(logs).not.toContain("cliente@example.com")
    expect(logs).not.toContain("Cliente Demo")
    expect(logs).not.toContain("Nota interna")
    expect(logs).not.toContain(token)

    const consulta = mocks.findUnique.mock.calls[0][0]
    expect(consulta.select).not.toHaveProperty("cliente")
    expect(consulta.select).not.toHaveProperty("notaInterna")
    expect(consulta.select).not.toHaveProperty("concepto")
  })

  it("limita a 5 solicitudes por minuto por token local", async () => {
    const token = `token_cancel_rl_${Date.now()}`
    const ip = "198.51.100.17"
    mocks.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 5; i++) {
      const res = await GETCancelado(
        requestCancelado({ enlace: token, ip })
      )
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const res = await GETCancelado(requestCancelado({ enlace: token, ip }))
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toContain("no-store")
  })

  it("registra el intento sin order id y conserva el externalId del link (AC-15)", async () => {
    const token = "token_cancel_sin_order"

    mocks.findUnique.mockResolvedValue(
      enlace({ token, externalId: "ORDER-FALLBACK" })
    )

    const res = await GETCancelado(
      requestCancelado({ enlace: token, ip: "198.51.100.38" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(mocks.registrarEventoPasarela).toHaveBeenCalledWith(
      expect.objectContaining({
        pasarela: "PAYPAL",
        tipo: "PAYPAL.CANCELADO",
        externalId: "ORDER-FALLBACK",
        enlacePagoId: "enlace_1",
        resultado: "IGNORADO",
        motivo: "CANCELADO_POR_PAGADOR",
        monto: 10656,
        moneda: "usd",
        requiereAccion: false,
      })
    )

    const evento = mocks.registrarEventoPasarela.mock.calls[0][0]
    expect(evento.eventoId).toMatch(/^PAYPAL:CANCELADO:enlace_1:/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("sigue pendiente si falla la consulta del link (AC-15)", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db caida"))

    const res = await GETCancelado(
      requestCancelado({ enlace: "token_cancel_db", ip: "198.51.100.39" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe("token_cancel_db")
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("vuelve a pendiente sin consultar la base si falta el token local (AC-15)", async () => {
    const res = await GETCancelado(
      requestCancelado({ token: "ORDER-CANCEL-SIN-TOKEN", ip: "198.51.100.40" })
    )

    expect(estadoDeRedirect(res)).toBe("pendiente")
    expect(redirect(res).searchParams.get("token")).toBe("")
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.registrarEventoPasarela).not.toHaveBeenCalled()
  })

  it("limita a 30 solicitudes por minuto por IP", async () => {
    const ip = "198.51.100.243"
    mocks.findUnique.mockResolvedValue(null)

    for (let i = 0; i < 30; i++) {
      const token = `token_cancel_ip_${Date.now()}_${i}`
      const res = await GETCancelado(requestCancelado({ enlace: token, ip }))
      expect(res.status, `solicitud ${i + 1}`).toBe(302)
    }

    const res = await GETCancelado(
      requestCancelado({ enlace: `token_cancel_ip_${Date.now()}_30`, ip })
    )
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
  })
})

describe("redirect a estado detras del proxy (base publica)", () => {
  const BASE_PUBLICA = "https://staging.pixelarch.dev"
  const ORIGEN_INTERNO = "http://0.0.0.0:8080"

  /**
   * Simula la request tal como la ve la app detras del proxy de Railway: el
   * origin es el interno. `NEXT_PUBLIC_URL` debe mandar en el `Location`.
   */
  function requestInterno(
    path: string,
    params: Record<string, string>,
    ip: string
  ): Request {
    const url = new URL(path, ORIGEN_INTERNO)
    for (const [clave, valor] of Object.entries(params)) {
      url.searchParams.set(clave, valor)
    }
    return new Request(url, { headers: { "x-forwarded-for": ip } })
  }

  async function conBasePublica<T>(fn: () => Promise<T>): Promise<T> {
    const previo = process.env.NEXT_PUBLIC_URL
    process.env.NEXT_PUBLIC_URL = BASE_PUBLICA

    try {
      return await fn()
    } finally {
      if (previo === undefined) {
        delete process.env.NEXT_PUBLIC_URL
      } else {
        process.env.NEXT_PUBLIC_URL = previo
      }
    }
  }

  function expectLocationPublico(res: Response): void {
    const location = res.headers.get("location") ?? ""
    expect(location.startsWith(`${BASE_PUBLICA}/pago/paypal/estado`)).toBe(true)
    expect(location).not.toContain("0.0.0.0:8080")
  }

  it("usa NEXT_PUBLIC_URL en /pago/paypal/[token]", async () => {
    mocks.findUnique.mockResolvedValue(null)

    const res = await conBasePublica(() =>
      GET(
        requestInterno("/pago/paypal/token_interno", {}, "198.51.100.71"),
        contexto("token_interno")
      )
    )

    expectLocationPublico(res)
    expect(estadoDeRedirect(res)).toBe("invalidado")
  })

  it("usa NEXT_PUBLIC_URL en el retorno", async () => {
    const token = "token_ret_base_publica"
    const orderId = "ORDER-RET-BASE-PUBLICA"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))
    mocks.getOrder.mockResolvedValue(ordenCapturada(orderId, token))

    const res = await conBasePublica(() =>
      GETRetorno(
        requestInterno(
          "/pago/paypal/retorno",
          { enlace: token, token: orderId },
          "198.51.100.72"
        )
      )
    )

    expectLocationPublico(res)
    expect(estadoDeRedirect(res)).toBe("pagado")
  })

  it("usa NEXT_PUBLIC_URL en la cancelacion", async () => {
    const token = "token_cancel_base_publica"
    const orderId = "ORDER-CANCEL-BASE-PUBLICA"

    mocks.findUnique.mockResolvedValue(enlace({ token, externalId: orderId }))

    const res = await conBasePublica(() =>
      GETCancelado(
        requestInterno(
          "/pago/paypal/cancelado",
          { enlace: token, token: orderId },
          "198.51.100.73"
        )
      )
    )

    expectLocationPublico(res)
    expect(estadoDeRedirect(res)).toBe("pendiente")
  })
})

describe("pagina /pago/paypal/estado", () => {
  function pagina(params: { token?: string; estado?: string }) {
    return EstadoPage({ searchParams: Promise.resolve(params) })
  }

  it("muestra el estado pagado con concepto y monto USD sin PII", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ estado: "PAGADO", total: 10656, moneda: "usd" })
    )

    render(await pagina({ token: "token_valido", estado: "pagado" }))

    expect(screen.getByText("Pago acreditado")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
    expect(screen.queryByText("cliente@example.com")).not.toBeInTheDocument()
    expect(screen.queryByText("Cliente Demo")).not.toBeInTheDocument()
  })

  it("muestra el estado pendiente de un link ACTIVO", async () => {
    render(await pagina({ token: "token_valido" }))

    expect(screen.getByText("Pago pendiente")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
  })

  it("muestra vencido de forma perezosa", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ expiraEn: new Date(Date.now() - 1_000) })
    )

    render(await pagina({ token: "token_vencido" }))

    expect(screen.getByText("Link vencido")).toBeInTheDocument()
  })

  it("muestra invalidado para un token inexistente y no muestra montos", async () => {
    mocks.findUnique.mockResolvedValue(null)

    render(await pagina({ token: "token_inexistente", estado: "invalidado" }))

    expect(screen.getByText("Link no valido")).toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
  })

  it("muestra un error legible cuando el link se resolvio con error", async () => {
    render(await pagina({ token: "token_valido", estado: "error" }))

    expect(screen.getByText("No pudimos procesar el pago")).toBeInTheDocument()
  })

  it("no consulta datos del cliente y solo selecciona campos publicos", async () => {
    await pagina({ token: "token_valido" })

    const consulta = mocks.findUnique.mock.calls[0][0]
    expect(consulta.select).toEqual({
      pasarela: true,
      concepto: true,
      total: true,
      moneda: true,
      estado: true,
      expiraEn: true,
      hitoId: true,
      suscripcionId: true,
      hito: { select: { estado: true } },
      suscripcion: { select: { estado: true, plan: true } },
    })
    expect(consulta.select).not.toHaveProperty("cliente")
    expect(consulta.select).not.toHaveProperty("notaInterna")
  })

  it("muestra pagado si el hito ya esta pagado aunque el link siga ACTIVO (AC-8)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ estado: "ACTIVO", hito: { estado: "PAGADO" } })
    )

    render(await pagina({ token: "token_hito_pagado" }))

    expect(screen.getByText("Pago acreditado")).toBeInTheDocument()
  })

  it("no confia en ?estado=pagado si el hito sigue pendiente (AC-1, AC-8)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ estado: "ACTIVO", hito: { estado: "PENDIENTE" } })
    )

    render(await pagina({ token: "token_activo", estado: "pagado" }))

    expect(screen.getByText("Pago pendiente")).toBeInTheDocument()
  })

  it("muestra invalidado si el soporte no es elegible aunque el link siga ACTIVO (AC-15)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({
        estado: "ACTIVO",
        hitoId: null,
        hito: null,
        suscripcionId: "susc_1",
        suscripcion: { estado: "PAUSED", plan: "SOPORTE" },
      })
    )

    render(await pagina({ token: "token_soporte_pausado" }))

    expect(screen.getByText("Link no valido")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
  })

  it("expone Referrer-Policy no-referrer porque el token viaja en el query", async () => {
    expect(pageMetadata.referrer).toBe("no-referrer")
  })

  it("oculta el monto si el link no esta en USD (AC-1, AC-18)", async () => {
    mocks.findUnique.mockResolvedValue(
      enlace({ moneda: "ars", total: 1065600 })
    )

    render(await pagina({ token: "token_ars" }))

    expect(screen.getByText("Pago pendiente")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
  })

  it("no muestra concepto ni monto de un link que no es PayPal (AC-15)", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ pasarela: "MERCADOPAGO" }))

    render(await pagina({ token: "token_mp" }))

    expect(screen.getByText("Link no valido")).toBeInTheDocument()
    expect(screen.queryByText("Sitio ACME — Anticipo")).not.toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
  })

  it("muestra error si falla la consulta del link (AC-14)", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db caida"))

    render(await pagina({ token: "token_db_error" }))

    expect(screen.getByText("No pudimos procesar el pago")).toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
  })

  it("no consulta la base para un token con formato invalido (AC-28)", async () => {
    render(await pagina({ token: "token con espacios" }))

    expect(screen.getByText("Link no valido")).toBeInTheDocument()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("mantiene el error informado por el retorno aunque el link figure pagado (AC-14)", async () => {
    mocks.findUnique.mockResolvedValue(enlace({ estado: "PAGADO" }))

    render(await pagina({ token: "token_valido", estado: "error" }))

    expect(screen.getByText("No pudimos procesar el pago")).toBeInTheDocument()
  })

  it("declara noindex, modo dinamico y no-store", async () => {
    expect(pageMetadata.robots).toMatchObject({ index: false })
    expect(pageDynamic).toBe("force-dynamic")

    await pagina({ token: "token_valido" })
    expect(unstable_noStore).toHaveBeenCalled()
  })
})

describe("middleware T-14", () => {
  type MiddlewareHandler = (
    auth: () => Promise<{ userId: string | null }>,
    req: NextRequest
  ) => Promise<Response>

  const handler = middleware as unknown as MiddlewareHandler

  function nextRequest(path: string): NextRequest {
    const url = new URL(path, BASE_URL)
    return { url: url.toString(), nextUrl: url } as unknown as NextRequest
  }

  it("permite /pago y sus rutas publicas sin redirigir al gate (plan §7.4)", async () => {
    for (const ruta of [
      "/pago",
      "/pago/paypal/token_valido",
      "/pago/paypal/estado?token=token_valido&estado=pagado",
      "/pago/paypal/retorno?enlace=token_valido&token=ORDER-1",
      "/pago/paypal/cancelado?enlace=token_valido&token=ORDER-1",
    ]) {
      const res = await handler(async () => ({ userId: null }), nextRequest(ruta))

      expect(res.headers.get("location"), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
    }

    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("declara /pago exacto y /pago/(.*) sin abrir /pagotest (plan §7.4)", () => {
    const publicas = mocks.routePatterns.find((rutas) => rutas.includes("/pago"))
    expect(publicas).toBeDefined()

    const coincide = (ruta: string) =>
      (publicas ?? []).some((patron) => patronARegExp(patron).test(ruta))

    expect(publicas).toContain("/pago")
    expect(publicas).toContain("/pago/(.*)")
    expect(coincide("/pago")).toBe(true)
    expect(coincide("/pago/paypal/token_valido")).toBe(true)
    expect(coincide("/pagotest")).toBe(false)
    expect(coincide("/pago-otro")).toBe(false)
  })

  it("sigue mandando /admin al gate (no se abrio el admin) (plan §7.4)", async () => {
    const res = await handler(
      async () => ({ userId: null }),
      nextRequest("/admin/pagos")
    )

    expect(res.headers.get("x-middleware-rewrite")).toContain("/gate/admin")
  })

  it("no reescribe /api ni /monitoring al gate (plan §7.4)", async () => {
    for (const ruta of ["/api/health", "/api/admin/clientes", "/monitoring"]) {
      const res = await handler(
        async () => ({ userId: null }),
        nextRequest(ruta)
      )

      expect(res.headers.get("location"), ruta).toBeNull()
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull()
    }
  })

  it("mantiene /monitoring y las APIs excluidas fuera del matcher (plan §7.4)", () => {
    const patrones = middlewareConfig.matcher.join(" ")

    expect(patrones).toContain("monitoring")
    for (const ruta of [
      "api/webhooks",
      "api/revalidate",
      "api/cron",
      "api/health",
    ]) {
      expect(patrones, ruta).toContain(ruta)
    }
  })
})
