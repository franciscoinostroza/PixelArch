import { describe, expect, it } from "vitest"
import {
  WEBHOOK_CUERPO_MAX_BYTES,
  WEBHOOK_FALLOS_MAX,
  WEBHOOK_FALLOS_VENTANA_MS,
  WEBHOOK_SOLICITUDES_MAX,
  WEBHOOK_SOLICITUDES_VENTANA_MS,
  cuerpoExcedeLimite,
  crearLimitadorWebhook,
} from "@/lib/paypal/webhook-limit"

describe("crearLimitadorWebhook - solicitudes", () => {
  it("permite 300 solicitudes y bloquea la 301 con Retry-After", () => {
    const ahora = 1_000
    const limitador = crearLimitadorWebhook({ ahora: () => ahora })

    for (let i = 0; i < WEBHOOK_SOLICITUDES_MAX; i++) {
      expect(limitador.permitir("ip:a").permitido, String(i)).toBe(true)
    }

    const bloqueada = limitador.permitir("ip:a")
    expect(bloqueada).toEqual({
      permitido: false,
      motivo: "SOLICITUDES",
      retryAfterSegundos: Math.ceil(WEBHOOK_SOLICITUDES_VENTANA_MS / 1000),
    })
  })

  it("reinicia la ventana de solicitudes", () => {
    let ahora = 0
    const limitador = crearLimitadorWebhook({
      ahora: () => ahora,
      solicitudesMax: 2,
      solicitudesVentanaMs: 1_000,
    })

    expect(limitador.permitir("ip:b").permitido).toBe(true)
    expect(limitador.permitir("ip:b").permitido).toBe(true)
    expect(limitador.permitir("ip:b").permitido).toBe(false)

    ahora = 1_001
    expect(limitador.permitir("ip:b").permitido).toBe(true)
  })

  it("calcula los segundos restantes de la ventana", () => {
    let ahora = 0
    const limitador = crearLimitadorWebhook({
      ahora: () => ahora,
      solicitudesMax: 1,
      solicitudesVentanaMs: 10_000,
    })

    expect(limitador.permitir("ip:c").permitido).toBe(true)
    ahora = 4_000
    const bloqueada = limitador.permitir("ip:c")
    expect(bloqueada).toEqual({
      permitido: false,
      motivo: "SOLICITUDES",
      retryAfterSegundos: 6,
    })
  })

  it("una IP no consume el presupuesto de otra", () => {
    const limitador = crearLimitadorWebhook({ solicitudesMax: 1 })

    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:a").permitido).toBe(false)
    expect(limitador.permitir("ip:b").permitido).toBe(true)
  })
})

describe("crearLimitadorWebhook - fallos de verificacion", () => {
  it("bloquea con FALLOS al alcanzar 20 y deja de verificar", () => {
    const ahora = 0
    const limitador = crearLimitadorWebhook({ ahora: () => ahora })

    for (let i = 0; i < WEBHOOK_FALLOS_MAX; i++) {
      limitador.registrarFallo("ip:a")
    }

    expect(limitador.permitir("ip:a")).toEqual({
      permitido: false,
      motivo: "FALLOS",
      retryAfterSegundos: Math.ceil(WEBHOOK_FALLOS_VENTANA_MS / 1000),
    })
  })

  it("un exito limpia los fallos pero no las solicitudes", () => {
    const ahora = 0
    const limitador = crearLimitadorWebhook({
      ahora: () => ahora,
      solicitudesMax: 3,
    })

    limitador.registrarFallo("ip:a")
    limitador.registrarFallo("ip:a")
    limitador.registrarExito("ip:a")

    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:a").permitido).toBe(false)
  })

  it("reinicia la ventana de fallos", () => {
    let ahora = 0
    const limitador = crearLimitadorWebhook({
      ahora: () => ahora,
      fallosMax: 1,
      fallosVentanaMs: 1_000,
    })

    limitador.registrarFallo("ip:a")
    expect(limitador.permitir("ip:a").permitido).toBe(false)

    ahora = 1_001
    expect(limitador.permitir("ip:a").permitido).toBe(true)
  })

  it("acota el mapa de claves y desaloja la entrada mas antigua", () => {
    const ahora = 0
    const limitador = crearLimitadorWebhook({
      ahora: () => ahora,
      solicitudesMax: 1,
      maxClaves: 2,
    })

    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:b").permitido).toBe(true)
    expect(limitador.permitir("ip:c").permitido).toBe(true)

    // `ip:a` fue desalojada: vuelve a entrar con una ventana nueva.
    expect(limitador.permitir("ip:a").permitido).toBe(true)
    expect(limitador.permitir("ip:a").permitido).toBe(false)
  })
})

describe("cuerpoExcedeLimite", () => {
  it("acepta el maximo exacto y rechaza un byte mas", () => {
    expect(cuerpoExcedeLimite(String(WEBHOOK_CUERPO_MAX_BYTES), null)).toBe(false)
    expect(cuerpoExcedeLimite(String(WEBHOOK_CUERPO_MAX_BYTES + 1), null)).toBe(
      true
    )
  })

  it("ignora un Content-Length invalido o ausente", () => {
    expect(cuerpoExcedeLimite(null, null)).toBe(false)
    expect(cuerpoExcedeLimite("abc", null)).toBe(false)
    expect(cuerpoExcedeLimite("-1", null)).toBe(false)
    expect(cuerpoExcedeLimite("1.5", null)).toBe(false)
  })

  it("mide el cuerpo en bytes UTF-8, no en caracteres", () => {
    const cuerpo = "á".repeat(WEBHOOK_CUERPO_MAX_BYTES / 2)
    expect(Buffer.byteLength(cuerpo, "utf8")).toBe(WEBHOOK_CUERPO_MAX_BYTES)
    expect(cuerpoExcedeLimite(null, cuerpo)).toBe(false)

    const excedido = `${cuerpo}a`
    expect(cuerpoExcedeLimite(null, excedido)).toBe(true)
  })
})
