import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as POST_CAMPANAS } from "@/app/api/propuestas/campanas/route"
import { logger } from "@/lib/logger"
import { resetRateLimit } from "@/lib/rate-limit"
import {
  REDACTED,
  redactSentryEventPropuestas,
  redactarMetaPropuestas,
  redactarTextoPropuestas,
  redactarUrlPropuestas,
} from "@/lib/propuestas/redact"

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  prisma: {
    campanaProspeccion: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    plantillaPropuesta: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/propuestas/auth", () => ({
  resolverAdminPropuestas: mocks.admin,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

/**
 * T-23 (AC-41; RF-59, RF-60, RF-61): privacidad del portal de propuestas.
 *
 * Cubre tres frentes:
 * - redaccion real de metas de log y eventos de Sentry (email, nombre,
 *   telefono, cuerpo, HTML, token de baja/opt-out y secretos);
 * - un caller real (`POST /api/propuestas/campanas`) con Prisma mockeado, para
 *   verificar que la ruta no entrega PII al logger ni a console;
 * - reglas estaticas sobre `src/lib/propuestas/**`: sin `console.*`, sin
 *   secretos embebidos, sin Prisma en modulos puros y sin logs con claves
 *   prohibidas.
 *
 * No hace llamadas de red: solo lee archivos, llama funciones puras y ejecuta
 * una ruta con Prisma/auth mockeados.
 */

const ROOT = process.cwd()
const DIR_LIB = path.join(ROOT, "src", "lib", "propuestas")
const DIR_API_PROPUESTAS = path.join(ROOT, "src", "app", "api", "propuestas")

const MODULOS_CON_PRISMA = new Set([
  "arco.ts",
  "consumo.ts",
  "prospectos-supresion.ts",
  "retencion.ts",
  "supresiones.ts",
])

const PATRONES_SECRETOS = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /\bre_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /PROPUESTAS_SECRETO\s*=\s*["'][^"']{8,}["']/,
]

const CLAVES_PROHIBIDAS_LOGGER =
  /\b(email|nombre|telefono|teléfono|cuerpo|html|token|secreto|password|apiKey|authorization)\s*:/i

function archivosLib(): string[] {
  if (!existsSync(DIR_LIB)) return []
  return readdirSync(DIR_LIB)
    .filter((nombre) => nombre.endsWith(".ts"))
    .map((nombre) => path.join(DIR_LIB, nombre))
    .sort()
}

function relativo(archivo: string): string {
  return path.relative(ROOT, archivo).split(path.sep).join("/")
}

function archivosTs(directorio: string): string[] {
  if (!existsSync(directorio)) return []

  const archivos: string[] = []

  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const completo = path.join(directorio, entrada.name)

    if (entrada.isDirectory()) {
      archivos.push(...archivosTs(completo))
      continue
    }

    if (entrada.name.endsWith(".ts")) archivos.push(completo)
  }

  return archivos.sort()
}

/**
 * Extrae los argumentos de cada `logger.debug/info/warn/error(...)` respetando
 * parentesis, comillas y templates. Evita falsos positivos por regex perezosas
 * en llamadas multilinea.
 */
function argumentosDeLogger(fuente: string): string[] {
  const llamadas: string[] = []
  const patron = /logger\.(?:debug|info|warn|error)\s*\(/g

  while (patron.exec(fuente) !== null) {
    let i = patron.lastIndex
    let profundidad = 1
    let comilla: string | null = null
    let escape = false

    while (i < fuente.length && profundidad > 0) {
      const caracter = fuente[i]

      if (comilla !== null) {
        if (escape) {
          escape = false
        } else if (caracter === "\\") {
          escape = true
        } else if (caracter === comilla) {
          comilla = null
        }
      } else if (caracter === '"' || caracter === "'" || caracter === "`") {
        comilla = caracter
      } else if (caracter === "(") {
        profundidad++
      } else if (caracter === ")") {
        profundidad--
      }

      i++
    }

    llamadas.push(fuente.slice(patron.lastIndex, Math.max(patron.lastIndex, i - 1)))
    patron.lastIndex = i
  }

  return llamadas
}

const META_SENSIBLE = {
  prospectoId: "cmp_prospecto_1",
  campanaId: "cmp_campana_1",
  envioId: "cmp_envio_1",
  estado: "ENVIADO",
  codigo: "PROVEEDOR",
  duracionMs: 120,
  email: "ana@example.com",
  nombre: "Ana Perez",
  telefono: "+54 11 5555-1234",
  cuerpo: "Hola Ana, te acerco una propuesta.",
  html: "<html><body><p>Hola Ana</p></body></html>",
  token: "v1.cmp_prospecto_1.hashfalso.hmacfalso",
  secreto: "secreto-super-privado-1234567890",
  urlBaja:
    "https://pixelarch.dev/propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso",
  optOut:
    "https://pixelarch.dev/api/opt-out?token=v1.cmp_prospecto_1.hashfalso.hmacfalso",
  anidado: {
    email: "ana@example.com",
    observacion: "Contactar por la tarde",
  },
} as const

const VALORES_SENSIBLES = [
  "ana@example.com",
  "Ana Perez",
  "+54 11 5555-1234",
  "Hola Ana, te acerco una propuesta.",
  "<html><body><p>Hola Ana</p></body></html>",
  "v1.cmp_prospecto_1.hashfalso.hmacfalso",
  "secreto-super-privado-1234567890",
]

describe("redaccion de texto del portal (T-23, AC-41)", () => {
  it("redacta email, nombre, telefono, cuerpo y secreto sin tocar ids internos", () => {
    const texto =
      "prospectoId=cmp_prospecto_1 campanaId=cmp_campana_1 estado=ENVIADO codigo=PROVEEDOR duracionMs=120; " +
      "email: ana@example.com; nombre: Ana Perez; telefono: +54 11 5555-1234; " +
      "cuerpo: Hola Ana, te acerco una propuesta.; secreto=secreto-super-privado-1234567890; " +
      "Authorization: Bearer abcdef1234567890"

    const salida = redactarTextoPropuestas(texto)

    expect(salida).toContain("prospectoId=cmp_prospecto_1")
    expect(salida).toContain("campanaId=cmp_campana_1")
    expect(salida).toContain("estado=ENVIADO")
    expect(salida).toContain("codigo=PROVEEDOR")
    expect(salida).toContain("duracionMs=120")
    expect(salida).toContain(REDACTED)

    for (const valor of [
      "ana@example.com",
      "Ana Perez",
      "5555-1234",
      "Hola Ana",
      "secreto-super-privado",
      "abcdef1234567890",
    ]) {
      expect(salida).not.toContain(valor)
    }
  })

  it("redacta un cuerpo suelto sin dejar la cola de la propuesta (regresion)", () => {
    const salida = redactarTextoPropuestas(
      "cuerpo: Hola Ana, te acerco una propuesta.",
    )

    expect(salida).toBe("cuerpo: [REDACTED]")
    expect(salida).not.toContain("te acerco una propuesta")
    expect(salida).not.toContain("Hola Ana")
  })

  it("redacta el token del link de baja y el token del opt-out", () => {
    const texto =
      "Baja: https://pixelarch.dev/propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso " +
      "y opt-out: https://pixelarch.dev/api/opt-out?token=v1.cmp_prospecto_1.hashfalso.hmacfalso&motivo=alta"

    const salida = redactarTextoPropuestas(texto)

    expect(salida).toContain("/propuestas/baja/[token]")
    expect(salida).toContain("token=[REDACTED]")
    expect(salida).not.toContain("v1.cmp_prospecto_1.hashfalso.hmacfalso")
    expect(salida).toContain("motivo=alta")
  })

  it("redactarUrlPropuestas conserva host/path y elimina tokens y credenciales", () => {
    expect(
      redactarUrlPropuestas(
        "https://pixelarch.dev/propuestas/baja/v1.cmp.hash.hmac",
      ),
    ).toBe("https://pixelarch.dev/propuestas/baja/[token]")

    expect(
      redactarUrlPropuestas(
        "https://pixelarch.dev/api/opt-out?token=v1.cmp.hash.hmac",
      ),
    ).toBe("https://pixelarch.dev/api/opt-out?token=[REDACTED]")

    const conCredenciales = redactarUrlPropuestas(
      "https://usuario:clave@example.com/propuestas/baja/v1.cmp.hash.hmac",
    )
    expect(conCredenciales).not.toContain("usuario")
    expect(conCredenciales).not.toContain("clave")
    expect(conCredenciales).toContain("[REDACTED]@example.com")
    expect(conCredenciales).toContain("/propuestas/baja/[token]")
  })

  it("un documento HTML completo se descarta entero", () => {
    expect(
      redactarTextoPropuestas(
        "<!doctype html><html><body><p>Ana Perez</p></body></html>",
      ),
    ).toBe(REDACTED)
    expect(
      redactarTextoPropuestas("<html lang=\"es\"><body>ana@example.com</body></html>"),
    ).toBe(REDACTED)
  })

  it("compone la redaccion de PayPal con la del portal", () => {
    const salida = redactarTextoPropuestas(
      "Pago https://pixelarch.dev/pago/paypal/ABC123def456 " +
        "y baja https://pixelarch.dev/propuestas/baja/v1.a.b.c",
    )

    // El token del link de pago lo redacta PayPal; el de baja, el portal.
    expect(salida).toContain("/pago/paypal/[REDACTED]")
    expect(salida).toContain("/propuestas/baja/[token]")
    expect(salida).not.toContain("ABC123def456")
    expect(salida).not.toContain("v1.a.b.c")
  })

  it("es idempotente y no toca ids, estados ni codigos internos", () => {
    const texto =
      "prospectoId=cmp_1 campanaId=cmp_2 envioId=cmp_3 estado=APROBADO codigo=OK duracionMs=15"
    expect(redactarTextoPropuestas(texto)).toBe(texto)

    const unaVez = redactarTextoPropuestas(
      "Baja /propuestas/baja/v1.a.b.c y opt-out /api/opt-out?token=v1.a.b.c",
    )
    expect(redactarTextoPropuestas(unaVez)).toBe(unaVez)
    expect(unaVez).not.toContain("v1.a.b.c")
  })
})

describe("redaccion de metas y eventos de Sentry (T-23, AC-41)", () => {
  it("redactarMetaPropuestas conserva estructura util y oculta la PII", () => {
    const salida = redactarMetaPropuestas(META_SENSIBLE)

    expect(salida).toMatchObject({
      prospectoId: "cmp_prospecto_1",
      campanaId: "cmp_campana_1",
      envioId: "cmp_envio_1",
      estado: "ENVIADO",
      codigo: "PROVEEDOR",
      duracionMs: 120,
    })

    expect(salida.email).toBe(REDACTED)
    expect(salida.nombre).toBe(REDACTED)
    expect(salida.telefono).toBe(REDACTED)
    expect(salida.cuerpo).toBe(REDACTED)
    expect(salida.html).toBe(REDACTED)
    expect(salida.token).toBe(REDACTED)
    expect(salida.secreto).toBe(REDACTED)
    expect(salida.anidado.email).toBe(REDACTED)
    expect(salida.anidado.observacion).toBe("Contactar por la tarde")

    expect(salida.urlBaja).toContain("/propuestas/baja/[token]")
    expect(salida.optOut).toContain("token=[REDACTED]")

    const serializado = JSON.stringify(salida)
    for (const valor of VALORES_SENSIBLES) {
      expect(serializado).not.toContain(valor)
    }

    // No muta la entrada.
    expect(META_SENSIBLE.email).toBe("ana@example.com")
    expect(META_SENSIBLE.cuerpo).toContain("Hola Ana")
    expect(META_SENSIBLE.urlBaja).toContain("v1.cmp_prospecto_1")
  })

  it("tolera ciclos sin mutar ni romper la estructura", () => {
    const ciclo: Record<string, unknown> = {
      prospectoId: "cmp_1",
      email: "ana@example.com",
    }
    ciclo.self = ciclo

    const salida = redactarMetaPropuestas(ciclo)

    expect(salida.prospectoId).toBe("cmp_1")
    expect(salida.email).toBe(REDACTED)
    expect(salida.self).toBe(salida)
    expect(ciclo.email).toBe("ana@example.com")
  })

  it("conserva fechas y cubre Map, Set y ciclos en arrays", () => {
    const fecha = new Date("2026-11-13T10:00:00.000Z")
    const ciclo: unknown[] = []
    ciclo.push(ciclo)

    const mapa = new Map<unknown, unknown>([
      ["email", "ana@example.com"],
      ["prospectoId", "cmp_prospecto_1"],
    ])
    const conjunto = new Set<unknown>([
      "ana@example.com",
      "cmp_prospecto_1",
    ])
    const entrada = { fecha, mapa, conjunto, ciclo }

    const salida = redactarMetaPropuestas(entrada)

    expect(salida.fecha).toBeInstanceOf(Date)
    expect(salida.fecha.getTime()).toBe(fecha.getTime())
    expect(salida.fecha).not.toBe(fecha)

    expect(salida.mapa).toBeInstanceOf(Map)
    const mapaSalida = salida.mapa as Map<unknown, unknown>
    expect(mapaSalida.get("email")).toBe(REDACTED)
    expect(mapaSalida.get("prospectoId")).toBe("cmp_prospecto_1")

    expect(salida.conjunto).toBeInstanceOf(Set)
    expect([...(salida.conjunto as Set<unknown>)]).toEqual([
      REDACTED,
      "cmp_prospecto_1",
    ])

    expect(salida.ciclo[0]).toBe(salida.ciclo)
    // La entrada original no se muta ni queda autorreferenciada a la copia.
    expect(ciclo[0]).toBe(ciclo)
    expect(mapa.get("email")).toBe("ana@example.com")
  })

  it("redacta el mensaje de un Error anidado sin dejar email ni token", () => {
    const salida = redactarMetaPropuestas({
      prospectoId: "cmp_prospecto_1",
      error: new Error("Fallo para ana@example.com con token=abc123456"),
    })

    expect(salida.prospectoId).toBe("cmp_prospecto_1")
    expect(salida.error.message).toBe(
      "Fallo para [REDACTED] con token=[REDACTED]",
    )

    const serializado = JSON.stringify(salida)
    expect(serializado).not.toContain("ana@example.com")
    expect(serializado).not.toContain("abc123456")
  })

  it("redactarMetaPropuestas es idempotente", () => {
    const unaVez = redactarMetaPropuestas(META_SENSIBLE)
    const dosVeces = redactarMetaPropuestas(unaVez)

    expect(dosVeces).toEqual(unaVez)
  })

  it("el evento de Sentry no expone email, cuerpo, HTML, token ni secreto", () => {
    const evento = {
      event_id: "evt_1",
      level: "error",
      extra: {
        prospectoId: "cmp_prospecto_1",
        estado: "ENVIADO",
        codigo: "PROVEEDOR",
        email: "ana@example.com",
        nombre: "Ana Perez",
        telefono: "+54 11 5555-1234",
        cuerpo: "Hola Ana, te acerco una propuesta.",
        html: "<html><body><p>Hola Ana</p></body></html>",
        token: "v1.cmp_prospecto_1.hashfalso.hmacfalso",
        secreto: "secreto-super-privado-1234567890",
      },
      contexts: {
        propuestas: {
          campanaId: "cmp_campana_1",
          urlBaja:
            "https://pixelarch.dev/propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso",
          optOut:
            "https://pixelarch.dev/api/opt-out?token=v1.cmp_prospecto_1.hashfalso.hmacfalso",
        },
      },
      breadcrumbs: [
        {
          category: "propuestas",
          message:
            "Baja abierta https://pixelarch.dev/propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso para ana@example.com",
          data: { prospectoId: "cmp_prospecto_1" },
        },
      ],
      request: {
        url: "https://pixelarch.dev/api/opt-out?token=v1.cmp_prospecto_1.hashfalso.hmacfalso",
        headers: {
          Authorization: "Bearer abcdef1234567890",
          "X-Request-Id": "req_1",
        },
        data: { email: "ana@example.com", cuerpo: "Hola Ana" },
      },
      user: { id: "user_1", email: "ana@example.com", name: "Ana Perez" },
      tags: { estado: "ENVIADO", codigo: "PROVEEDOR" },
      exception: {
        values: [
          {
            type: "Error",
            value:
              "Fallo para ana@example.com en /propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso",
          },
        ],
      },
      logentry: { message: "cuerpo: Hola Ana" },
      message: "Fallo para ana@example.com",
      transaction: "GET /propuestas/baja/v1.cmp_prospecto_1.hashfalso.hmacfalso",
      sdkProcessingMetadata: { requestId: "req_1" },
    }

    const salida = redactSentryEventPropuestas(evento)
    const serializado = JSON.stringify(salida)

    expect(salida.event_id).toBe("evt_1")
    expect(salida.level).toBe("error")
    expect(salida.extra.prospectoId).toBe("cmp_prospecto_1")
    expect(salida.extra.estado).toBe("ENVIADO")
    expect(salida.extra.codigo).toBe("PROVEEDOR")
    expect(salida.extra.email).toBe(REDACTED)
    expect(salida.extra.cuerpo).toBe(REDACTED)
    expect(salida.extra.html).toBe(REDACTED)
    expect(salida.extra.secreto).toBe(REDACTED)
    expect(salida.contexts.propuestas.campanaId).toBe("cmp_campana_1")
    expect(salida.contexts.propuestas.urlBaja).toContain(
      "/propuestas/baja/[token]",
    )
    expect(salida.contexts.propuestas.optOut).toContain("token=[REDACTED]")

    // request: URL, headers y data censurados sin perder el id de request.
    expect(salida.request.url).toBe(
      "https://pixelarch.dev/api/opt-out?token=[REDACTED]",
    )
    expect(salida.request.headers["X-Request-Id"]).toBe("req_1")
    expect(salida.request.headers.Authorization).toBe(REDACTED)
    expect(salida.request.data.email).toBe(REDACTED)
    expect(salida.request.data.cuerpo).toBe(REDACTED)

    // breadcrumbs, exception, logentry, message y transaction.
    expect(salida.breadcrumbs[0]?.message).toContain("/propuestas/baja/[token]")
    expect(salida.breadcrumbs[0]?.message).not.toContain("ana@example.com")
    expect(salida.breadcrumbs[0]?.data.prospectoId).toBe("cmp_prospecto_1")
    expect(salida.exception.values[0]?.value).toContain(
      "/propuestas/baja/[token]",
    )
    expect(salida.exception.values[0]?.value).not.toContain("ana@example.com")
    expect(salida.logentry.message).toBe("cuerpo: [REDACTED]")
    expect(salida.message).toBe("Fallo para [REDACTED]")
    expect(salida.transaction).toBe("GET /propuestas/baja/[token]")

    expect(salida.user.id).toBe("user_1")
    expect(salida.user.email).toBe(REDACTED)
    expect(salida.user.name).toBe(REDACTED)
    expect(salida.tags.estado).toBe("ENVIADO")
    expect(salida.sdkProcessingMetadata.requestId).toBe("req_1")

    for (const valor of VALORES_SENSIBLES) {
      expect(serializado).not.toContain(valor)
    }
    expect(serializado).toContain("/propuestas/baja/[token]")
    expect(serializado).toContain("token=[REDACTED]")
    expect(serializado).toContain("/api/opt-out")
    // El evento original no se muta.
    expect(evento.extra.email).toBe("ana@example.com")
    expect(evento.request.url).toContain("v1.cmp_prospecto_1")
  })

  describe("caller real de una ruta del portal (T-23, AC-41)", () => {
    const PII = [
      "ana@example.com",
      "Ana Perez",
      "+54 11 5555-1234",
      "Hola Ana, te acerco una propuesta.",
      "<html><body><p>Hola Ana</p></body></html>",
      "v1.cmp_prospecto_1.hashfalso.hmacfalso",
    ] as const

    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_URL", "https://pixelarch.dev")
      mocks.admin.mockResolvedValue({
        ok: true,
        admin: { userId: "admin_privacidad", nombre: "Admin" },
      })
      resetRateLimit("propuestas:admin_privacidad")
      resetRateLimit("propuestas:ip:unknown")
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.clearAllMocks()
      vi.restoreAllMocks()
    })

    it("un error de Prisma con PII no llega al logger ni a console", async () => {
      const detalle = [
        "email=ana@example.com",
        "nombre=Ana Perez",
        "telefono=+54 11 5555-1234",
        "cuerpo=Hola Ana, te acerco una propuesta.",
        "html=<html><body><p>Hola Ana</p></body></html>",
        "token=v1.cmp_prospecto_1.hashfalso.hmacfalso",
      ].join("; ")

      mocks.prisma.campanaProspeccion.findUnique.mockRejectedValue(
        new Error(`Fallo inesperado: ${detalle}`),
      )

      const consolaError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})
      // Espia el logger real sin reemplazar su implementacion: la ruta ejerce
      // el caller y el logger sigue escribiendo por console.error.
      const loggerError = vi.spyOn(logger, "error")

      try {
        const request = new Request(
          "https://pixelarch.dev/api/propuestas/campanas",
          {
            method: "POST",
            headers: {
              origin: "https://pixelarch.dev",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              nombre: "Campana privacidad",
              consulta: "cafes de especialidad en Palermo",
              limiteCorrida: 5,
              idempotencyKey: "11111111-1111-4111-8111-111111111111",
            }),
          },
        )

        const respuesta = await POST_CAMPANAS(request)

        expect(respuesta.status).toBe(500)
        await expect(respuesta.json()).resolves.toEqual({
          error: "Error inesperado.",
          codigo: "DESCONOCIDO",
        })

        expect(loggerError).toHaveBeenCalledTimes(1)
        const [mensaje, meta] = loggerError.mock.calls[0] ?? []
        expect(mensaje).toBe("Error creando campana de propuestas")
        expect(meta).toEqual({
          codigo: "DESCONOCIDO",
          adminId: "admin_privacidad",
        })

        const salidaConsola = consolaError.mock.calls
          .map((llamada) => String(llamada[0]))
          .join("\n")

        expect(salidaConsola).toContain("Error creando campana de propuestas")
        expect(salidaConsola).toContain("admin_privacidad")
        expect(salidaConsola).toContain("DESCONOCIDO")

        for (const valor of PII) {
          expect(JSON.stringify(meta)).not.toContain(valor)
          expect(salidaConsola).not.toContain(valor)
        }
      } finally {
        loggerError.mockRestore()
        consolaError.mockRestore()
      }
    })
  })

  it("los tres runtimes de Sentry usan el redactor que cubre propuestas", () => {
    for (const archivo of [
      "src/sentry.server.config.ts",
      "src/sentry.edge.config.ts",
      "src/instrumentation-client.ts",
    ]) {
      const fuente = readFileSync(path.join(ROOT, archivo), "utf8")
      expect(fuente, archivo).toContain("beforeSend")
      expect(fuente, archivo).toContain("redactSentryEventPropuestas")
    }
  })

  it("la redaccion no rompe DSN, sampling ni replay de los tres runtimes", () => {
    const runtimes = {
      "src/sentry.server.config.ts": "SENTRY_DSN",
      "src/sentry.edge.config.ts": "SENTRY_DSN",
      "src/instrumentation-client.ts": "NEXT_PUBLIC_SENTRY_DSN",
    } as const

    for (const [archivo, variableDsn] of Object.entries(runtimes)) {
      const fuente = readFileSync(path.join(ROOT, archivo), "utf8")

      expect(fuente, archivo).toContain("Sentry.init({")
      expect(fuente, archivo).toContain(variableDsn)
      expect(fuente, archivo).toContain("enabled: !!dsn")
      expect(fuente, archivo).toContain("tracesSampleRate")
      expect(fuente, archivo).toContain("beforeSend(event)")
      expect(fuente, archivo).toContain(
        "return redactSentryEventPropuestas(event)",
      )
    }

    const cliente = readFileSync(
      path.join(ROOT, "src/instrumentation-client.ts"),
      "utf8",
    )
    expect(cliente).toContain("replaysSessionSampleRate: 0.1")
    expect(cliente).toContain("replaysOnErrorSampleRate: 1.0")
    expect(cliente).toContain("Sentry.replayIntegration()")
    expect(cliente).toContain("captureRouterTransitionStart")

    for (const archivo of [
      "src/sentry.server.config.ts",
      "src/sentry.edge.config.ts",
    ]) {
      const fuente = readFileSync(path.join(ROOT, archivo), "utf8")
      expect(fuente, archivo).toContain("includeLocalVariables: false")
    }
  })
})

describe("reglas estaticas de privacidad en src/lib/propuestas (T-23, AC-41)", () => {
  const archivos = archivosLib()

  it("encuentra los modulos reales del portal (el test no es vacio)", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(15)
    const nombres = archivos.map(relativo)
    expect(nombres).toContain("src/lib/propuestas/redact.ts")
    expect(nombres).toContain("src/lib/propuestas/config.ts")
    expect(nombres).toContain("src/lib/propuestas/errores.ts")
  })

  it("no usa console.*: los logs pasan por logger y redactan la meta", () => {
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8")
      expect(fuente, relativo(archivo)).not.toMatch(
        /console\.(?:log|info|warn|error|debug)\s*\(/,
      )
    }
  })

  it("el redactor es browser-safe: sin node:* ni server-only", () => {
    for (const archivo of [
      "src/lib/propuestas/redact.ts",
      "src/lib/paypal/redact.ts",
    ]) {
      const fuente = readFileSync(path.join(ROOT, archivo), "utf8")
      expect(fuente, archivo).not.toMatch(/\bfrom\s+["']node:/)
      expect(fuente, archivo).not.toMatch(/\brequire\s*\(\s*["']node:/)
      expect(fuente, archivo).not.toMatch(/["']server-only["']/)
    }
  })

  it("las llamadas a logger no incluyen claves con PII", () => {
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8")
      for (const argumentos of argumentosDeLogger(fuente)) {
        expect(argumentos, relativo(archivo)).not.toMatch(
          CLAVES_PROHIBIDAS_LOGGER,
        )
      }
    }
  })

  it("las rutas del portal no loguean PII ni usan console.*", () => {
    const rutas = archivosTs(DIR_API_PROPUESTAS)
    expect(rutas.length).toBeGreaterThanOrEqual(10)

    // Claves inequivocamente sensibles. Se omite `nombre` a proposito: en las
    // rutas puede referirse al nombre de una campana, no a una persona.
    const clavesProhibidas =
      /\b(email|telefono|teléfono|cuerpo|html|token|secreto|password|apiKey|authorization)\s*:/i

    for (const archivo of rutas) {
      const fuente = readFileSync(archivo, "utf8")
      expect(fuente, relativo(archivo)).not.toMatch(
        /console\.(?:log|info|warn|error|debug)\s*\(/,
      )

      for (const argumentos of argumentosDeLogger(fuente)) {
        expect(argumentos, relativo(archivo)).not.toMatch(clavesProhibidas)
      }
    }
  })

  it("solo los modulos de dominio con Prisma importan el cliente", () => {
    for (const archivo of archivos) {
      if (MODULOS_CON_PRISMA.has(path.basename(archivo))) continue
      const fuente = readFileSync(archivo, "utf8")
      expect(fuente, relativo(archivo)).not.toContain("@/lib/prisma")
    }
  })

  it("no contiene secretos embebidos ni claves de proveedor", () => {
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8")
      for (const patron of PATRONES_SECRETOS) {
        expect(fuente, relativo(archivo)).not.toMatch(patron)
      }
    }
  })
})
