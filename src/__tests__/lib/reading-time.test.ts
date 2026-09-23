import { describe, expect, it } from "vitest"
import { portableTextToPlain, estimateReadingMinutes, readingTimeLabel } from "@/lib/reading-time"

const blocks = [
  {
    _type: "block",
    style: "normal",
    children: [{ _type: "span", text: "Uno dos tres cuatro cinco." }],
  },
  {
    _type: "block",
    style: "h2",
    children: [{ _type: "span", text: "Seis siete" }],
  },
  {
    _type: "block",
    style: "normal",
    listItem: "bullet",
    children: [{ _type: "span", text: "ocho nueve diez" }],
  },
]

describe("portableTextToPlain", () => {
  it("extrae y une el texto de los bloques", () => {
    expect(portableTextToPlain(blocks)).toBe("Uno dos tres cuatro cinco. Seis siete ocho nueve diez")
  })

  it("devuelve vacio para entradas invalidas", () => {
    expect(portableTextToPlain(null)).toBe("")
    expect(portableTextToPlain(undefined)).toBe("")
    expect(portableTextToPlain("texto")).toBe("")
    expect(portableTextToPlain([])).toBe("")
  })

  it("ignora bloques sin children o con hijos invalidos", () => {
    expect(portableTextToPlain([{ _type: "block" }, { _type: "block", children: [{ _type: "span" }] }])).toBe("")
  })
})

describe("estimateReadingMinutes", () => {
  it("calcula minutos con 200 palabras por minuto", () => {
    const words = Array.from({ length: 400 }, () => "palabra").join(" ")
    expect(estimateReadingMinutes(words)).toBe(2)
  })

  it("minimo 1 minuto", () => {
    expect(estimateReadingMinutes("pocas palabras")).toBe(1)
    expect(estimateReadingMinutes("")).toBe(1)
  })

  it("acepta bloques de portable text", () => {
    expect(estimateReadingMinutes(blocks)).toBe(1)
  })

  it("redondea al minuto mas cercano", () => {
    const words = Array.from({ length: 500 }, () => "palabra").join(" ")
    expect(estimateReadingMinutes(words)).toBe(3)
  })
})

describe("readingTimeLabel", () => {
  it("formatea la etiqueta", () => {
    expect(readingTimeLabel(8)).toBe("8 min de lectura")
  })
})