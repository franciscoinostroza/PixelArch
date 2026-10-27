import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REDACTED } from "@/lib/paypal/redact"

// AC-19 / RNF-6: Sentry no debe recibir PII ni secretos de PayPal.
// Se mockea el SDK para inspeccionar la configuracion sin inicializar Sentry.
const { init } = vi.hoisted(() => ({ init: vi.fn() }))

vi.mock("@sentry/nextjs", () => ({ init }))

interface SentryInitOptions {
  dsn?: string
  enabled?: boolean
  includeLocalVariables?: boolean
  tracesSampleRate?: number
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown>
}

const originalDsn = process.env.SENTRY_DSN

async function cargarConfiguracion(): Promise<SentryInitOptions> {
  vi.resetModules()
  await import("@/sentry.server.config")
  const llamada = init.mock.calls[init.mock.calls.length - 1]
  if (!llamada) throw new Error("Sentry.init no fue invocado")
  return llamada[0] as SentryInitOptions
}

async function cargarConfiguracionEdge(): Promise<SentryInitOptions> {
  vi.resetModules()
  await import("@/sentry.edge.config")
  const llamada = init.mock.calls[init.mock.calls.length - 1]
  if (!llamada) throw new Error("Sentry.init no fue invocado en edge")
  return llamada[0] as SentryInitOptions
}

beforeEach(() => {
  init.mockClear()
})

afterEach(() => {
  if (originalDsn === undefined) delete process.env.SENTRY_DSN
  else process.env.SENTRY_DSN = originalDsn
  vi.resetModules()
})

describe("sentry.server.config (AC-19)", () => {
  // Sentry v11: la opcion debe seguir siendo valida y no adjuntar variables
  // locales de los stack frames (pueden contener email/nombre o credenciales).
  it("inicializa Sentry con includeLocalVariables false y beforeSend", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1"

    const opciones = await cargarConfiguracion()

    expect(init).toHaveBeenCalledTimes(1)
    expect(opciones.dsn).toBe("https://public@example.ingest.sentry.io/1")
    expect(opciones.enabled).toBe(true)
    expect(opciones.includeLocalVariables).toBe(false)
    expect(opciones.tracesSampleRate).toBe(0.1)
    expect(typeof opciones.beforeSend).toBe("function")
  })

  it("queda deshabilitado si falta SENTRY_DSN sin romper la config v11", async () => {
    delete process.env.SENTRY_DSN

    const opciones = await cargarConfiguracion()

    expect(opciones.enabled).toBe(false)
    expect(opciones.dsn).toBeUndefined()
    expect(opciones.includeLocalVariables).toBe(false)
  })

  it("beforeSend redacta PII y secretos en extras, contextos, breadcrumbs, request y user", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1"
    const { beforeSend } = await cargarConfiguracion()
    if (!beforeSend) throw new Error("Falta beforeSend en la configuracion de Sentry")

    const evento: Record<string, unknown> = {
      extra: {
        email: "pagador@example.com",
        token: "tok-1",
        id: "pay_1",
        monto: 10656,
        anidado: { email_address: "pagador@example.com" },
      },
      contexts: {
        pagador: { name: "Ana", country: "AR" },
      },
      breadcrumbs: [
        {
          category: "http",
          message: "Pago para pagador@example.com",
          data: {
            authorization: "Bearer token-secreto-123",
            url: "https://pixelarch.dev/pago/paypal/abc123xyz",
          },
        },
      ],
      request: {
        url: "https://pixelarch.dev/pago/paypal/abc123xyz",
        headers: {
          Authorization: "Bearer token-secreto-123",
          "X-Request-Id": "req-1",
        },
        data: { email: "pagador@example.com" },
      },
      user: { id: "user_1", email: "pagador@example.com" },
      tags: { payerEmail: "pagador@example.com", estado: "SUCCEEDED" },
      exception: {
        values: [{ type: "Error", value: "Fallo para pagador@example.com" }],
      },
      logentry: { message: "token=tok-1" },
      message: "Fallo para pagador@example.com",
      transaction: "GET /pago/paypal/abc123xyz",
      sdkProcessingMetadata: {
        email: "pagador@example.com",
        requestId: "req-1",
      },
      level: "error",
    }

    // Referencia al objeto original para comprobar que el redactor no lo muta.
    const extraOriginal = evento.extra as Record<string, unknown>

    const salida = beforeSend(evento)

    const extra = salida.extra as Record<string, unknown>
    const anidado = extra.anidado as Record<string, unknown>
    expect(extra.email).toBe(REDACTED)
    expect(extra.token).toBe(REDACTED)
    expect(extra.id).toBe("pay_1")
    expect(extra.monto).toBe(10656)
    expect(anidado.email_address).toBe(REDACTED)

    const contexts = salida.contexts as Record<string, Record<string, unknown>>
    expect(contexts.pagador.name).toBe(REDACTED)
    expect(contexts.pagador.country).toBe("AR")

    const breadcrumbs = salida.breadcrumbs as Array<Record<string, unknown>>
    const breadcrumbData = breadcrumbs[0].data as Record<string, unknown>
    expect(breadcrumbs[0].category).toBe("http")
    expect(String(breadcrumbs[0].message)).not.toContain("pagador@example.com")
    expect(breadcrumbData.authorization).toBe(REDACTED)
    expect(String(breadcrumbData.url)).not.toContain("abc123xyz")

    const request = salida.request as Record<string, unknown>
    const requestHeaders = request.headers as Record<string, unknown>
    const requestData = request.data as Record<string, unknown>
    expect(String(request.url)).not.toContain("abc123xyz")
    expect(requestHeaders.Authorization).toBe(REDACTED)
    expect(requestHeaders["X-Request-Id"]).toBe("req-1")
    expect(requestData.email).toBe(REDACTED)

    const user = salida.user as Record<string, unknown>
    expect(user.id).toBe("user_1")
    expect(user.email).toBe(REDACTED)

    const tags = salida.tags as Record<string, unknown>
    expect(tags.payerEmail).toBe(REDACTED)
    expect(tags.estado).toBe("SUCCEEDED")

    const exception = salida.exception as { values: Array<Record<string, unknown>> }
    expect(exception.values[0].type).toBe("Error")
    expect(String(exception.values[0].value)).not.toContain("pagador@example.com")

    const logentry = salida.logentry as Record<string, unknown>
    expect(String(logentry.message)).not.toContain("tok-1")

    expect(String(salida.message)).not.toContain("pagador@example.com")
    expect(String(salida.transaction)).not.toContain("abc123xyz")

    const metadata = salida.sdkProcessingMetadata as Record<string, unknown>
    expect(metadata.email).toBe(REDACTED)
    expect(metadata.requestId).toBe("req-1")

    expect(salida.level).toBe("error")

    // El redactor devuelve copias: el objeto original no se muta.
    expect(extraOriginal.email).toBe("pagador@example.com")
  })
})

describe("sentry.edge.config (AC-19)", () => {
  it("replica includeLocalVariables false y el redactor de beforeSend", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1"

    const opciones = await cargarConfiguracionEdge()

    expect(opciones.includeLocalVariables).toBe(false)
    expect(typeof opciones.beforeSend).toBe("function")
    if (!opciones.beforeSend) throw new Error("Falta beforeSend en edge")

    const salida = opciones.beforeSend({
      extra: { email: "pagador@example.com", id: "pay_1" },
      user: { email: "pagador@example.com" },
      message: "Fallo para pagador@example.com",
      transaction: "GET /pago/paypal/abc123xyz",
      sdkProcessingMetadata: { payer_id: "PAYER-1", requestId: "req-1" },
      level: "error",
    })

    const extra = salida.extra as Record<string, unknown>
    const user = salida.user as Record<string, unknown>
    const metadata = salida.sdkProcessingMetadata as Record<string, unknown>
    expect(extra.email).toBe(REDACTED)
    expect(extra.id).toBe("pay_1")
    expect(user.email).toBe(REDACTED)
    expect(String(salida.message)).not.toContain("pagador@example.com")
    expect(String(salida.transaction)).not.toContain("abc123xyz")
    expect(metadata.payer_id).toBe(REDACTED)
    expect(metadata.requestId).toBe("req-1")
    expect(salida.level).toBe("error")
  })
})
