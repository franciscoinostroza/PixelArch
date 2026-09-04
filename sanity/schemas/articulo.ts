import { defineField, defineType } from "sanity"

export default defineType({
  name: "articulo",
  title: "Artículo",
  type: "document",
  fields: [
    defineField({ name: "titulo", title: "Título", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "titulo" } }),
    defineField({ name: "descripcion", title: "Descripción (resumen)", type: "text", rows: 3 }),
    defineField({ name: "portada", title: "Imagen de portada", type: "image", options: { hotspot: true } }),
    defineField({ name: "fecha", title: "Fecha de publicación", type: "date", initialValue: new Date().toISOString().slice(0, 10) }),
    defineField({ name: "autor", title: "Autor", type: "string", initialValue: "PixelArch" }),
    defineField({ name: "tags", title: "Tags", type: "array", of: [{ type: "string" }] }),
    defineField({
      name: "contenido",
      title: "Contenido",
      type: "array",
      of: [
        { type: "block" },
        { type: "image", fields: [defineField({ name: "alt", type: "string", title: "Texto alternativo" })] },
      ],
    }),
    defineField({ name: "meta_title", title: "Título SEO (opcional)", type: "string" }),
    defineField({ name: "meta_description", title: "Descripción SEO (opcional)", type: "text" }),
    defineField({ name: "og_image", title: "Imagen para redes sociales", type: "image" }),
    defineField({ name: "activo", title: "Publicado", type: "boolean", initialValue: false }),
  ],
  preview: {
    select: { title: "titulo", subtitle: "fecha" },
  },
})