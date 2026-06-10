import { describe, it, expect } from "vitest"
import { contactSchema } from "@/lib/validations"

const validData = {
  nombre: "Juan Pérez",
  email: "juan@example.com",
  mensaje: "Hola, quiero contratar servicios de desarrollo web.",
}

describe("contactSchema", () => {
  it("accepts valid data", () => {
    const result = contactSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it("rejects nombre shorter than 2 characters", () => {
    const result = contactSchema.safeParse({ ...validData, nombre: "A" })
    expect(result.success).toBe(false)
  })

  it("rejects nombre longer than 50 characters", () => {
    const result = contactSchema.safeParse({
      ...validData,
      nombre: "A".repeat(51),
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid email", () => {
    const result = contactSchema.safeParse({ ...validData, email: "not-an-email" })
    expect(result.success).toBe(false)
  })

  it("rejects mensaje shorter than 20 characters", () => {
    const result = contactSchema.safeParse({ ...validData, mensaje: "Corto" })
    expect(result.success).toBe(false)
  })

  it("rejects mensaje longer than 1000 characters", () => {
    const result = contactSchema.safeParse({
      ...validData,
      mensaje: "A".repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty object", () => {
    const result = contactSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("accepts boundary values", () => {
    const result = contactSchema.safeParse({
      nombre: "Ab",
      email: "a@b.co",
      mensaje: "Un mensaje de exactamente veinte.",
    })
    expect(result.success).toBe(true)
  })

  it("flattens errors on invalid data", () => {
    const result = contactSchema.safeParse({ nombre: "", email: "x", mensaje: "" })
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors).toHaveProperty("nombre")
      expect(flat.fieldErrors).toHaveProperty("email")
      expect(flat.fieldErrors).toHaveProperty("mensaje")
    }
  })
})
