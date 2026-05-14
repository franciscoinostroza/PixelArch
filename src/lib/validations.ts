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
