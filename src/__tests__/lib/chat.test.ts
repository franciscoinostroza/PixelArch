import { describe, expect, it } from "vitest"
import { matchIntent, CHAT_ANSWERS } from "@/lib/chat"

describe("matchIntent", () => {
  it("detecta precios", () => {
    expect(matchIntent("Cuánto cuesta el plan básico?").intent).toBe("precios")
    expect(matchIntent("Me pasás los precios?").intent).toBe("precios")
  })

  it("detecta tiempos de entrega", () => {
    expect(matchIntent("Cuánto tarda una landing?").intent).toBe("tiempos")
    expect(matchIntent("En cuánto tiempo entregan?").intent).toBe("tiempos")
  })

  it("detecta cancelación", () => {
    expect(matchIntent("Cómo cancelo mi suscripción?").intent).toBe("cancelar")
  })

  it("detecta moneda", () => {
    expect(matchIntent("En qué moneda me cobran?").intent).toBe("moneda")
    expect(matchIntent("Aceptan dólares?").intent).toBe("moneda")
  })

  it("detecta hosting/soporte", () => {
    expect(matchIntent("Qué incluye el hosting?").intent).toBe("hosting")
  })

  it("deriva a humano cuando no hay match", () => {
    expect(matchIntent("me interesa un proyecto raro").intent).toBe("humano")
    expect(matchIntent("").intent).toBe("humano")
  })

  it("da respuestas con whatsapp link para humano", () => {
    const r = matchIntent("quiero hablar con una persona")
    expect(r.intent).toBe("humano")
    expect(CHAT_ANSWERS.humano.whatsapp).toBe(true)
    expect(CHAT_ANSWERS.precios.whatsapp).toBeUndefined()
  })
})