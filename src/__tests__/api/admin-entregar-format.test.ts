import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-04b (AC-18): el email de entrega recibe los precios del servicio en
 * centavos y los formatea en es-AR. Detecta un /100 o *100 de mas.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rateLimit: vi.fn(() => true),
  update: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }))
vi.mock("@/lib/prisma", () => ({
  prisma: { suscripcion: { update: mocks.update } },
}))
vi.mock("@/lib/resend", () => ({
  resend: () => ({ emails: { send: mocks.send } }),
}))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "@/app/api/admin/entregar/route"

describe("POST /api/admin/entregar: precios USD en centavos (T-04b, AC-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimit.mockReturnValue(true)
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1", nombre: "Admin" })
    mocks.update.mockResolvedValue({
      id: "suscripcion_1",
      cliente: { email: "cliente@example.com", nombre: "ACME" },
      servicio: {
        nombre: "Landing",
        precioBasico: 2500,
        precioMantenimiento: 20000,
      },
    })
    mocks.send.mockResolvedValue({ data: { id: "email_1" } })
  })

  it("formatea basico y premium sin corrimientos de centavos", async () => {
    const req = new Request("https://pixelarch.dev/api/admin/entregar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suscripcionId: "suscripcion_1" }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    const payload = mocks.send.mock.calls[0][0] as { text: string }
    expect(payload.text).toContain("Soporte basico: US$25,00/mes")
    expect(payload.text).toContain("Soporte premium: US$200,00/mes")
  })
})
