import { defineField, defineType } from "sanity"

export default defineType({
  name: "contacto",
  title: "Contacto",
  type: "document",
  fields: [
    defineField({ name: "email", title: "Email", type: "string" }),
    defineField({ name: "whatsapp", title: "WhatsApp", type: "string" }),
    defineField({ name: "telegram", title: "Telegram", type: "string" }),
    defineField({ name: "linkedin", title: "LinkedIn", type: "url" }),
    defineField({ name: "github", title: "GitHub", type: "url" }),
    defineField({ name: "instagram", title: "Instagram", type: "url" }),
  ],
})
