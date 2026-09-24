import { z } from "zod"

export const contactSchema = z.object({
  nombre: z.string().min(2, "Mínimo 2 caracteres").max(50, "Máximo 50 caracteres"),
  email: z.string().email("Email inválido"),
  mensaje: z
    .string()
    .min(20, "Mínimo 20 caracteres")
    .max(1000, "Máximo 1000 caracteres"),
})

export type ContactFormValues = z.infer<typeof contactSchema>

export const clienteSchema = z.object({
  nombre: z.string().min(2, "Mínimo 2 caracteres").max(80, "Máximo 80 caracteres"),
  email: z.string().email("Email inválido"),
  empresa: z.string().max(80, "Máximo 80 caracteres").optional().default(""),
  telefono: z.string().max(30, "Máximo 30 caracteres").optional().default(""),
  notas: z.string().max(1000, "Máximo 1000 caracteres").optional().default(""),
})

export type ClienteFormValues = z.infer<typeof clienteSchema>
