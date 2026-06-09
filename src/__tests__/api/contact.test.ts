import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "@/app/api/contact/route"

vi.mock("@/lib/resend", () => ({
  resend: vi.fn(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "mock-id" } }),
    },
  })),
}))

const validBody = {
  nombre: "Juan Pérez",
  email: "juan@example.com",
  mensaje: "Hola, quiero contratar servicios de desarrollo web.",
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("accepts valid data and returns 200", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ok: true })
  })

  it("rejects invalid data with 400", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "", email: "bad", mensaje: "" }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty("error")
  })

  it("rejects empty body with 400", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("rejects missing fields with field errors", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    const body = await response.json()
    expect(body.error.fieldErrors).toHaveProperty("nombre")
    expect(body.error.fieldErrors).toHaveProperty("email")
    expect(body.error.fieldErrors).toHaveProperty("mensaje")
  })
})
