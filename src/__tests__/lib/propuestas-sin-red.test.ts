import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as POST_BORRADOR } from "@/app/api/propuestas/prospectos/[id]/borrador/route"
import { buscarLugaresPlaces } from "@/lib/propuestas/places"
import { ErrorResend, enviarEmail } from "@/lib/propuestas/resend"
import { resetRateLimit } from "@/lib/rate-limit"
import {
  esHostPropuestasBloqueado,
  esUrlPropuestasBloqueada,
  instalarGuardRedPropuestas,
  mensajeRedPropuestas,
} from "../helpers/guard-propuestas-red"

/**
 * T-23 (AC-41, AC-44; RF-59, RF-60, RF-61): la suite del portal no llama a
 * proveedores reales.
 *
 * - `buscarLugaresPlaces` y `enviarEmail` fallan antes de tocar `fetch` si
 *   falta la configuracion (Places/Resend).
 * - `modo: "LLM"` responde 503 sin leer/escribir Prisma ni llamar a un LLM.
 * - El guard instalado en `setup.ts` bloquea Places, Resend y hosts LLM con un
 *   mensaje accionable, sin filtrar query strings ni credenciales.
 *
 * Los mocks de Prisma/Clerk existen solo para ejercitar la ruta; ninguno toca
 * una base real.
 */

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  prisma: {
    prospecto: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    envioPropuesta: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    plantillaPropuesta: { findFirst: vi.fn() },
    supresionProspecto: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    consumoProveedor: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/propuestas/auth", () => ({
  resolverAdminPropuestas: mocks.admin,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

const ENTRADA_RESEND = {
  fromEmail: "propuestas@pixelarch.dev",
  replyTo: "hola@pixelarch.dev",
  to: "ana@example.com",
  subject: "Una propuesta para tu negocio",
  html: "<p>Hola</p>",
  text: "Hola",
  headers: {
    "List-Unsubscribe":
      "<https://pixelarch.dev/api/opt-out?token=token-de-prueba>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  idempotencyKey: "envio:cmp_1:v1",
}

beforeEach(() => {
  vi.stubEnv("PROPUESTAS_PLACES_API_KEY", "")
  vi.stubEnv("RESEND_API_KEY", "")
  vi.stubEnv("NEXT_PUBLIC_URL", "https://pixelarch.dev")

  mocks.admin.mockResolvedValue({
    ok: true,
    admin: { userId: "admin_llm", nombre: "Admin" },
  })

  resetRateLimit("propuestas:admin_llm")
  resetRateLimit("propuestas:ip:unknown")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("configuracion faltante no toca la red (T-23, AC-41, AC-44)", () => {
  it("sin PROPUESTAS_PLACES_API_KEY no llama a fetch y falla cerrado", async () => {
    const fetchEspia = vi.fn()

    const resultado = await buscarLugaresPlaces(
      { textQuery: "cafes de especialidad en Palermo" },
      { fetchImpl: fetchEspia },
    )

    expect(resultado).toEqual({
      ok: false,
      codigo: "NO_CONFIGURADO",
      status: null,
      mensaje: "La funcion solicitada no esta configurada.",
    })
    expect(fetchEspia).not.toHaveBeenCalled()
  })

  it("un apiKey inyectado vacio tampoco llama a fetch", async () => {
    const fetchEspia = vi.fn()

    const resultado = await buscarLugaresPlaces(
      { textQuery: "estudios contables en Rosario" },
      { apiKey: "   ", fetchImpl: fetchEspia },
    )

    expect(resultado.ok).toBe(false)
    expect(resultado).toMatchObject({ codigo: "NO_CONFIGURADO" })
    expect(fetchEspia).not.toHaveBeenCalled()
  })

  it("sin RESEND_API_KEY falla con VALIDACION, no toca fetch y no filtra PII", async () => {
    const fetchEspia = vi.fn()

    const error = await enviarEmail(ENTRADA_RESEND, {
      fetchImpl: fetchEspia,
    }).then(
      () => null,
      (causa: unknown) => causa,
    )

    expect(error).toBeInstanceOf(ErrorResend)
    expect((error as ErrorResend).codigo).toBe("VALIDACION")
    expect((error as Error).message).not.toContain("ana@example.com")
    expect(fetchEspia).not.toHaveBeenCalled()
  })
})

describe("modo LLM: 503 sin escrituras ni proveedor (T-23, AC-41, AC-44)", () => {
  it("responde NO_CONFIGURADO antes de leer o escribir Prisma y sin fetch", async () => {
    const fetchEspia = vi.spyOn(globalThis, "fetch")

    try {
      const request = new Request(
        "https://pixelarch.dev/api/propuestas/prospectos/cmp_prospecto_1/borrador",
        {
          method: "POST",
          headers: {
            origin: "https://pixelarch.dev",
            "content-type": "application/json",
          },
          body: JSON.stringify({ modo: "LLM" }),
        },
      )

      const respuesta = await POST_BORRADOR(request, {
        params: Promise.resolve({ id: "cmp_prospecto_1" }),
      })

      expect(respuesta.status).toBe(503)
      await expect(respuesta.json()).resolves.toEqual({
        error: "La redacción por LLM no está configurada.",
        codigo: "NO_CONFIGURADO",
      })

      expect(mocks.prisma.prospecto.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.prospecto.updateMany).not.toHaveBeenCalled()
      expect(mocks.prisma.envioPropuesta.create).not.toHaveBeenCalled()
      expect(mocks.prisma.envioPropuesta.findFirst).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(fetchEspia).not.toHaveBeenCalled()
    } finally {
      fetchEspia.mockRestore()
    }
  })
})

describe("guard de red del portal (T-23, AC-41, AC-44)", () => {
  it("detecta Places, Resend, LLM y sus subdominios", () => {
    for (const host of [
      "places.googleapis.com",
      "api.resend.com",
      "api.openai.com",
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "openrouter.ai",
      "cdn.openrouter.ai",
      "api.mistral.ai",
      "api.cohere.ai",
      "API.OPENAI.COM",
      "api.openai.com.",
    ]) {
      expect(esHostPropuestasBloqueado(host), host).toBe(true)
    }
  })

  it("no bloquea hosts parecidos ni la app", () => {
    for (const host of [
      "googleapis.com",
      "notplaces.googleapis.com",
      "places.googleapis.com.evil.example",
      "notopenai.com",
      "openrouter.ai.evil.example",
      "pixelarch.dev",
      "localhost",
    ]) {
      expect(esHostPropuestasBloqueado(host), host).toBe(false)
    }

    expect(esUrlPropuestasBloqueada("https://pixelarch.dev/propuestas")).toBe(
      false,
    )
    expect(esUrlPropuestasBloqueada("no-es-una-url")).toBe(false)
    expect(esUrlPropuestasBloqueada(null)).toBe(false)
  })

  it("bloquea un fetch real a Places, Resend y LLM sin salir a la red", async () => {
    expect(() => instalarGuardRedPropuestas()).not.toThrow()

    await expect(
      fetch("https://places.googleapis.com/v1/places:searchText"),
    ).rejects.toThrow(/places\.googleapis\.com/)

    await expect(fetch("https://api.resend.com/emails")).rejects.toThrow(
      /api\.resend\.com/,
    )

    await expect(
      fetch("https://api.openai.com/v1/chat/completions"),
    ).rejects.toThrow(/api\.openai\.com/)

    await expect(
      fetch("https://generativelanguage.googleapis.com/v1beta/models"),
    ).rejects.toThrow(/generativelanguage\.googleapis\.com/)
  })

  it("es idempotente: reinstalarlo no duplica el wrapper", () => {
    const antes = globalThis.fetch
    instalarGuardRedPropuestas()
    expect(globalThis.fetch).toBe(antes)
  })

  it("setup.ts deja el guard instalado sobre fetch", () => {
    const actual = globalThis.fetch as typeof fetch & {
      __pixelarchGuardRedPropuestas?: true
    }

    expect(actual.__pixelarchGuardRedPropuestas).toBe(true)
  })

  it("reconoce URL y Request como entradas bloqueadas sin filtrar la query", () => {
    expect(
      esUrlPropuestasBloqueada(
        new URL("https://api.openai.com/v1/chat/completions?x=1"),
      ),
    ).toBe(true)

    const request = new Request(
      "https://places.googleapis.com/v1/places:searchText?key=clave-secreta",
      { method: "POST" },
    )

    expect(esUrlPropuestasBloqueada(request)).toBe(true)

    const mensaje = mensajeRedPropuestas(request)
    expect(mensaje).toContain("places.googleapis.com")
    expect(mensaje).toContain("/v1/places:searchText")
    expect(mensaje).not.toContain("clave-secreta")
    expect(mensaje).not.toContain("key=")
  })

  it("deja pasar hosts ajenos y delega en el fetch previo", async () => {
    const anterior = globalThis.fetch
    const mock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      // El guard debe delegar la entrada y el init originales tal cual.
      expect(args.length).toBeGreaterThan(0)
      return new Response("ok", { status: 200 })
    })

    vi.stubGlobal("fetch", mock)

    try {
      instalarGuardRedPropuestas()

      const respuesta = await fetch("https://pixelarch.dev/api/health")
      expect(respuesta.status).toBe(200)
      expect(mock).toHaveBeenCalledTimes(1)
      expect(mock.mock.calls[0]?.[0]).toBe("https://pixelarch.dev/api/health")

      await expect(fetch("https://api.resend.com/emails")).rejects.toThrow(
        /api\.resend\.com/,
      )
      expect(mock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }

    expect(globalThis.fetch).toBe(anterior)
  })

  it("con claves falsas el guard corta Places y Resend antes de la red", async () => {
    vi.stubEnv("PROPUESTAS_PLACES_API_KEY", "clave-falsa-places-1234567890")
    vi.stubEnv("RESEND_API_KEY", "clave-falsa-resend-1234567890")

    const places = await buscarLugaresPlaces({
      textQuery: "cafes de especialidad en Palermo",
    })

    expect(places).toEqual({
      ok: false,
      codigo: "RED",
      status: null,
      mensaje: "Error de red.",
    })

    await expect(enviarEmail(ENTRADA_RESEND)).rejects.toMatchObject({
      codigo: "RED",
    })
  })

  it("el mensaje indica host/path y no filtra query ni credenciales", () => {
    const mensaje = mensajeRedPropuestas(
      "https://api.openai.com/v1/chat/completions?api_key=sk-secreto-123",
    )

    expect(mensaje).toContain("api.openai.com")
    expect(mensaje).toContain("/v1/chat/completions")
    expect(mensaje).toContain("vi.stubGlobal")
    expect(mensaje).toContain("Places")
    expect(mensaje).toContain("Resend")
    expect(mensaje).toContain("LLM")
    expect(mensaje).not.toContain("api_key")
    expect(mensaje).not.toContain("sk-secreto-123")
  })
})
