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
