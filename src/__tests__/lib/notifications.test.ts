import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T-04b (AC-18, RNF-14): los recibos por email usan `formatearMonto` con el
 * default es-AR y reciben centavos, no dolares/pesos.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock("@/lib/resend", () => ({
  resend: () => ({ emails: { send: mocks.send } }),
}))

import { sendPaymentReceipt } from "@/lib/notifications"

describe("sendPaymentReceipt: formato de montos (T-04b, AC-18, RNF-14)", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-key")
    mocks.send.mockReset()
    mocks.send.mockResolvedValue({ data: { id: "email_1" } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("muestra USD en es-AR con miles y centavos", async () => {
    await sendPaymentReceipt("cliente@example.com", "ACME", 100050, "usd", "Landing")

    expect(mocks.send).toHaveBeenCalledTimes(1)
    const payload = mocks.send.mock.calls[0][0] as { text: string }
    expect(payload.text).toContain("US$1.000,50")
    expect(payload.text).not.toContain("US$1,000.50")
    expect(payload.text).not.toContain("$1000.50")
  })

  it("mantiene ARS separado y con su formato", async () => {
    await sendPaymentReceipt("cliente@example.com", "ACME", 3850000, "ars", "Soporte")

    const payload = mocks.send.mock.calls[0][0] as { text: string }
    expect(payload.text).toContain("$38.500 ARS")
    expect(payload.text).not.toContain("US$")
  })
})
