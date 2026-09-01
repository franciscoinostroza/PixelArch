import { describe, it, expect, vi, afterEach } from "vitest"
import { getDolarVentaBancoNacion, formatARS, formatUSD } from "@/lib/dolar"

const providers = [
  { slug: "banco-nacion", bid: 1485, ask: 1535 },
  { slug: "reba", bid: 1490, ask: 1525 },
]

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getDolarVentaBancoNacion", () => {
  it("returns the ask of banco-nacion", async () => {
    vi.stubGlobal("fetch", mockFetchOk(providers))
    const rate = await getDolarVentaBancoNacion()
    expect(rate).toBe(1535)
  })

  it("returns null when banco-nacion is missing", async () => {
    vi.stubGlobal("fetch", mockFetchOk([{ slug: "reba", bid: 1490, ask: 1525 }]))
    const rate = await getDolarVentaBancoNacion()
    expect(rate).toBeNull()
  })

  it("returns null when the API responds with error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const rate = await getDolarVentaBancoNacion()
    expect(rate).toBeNull()
  })

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const rate = await getDolarVentaBancoNacion()
    expect(rate).toBeNull()
  })
})

describe("formatARS", () => {
  it("rounds up to the nearest 500", () => {
    expect(formatARS(5100, 1535)).toBe("$78.500")
    expect(formatARS(5100, 1530)).toBe("$78.500")
    expect(formatARS(5100, 1540)).toBe("$79.000")
  })

  it("never rounds down", () => {
    const exact = (5100 / 100) * 1535
    const result = formatARS(5100, 1535).replace("$", "").replaceAll(".", "")
    expect(Number(result)).toBeGreaterThanOrEqual(exact)
  })

  it("formats with thousands separator", () => {
    expect(formatARS(3000, 1000)).toBe("$30.000")
  })
})

describe("formatUSD", () => {
  it("formats cents as USD", () => {
    expect(formatUSD(5100)).toBe("US$51")
    expect(formatUSD(0)).toBe("US$0")
  })
})
