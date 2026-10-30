import { describe, it, expect } from "vitest"
import {
  rateLimit,
  rateLimitDetalle,
  rateLimitEstado,
  resetRateLimit,
} from "@/lib/rate-limit"

describe("rateLimit", () => {
  it("allows first request", () => {
    expect(rateLimit("rl:1", 3, 60_000)).toBe(true)
  })

  it("allows requests within limit", () => {
    const key = "rl:2"
    expect(rateLimit(key, 2, 60_000)).toBe(true)
    expect(rateLimit(key, 2, 60_000)).toBe(true)
  })

  it("blocks requests exceeding limit", () => {
    const key = "rl:3"
    expect(rateLimit(key, 1, 60_000)).toBe(true)
    expect(rateLimit(key, 1, 60_000)).toBe(false)
  })
})

describe("rateLimitDetalle / rateLimitEstado", () => {
  it("devuelve los restantes y los segundos de espera", () => {
    const key = "rl:detalle:1"

    expect(rateLimitDetalle(key, 2, 60_000)).toMatchObject({
      permitido: true,
      restantes: 1,
      retryAfterSegundos: 0,
    })
    expect(rateLimitDetalle(key, 2, 60_000)).toMatchObject({
      permitido: true,
      restantes: 0,
    })
    expect(rateLimitDetalle(key, 2, 60_000)).toMatchObject({
      permitido: false,
      restantes: 0,
      retryAfterSegundos: 60,
    })
  })

  it("consulta el estado sin incrementar el contador", () => {
    const key = "rl:detalle:2"

    expect(rateLimitDetalle(key, 1, 60_000).permitido).toBe(true)
    expect(rateLimitEstado(key, 1, 60_000).excedido).toBe(true)
    expect(rateLimitEstado(key, 1, 60_000).excedido).toBe(true)
  })

  it("resetRateLimit borra la ventana", () => {
    const key = "rl:detalle:3"

    expect(rateLimit(key, 1, 60_000)).toBe(true)
    expect(rateLimit(key, 1, 60_000)).toBe(false)
    resetRateLimit(key)
    expect(rateLimit(key, 1, 60_000)).toBe(true)
  })
})
