import { defineField, defineType } from "sanity"

export default defineType({
  name: "servicio",
  title: "Servicio",
  type: "document",
  fields: [
    defineField({ name: "titulo", title: "Titulo", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "titulo" } }),
    defineField({ name: "descripcion", title: "Descripcion", type: "text" }),
    defineField({ name: "meta_title", title: "Titulo SEO (opcional)", type: "string" }),
    defineField({ name: "meta_description", title: "Descripcion SEO (opcional)", type: "text" }),
    defineField({ name: "og_image", title: "Imagen para redes sociales", type: "image" }),
    defineField({ name: "icono", title: "Icono (emoji)", type: "string" }),
    defineField({ name: "tags", title: "Tags", type: "array", of: [{ type: "string" }] }),
    defineField({ name: "precioUnico", title: "Pago unico (centavos USD)", type: "number", initialValue: 0 }),
    defineField({ name: "precioBasico", title: "Plan Basico mensual (centavos USD)", type: "number", initialValue: 0 }),
    defineField({ name: "precioMantenimiento", title: "Plan Mantenimiento mensual (centavos USD)", type: "number", initialValue: 0 }),
    defineField({ name: "orden", title: "Orden", type: "number", initialValue: 0 }),
    defineField({ name: "activo", title: "Activo", type: "boolean", initialValue: true }),
  ],
  preview: {
    select: { title: "titulo", subtitle: "descripcion" },
  },
})
