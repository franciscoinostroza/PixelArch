import { describe, it, expect } from "vitest"
import { rateLimit } from "@/lib/rate-limit"

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
