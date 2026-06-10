import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}))

import { GET } from "@/app/api/health/route"

describe("GET /api/health", () => {
  it("returns 200 status", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
  })

  it("returns JSON with status ok", async () => {
    const response = await GET()
    const body = await response.json()
    expect(body).toHaveProperty("status", "ok")
  })

  it("returns JSON with timestamp", async () => {
    const response = await GET()
    const body = await response.json()
    expect(body).toHaveProperty("timestamp")
    expect(typeof body.timestamp).toBe("string")
  })

  it("returns JSON with uptime", async () => {
    const response = await GET()
    const body = await response.json()
    expect(body).toHaveProperty("uptime")
    expect(typeof body.uptime).toBe("number")
  })

  it("returns db status", async () => {
    const response = await GET()
    const body = await response.json()
    expect(body).toHaveProperty("db")
  })
})
