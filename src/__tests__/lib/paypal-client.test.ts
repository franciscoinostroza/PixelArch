import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PAYPAL_DEFAULT_TIMEOUT_MS,
  PAYPAL_WEBHOOK_TIMEOUT_MS,
  PaypalError,
  captureOrder,
  createOrder,
  esPaypalError,
  esPaypalNoConfigurado,
  formatearMontoPaypal,
  getOrder,
  parsearMontoPaypal,
  resetPaypalTokenCache,
  verifyWebhookSignature,
  type CreateOrderInput,
} from "@/lib/paypal/client"

const PAYPAL_KEYS = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_BASE_URL",
  "PAYPAL_FEE_BPS",
  "PAYPAL_FEE_FIXED_CENTS",
] as const

type PaypalKey = (typeof PAYPAL_KEYS)[number]

const originalEnv = new Map<PaypalKey, string | undefined>()

function limpiarEnv() {
  for (const key of PAYPAL_KEYS) delete process.env[key]
}

function configurar(overrides: Partial<Record<PaypalKey, string>> = {}) {
  limpiarEnv()
  const base: Record<string, string> = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "client-id-de-prueba",
    PAYPAL_CLIENT_SECRET: "client-secret-de-prueba",
    PAYPAL_WEBHOOK_ID: "webhook-id-de-prueba",
    PAYPAL_BASE_URL: "https://paypal.test",
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) process.env[key] = value
  }
}

function respuesta(status: number, body: unknown): Response {
  return {
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(handler)
  vi.stubGlobal("fetch", mock)
  return mock
}

function entradaOrden(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    montoCents: 10656,
    referencia: "enlace-abc",
    descripcion: "Anticipo",
    returnUrl: "https://pixelarch.dev/pago/paypal/retorno?enlace=abc",
    cancelUrl: "https://pixelarch.dev/pago/paypal/cancelado",
    ...overrides,
  }
}

function ordenPaypal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ORDER-123",
    status: "CREATED",
    purchase_units: [
      {
        reference_id: "default",
        custom_id: "enlace-abc",
        invoice_id: "enlace-abc",
        amount: { currency_code: "USD", value: "106.56" },
        payments: { captures: [] },
      },
    ],
    links: [
      { rel: "self", href: "https://paypal.test/v2/checkout/orders/ORDER-123" },
      {
        rel: "payer-action",
        href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123",
      },
    ],
    create_time: "2026-10-20T12:00:00Z",
    ...overrides,
  }
}

function capturaPaypal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "CAPTURE-1",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "106.56" },
    supplementary_data: { related_ids: { order_id: "ORDER-123" } },
    custom_id: "enlace-abc",
    invoice_id: "enlace-abc",
    create_time: "2026-10-20T12:05:00Z",
    final_capture: true,
    ...overrides,
  }
}

function handlerBasico(opciones: {
  orden?: unknown
  captura?: unknown
  token?: unknown
} = {}) {
  return (url: string, init: RequestInit): Response => {
    if (url.endsWith("/v1/oauth2/token")) {
      return respuesta(200, opciones.token ?? { access_token: "TOKEN-1", expires_in: 3600 })
    }
    if (url.endsWith("/v2/checkout/orders") && init.method === "POST") {
      return respuesta(201, opciones.orden ?? ordenPaypal())
    }
    if (url.endsWith("/capture") && init.method === "POST") {
      return respuesta(201, opciones.captura ?? ordenPaypal({ status: "COMPLETED" }))
    }
    if (url.includes("/v2/checkout/orders/") && init.method === "GET") {
      return respuesta(200, opciones.orden ?? ordenPaypal())
    }
    throw new Error(`URL inesperada en el mock: ${url}`)
  }
}

function errorEsperado(error: unknown): PaypalError {
  if (!(error instanceof PaypalError)) {
    throw new Error(`Se esperaba PaypalError, se recibio: ${String(error)}`)
  }
  return error
}

beforeEach(() => {
  for (const key of PAYPAL_KEYS) originalEnv.set(key, process.env[key])
  configurar()
  resetPaypalTokenCache()
})

afterEach(() => {
  for (const key of PAYPAL_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  originalEnv.clear()
  resetPaypalTokenCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// AC-1 / AC-5: la orden se crea contra Orders API v2 en USD y el checkout es
// alojado por PayPal (guest checkout permitido).
describe("createOrder (AC-1, AC-5)", () => {
  it("autentica y crea una orden con intent CAPTURE, USD y guest checkout", async () => {
    const mock = mockFetch(handlerBasico())

    const orden = await createOrder(entradaOrden(), { requestId: "req-123" })

    expect(orden).toMatchObject({
      id: "ORDER-123",
      status: "CREATED",
      customId: "enlace-abc",
      invoiceId: "enlace-abc",
      amountCents: 10656,
      currencyCode: "USD",
      payerActionUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123",
    })
    expect(orden.captures).toEqual([])

    const llamadaToken = mock.mock.calls[0]
    expect(String(llamadaToken[0])).toBe("https://paypal.test/v1/oauth2/token")
    expect(llamadaToken[1].method).toBe("POST")
    expect(llamadaToken[1].body).toBe("grant_type=client_credentials")
    const headersToken = llamadaToken[1].headers as Record<string, string>
    expect(headersToken.Authorization).toMatch(/^Basic /)
    expect(headersToken.Authorization).not.toContain("client-secret-de-prueba")

    // El header Basic debe codificar exactamente clientId:clientSecret.
    const basic = String(headersToken.Authorization).replace(/^Basic /, "")
    expect(Buffer.from(basic, "base64").toString("utf8")).toBe(
      "client-id-de-prueba:client-secret-de-prueba"
    )

    const llamadaOrden = mock.mock.calls[1]
    expect(String(llamadaOrden[0])).toBe("https://paypal.test/v2/checkout/orders")
    expect(llamadaOrden[1].method).toBe("POST")
    const headersOrden = llamadaOrden[1].headers as Record<string, string>
    expect(headersOrden.Authorization).toBe("Bearer TOKEN-1")
    expect(headersOrden["PayPal-Request-Id"]).toBe("req-123")

    const cuerpo = JSON.parse(String(llamadaOrden[1].body)) as Record<string, unknown>
    expect(cuerpo.intent).toBe("CAPTURE")
    const unidades = cuerpo.purchase_units as Record<string, unknown>[]
    expect(unidades).toHaveLength(1)
    expect(unidades[0].amount).toEqual({ currency_code: "USD", value: "106.56" })
    expect(unidades[0].custom_id).toBe("enlace-abc")
    expect(unidades[0].invoice_id).toBe("enlace-abc")
    expect(unidades[0].description).toBe("Anticipo")

    const paymentSource = cuerpo.payment_source as Record<string, unknown>
    const paypal = paymentSource.paypal as Record<string, unknown>
    const contexto = paypal.experience_context as Record<string, unknown>
    expect(contexto).toMatchObject({
      landing_page: "NO_PREFERENCE",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: "https://pixelarch.dev/pago/paypal/retorno?enlace=abc",
      cancel_url: "https://pixelarch.dev/pago/paypal/cancelado",
    })
  })

  it("cachea el token entre llamadas sucesivas", async () => {
    const mock = mockFetch(handlerBasico())

    await createOrder(entradaOrden())
    await createOrder(entradaOrden())

    const llamadasToken = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/oauth2/token")
    )
    const llamadasOrden = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v2/checkout/orders")
    )
    expect(llamadasToken).toHaveLength(1)
    expect(llamadasOrden).toHaveLength(2)
  })

  it("comparte una unica solicitud de token entre llamadas simultaneas", async () => {
    const mock = mockFetch(handlerBasico())

    await Promise.all([createOrder(entradaOrden()), createOrder(entradaOrden())])

    const llamadasToken = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/oauth2/token")
    )
    expect(llamadasToken).toHaveLength(1)
  })

  it("respeta el presupuesto de cada caller con un token lento (4 s webhook, 8 s admin)", async () => {
    vi.useFakeTimers()
    try {
      let resolverToken: (() => void) | undefined
      const tokenPendiente = new Promise<Response>((resolve) => {
        resolverToken = () =>
          resolve(respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 }))
      })
      const mock = mockFetch((url) => {
        if (url.endsWith("/v1/oauth2/token")) return tokenPendiente
        if (url.endsWith("/v2/checkout/orders")) return respuesta(201, ordenPaypal())
        throw new Error(`URL inesperada en el mock: ${url}`)
      })

      const webhook = createOrder(entradaOrden(), {
        timeoutMs: PAYPAL_WEBHOOK_TIMEOUT_MS,
      }).catch((e: unknown) => e)
      const admin = createOrder(entradaOrden(), {
        timeoutMs: PAYPAL_DEFAULT_TIMEOUT_MS,
      }).catch((e: unknown) => e)

      // A los 4 s vence solo el caller con presupuesto de webhook.
      await vi.advanceTimersByTimeAsync(PAYPAL_WEBHOOK_TIMEOUT_MS)
      const errorWebhook = errorEsperado(await webhook)
      expect(errorWebhook.code).toBe("TIMEOUT")
      expect(errorWebhook.message).toContain(`${PAYPAL_WEBHOOK_TIMEOUT_MS} ms`)

      // La peticion compartida del token sigue viva y el admin la aprovecha.
      await vi.advanceTimersByTimeAsync(2_000)
      if (!resolverToken) throw new Error("Falta resolver el token de prueba")
      resolverToken()

      const resultadoAdmin = await admin
      if (resultadoAdmin instanceof PaypalError) throw resultadoAdmin
      expect(resultadoAdmin).toMatchObject({ id: "ORDER-123" })

      const llamadasToken = mock.mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/oauth2/token")
      )
      expect(llamadasToken).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("abortar un caller no cancela el token compartido del otro", async () => {
    let resolverToken: (() => void) | undefined
    let senalCompartida: AbortSignal | undefined
    const tokenPendiente = new Promise<Response>((resolve) => {
      resolverToken = () =>
        resolve(respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 }))
    })
    const mock = mockFetch((url, init) => {
      if (url.endsWith("/v1/oauth2/token")) {
        senalCompartida = init.signal ?? undefined
        return tokenPendiente
      }
      if (url.endsWith("/v2/checkout/orders")) return respuesta(201, ordenPaypal())
      throw new Error(`URL inesperada en el mock: ${url}`)
    })

    const controller = new AbortController()
    const webhook = createOrder(entradaOrden(), {
      timeoutMs: PAYPAL_WEBHOOK_TIMEOUT_MS,
      signal: controller.signal,
    }).catch((e: unknown) => e)
    const admin = createOrder(entradaOrden(), {
      timeoutMs: PAYPAL_DEFAULT_TIMEOUT_MS,
    }).catch((e: unknown) => e)

    controller.abort()
    const errorWebhook = errorEsperado(await webhook)
    expect(errorWebhook.code).toBe("ABORTADO")
    // El signal del caller no se propaga a la peticion compartida del token.
    expect(senalCompartida?.aborted).toBe(false)

    if (!resolverToken) throw new Error("Falta resolver el token de prueba")
    resolverToken()

    const resultadoAdmin = await admin
    if (resultadoAdmin instanceof PaypalError) throw resultadoAdmin
    expect(resultadoAdmin).toMatchObject({ id: "ORDER-123" })

    const llamadasToken = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/oauth2/token")
    )
    expect(llamadasToken).toHaveLength(1)
  })

  it("renueva el token cuando vence el margen de expiracion", async () => {
    let ahora = 1_700_000_000_000
    const ahoraSpy = vi.spyOn(Date, "now").mockImplementation(() => ahora)
    const mock = mockFetch(handlerBasico())

    await createOrder(entradaOrden())
    ahora += 3_600_000
    await createOrder(entradaOrden())

    const llamadasToken = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/oauth2/token")
    )
    expect(llamadasToken).toHaveLength(2)
    ahoraSpy.mockRestore()
  })

  it("renueva el token al agotarse el margen de seguridad, antes de vencer", async () => {
    let ahora = 1_700_000_000_000
    const ahoraSpy = vi.spyOn(Date, "now").mockImplementation(() => ahora)
    const mock = mockFetch(handlerBasico())

    const llamadasToken = () =>
      mock.mock.calls.filter(([url]) => String(url).endsWith("/v1/oauth2/token"))

    await createOrder(entradaOrden())
    expect(llamadasToken()).toHaveLength(1)

    // expires_in=3600 s y margen=60 s: aun dentro del margen se reutiliza.
    ahora += 3_540_000 - 1
    await createOrder(entradaOrden())
    expect(llamadasToken()).toHaveLength(1)

    // Al agotarse el margen se renueva, 60 s antes del vencimiento real.
    ahora += 1
    await createOrder(entradaOrden())
    expect(llamadasToken()).toHaveLength(2)

    ahoraSpy.mockRestore()
  })

  it("usa 8 s por defecto y 4 s en el webhook", () => {
    expect(PAYPAL_DEFAULT_TIMEOUT_MS).toBe(8000)
    expect(PAYPAL_WEBHOOK_TIMEOUT_MS).toBe(4000)
  })

  // RNF-5: el timeout real de admin/retorno debe ser 8 s, no solo la constante.
  it("programa el timeout de 8 s por defecto en admin/retorno (RNF-5)", async () => {
    const esperas: number[] = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: TimerHandler, delay?: number) => {
        void handler
        if (typeof delay === "number") esperas.push(delay)
        return 0
      }) as unknown as typeof setTimeout)

    try {
      mockFetch(handlerBasico())
      await createOrder(entradaOrden())

      // Peticion de token independiente (8 s) + espera del token del caller
      // (8 s) + request de la orden (8 s): todo con el presupuesto de admin.
      expect(esperas.filter((ms) => ms === PAYPAL_DEFAULT_TIMEOUT_MS)).toHaveLength(3)
      expect(esperas).not.toContain(PAYPAL_WEBHOOK_TIMEOUT_MS)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})

// AC-5: get/capture mapean la orden y la captura sin exponer el payload.
describe("getOrder y captureOrder (AC-5)", () => {
  it("consulta una orden por id con GET", async () => {
    const mock = mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      if (url === "https://paypal.test/v2/checkout/orders/ORDER%2F123") {
        return respuesta(200, ordenPaypal({ id: "ORDER/123" }))
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    const orden = await getOrder("ORDER/123")

    expect(orden.id).toBe("ORDER/123")
    expect(orden.amountCents).toBe(10656)
    const llamada = mock.mock.calls[1]
    expect(llamada[1].method).toBe("GET")
  })

  it("captura una orden y mapea la captura con monto, orden y flags", async () => {
    const ordenCapturada = ordenPaypal({
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: "enlace-abc",
          invoice_id: "enlace-abc",
          amount: { currency_code: "USD", value: "106.56" },
          payments: { captures: [capturaPaypal()] },
        },
      ],
    })

    const mock = mockFetch(handlerBasico({ captura: ordenCapturada }))

    const orden = await captureOrder("ORDER-123", { requestId: "cap-req-1" })

    expect(orden.status).toBe("COMPLETED")
    expect(orden.captures).toHaveLength(1)
    expect(orden.captures[0]).toMatchObject({
      id: "CAPTURE-1",
      status: "COMPLETED",
      amountCents: 10656,
      currencyCode: "USD",
      orderId: "ORDER-123",
      customId: "enlace-abc",
      invoiceId: "enlace-abc",
      finalCapture: true,
    })

    const llamada = mock.mock.calls[1]
    expect(String(llamada[0])).toBe(
      "https://paypal.test/v2/checkout/orders/ORDER-123/capture"
    )
    expect(llamada[1].method).toBe("POST")
    expect(llamada[1].body).toBe("{}")
    const headers = llamada[1].headers as Record<string, string>
    expect(headers["PayPal-Request-Id"]).toBe("cap-req-1")
  })

  it("deriva un requestId estable cuando captureOrder no lo recibe", async () => {
    const mock = mockFetch(handlerBasico({ captura: ordenPaypal({ status: "COMPLETED" }) }))

    await captureOrder("ORDER-123")
    await captureOrder("ORDER-123")

    const capturas = mock.mock.calls.filter(([url]) => String(url).endsWith("/capture"))
    expect(capturas).toHaveLength(2)
    const ids = capturas.map(
      ([, init]) => (init.headers as Record<string, string>)["PayPal-Request-Id"]
    )
    expect(ids[0]).toMatch(/^capture-[a-f0-9]{64}$/)
    expect(ids[0]).toBe(ids[1])
  })

  it("invalida el token cacheado y reintenta una sola vez ante un 401", async () => {
    let tokensEmitidos = 0
    let consultas = 0
    const mock = mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        tokensEmitidos += 1
        return respuesta(200, {
          access_token: `TOKEN-${tokensEmitidos}`,
          expires_in: 3600,
        })
      }
      if (url.includes("/v2/checkout/orders/") && url.endsWith("/ORDER-123")) {
        consultas += 1
        // Primera consulta exitosa: deja TOKEN-1 en cache. La segunda simula
        // un token revocado; el reintento debe pedir TOKEN-2.
        if (consultas === 2) {
          return respuesta(401, { name: "AUTHENTICATION_FAILURE" })
        }
        return respuesta(200, ordenPaypal())
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    await getOrder("ORDER-123")
    const orden = await getOrder("ORDER-123")

    expect(orden.id).toBe("ORDER-123")
    expect(tokensEmitidos).toBe(2)
    expect(consultas).toBe(3)
    const llamadasConsulta = mock.mock.calls.filter(([url]) =>
      String(url).endsWith("/ORDER-123")
    )
    expect(llamadasConsulta).toHaveLength(3)
    expect(
      (llamadasConsulta[1][1].headers as Record<string, string>).Authorization
    ).toBe("Bearer TOKEN-1")
    // El reintento usa el token nuevo, no el invalidado.
    expect(
      (llamadasConsulta[2][1].headers as Record<string, string>).Authorization
    ).toBe("Bearer TOKEN-2")
  })

  it("no reintenta si el 401 viene de un token recien emitido", async () => {
    let tokensEmitidos = 0
    let consultas = 0
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        tokensEmitidos += 1
        return respuesta(200, {
          access_token: `TOKEN-${tokensEmitidos}`,
          expires_in: 3600,
        })
      }
      consultas += 1
      return respuesta(401, { name: "AUTHENTICATION_FAILURE" })
    })

    const error = errorEsperado(await getOrder("ORDER-123").catch((e: unknown) => e))

    expect(error.code).toBe("AUTENTICACION")
    expect(tokensEmitidos).toBe(1)
    expect(consultas).toBe(1)
  })

  it("no reintenta mas de una vez si el reintento tambien devuelve 401", async () => {
    let tokensEmitidos = 0
    let consultas = 0
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        tokensEmitidos += 1
        return respuesta(200, {
          access_token: `TOKEN-${tokensEmitidos}`,
          expires_in: 3600,
        })
      }
      consultas += 1
      if (consultas === 1) return respuesta(200, ordenPaypal())
      return respuesta(401, { name: "AUTHENTICATION_FAILURE" })
    })

    await getOrder("ORDER-123")
    const error = errorEsperado(await getOrder("ORDER-123").catch((e: unknown) => e))

    expect(error.code).toBe("AUTENTICACION")
    expect(error.httpStatus).toBe(401)
    expect(tokensEmitidos).toBe(2)
    expect(consultas).toBe(3)
  })
})

// AC-14 / AC-16: errores claros y sanitizados; sin config no hay llamada.
describe("errores del cliente (AC-14, AC-16)", () => {
  it("no llama a PayPal si falta configuracion y devuelve NO_CONFIGURADO", async () => {
    limpiarEnv()
    const mock = mockFetch(() => {
      throw new Error("no deberia llamarse")
    })

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("NO_CONFIGURADO")
    expect(error.message).toContain("PayPal no disponible")
    expect(mock).not.toHaveBeenCalled()
  })

  it("sanitiza un 401 de OAuth sin filtrar el client secret ni PII", async () => {
    const secreto = "client-secret-que-no-debe-filtrarse"
    const email = "pagador@example.com"
    configurar({ PAYPAL_CLIENT_SECRET: secreto })
    const mock = mockFetch(() =>
      respuesta(401, {
        error: "invalid_client",
        error_description: `secret ${secreto} for ${email}`,
        email,
      })
    )

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("AUTENTICACION")
    expect(error.httpStatus).toBe(401)
    expect(error.message).toContain("PayPal rechazo")
    expect(error.message).not.toContain(secreto)
    expect(error.message).not.toContain(email)
    expect(JSON.stringify(error)).not.toContain(secreto)
    expect(JSON.stringify(error)).not.toContain(email)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("expone solo el codigo seguro de PayPal y nunca el mensaje crudo", async () => {
    const secreto = "3C679366HH908993F-secreto"
    const email = "pagador@example.com"
    const mock = mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      return respuesta(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: `El pagador ${email} uso token=${secreto}`,
        details: [{ issue: "INVALID_PARAMETER_VALUE", description: `token=${secreto}` }],
      })
    })

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("HTTP")
    expect(error.httpStatus).toBe(422)
    expect(error.issue).toBe("UNPROCESSABLE_ENTITY")
    expect(error.message).toContain("HTTP 422")
    expect(error.message).toContain("UNPROCESSABLE_ENTITY")
    expect(error.message).not.toContain(email)
    expect(error.message).not.toContain(secreto)
    expect(JSON.stringify(error)).not.toContain(email)
    expect(JSON.stringify(error)).not.toContain(secreto)
    expect(mock.mock.calls).toHaveLength(2)
  })

  it("rechaza una respuesta sin orden valida", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      return respuesta(201, { mensaje: "sin id" })
    })

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("RESPUESTA_INVALIDA")
    expect(error.message).toContain("respuesta invalida")
  })

  it("rechaza una respuesta de token invalida (sin expires_in)", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1" })
      }
      throw new Error(`No deberia llamarse: ${url}`)
    })

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("RESPUESTA_INVALIDA")
    expect(error.message).toContain("autenticar")
  })

  it("exige HTTPS y rechaza credenciales en returnUrl/cancelUrl", async () => {
    const mock = mockFetch(handlerBasico())
    const invalidas: Partial<CreateOrderInput>[] = [
      { returnUrl: "http://pixelarch.dev/pago/paypal/retorno" },
      { returnUrl: "https://user:pass@pixelarch.dev/pago/paypal/retorno" },
      { cancelUrl: "http://pixelarch.dev/pago/paypal/cancelado" },
      { cancelUrl: "https://user:pass@pixelarch.dev/pago/paypal/cancelado" },
    ]

    for (const override of invalidas) {
      const error = errorEsperado(
        await createOrder(entradaOrden(override)).catch((e: unknown) => e)
      )
      expect(esPaypalError(error)).toBe(true)
      expect(error.code).toBe("VALIDACION")
    }

    expect(mock).not.toHaveBeenCalled()
  })

  it("normaliza un monto invalido a PaypalError VALIDACION", async () => {
    const mock = mockFetch(handlerBasico())

    const error = errorEsperado(
      await createOrder(entradaOrden({ montoCents: 0 })).catch((e: unknown) => e)
    )

    expect(esPaypalError(error)).toBe(true)
    expect(error.code).toBe("VALIDACION")
    expect(mock).not.toHaveBeenCalled()
  })

  it("sanitiza los errores de getOrder sin filtrar PII ni secretos", async () => {
    const accessToken = "A21AA-token-get-secreto"
    const email = "pagador@example.com"
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: accessToken, expires_in: 3600 })
      }
      return respuesta(500, {
        name: "INTERNAL_SERVER_ERROR",
        message: `fallo con ${email} y token=${accessToken}`,
        email,
        payer: { email_address: email },
        details: [{ issue: "INTERNAL_ERROR", description: `token=${accessToken}` }],
      })
    })

    const error = errorEsperado(await getOrder("ORDER-123").catch((e: unknown) => e))
    const serializado = JSON.stringify(error)

    expect(error.code).toBe("HTTP")
    expect(error.httpStatus).toBe(500)
    expect(error.issue).toBe("INTERNAL_SERVER_ERROR")
    for (const dato of [accessToken, email]) {
      expect(error.message).not.toContain(dato)
      expect(serializado).not.toContain(dato)
    }
  })

  it("sanitiza los errores de captureOrder sin filtrar PII ni el payload", async () => {
    const email = "pagador@example.com"
    const payloadCrudo = `{"payer":{"email_address":"${email}","name":{"given_name":"Ana"}}}`
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      return respuesta(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: payloadCrudo,
        payer: { email_address: email, name: { given_name: "Ana" } },
        details: [{ issue: "INVALID_PARAMETER_VALUE", description: payloadCrudo }],
      })
    })

    const error = errorEsperado(
      await captureOrder("ORDER-123", { requestId: "cap-req-1" }).catch((e: unknown) => e)
    )
    const serializado = JSON.stringify(error)

    expect(error.code).toBe("HTTP")
    expect(error.httpStatus).toBe(422)
    expect(error.issue).toBe("UNPROCESSABLE_ENTITY")
    for (const dato of [payloadCrudo, email, "Ana"]) {
      expect(error.message).not.toContain(dato)
      expect(serializado).not.toContain(dato)
    }
  })

  it("corta por timeout con AbortController y un mensaje claro", async () => {
    const mock = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new Error("aborted"))
            return
          }
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
    )

    const error = errorEsperado(
      await createOrder(entradaOrden(), { timeoutMs: 20 }).catch((e: unknown) => e)
    )

    expect(error.code).toBe("TIMEOUT")
    expect(error.message).toContain("20 ms")
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("respeta la cancelacion externa con ABORTADO", async () => {
    mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new Error("aborted"))
            return
          }
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
    )
    const controller = new AbortController()

    const promesa = createOrder(entradaOrden(), { signal: controller.signal })
    controller.abort()
    const error = errorEsperado(await promesa.catch((e: unknown) => e))

    expect(error.code).toBe("ABORTADO")
  })

  // RNF-5 / AC-14: un fallo de red no debe exponer el detalle interno.
  it("mapea un fallo de red a RED sin filtrar el detalle interno", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed con token interno")))

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(error.code).toBe("RED")
    expect(error.message).toBe("No se pudo conectar con PayPal al autenticar.")
    expect(error.message).not.toContain("fetch failed")
    expect(JSON.stringify(error)).not.toContain("fetch failed")
    expect(JSON.stringify(error)).not.toContain("token interno")
  })

  // AC-19 / RNF-6: ni el access token, ni Authorization, ni el payload crudo
  // (que incluye PII) deben sobrevivir en el error.
  it("no filtra access token, Authorization ni el payload crudo", async () => {
    const accessToken = "A21AA-token-de-acceso-secreto"
    const email = "pagador@example.com"
    const payloadCrudo = `{"payer":{"email_address":"${email}","name":{"given_name":"Ana"}}}`

    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: accessToken, expires_in: 3600 })
      }
      return respuesta(400, {
        name: "INVALID_REQUEST",
        message: payloadCrudo,
        access_token: accessToken,
        authorization: `Bearer ${accessToken}`,
        payer: { email_address: email, name: { given_name: "Ana" } },
        details: [{ issue: "INVALID_PARAMETER", description: payloadCrudo }],
      })
    })

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))
    const serializado = JSON.stringify(error)

    expect(error.code).toBe("HTTP")
    expect(error.httpStatus).toBe(400)
    expect(error.issue).toBe("INVALID_REQUEST")
    for (const dato of [accessToken, `Bearer ${accessToken}`, payloadCrudo, email, "Ana"]) {
      expect(error.message).not.toContain(dato)
      expect(serializado).not.toContain(dato)
    }
  })

  // AC-16: el endpoint debe poder distinguir NO_CONFIGURADO y responder 503.
  it("expone un helper para mapear NO_CONFIGURADO a 503 (AC-16)", async () => {
    limpiarEnv()

    const error = errorEsperado(await createOrder(entradaOrden()).catch((e: unknown) => e))

    expect(esPaypalNoConfigurado(error)).toBe(true)
    expect(esPaypalNoConfigurado(new PaypalError({ code: "HTTP", message: "x" }))).toBe(false)
    expect(esPaypalNoConfigurado(new Error("x"))).toBe(false)
  })
})

// AC-7: la verificacion de firma es server-to-server y usa PAYPAL_WEBHOOK_ID.
describe("verifyWebhookSignature (AC-7)", () => {
  const headers = {
    "PAYPAL-TRANSMISSION-ID": "tx-1",
    "PAYPAL-TRANSMISSION-TIME": "2026-10-20T12:00:00Z",
    "PAYPAL-TRANSMISSION-SIG": "firma-abc",
    "PAYPAL-CERT-URL": "https://api.paypal.com/cert.pem",
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  }
  const event = {
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "CAPTURE-1", amount: { currency_code: "USD", value: "106.56" } },
  }

  it("verifica un webhook exitoso enviando headers, webhook id y evento", async () => {
    const mock = mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return respuesta(200, { verification_status: "SUCCESS" })
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    const resultado = await verifyWebhookSignature({ headers, event })

    expect(resultado).toEqual({ verificado: true, estado: "SUCCESS", motivo: "OK" })

    const llamada = mock.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/notifications/verify-webhook-signature")
    )
    if (!llamada) throw new Error("No se llamo a verify-webhook-signature")

    expect(llamada[1].method).toBe("POST")
    const cuerpo = JSON.parse(String(llamada[1].body)) as Record<string, unknown>
    expect(cuerpo).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.paypal.com/cert.pem",
      transmission_id: "tx-1",
      transmission_sig: "firma-abc",
      transmission_time: "2026-10-20T12:00:00Z",
      webhook_id: "webhook-id-de-prueba",
      webhook_event: event,
    })
  })

  it("devuelve firma invalida cuando PayPal responde FAILURE", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      return respuesta(200, { verification_status: "FAILURE" })
    })

    const resultado = await verifyWebhookSignature({ headers, event })

    expect(resultado).toEqual({
      verificado: false,
      estado: "FAILURE",
      motivo: "FIRMA_INVALIDA",
    })
  })

  it("rechaza headers incompletos sin llamar a PayPal", async () => {
    const mock = mockFetch(() => {
      throw new Error("no deberia llamarse")
    })

    const resultado = await verifyWebhookSignature({
      headers: { "PAYPAL-TRANSMISSION-ID": "tx-1" },
      event,
    })

    expect(resultado).toEqual({
      verificado: false,
      estado: null,
      motivo: "HEADERS_INCOMPLETOS",
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it("usa NO_CONFIGURADO si falta la configuracion del webhook", async () => {
    limpiarEnv()

    const error = errorEsperado(
      await verifyWebhookSignature({ headers, event }).catch((e: unknown) => e)
    )

    expect(error.code).toBe("NO_CONFIGURADO")
  })

  // RNF-5: el presupuesto del webhook es de 4 s por llamada (token + verificacion).
  it("programa 4 s por llamada en el webhook (RNF-5)", async () => {
    resetPaypalTokenCache()
    const esperas: number[] = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: TimerHandler, delay?: number) => {
        void handler
        if (typeof delay === "number") esperas.push(delay)
        return 0
      }) as unknown as typeof setTimeout)

    try {
      mockFetch((url) => {
        if (url.endsWith("/v1/oauth2/token")) {
          return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
        }
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
          return respuesta(200, { verification_status: "SUCCESS" })
        }
        throw new Error(`URL inesperada: ${url}`)
      })

      await verifyWebhookSignature({ headers, event })

      // El caller del webhook espera el token y verifica con 4 s cada uno; la
      // peticion compartida del token conserva su propio cap independiente.
      expect(esperas.filter((ms) => ms === PAYPAL_WEBHOOK_TIMEOUT_MS)).toHaveLength(2)
      expect(esperas.filter((ms) => ms === PAYPAL_DEFAULT_TIMEOUT_MS)).toHaveLength(1)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  it("lee los headers de transmision desde un objeto Headers", async () => {
    const mock = mockFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        return respuesta(200, { access_token: "TOKEN-1", expires_in: 3600 })
      }
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return respuesta(200, { verification_status: "SUCCESS" })
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    const resultado = await verifyWebhookSignature({
      headers: new Headers(headers),
      event,
    })

    expect(resultado).toEqual({ verificado: true, estado: "SUCCESS", motivo: "OK" })

    const llamada = mock.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/notifications/verify-webhook-signature")
    )
    if (!llamada) throw new Error("No se llamo a verify-webhook-signature")
    const cuerpo = JSON.parse(String(llamada[1].body)) as Record<string, unknown>
    expect(cuerpo.transmission_id).toBe("tx-1")
    expect(cuerpo.webhook_id).toBe("webhook-id-de-prueba")
  })
})

describe("mapeo puro de montos PayPal", () => {
  it("convierte centavos a decimal y viceversa sin floats", () => {
    expect(formatearMontoPaypal(10050)).toBe("100.50")
    expect(formatearMontoPaypal(100)).toBe("1.00")
    expect(formatearMontoPaypal(999999)).toBe("9999.99")

    expect(parsearMontoPaypal("100.50")).toBe(10050)
    expect(parsearMontoPaypal("100.5")).toBe(10050)
    expect(parsearMontoPaypal("100")).toBe(10000)
    expect(parsearMontoPaypal("1,50")).toBeNull()
    expect(parsearMontoPaypal(100)).toBeNull()
    expect(parsearMontoPaypal("")).toBeNull()
  })

  it("lanza PaypalError VALIDACION al formatear un monto invalido", () => {
    let capturado: unknown
    try {
      formatearMontoPaypal(0)
    } catch (error) {
      capturado = error
    }

    const error = errorEsperado(capturado)
    expect(esPaypalError(error)).toBe(true)
    expect(error.code).toBe("VALIDACION")
  })
})
