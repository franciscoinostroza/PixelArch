import { describe, expect, it } from "vitest"
import {
  REDACTED,
  esClaveSensible,
  redactSensitiveData,
  redactSensitiveString,
  redactSentryEvent,
} from "@/lib/paypal/redact"

// AC-19 / RNF-13: ni emails, nombres, direcciones, tokens ni secretos deben
// llegar a logs o Sentry; el resto de la informacion util se conserva.
describe("redactSensitiveData (AC-19)", () => {
  it("redacta todas las claves sensibles conocidas", () => {
    const entrada: Record<string, string> = {
      email: "pagador@example.com",
      email_address: "pagador@example.com",
      payerEmail: "pagador@example.com",
      pagadorEmail: "pagador@example.com",
      nombre: "Ana",
      name: "Ana",
      given_name: "Ana",
      surname: "Perez",
      address: "Calle 123",
      token: "tok-1",
      access_token: "access-1",
      refresh_token: "refresh-1",
      client_secret: "secret-1",
      secret: "secret-2",
      password: "hunter2",
      apiKey: "api-key-1",
      "x-api-key": "x-api-key-1",
      cookie: "session=abc",
      "set-cookie": "session=abc",
      phone: "+54 11 5555 5555",
      telefono: "+54 11 5555 5555",
      Authorization: "Bearer token-abc",
      enlace: "https://pixelarch.dev/pago/paypal/abc",
      PayerID: "PAYER-1",
      payer_id: "PAYER-2",
    }

    const salida = redactSensitiveData(entrada)

    for (const clave of Object.keys(entrada)) {
      expect(salida[clave]).toBe(REDACTED)
    }
  })

  it("redacta en objetos anidados y arrays sin tocar datos utiles", () => {
    const entrada = {
      id: "pay_1",
      monto: 10656,
      moneda: "usd",
      estado: "SUCCEEDED",
      pagador: {
        email: "pagador@example.com",
        name: "Ana",
        payer_id: "PAYER-1",
        pais: "AR",
      },
      eventos: [
        { tipo: "PAYMENT.CAPTURE.COMPLETED", email: "pagador@example.com", monto: 10656 },
        { tipo: "PAYMENT.CAPTURE.DENIED", token: "tok-1" },
      ],
    }

    const salida = redactSensitiveData(entrada)

    expect(salida.id).toBe("pay_1")
    expect(salida.monto).toBe(10656)
    expect(salida.moneda).toBe("usd")
    expect(salida.estado).toBe("SUCCEEDED")
    expect(salida.pagador).toEqual({
      email: REDACTED,
      name: REDACTED,
      payer_id: REDACTED,
      pais: "AR",
    })
    expect(salida.eventos[0]).toEqual({
      tipo: "PAYMENT.CAPTURE.COMPLETED",
      email: REDACTED,
      monto: 10656,
    })
    expect(salida.eventos[1]).toEqual({
      tipo: "PAYMENT.CAPTURE.DENIED",
      token: REDACTED,
    })
  })

  it("no muta la entrada y devuelve copias de objetos y arrays", () => {
    const entrada = {
      email: "pagador@example.com",
      anidado: { token: "tok-1" },
      lista: ["pagador@example.com", "ok"],
    }
    const antes = JSON.parse(JSON.stringify(entrada)) as typeof entrada

    const salida = redactSensitiveData(entrada)

    expect(entrada).toEqual(antes)
    expect(salida).not.toBe(entrada)
    expect(salida.anidado).not.toBe(entrada.anidado)
    expect(salida.lista).not.toBe(entrada.lista)
    expect(salida.email).toBe(REDACTED)
    expect(salida.anidado.token).toBe(REDACTED)
  })

  it("soporta ciclos sin colgarse y preserva la estructura", () => {
    interface Ciclico {
      nombre: string
      self?: Ciclico
      lista?: unknown[]
    }

    const entrada: Ciclico = { nombre: "Ana" }
    entrada.self = entrada
    entrada.lista = [entrada, "pagador@example.com"]

    const salida = redactSensitiveData(entrada)

    expect(salida.nombre).toBe(REDACTED)
    expect(salida.self).toBe(salida)
    expect(salida.lista?.[0]).toBe(salida)
    expect(salida.lista?.[1]).toBe(REDACTED)
  })

  it("tolera valores raros: null, undefined, BigInt, Date, Map y Set", () => {
    const fecha = new Date("2026-10-20T12:00:00Z")
    const mapa = new Map<string, string>([
      ["email", "pagador@example.com"],
      ["estado", "OK"],
    ])
    const set = new Set(["pagador@example.com", "OK"])

    const salida = redactSensitiveData({
      nulo: null,
      indefinido: undefined,
      numero: 42,
      grande: BigInt(10),
      booleano: true,
      fecha,
      mapa,
      set,
    })

    expect(salida.nulo).toBeNull()
    expect(salida.indefinido).toBeUndefined()
    expect(salida.numero).toBe(42)
    expect(salida.grande).toBe(BigInt(10))
    expect(salida.booleano).toBe(true)
    expect(salida.fecha).not.toBe(fecha)
    expect(salida.fecha.getTime()).toBe(fecha.getTime())
    expect(salida.mapa).not.toBe(mapa)
    expect(salida.mapa.get("email")).toBe(REDACTED)
    expect(salida.mapa.get("estado")).toBe("OK")
    expect(salida.set.has(REDACTED)).toBe(true)
    expect(salida.set.has("OK")).toBe(true)
  })

  it("redacta emails y tokens dentro de mensajes de Error", () => {
    const error = new Error("Fallo para pagador@example.com con token=tok-123456")
    const salida = redactSensitiveData({ error })
    const redactado = salida.error as unknown as { name: string; message: string }

    expect(redactado.name).toBe("Error")
    expect(redactado.message).not.toContain("pagador@example.com")
    expect(redactado.message).not.toContain("tok-123456")
    expect(redactado.message).toContain(REDACTED)
  })

  it("preserva claves parecidas no sensibles", () => {
    const entrada = {
      username: "ana",
      brand_name: "PixelArch",
      status: "SUCCEEDED",
      id: "pay_1",
      monto: 10656,
    }

    const salida = redactSensitiveData(entrada)

    expect(salida).toEqual(entrada)
    expect(esClaveSensible("username")).toBe(false)
    expect(esClaveSensible("brand_name")).toBe(false)
    expect(esClaveSensible("email_address")).toBe(true)
    expect(esClaveSensible("PayerID")).toBe(true)
    expect(esClaveSensible("payer_id")).toBe(true)
    expect(esClaveSensible("apiKey")).toBe(true)
    expect(esClaveSensible("x-api-key")).toBe(true)
    expect(esClaveSensible("cookie")).toBe(true)
    expect(esClaveSensible("set-cookie")).toBe(true)
    expect(esClaveSensible("phone")).toBe(true)
    expect(esClaveSensible("telefono")).toBe(true)
    expect(esClaveSensible("secret")).toBe(true)
    expect(esClaveSensible("password")).toBe(true)
  })

  it("redacta por sensibilidad de clave dentro de un Map", () => {
    const mapa = new Map<string, string>([
      ["name", "Ana"],
      ["email", "pagador@example.com"],
      ["estado", "OK"],
    ])

    const salida = redactSensitiveData({ mapa })

    expect(salida.mapa.get("name")).toBe(REDACTED)
    expect(salida.mapa.get("email")).toBe(REDACTED)
    expect(salida.mapa.get("estado")).toBe("OK")
  })

  it("serializa URL, URLSearchParams y Headers redactados", () => {
    const url = new URL(
      "https://pixelarch.dev/pago/paypal/EnLaCe123?token=abc123&monto=10656"
    )
    const params = new URLSearchParams({
      token: "tok-123456",
      email: "pagador@example.com",
      monto: "10656",
    })
    const headers = new Headers({
      Authorization: "Bearer token-secreto-123",
      "X-Request-Id": "req-1",
    })

    const salida = redactSensitiveData({ url, params, headers })

    expect(typeof salida.url).toBe("string")
    expect(String(salida.url)).not.toContain("EnLaCe123")
    expect(String(salida.url)).not.toContain("abc123")
    expect(String(salida.url)).toContain("monto=10656")

    expect(typeof salida.params).toBe("string")
    expect(String(salida.params)).not.toContain("tok-123456")
    expect(String(salida.params)).not.toContain("pagador")
    expect(String(salida.params)).toContain("monto=10656")

    expect(salida.headers).toEqual({
      authorization: REDACTED,
      "x-request-id": "req-1",
    })
  })
})

describe("redactSensitiveString (AC-19)", () => {
  it("redacta credenciales, parametros sensibles y el token del link", () => {
    const url =
      "https://pixelarch.dev/pago/paypal/EnLaCe123?token=abc123&email=pagador%40example.com&enlace=xyz&monto=10656"

    const salida = redactSensitiveString(url)

    expect(salida).not.toContain("EnLaCe123")
    expect(salida).not.toContain("abc123")
    expect(salida).not.toContain("pagador")
    expect(salida).not.toContain("xyz")
    expect(salida).toContain("monto=10656")
    expect(salida).toContain(REDACTED)
  })

  it("preserva las rutas fijas del flujo de pago sin token", () => {
    const salida = redactSensitiveString(
      "https://pixelarch.dev/pago/paypal/retorno?enlace=token-opaco-123"
    )

    expect(salida).toContain("/pago/paypal/retorno")
    expect(salida).not.toContain("token-opaco-123")
    expect(redactSensitiveString("https://pixelarch.dev/pago/paypal/cancelado")).toBe(
      "https://pixelarch.dev/pago/paypal/cancelado"
    )
    expect(redactSensitiveString("https://pixelarch.dev/pago/paypal/estado")).toBe(
      "https://pixelarch.dev/pago/paypal/estado"
    )

    const estadoConToken = redactSensitiveString(
      "https://pixelarch.dev/pago/paypal/estado?token=token-opaco-123"
    )
    expect(estadoConToken).toContain("/pago/paypal/estado")
    expect(estadoConToken).not.toContain("token-opaco-123")
  })

  it("redacta Bearer/Basic sin borrar la etiqueta", () => {
    const salida = redactSensitiveString(
      "Authorization: Bearer token-super-secreto-123 / Basic dXNlcjpwYXNzd29yZA=="
    )

    expect(salida).not.toContain("token-super-secreto-123")
    expect(salida).not.toContain("dXNlcjpwYXNzd29yZA==")
    expect(salida).toContain("Authorization")
    expect(salida).toContain(REDACTED)
  })

  it("redacta emails en texto libre y conserva el resto del mensaje", () => {
    const salida = redactSensitiveString("Pago de US$106,56 confirmado para pagador@example.com")

    expect(salida).not.toContain("pagador@example.com")
    expect(salida).toContain("US$106,56")
    expect(salida).toContain("confirmado")
  })

  it("redacta el valor completo de asignaciones sin comillas (nombre, name y address)", () => {
    const salida = redactSensitiveString(
      "pago ok nombre=Ana Perez; name=John Smith; address=Avenida Siempreviva 742; estado=OK"
    )

    expect(salida).not.toContain("Perez")
    expect(salida).not.toContain("Smith")
    expect(salida).not.toContain("Siempreviva")
    expect(salida).toContain("estado=OK")
    expect(salida.match(/\[REDACTED\]/g)).toHaveLength(3)
  })

  it("corta la asignacion en ), ], } y fin de linea sin perder el cierre", () => {
    const parentesis = redactSensitiveString("error (name=Ana Perez) fin")
    expect(parentesis).not.toContain("Perez")
    expect(parentesis).toContain("(name=[REDACTED])")

    const corchete = redactSensitiveString(
      "contexto [address=Avenida Siempreviva 742] fin"
    )
    expect(corchete).not.toContain("Siempreviva")
    expect(corchete).toContain("[address=[REDACTED]]")

    const llave = redactSensitiveString("{telefono=+54 11 5555 5555}")
    expect(llave).not.toContain("5555")
    expect(llave).toContain("{telefono=[REDACTED]}")

    const finDeLinea = redactSensitiveString("nombre=Ana Perez\nestado=OK")
    expect(finDeLinea).not.toContain("Perez")
    expect(finDeLinea).toContain("estado=OK")
  })

  it("redacta claves sensibles de header y telefono en texto libre", () => {
    const salida = redactSensitiveString(
      "cookie=session-abc; set-cookie=session-def; x-api-key=api-key-123; phone=+54 11 5555 5555; telefono=+54 11 4444 4444"
    )

    for (const valor of ["session-abc", "session-def", "api-key-123", "5555", "4444"]) {
      expect(salida).not.toContain(valor)
    }
    expect(salida).toContain(REDACTED)
  })

  it("redacta claves sensibles dentro de un JSON serializado", () => {
    const json = JSON.stringify({
      email: "pagador@example.com",
      token: "tok-123456",
      id: "pay_1",
      monto: 10656,
    })

    const salida = redactSensitiveString(json)

    expect(salida).not.toContain("pagador@example.com")
    expect(salida).not.toContain("tok-123456")
    expect(salida).toContain("pay_1")
    expect(salida).toContain("10656")
  })

  it("redacta valores anidados dentro de un JSON serializado", () => {
    const json = JSON.stringify({
      name: { first: "Ana", last: "Perez" },
      payer: { payer_id: "PAYER-1", email_address: "pagador@example.com" },
      id: "pay_1",
      monto: 10656,
    })

    const salida = redactSensitiveString(json)

    expect(salida).not.toContain("Ana")
    expect(salida).not.toContain("Perez")
    expect(salida).not.toContain("PAYER-1")
    expect(salida).not.toContain("pagador@example.com")
    expect(salida).toContain("pay_1")
    expect(salida).toContain("10656")
  })

  it("no altera texto sin datos sensibles", () => {
    const texto = "Pago SUCCEEDED de 10656 USD con estado OK"

    expect(redactSensitiveString(texto)).toBe(texto)
  })
})

// T-31 (AC-19, AC-28): un payload de webhook PayPal trae el pagador completo
// (email, nombre, payer_id, direccion). Nada de eso debe sobrevivir en logs ni
// Sentry; los identificadores y montos si se conservan.
describe("payloads de webhook PayPal (AC-19, AC-28)", () => {
  it("redacta email, nombre, payer_id y direccion sin perder ids, monto ni estado", () => {
    const evento = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAPTURE-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "106.56" },
        custom_id: "enlace_abc",
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        payer: {
          email_address: "pagador@example.com",
          payer_id: "PAYER-1",
          name: { given_name: "Ana", surname: "Perez" },
          address: { address_line_1: "Calle 123", admin_area_1: "CABA" },
        },
        shipping: {
          address: { address_line_1: "Calle 123", postal_code: "1000" },
        },
      },
    }

    const salida = redactSensitiveData(evento)
    const resource = salida.resource

    expect(salida.id).toBe("WH-1")
    expect(salida.event_type).toBe("PAYMENT.CAPTURE.COMPLETED")
    expect(resource.id).toBe("CAPTURE-1")
    expect(resource.status).toBe("COMPLETED")
    expect(resource.amount).toEqual({ currency_code: "USD", value: "106.56" })
    expect(resource.custom_id).toBe("enlace_abc")
    expect(resource.supplementary_data.related_ids.order_id).toBe("ORDER-1")

    // Cada dato del pagador se redacta aunque el objeto se conserve.
    expect(resource.payer).toEqual({
      email_address: REDACTED,
      payer_id: REDACTED,
      name: REDACTED,
      address: REDACTED,
    })
    expect(resource.shipping).toEqual({ address: REDACTED })

    const serializado = JSON.stringify(salida)
    for (const dato of [
      "pagador@example.com",
      "Ana",
      "Perez",
      "PAYER-1",
      "Calle 123",
      "CABA",
      "1000",
    ]) {
      expect(serializado).not.toContain(dato)
    }
  })

  it("redactSentryEvent limpia un evento de error con el pagador en extras y contextos", () => {
    const evento = {
      extra: {
        pagoId: "pago_1",
        monto: 10656,
        moneda: "usd",
        pagador: { email: "pagador@example.com", nombre: "Ana Perez" },
      },
      contexts: {
        paypal: {
          email_address: "pagador@example.com",
          payer_id: "PAYER-1",
          estado: "SUCCEEDED",
        },
      },
      user: { id: "user_1", email: "pagador@example.com", name: "Ana Perez" },
      tags: { pagadorEmail: "pagador@example.com", pasarela: "PAYPAL" },
      level: "error",
    }

    const salida = redactSentryEvent(evento)
    const extra = salida.extra as Record<string, unknown>
    const pagador = extra.pagador as Record<string, unknown>
    const contexts = salida.contexts as Record<string, Record<string, unknown>>
    const user = salida.user as Record<string, unknown>
    const tags = salida.tags as Record<string, unknown>

    expect(extra.pagoId).toBe("pago_1")
    expect(extra.monto).toBe(10656)
    expect(extra.moneda).toBe("usd")
    expect(pagador.email).toBe(REDACTED)
    expect(pagador.nombre).toBe(REDACTED)

    expect(contexts.paypal.email_address).toBe(REDACTED)
    expect(contexts.paypal.payer_id).toBe(REDACTED)
    expect(contexts.paypal.estado).toBe("SUCCEEDED")

    expect(user.id).toBe("user_1")
    expect(user.email).toBe(REDACTED)
    expect(user.name).toBe(REDACTED)

    expect(tags.pagadorEmail).toBe(REDACTED)
    expect(tags.pasarela).toBe("PAYPAL")

    const serializado = JSON.stringify(salida)
    expect(serializado).not.toContain("pagador@example.com")
    expect(serializado).not.toContain("Ana Perez")
    expect(serializado).not.toContain("Perez")
    expect(serializado).not.toContain("PAYER-1")
  })
})
