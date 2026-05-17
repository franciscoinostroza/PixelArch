/**
 * Upsert servicios en Prisma con los precio IDs de Paddle
 * Uso: npx tsx src/scripts/seed-servicios-prisma.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
})

const servicios = [
  { id: "servicio-desarrollo-web", nombre: "Desarrollo Web", descripcion: "Creamos aplicaciones web modernas, rápidas y escalables con React, Next.js y TypeScript.", precio: 5000, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv43wxbgf0kyhz4j5746fgy" },
  { id: "servicio-chatbot", nombre: "Chatbot Inteligente", descripcion: "Automatizá la atención al cliente y las ventas con chatbots inteligentes.", precio: 4000, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv43xq9xs8hzzbt14m0r7b7" },
  { id: "servicio-agentes-ia", nombre: "Agentes de IA", descripcion: "Desplegamos agentes de inteligencia artificial autónomos que analizan datos y toman decisiones.", precio: 6000, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv43ycmz67j9k146x5x920b" },
  { id: "servicio-landing-pages", nombre: "Landing Pages", descripcion: "Landing pages diseñadas para convertir. Optimizadas para SEO y velocidad.", precio: 3000, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv43z1hxmamwvj8b5b7nv8w" },
  { id: "servicio-automatizaciones", nombre: "Automatizaciones", descripcion: "Conectamos tus herramientas y eliminamos tareas repetitivas con flujos automatizados.", precio: 4500, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv43zq2tk9b7d7j759ggsyj" },
  { id: "servicio-integraciones", nombre: "Integraciones", descripcion: "Conectamos tu negocio con las plataformas que ya usás.", precio: 3500, intervalo: "MONTHLY" as const, paddlePriceId: "pri_01krv440bmmmdz6jz1qg9eezeg" },
]

async function seed() {
  for (const s of servicios) {
    await prisma.servicio.upsert({
      where: { id: s.id },
      create: s,
      update: { paddlePriceId: s.paddlePriceId, nombre: s.nombre, descripcion: s.descripcion, precio: s.precio, intervalo: s.intervalo },
    })
    console.log(`  ${s.nombre}: ${s.paddlePriceId}`)
  }
  console.log("Hecho.")
  await prisma.$disconnect()
}

seed()
