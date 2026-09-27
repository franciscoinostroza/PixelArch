import { describe, expect, it } from "vitest"
import { decidirAlertas, type CheckUptime } from "@/lib/uptime-alerts"

const c = (servicio: string, ok: boolean, statusCode: number | null = ok ? 200 : null): CheckUptime => ({
  servicio,
  ok,
  statusCode,
  latenciaMs: 100,
})

describe("decidirAlertas", () => {
  it("no alerta con un solo fallo", () => {
    expect(decidirAlertas([[c("API", false)]])).toEqual([])
  })

  it("alerta caida con dos fallos seguidos", () => {
    const r = decidirAlertas([[c("API", false, 502), c("API", false)]])
    expect(r).toEqual([{ tipo: "caida", servicio: "API", statusCode: 502, latenciaMs: 100 }])
  })

  it("alerta caida cuando los dos primeros chequeos fallan", () => {
    const r = decidirAlertas([[c("API", false), c("API", false)]])
    expect(r).toEqual([{ tipo: "caida", servicio: "API", statusCode: null, latenciaMs: 100 }])
  })

  it("no repite la alerta mientras sigue caido", () => {
    expect(decidirAlertas([[c("API", false), c("API", false), c("API", false)]])).toEqual([])
  })

  it("alerta recuperacion al volver tras dos fallos", () => {
    const r = decidirAlertas([[c("API", true), c("API", false), c("API", false)]])
    expect(r).toEqual([{ tipo: "recuperacion", servicio: "API" }])
  })

  it("no alerta recuperacion si el fallo fue aislado", () => {
    expect(decidirAlertas([[c("API", true), c("API", false), c("API", true)]])).toEqual([])
  })

  it("historial vacio no alerta", () => {
    expect(decidirAlertas([[]])).toEqual([])
  })

  it("todo ok no alerta", () => {
    expect(decidirAlertas([[c("API", true), c("API", true), c("API", true)]])).toEqual([])
  })

  it("procesa varios servicios a la vez", () => {
    const r = decidirAlertas([
      [c("Sitio web", false), c("Sitio web", false)],
      [c("API", true), c("API", true)],
      [c("Blog", true), c("Blog", false), c("Blog", false)],
    ])
    expect(r).toEqual([
      { tipo: "caida", servicio: "Sitio web", statusCode: null, latenciaMs: 100 },
      { tipo: "recuperacion", servicio: "Blog" },
    ])
  })
})
