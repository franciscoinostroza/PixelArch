import { defineField, defineType } from "sanity"

export default defineType({
  name: "servicio",
  title: "Servicio",
  type: "document",
  fields: [
    defineField({ name: "titulo", title: "Titulo", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "titulo" } }),
    defineField({ name: "descripcion", title: "Descripcion", type: "text" }),
    defineField({ name: "icono", title: "Icono (emoji)", type: "string" }),
    defineField({ name: "tags", title: "Tags", type: "array", of: [{ type: "string" }] }),
    defineField({ name: "precio", title: "Precio (centavos USD)", type: "number", initialValue: 0 }),
    defineField({ name: "intervalo", title: "Intervalo", type: "string", options: { list: [{ title: "Mensual", value: "MENSUAL" }, { title: "Anual", value: "ANUAL" }] }, initialValue: "MENSUAL" }),
    defineField({ name: "paddlePriceId", title: "Paddle Price ID", type: "string" }),
    defineField({ name: "orden", title: "Orden", type: "number", initialValue: 0 }),
    defineField({ name: "activo", title: "Activo", type: "boolean", initialValue: true }),
  ],
  preview: {
    select: { title: "titulo", subtitle: "descripcion" },
  },
})
