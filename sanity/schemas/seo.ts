import { defineField, defineType } from "sanity"

export default defineType({
  name: "seo",
  title: "SEO",
  type: "document",
  fields: [
    defineField({ name: "titulo_sitio", title: "Título del sitio", type: "string" }),
    defineField({ name: "descripcion", title: "Descripción", type: "text" }),
    defineField({ name: "og_image", title: "Imagen Open Graph", type: "image" }),
    defineField({ name: "keywords", title: "Keywords", type: "array", of: [{ type: "string" }] }),
  ],
})
