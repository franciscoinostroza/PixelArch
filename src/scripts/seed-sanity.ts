/**
 * Crea documentos iniciales en Sanity para PixelArch
 * Uso: npx tsx src/scripts/seed-sanity.ts
 */
import { createClient } from "@sanity/client"

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

async function seed() {
  console.log("Conectando a Sanity...")
  console.log(`  Project: ${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}`)
  console.log(`  Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || "production"}\n`)

  const servicios = [
    {
      _id: "servicio-desarrollo-web",
      _type: "servicio",
      titulo: "Desarrollo Web",
      slug: { _type: "slug", current: "desarrollo-web" },
      descripcion: "Creamos aplicaciones web modernas, rapidas y escalables con React, Next.js y TypeScript.",
      icono: "🌐",
      tags: ["React", "Next.js", "Tailwind", "TypeScript", "PostgreSQL"],
      precioUnico: 100000,
      precioBasico: 5000,
      precioMantenimiento: 20000,
      orden: 1,
      activo: true,
    },
    {
      _id: "servicio-chatbot",
      _type: "servicio",
      titulo: "Chatbot Inteligente",
      slug: { _type: "slug", current: "chatbot" },
      descripcion: "Automatiza la atencion al cliente con chatbots en WhatsApp, Telegram, Instagram y tu sitio.",
      icono: "🤖",
      tags: ["IA", "NLP", "WhatsApp", "Telegram", "Instagram"],
      precioUnico: 50000,
      precioBasico: 4000,
      precioMantenimiento: 10000,
      orden: 2,
      activo: true,
    },
    {
      _id: "servicio-agentes-ia",
      _type: "servicio",
      titulo: "Agentes de IA",
      slug: { _type: "slug", current: "agentes-ia" },
      descripcion: "Agentes de IA autonomos que analizan datos, toman decisiones y ejecutan tareas complejas.",
      icono: "🧠",
      tags: ["GPT", "LangChain", "RAG", "Autonomo", "Analisis"],
      precioUnico: 150000,
      precioBasico: 6000,
      precioMantenimiento: 20000,
      orden: 3,
      activo: true,
    },
    {
      _id: "servicio-landing-pages",
      _type: "servicio",
      titulo: "Landing Pages",
      slug: { _type: "slug", current: "landing-pages" },
      descripcion: "Landing pages disenadas para convertir, optimizadas para SEO y velocidad de carga.",
      icono: "🎯",
      tags: ["SEO", "Conversion", "Rapido", "Responsive", "Analytics"],
      precioUnico: 30000,
      precioBasico: 3000,
      precioMantenimiento: 10000,
      orden: 4,
      activo: true,
    },
    {
      _id: "servicio-automatizaciones",
      _type: "servicio",
      titulo: "Automatizaciones",
      slug: { _type: "slug", current: "automatizaciones" },
      descripcion: "Conectamos tus herramientas y eliminamos tareas repetitivas con flujos automatizados.",
      icono: "⚡",
      tags: ["Zapier", "n8n", "Workflows", "APIs", "Notificaciones"],
      precioUnico: 80000,
      precioBasico: 4500,
      precioMantenimiento: 15000,
      orden: 5,
      activo: true,
    },
    {
      _id: "servicio-integraciones",
      _type: "servicio",
      titulo: "Integraciones",
      slug: { _type: "slug", current: "integraciones" },
      descripcion: "Conectamos tu negocio con Paddle, Clerk, Resend y cualquier API externa.",
      icono: "🔗",
      tags: ["API REST", "Webhooks", "Paddle", "Clerk", "OAuth"],
      precioUnico: 50000,
      precioBasico: 3500,
      precioMantenimiento: 10000,
      orden: 6,
      activo: true,
    },
  ]

  const landing = {
    _id: "landing",
    _type: "landing",
    hero_titulo: "Impulsa tu negocio con tecnologia inteligente",
    hero_subtitulo: "Creamos sitios web, chatbots, agentes de IA y automatizaciones para que tu negocio crezca.",
    hero_cta_primario: "Ver servicios",
    hero_cta_secundario: "Contactanos",
    stats: [
      { numero: 50, label: "Proyectos entregados" },
      { numero: 12, label: "Clientes activos" },
      { numero: 24, label: "Horas de soporte/mes" },
      { numero: 100, label: "Satisfaccion" },
    ],
    proceso_pasos: [
      { titulo: "Consulta", descripcion: "Entendemos tu necesidad y definimos el alcance del proyecto." },
      { titulo: "Desarrollo", descripcion: "Creamos la solucion con tecnologias modernas y buenas practicas." },
      { titulo: "Entrega", descripcion: "Te entregamos el proyecto completo con documentacion y soporte." },
      { titulo: "Mantenimiento", descripcion: "Mantenemos tu servicio activo con planes mensuales flexibles." },
    ],
  }

  const seo = {
    _id: "seo",
    _type: "seo",
    titulo_sitio: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
    descripcion: "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
    og_image: "",
    keywords: ["desarrollo web", "chatbot", "agentes IA", "landing pages", "automatizaciones"],
  }

  const contacto = {
    _id: "contacto",
    _type: "contacto",
    email: "hola@pixelarch.com",
    whatsapp: "",
    telegram: "@pixelarch",
    linkedin: "",
    github: "",
    instagram: "",
  }

  const docs = [...servicios, landing, seo, contacto]

  for (const doc of docs) {
    const { _id, _type, ...body } = doc
    console.log(`Creando ${_id} (${_type})...`)
    await client.createOrReplace({ _id, _type, ...body } as any)
  }

  console.log(`\n${docs.length} documentos creados.`)
}

seed()
