import { describe, expect, it } from "vitest"
import {
  evaluarDedupe,
  type ExistenteDedupe,
} from "@/lib/propuestas/dedupe"

/**
 * T-05 (AC-14; RF-14, RF-22): dedupe por placeId, email exacto y dominio de
 * negocio. Los duplicados exactos se reutilizan; la misma empresa en otra
 * ficha/sucursal se marca como posible duplicado y nunca se fusiona sola.
 */

const EXISTENTES: ExistenteDedupe[] = [
  {
    id: "p1",
    placeId: "ChIJ-place-1",
    email: "info@consultora-uno.com",
    dominioNormalizado: "consultora-uno.com",
  },
  {
    id: "p2",
    placeId: "ChIJ-place-2",
    email: "info@consultora-dos.com",
    dominioNormalizado: "consultora-dos.com",
  },
]

describe("T-05: dedupe por placeId (AC-14)", () => {
  it("reutiliza el prospecto con el mismo placeId aunque cambien otros datos", () => {
    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-place-1",
          email: "otro@otro.com",
          dominioNormalizado: "otro.com",
        },
        EXISTENTES,
      ),
    ).toEqual({
      tipo: "REUTILIZAR",
      prospectoId: "p1",
      motivo: "PLACE_ID",
    })
  })

  it("tolera espacios en el placeId y no lo casea", () => {
    expect(
      evaluarDedupe({ placeId: "  ChIJ-place-1  " }, EXISTENTES),
    ).toEqual({ tipo: "REUTILIZAR", prospectoId: "p1", motivo: "PLACE_ID" })

    expect(
      evaluarDedupe({ placeId: "chij-place-1" }, EXISTENTES).tipo,
    ).toBe("NUEVO")
  })
})

describe("T-05: dedupe por email exacto (AC-14)", () => {
  it("reutiliza por email normalizado (case-insensitive)", () => {
    expect(
      evaluarDedupe({ email: "INFO@Consultora-Dos.com" }, EXISTENTES),
    ).toEqual({ tipo: "REUTILIZAR", prospectoId: "p2", motivo: "EMAIL" })
  })

  it("el email gana antes que el dominio", () => {
    expect(
      evaluarDedupe(
        {
          email: "info@consultora-uno.com",
          dominioNormalizado: "consultora-dos.com",
        },
        EXISTENTES,
      ),
    ).toEqual({ tipo: "REUTILIZAR", prospectoId: "p1", motivo: "EMAIL" })
  })

  it("un email invalido no deduplica", () => {
    expect(
      evaluarDedupe(
        { email: "info@consultora-uno", dominioNormalizado: "otro.com" },
        EXISTENTES,
      ).tipo,
    ).toBe("NUEVO")
  })
})

describe("T-05: dedupe por dominio de negocio (AC-14)", () => {
  it("marca posible duplicado cuando el dominio coincide y el placeId difiere", () => {
    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-sucursal",
          email: "sucursal@consultora-uno.com",
          dominioNormalizado: "www.consultora-uno.com",
        },
        EXISTENTES,
      ),
    ).toEqual({
      tipo: "POSIBLE_DUPLICADO",
      prospectoId: "p1",
      motivo: "DOMINIO",
    })
  })

  it("compara el dominio registrable aunque el candidato traiga una URL o subdominio", () => {
    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-otra-ficha",
          dominioNormalizado: "https://mail.consultora-dos.com/contacto",
        },
        EXISTENTES,
      ),
    ).toEqual({
      tipo: "POSIBLE_DUPLICADO",
      prospectoId: "p2",
      motivo: "DOMINIO",
    })
  })

  it("no marca posible duplicado si el placeId es el mismo", () => {
    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-place-2",
          dominioNormalizado: "mail.consultora-dos.com",
        },
        EXISTENTES,
      ),
    ).toEqual({ tipo: "REUTILIZAR", prospectoId: "p2", motivo: "PLACE_ID" })
  })

  it("es determinista: con varios dominios iguales devuelve el primero", () => {
    const dos: ExistenteDedupe[] = [
      { id: "a", placeId: "1", dominioNormalizado: "misma-empresa.com" },
      { id: "b", placeId: "2", dominioNormalizado: "www.misma-empresa.com" },
    ]

    expect(
      evaluarDedupe(
        { placeId: "3", dominioNormalizado: "misma-empresa.com" },
        dos,
      ),
    ).toEqual({
      tipo: "POSIBLE_DUPLICADO",
      prospectoId: "a",
      motivo: "DOMINIO",
    })
  })

  it("nunca deduplica por un proveedor publico", () => {
    const gmail: ExistenteDedupe[] = [
      {
        id: "g1",
        placeId: "ChIJ-g1",
        email: "otra@gmail.com",
        dominioNormalizado: "gmail.com",
      },
    ]

    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-g2",
          email: "nueva@gmail.com",
          dominioNormalizado: "gmail.com",
        },
        gmail,
      ),
    ).toEqual({ tipo: "NUEVO" })
  })

  it("un email exacto de Gmail sigue siendo una senal valida", () => {
    const gmail: ExistenteDedupe[] = [
      {
        id: "g1",
        email: "misma@gmail.com",
        dominioNormalizado: "gmail.com",
      },
    ]

    expect(evaluarDedupe({ email: "Misma@Gmail.com" }, gmail)).toEqual({
      tipo: "REUTILIZAR",
      prospectoId: "g1",
      motivo: "EMAIL",
    })
  })

  it("ignora sufijos publicos y dominios invalidos", () => {
    const invalidos: ExistenteDedupe[] = [
      { id: "x1", dominioNormalizado: "com.ar" },
      { id: "x2", dominioNormalizado: "co.uk" },
    ]

    expect(
      evaluarDedupe(
        { placeId: "nuevo", dominioNormalizado: "com.ar" },
        invalidos,
      ),
    ).toEqual({ tipo: "NUEVO" })
  })
})

describe("T-05: sin fusion automatica (AC-14)", () => {
  it("devuelve NUEVO cuando no hay ninguna senal", () => {
    expect(
      evaluarDedupe(
        {
          placeId: "ChIJ-nuevo",
          email: "info@nueva-empresa.com",
          dominioNormalizado: "nueva-empresa.com",
        },
        EXISTENTES,
      ),
    ).toEqual({ tipo: "NUEVO" })

    expect(evaluarDedupe({}, [])).toEqual({ tipo: "NUEVO" })
  })

  it("no muta la lista de existentes y no devuelve datos fusionados", () => {
    const existentes: ExistenteDedupe[] = [
      {
        id: "p1",
        placeId: "ChIJ-place-1",
        email: "info@consultora-uno.com",
        dominioNormalizado: "consultora-uno.com",
      },
    ]
    const copia = JSON.parse(JSON.stringify(existentes))

    const resultado = evaluarDedupe(
      {
        placeId: "ChIJ-sucursal",
        email: "sucursal@consultora-uno.com",
        dominioNormalizado: "consultora-uno.com",
      },
      existentes,
    )

    expect(resultado).toEqual({
      tipo: "POSIBLE_DUPLICADO",
      prospectoId: "p1",
      motivo: "DOMINIO",
    })
    expect(resultado).not.toHaveProperty("fusionar")
    expect(existentes).toEqual(copia)
  })
})
