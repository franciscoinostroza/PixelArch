import { defineField, defineType } from "sanity"

export default defineType({
  name: "landing",
  title: "Landing",
  type: "document",
  fields: [
    defineField({ name: "hero_titulo", title: "Hero — Título", type: "string" }),
    defineField({ name: "hero_subtitulo", title: "Hero — Subtítulo", type: "text" }),
    defineField({ name: "hero_cta_primario", title: "Hero — CTA Primario", type: "string" }),
    defineField({ name: "hero_cta_secundario", title: "Hero — CTA Secundario", type: "string" }),
    defineField({
      name: "stats",
      title: "Stats",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({ name: "numero", title: "Número", type: "number" }),
            defineField({ name: "label", title: "Etiqueta", type: "string" }),
          ],
        },
      ],
    }),
    defineField({
      name: "proceso_pasos",
      title: "Proceso — Pasos",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({ name: "titulo", title: "Título", type: "string" }),
            defineField({ name: "descripcion", title: "Descripción", type: "text" }),
          ],
        },
      ],
    }),
  ],
})
