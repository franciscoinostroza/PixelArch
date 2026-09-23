import { describe, expect, it } from "vitest"
import { normalizeUrl, isBlockedHost, computeScores, buildFindings, type AuditData } from "@/lib/audit"

describe("normalizeUrl", () => {
  it("agrega https si falta el protocolo", () => {
    expect(normalizeUrl("pixelarch.dev")).toBe("https://pixelarch.dev/")
    expect(normalizeUrl("www.ejemplo.com/ruta")).toBe("https://www.ejemplo.com/ruta")
  })

  it("respeta http y https explicitos", () => {
    expect(normalizeUrl("http://ejemplo.com")).toBe("http://ejemplo.com/")
    expect(normalizeUrl("https://ejemplo.com/pagina")).toBe("https://ejemplo.com/pagina")
  })

  it("rechaza entradas invalidas", () => {
    expect(normalizeUrl("")).toBeNull()
    expect(normalizeUrl("   ")).toBeNull()
    expect(normalizeUrl("ftp://ejemplo.com")).toBeNull()
    expect(normalizeUrl("sinpunto")).toBeNull()
  })
})

describe("isBlockedHost", () => {
  it("bloquea localhost y variantes", () => {
    expect(isBlockedHost("localhost")).toBe(true)
    expect(isBlockedHost("algo.local")).toBe(true)
    expect(isBlockedHost("casa.internal")).toBe(true)
  })

  it("bloquea IPs privadas", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true)
    expect(isBlockedHost("10.0.0.5")).toBe(true)
    expect(isBlockedHost("192.168.1.1")).toBe(true)
    expect(isBlockedHost("172.16.0.1")).toBe(true)
    expect(isBlockedHost("172.31.255.1")).toBe(true)
    expect(isBlockedHost("169.254.1.1")).toBe(true)
  })

  it("permite hosts publicos", () => {
    expect(isBlockedHost("pixelarch.dev")).toBe(false)
    expect(isBlockedHost("google.com")).toBe(false)
    expect(isBlockedHost("172.32.0.1")).toBe(false)
    expect(isBlockedHost("8.8.8.8")).toBe(false)
  })
})

const baseData: AuditData = {
  finalUrl: "https://ejemplo.com/",
  status: 200,
  redirects: false,
  ttfbMs: 300,
  totalMs: 700,
  htmlKb: 120,
  title: "Ejemplo — Mi sitio",
  metaDescription: "Una descripcion",
  hasViewport: true,
  h1Count: 1,
  lang: "es",
  imgCount: 10,
  imgNoAlt: 0,
  https: true,
  certDaysLeft: 80,
  headers: { hsts: true, csp: true, xfo: true, xcto: true, referrer: true },
}

describe("computeScores", () => {
  it("da puntaje maximo a un sitio perfecto", () => {
    const s = computeScores(baseData)
    expect(s.velocidad).toBe(100)
    expect(s.ssl).toBe(100)
    expect(s.seo).toBe(100)
    expect(s.seguridad).toBe(100)
  })

  it("penaliza sitio sin https ni headers", () => {
    const s = computeScores({
      ...baseData,
      https: false,
      certDaysLeft: null,
      headers: { hsts: false, csp: false, xfo: false, xcto: false, referrer: false },
    })
    expect(s.ssl).toBe(15)
    expect(s.seguridad).toBe(0)
  })

  it("penaliza sitios lentos y pesados", () => {
    const s = computeScores({ ...baseData, totalMs: 8000, htmlKb: 1200 })
    expect(s.velocidad).toBeLessThanOrEqual(25)
  })

  it("baja SSL si el certificado vence pronto", () => {
    const s = computeScores({ ...baseData, certDaysLeft: 3 })
    expect(s.ssl).toBeLessThanOrEqual(40)
  })

  it("puntua SEO parcial sin title ni description", () => {
    const s = computeScores({ ...baseData, title: null, metaDescription: null })
    expect(s.seo).toBe(45)
  })
})

describe("buildFindings", () => {
  it("genera hallazgos con tipos validos", () => {
    const f = buildFindings({ ...baseData, https: false, certDaysLeft: null })
    expect(f.length).toBeGreaterThan(0)
    for (const item of f) {
      expect(["ok", "warn", "fail"]).toContain(item.type)
      expect(item.text.length).toBeGreaterThan(0)
    }
    expect(f.some((x) => x.type === "fail" && x.text.includes("HTTPS"))).toBe(true)
  })

  it("limita la cantidad de hallazgos", () => {
    const f = buildFindings({
      ...baseData,
      title: null,
      metaDescription: null,
      hasViewport: false,
      h1Count: 0,
      imgNoAlt: 5,
      htmlKb: 2000,
      totalMs: 9000,
      https: false,
      certDaysLeft: null,
      headers: { hsts: false, csp: false, xfo: false, xcto: false, referrer: false },
    })
    expect(f.length).toBeLessThanOrEqual(14)
  })
})