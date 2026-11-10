import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * T-03 (AC-6, AC-43; RF-62): contrato estatico del esquema Prisma del portal.
 *
 * El cambio es aditivo: seis modelos y ocho enums nuevos con los campos,
 * uniques e indices del plan §4.1. No toca la base ni crea datos; solo valida
 * `prisma/schema.prisma`. Los modelos nuevos no tienen FKs ni relaciones a
 * `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` ni `Hito`.
 */

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")

const MODELOS_PORTAL = [
  "CampanaProspeccion",
  "Prospecto",
  "PlantillaPropuesta",
  "EnvioPropuesta",
  "SupresionProspecto",
  "ConsumoProveedor",
] as const

const MODELOS_CRM = [
  "Cliente",
  "Pago",
  "Suscripcion",
  "EnlacePago",
  "Proyecto",
  "Hito",
] as const

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
    campos.set(
      match[1],
      match[2].replace(/\s*\/\/.*$/, "").replace(/\s+/g, " ").trim(),
    )
  }
  return campos
}

function camposExtra(
  campos: Map<string, string>,
  esperados: Record<string, string>,
): string[] {
  return [...campos.keys()].filter((campo) => !(campo in esperados))
}

function indicesModelo(nombre: string): string[] {
  return bloque("model", nombre)
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith("@@index("))
    .map((linea) => linea.replace(/\s+/g, ""))
}

function uniquesModelo(nombre: string): string[] {
  return bloque("model", nombre)
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith("@@unique("))
    .map((linea) => linea.replace(/\s+/g, ""))
}

describe("T-03: enums del portal (AC-43)", () => {
  it("declara los ocho enums con los valores del plan §4.1", () => {
    expect(valoresEnum("EstadoCampanaProspeccion")).toEqual([
      "BORRADOR",
      "EN_CURSO",
      "COMPLETADA",
      "PARCIAL",
      "CANCELADA",
      "FALLIDA",
    ])
    expect(valoresEnum("EstadoProspecto")).toEqual([
      "NUEVO",
      "SIN_ENRIQUECER",
      "ENRIQUECIDO",
      "PUNTUADO",
      "BORRADOR",
      "APROBADO",
      "ENVIADO",
      "RESPONDIO",
      "DESCARTADO",
      "SUPRIMIDO",
    ])
    expect(valoresEnum("EstadoEnvioPropuesta")).toEqual([
      "BORRADOR",
      "APROBADO",
      "ENVIANDO",
      "ENVIADO",
      "FALLIDO",
      "REBOTADO",
      "QUEJA",
      "RESPONDIDO",
      "CANCELADO",
    ])
    expect(valoresEnum("AmbitoSupresion")).toEqual(["EMAIL", "DOMINIO"])
    expect(valoresEnum("MotivoSupresion")).toEqual([
      "OPT_OUT",
      "REBOTE_DURO",
      "QUEJA",
      "MANUAL",
      "SOLICITUD_ARCO",
    ])
    expect(valoresEnum("OrigenSupresion")).toEqual(["ENLACE", "MANUAL", "ARCO"])
    expect(valoresEnum("FuenteDatoProspecto")).toEqual([
      "PLACES",
      "WEB_NEGOCIO",
      "CARGA_MANUAL",
    ])
    expect(valoresEnum("ProveedorConsumo")).toEqual([
      "GOOGLE_PLACES",
      "WEB_FETCH",
      "AUDITORIA",
      "REDACTOR",
      "RESEND",
    ])
  })
})

describe("T-03: modelo CampanaProspeccion (AC-43)", () => {
  const campana = camposModelo("CampanaProspeccion")

  it("declara los campos, defaults y relaciones del plan", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      nombre: "String",
      consulta: "String",
      zona: "String?",
      rubro: "String?",
      filtros: "Json?",
      estado: "EstadoCampanaProspeccion @default(BORRADOR)",
      limiteCorrida: "Int @default(20)",
      plantillaId: "String?",
      creadaPor: "String",
      creadaPorNombre: "String?",
      idempotencyKey: "String? @unique",
      ultimoError: "String?",
      iniciadaEn: "DateTime?",
      finalizadaEn: "DateTime?",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
      plantilla:
        "PlantillaPropuesta? @relation(fields: [plantillaId], references: [id], onDelete: SetNull)",
      prospectos: "Prospecto[]",
      envios: "EnvioPropuesta[]",
      consumos: "ConsumoProveedor[]",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(campana.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(campana, esperados)).toEqual([])
    expect(indicesModelo("CampanaProspeccion")).toEqual([
      "@@index([estado,creadoEn])",
      "@@index([creadaPor])",
    ])
  })
})

describe("T-03: modelo Prospecto (AC-6, AC-43)", () => {
  const prospecto = camposModelo("Prospecto")

  it("declara identidad, contacto, enriquecimiento y procedencia del plan", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      nombreNegocio: "String",
      sitioWeb: "String?",
      dominioNormalizado: "String?",
      ciudad: "String?",
      rubro: "String?",
      placeId: "String? @unique",
      email: "String? @unique",
      telefono: "String?",
      contactoNombre: "String?",
      contactoCargo: "String?",
      emailFuenteUrl: "String?",
      emailFechaFuente: "DateTime?",
      fuenteTipo: "FuenteDatoProspecto?",
      fuenteUrl: "String?",
      fechaFuente: "DateTime?",
      estado: "EstadoProspecto @default(NUEVO)",
      score: "Int?",
      scoreDetalle: "Json?",
      auditoriaResumen: "Json?",
      auditoriaEstado: "String?",
      auditoriaFecha: "DateTime?",
      posibleDuplicadoDeId: "String?",
      motivoSinEnriquecer: "String?",
      baseLegal: "String?",
      notaLegal: "String?",
      notas: "String?",
      arcoHistorial: "Json?",
      historial: "Json?",
      actualizadoPor: "String?",
      ultimaInteraccionEn: "DateTime @default(now())",
      ultimoEnvioEn: "DateTime?",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
      campanaOrigenId: "String",
      campanaOrigen:
        "CampanaProspeccion @relation(fields: [campanaOrigenId], references: [id], onDelete: Cascade)",
      envios: "EnvioPropuesta[]",
      consumos: "ConsumoProveedor[]",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(prospecto.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(prospecto, esperados)).toEqual([])
    expect(indicesModelo("Prospecto")).toEqual([
      "@@index([estado,actualizadoEn])",
      "@@index([campanaOrigenId,estado])",
      "@@index([dominioNormalizado])",
      "@@index([posibleDuplicadoDeId])",
      "@@index([ultimaInteraccionEn])",
    ])
  })

  it("no guarda HTML crudo ni datos sensibles", () => {
    for (const campo of ["html", "htmlCrudo", "contenidoWeb", "datosSensibles"]) {
      expect(prospecto.has(campo)).toBe(false)
    }
  })
})

describe("T-03: modelo PlantillaPropuesta (AC-43)", () => {
  const plantilla = camposModelo("PlantillaPropuesta")

  it("declara versionado, lista blanca y estado activo", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      nombre: "String",
      idioma: 'String @default("es")',
      asunto: "String",
      cuerpo: "String",
      variablesPermitidas: "Json",
      version: "Int @default(1)",
      activa: "Boolean @default(true)",
      creadaPor: "String",
      creadaPorNombre: "String?",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
      campanas: "CampanaProspeccion[]",
      envios: "EnvioPropuesta[]",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(plantilla.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(plantilla, esperados)).toEqual([])
    expect(uniquesModelo("PlantillaPropuesta")).toEqual([
      "@@unique([nombre,version])",
    ])
    expect(indicesModelo("PlantillaPropuesta")).toEqual(["@@index([activa])"])
  })
})

describe("T-03: modelo EnvioPropuesta (AC-6, AC-43)", () => {
  const envio = camposModelo("EnvioPropuesta")

  it("declara borrador, snapshot aprobado y trazabilidad del envio", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      prospectoId: "String",
      campanaId: "String",
      plantillaId: "String?",
      plantillaVersion: "Int?",
      secuencia: "Int",
      version: "Int @default(1)",
      destinatario: "String",
      fromEmail: "String?",
      fromNombre: "String?",
      replyTo: "String?",
      asunto: "String",
      cuerpoHtml: "String",
      cuerpoTexto: "String",
      hashContenido: "String",
      tokenBaja: "String?",
      estado: "EstadoEnvioPropuesta @default(BORRADOR)",
      aprobadoAsunto: "String?",
      aprobadoCuerpoHtml: "String?",
      aprobadoCuerpoTexto: "String?",
      aprobadoHash: "String?",
      aprobadoPor: "String?",
      aprobadoPorNombre: "String?",
      aprobadoEn: "DateTime?",
      enviadoPor: "String?",
      enviadoPorNombre: "String?",
      enviadoEn: "DateTime?",
      proveedorMessageId: "String? @unique",
      idempotencyKey: "String? @unique",
      error: "String?",
      intentos: "Int @default(0)",
      motivoCancelacion: "String?",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
      prospecto:
        "Prospecto @relation(fields: [prospectoId], references: [id], onDelete: Cascade)",
      campana:
        "CampanaProspeccion @relation(fields: [campanaId], references: [id], onDelete: Cascade)",
      plantilla:
        "PlantillaPropuesta? @relation(fields: [plantillaId], references: [id], onDelete: SetNull)",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(envio.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(envio, esperados)).toEqual([])
    expect(uniquesModelo("EnvioPropuesta")).toEqual([
      "@@unique([prospectoId,secuencia,version])",
    ])
    expect(indicesModelo("EnvioPropuesta")).toEqual([
      "@@index([estado,creadoEn])",
      "@@index([prospectoId,secuencia])",
      "@@index([campanaId,estado])",
    ])
  })
})

describe("T-03: modelo SupresionProspecto (AC-6, AC-43)", () => {
  const supresion = camposModelo("SupresionProspecto")

  it("guarda hash/clave, ambito y trazabilidad sin email en claro", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      ambito: "AmbitoSupresion",
      clave: "String @unique",
      emailHash: "String?",
      emailEnmascarado: "String?",
      dominioNegocio: "String?",
      motivo: "MotivoSupresion",
      origen: "OrigenSupresion",
      activa: "Boolean @default(true)",
      notas: "String?",
      historial: "Json?",
      creadaPor: "String?",
      creadaPorNombre: "String?",
      creadaEn: "DateTime @default(now())",
      revocadaPor: "String?",
      revocadaEn: "DateTime?",
      motivoRevocacion: "String?",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(supresion.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(supresion, esperados)).toEqual([])
    expect(supresion.has("email")).toBe(false)
    expect(indicesModelo("SupresionProspecto")).toEqual([
      "@@index([ambito,activa])",
      "@@index([emailHash])",
      "@@index([dominioNegocio])",
    ])
  })
})

describe("T-03: modelo ConsumoProveedor (AC-43)", () => {
  const consumo = camposModelo("ConsumoProveedor")

  it("declara cupos/costos por campana, proveedor y fecha UTC", () => {
    const esperados: Record<string, string> = {
      id: "String @id @default(cuid())",
      clave: "String @unique",
      campanaId: "String",
      prospectoId: "String?",
      proveedor: "ProveedorConsumo",
      fecha: "DateTime @db.Date",
      llamadas: "Int @default(0)",
      unidades: "Int @default(0)",
      costoCentavos: "Int @default(0)",
      creadoEn: "DateTime @default(now())",
      actualizadoEn: "DateTime @updatedAt",
      campana:
        "CampanaProspeccion @relation(fields: [campanaId], references: [id], onDelete: Cascade)",
      prospecto:
        "Prospecto? @relation(fields: [prospectoId], references: [id], onDelete: SetNull)",
    }

    for (const [campo, tipo] of Object.entries(esperados)) {
      expect(consumo.get(campo), `campo ${campo}`).toBe(tipo)
    }
    expect(camposExtra(consumo, esperados)).toEqual([])
    expect(indicesModelo("ConsumoProveedor")).toEqual([
      "@@index([campanaId,proveedor,fecha])",
      "@@index([prospectoId])",
      "@@index([proveedor,fecha])",
    ])
  })
})

describe("T-03: aislamiento del esquema (AC-6, AC-43)", () => {
  it("los modelos nuevos no referencian ningun modelo del CRM", () => {
    for (const modelo of MODELOS_PORTAL) {
      const contenido = bloque("model", modelo)

      for (const crm of MODELOS_CRM) {
        expect(contenido, `${modelo} referencia ${crm}`).not.toMatch(
          new RegExp(String.raw`\b${crm}\b`),
        )
      }
      expect(contenido, `${modelo} declara una FK al CRM`).not.toMatch(
        /\b(clienteId|pagoId|suscripcionId|enlacePagoId|proyectoId|hitoId)\b/,
      )
    }
  })

  it("las relaciones de los modelos nuevos apuntan solo a modelos del portal", () => {
    const permitidos = new Set<string>(MODELOS_PORTAL)

    for (const modelo of MODELOS_PORTAL) {
      const contenido = bloque("model", modelo)

      for (const linea of contenido.split("\n")) {
        if (!linea.includes("@relation(")) continue

        const destino = linea
          .trim()
          .split(/\s+/)[1]
          ?.replace(/[?[\]]/g, "")

        expect(destino, `${modelo} tiene una relacion sin destino`).toBeDefined()
        expect(permitidos.has(destino as string), `${modelo} -> ${destino}`).toBe(
          true,
        )
      }
    }
  })

  it("los modelos del CRM no incorporan campos ni relaciones del portal", () => {
    for (const crm of MODELOS_CRM) {
      const contenido = bloque("model", crm)

      for (const modelo of MODELOS_PORTAL) {
        expect(contenido, `${crm} referencia ${modelo}`).not.toMatch(
          new RegExp(String.raw`\b${modelo}\b`),
        )
      }
    }
  })

  it("no declara programacion ni scheduler: la secuencia es manual (AC-30)", () => {
    expect(schema).not.toMatch(/\bscheduledAt\b|\bscheduledEn\b|\bprogramadoEn\b/)
  })
})
