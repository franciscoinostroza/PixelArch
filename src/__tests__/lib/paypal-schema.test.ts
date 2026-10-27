import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * T-03 (AC-1, AC-10, AC-11, AC-18, AC-24): el schema Prisma es aditivo y
 * contiene los enums, campos, modelos, relaciones, uniques e indices del
 * plan §4.1. No toca la base: solo valida el contrato de prisma/schema.prisma.
 */

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")

function bloque(tipo: "model" | "enum", nombre: string): string {
  const re = new RegExp(String.raw`^${tipo}\s+${nombre}\s*\{([\s\S]*?)^\}`, "m")
  const match = schema.match(re)
  if (!match) throw new Error(`No se encontro ${tipo} ${nombre} en prisma/schema.prisma`)
  return match[1]
}

function valoresEnum(nombre: string): string[] {
  return bloque("enum", nombre)
    .split("\n")
    .map((linea) => linea.trim().replace(/\s*\/\/.*$/, ""))
    .filter((linea) => linea.length > 0 && !linea.startsWith("//"))
}

function camposModelo(nombre: string): Map<string, string> {
  const campos = new Map<string, string>()
  for (const linea of bloque("model", nombre).split("\n")) {
    const texto = linea.trim()
    if (!texto || texto.startsWith("//") || texto.startsWith("@@")) continue
    const match = texto.match(/^(\w+)\s+(.+)$/)
    if (!match) continue
    campos.set(match[1], match[2].replace(/\s*\/\/.*$/, "").replace(/\s+/g, " ").trim())
  }
  return campos
}

function indicesModelo(nombre: string): string[] {
  return bloque("model", nombre)
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith("@@index("))
    .map((linea) => linea.replace(/\s+/g, ""))
}

describe("T-03: enums Prisma de PayPal", () => {
  it("declara Pasarela, OrigenPago, EstadoEnlace, EstadoRevision, TipoAjuste y DecisionAjuste con los valores del plan", () => {
    expect(valoresEnum("Pasarela")).toEqual(["MANUAL", "MERCADOPAGO", "PAYPAL"])
    expect(valoresEnum("OrigenPago")).toEqual(["AUTOMATICO", "MANUAL"])
    expect(valoresEnum("EstadoEnlace")).toEqual([
      "CREANDO",
      "ACTIVO",
      "PAGADO",
      "VENCIDO",
      "INVALIDADO",
      "FALLIDO",
    ])
    expect(valoresEnum("EstadoRevision")).toEqual(["PENDIENTE", "ACEPTADO", "RECHAZADO"])
    expect(valoresEnum("TipoAjuste")).toEqual(["REEMBOLSO", "CONTRACARGO"])
    expect(valoresEnum("DecisionAjuste")).toEqual([
      "NINGUNA",
      "REVERTIR_HITO",
      "DESCONTAR_MESES",
    ])
  })

  it("agrega PAYPAL a MetodoPago sin quitar los metodos existentes", () => {
    const metodos = valoresEnum("MetodoPago")

    expect(metodos).toContain("PAYPAL")
    expect(metodos).toEqual(
      expect.arrayContaining(["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO", "OTRO"]),
    )
  })

  it("agrega REVISION y CONTRACARGO a EstadoPago sin quitar los estados existentes", () => {
    const estados = valoresEnum("EstadoPago")

    expect(estados).toContain("REVISION")
    expect(estados).toContain("CONTRACARGO")
    expect(estados).toEqual(
      expect.arrayContaining(["SUCCEEDED", "FAILED", "REFUNDED", "PENDING"]),
    )
  })
})

describe("T-03: modelo Pago (AC-1, AC-10, AC-18, AC-24)", () => {
  const pago = camposModelo("Pago")

  it("agrega los campos del plan con sus tipos y defaults", () => {
    expect(pago.get("pasarela")).toBe("Pasarela @default(MANUAL)")
    expect(pago.get("origen")).toBe("OrigenPago @default(MANUAL)")
    expect(pago.get("enlacePagoId")).toBe("String?")
    expect(pago.get("montoAcordado")).toBe("Int?")
    expect(pago.get("comision")).toBe("Int @default(0)")
    expect(pago.get("montoEsperado")).toBe("Int?")
    expect(pago.get("meses")).toBe("Int?")
    expect(pago.get("feeBps")).toBe("Int?")
    expect(pago.get("feeFixedCents")).toBe("Int?")
    expect(pago.get("evidencia")).toBe("String?")
    expect(pago.get("reciboEmitidoEn")).toBe("DateTime?")
    expect(pago.get("revisionEstado")).toBe("EstadoRevision?")
    expect(pago.get("revisionNota")).toBe("String?")
    expect(pago.get("revisionResueltaPor")).toBe("String?")
    expect(pago.get("revisionResueltaEn")).toBe("DateTime?")
  })

  it("declara paypalOrderId y reciboId unicos", () => {
    expect(pago.get("paypalOrderId")).toBe("String? @unique")
    expect(pago.get("reciboId")).toBe("String? @unique")
    expect(pago.get("externalId")).toBe("String? @unique")
  })

  it("conserva los campos existentes (cambio aditivo)", () => {
    expect(pago.get("id")).toBe("String @id @default(cuid())")
    expect(pago.get("clienteId")).toBe("String")
    expect(pago.get("suscripcionId")).toBe("String?")
    expect(pago.get("hitoId")).toBe("String?")
    expect(pago.get("monto")).toBe("Int")
    expect(pago.get("moneda")).toBe('String @default("usd")')
    expect(pago.get("cotizacion")).toBe("Float?")
    expect(pago.get("metodo")).toBe("MetodoPago?")
    expect(pago.get("nota")).toBe("String?")
    expect(pago.get("registradoPor")).toBe("String?")
    expect(pago.get("estadoPago")).toBe("EstadoPago")
    expect(pago.get("creadoEn")).toBe("DateTime @default(now())")
  })

  it("declara las relaciones del plan", () => {
    expect(pago.get("enlacePago")).toBe(
      "EnlacePago? @relation(fields: [enlacePagoId], references: [id])",
    )
    expect(pago.get("ajustes")).toBe("AjustePago[]")
    expect(pago.get("eventos")).toBe("EventoPasarela[]")
  })

  it("no agrega columnas de email ni nombre del pagador", () => {
    for (const campo of ["pagadorEmail", "pagadorNombre", "payerEmail", "payerNombre", "email", "nombre"]) {
      expect(pago.has(campo)).toBe(false)
    }
    expect(schema).not.toMatch(/pagadorEmail|pagadorNombre/)
  })
})

describe("T-03: modelo EnlacePago (AC-1, AC-10, AC-11, AC-18, AC-24)", () => {
  const enlace = camposModelo("EnlacePago")

  it("declara todos los campos del plan", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      token: "String @unique",
      clienteId: "String",
      hitoId: "String?",
      suscripcionId: "String?",
      pasarela: "Pasarela",
      concepto: "String",
      descripcion: "String?",
      notaInterna: "String?",
      montoAcordado: "Int",
      comision: "Int @default(0)",
      total: "Int",
      moneda: 'String @default("usd")',
      meses: "Int?",
      feeBps: "Int @default(0)",
      feeFixedCents: "Int @default(0)",
      url: "String?",
      checkoutUrl: "String?",
      externalId: "String? @unique",
      estado: "EstadoEnlace @default(CREANDO)",
      grupoCobroId: "String",
      expiraEn: "DateTime",
      orderExpiraEn: "DateTime?",
      generadoPor: "String?",
      generadoPorNombre: "String?",
      enviadoPor: "String?",
      enviadoEn: "DateTime?",
      canalEnvio: "String?",
      idioma: "String?",
      invalidadoEn: "DateTime?",
      motivoInvalido: "String?",
      ultimoError: "String?",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(enlace.get(campo), `campo ${campo}`).toBe(tipo)
    }
  })

  it("declara las relaciones y los indices del plan", () => {
    expect(enlace.get("cliente")).toBe(
      "Cliente @relation(fields: [clienteId], references: [id])",
    )
    expect(enlace.get("hito")).toBe("Hito? @relation(fields: [hitoId], references: [id])")
    expect(enlace.get("suscripcion")).toBe(
      "Suscripcion? @relation(fields: [suscripcionId], references: [id])",
    )
    expect(enlace.get("pagos")).toBe("Pago[]")
    expect(enlace.get("eventos")).toBe("EventoPasarela[]")
    expect(indicesModelo("EnlacePago")).toEqual([
      "@@index([clienteId])",
      "@@index([hitoId])",
      "@@index([suscripcionId])",
      "@@index([estado])",
      "@@index([grupoCobroId])",
      "@@index([expiraEn])",
    ])
  })
})

describe("T-03: modelo EventoPasarela (AC-10, AC-11, AC-24)", () => {
  const evento = camposModelo("EventoPasarela")

  it("declara los campos del plan sin payload crudo", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      pasarela: "Pasarela",
      eventoId: "String @unique",
      tipo: "String",
      externalId: "String?",
      enlacePagoId: "String?",
      pagoId: "String?",
      resultado: "String",
      motivo: "String?",
      monto: "Int?",
      moneda: "String?",
      requiereAccion: "Boolean @default(false)",
      creadoEn: "DateTime @default(now())",
      procesadoEn: "DateTime?",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(evento.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(evento.has("payload")).toBe(false)
  })

  it("declara las relaciones y los indices del plan", () => {
    expect(evento.get("enlacePago")).toBe(
      "EnlacePago? @relation(fields: [enlacePagoId], references: [id])",
    )
    expect(evento.get("pago")).toBe("Pago? @relation(fields: [pagoId], references: [id])")
    expect(indicesModelo("EventoPasarela")).toEqual([
      "@@index([pasarela,creadoEn])",
      "@@index([enlacePagoId])",
      "@@index([pagoId])",
      "@@index([requiereAccion])",
    ])
  })
})

describe("T-03: modelo AjustePago (AC-10, AC-24)", () => {
  const ajuste = camposModelo("AjustePago")

  it("declara los campos del plan", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      pagoId: "String",
      tipo: "TipoAjuste",
      monto: "Int",
      motivo: "String?",
      evidencia: "String?",
      decision: "DecisionAjuste @default(NINGUNA)",
      mesesDescontados: "Int?",
      registradoPor: "String?",
      creadoEn: "DateTime @default(now())",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(ajuste.get(campo), `campo ${campo}`).toBe(tipo)
    }
  })

  it("declara la relacion y el indice del plan", () => {
    expect(ajuste.get("pago")).toBe("Pago @relation(fields: [pagoId], references: [id])")
    expect(indicesModelo("AjustePago")).toEqual(["@@index([pagoId])"])
  })
})

describe("T-03: relaciones inversas", () => {
  it("agrega enlacesPago a Cliente, Hito y Suscripcion", () => {
    expect(camposModelo("Cliente").get("enlacesPago")).toBe("EnlacePago[]")
    expect(camposModelo("Hito").get("enlacesPago")).toBe("EnlacePago[]")
    expect(camposModelo("Suscripcion").get("enlacesPago")).toBe("EnlacePago[]")
  })
})
