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

  // ── Servicios ──────────────────────────────────────────────
  const servicios = [
    {
      _id: "servicio-desarrollo-web",
      _type: "servicio",
      titulo: "Desarrollo Web",
      slug: { _type: "slug", current: "desarrollo-web" },
      descripcion:
        "Creamos aplicaciones web modernas, rapidas y escalables con React, Next.js y TypeScript. Desde landings institucionales hasta dashboards complejos, cada proyecto se adapta a las necesidades de tu negocio.",
      icono: "🌐",
      tags: ["React", "Next.js", "Tailwind", "TypeScript", "PostgreSQL"],
      precio: 5000,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv43wxbgf0kyhz4j5746fgy",
      orden: 1,
      activo: true,
    },
    {
      _id: "servicio-chatbot",
      _type: "servicio",
      titulo: "Chatbot Inteligente",
      slug: { _type: "slug", current: "chatbot" },
      descripcion:
        "Automatiza la atencion al cliente y las ventas con chatbots inteligentes que funcionan en WhatsApp, Telegram, Instagram y tu sitio web. Entrenados con tu informacion y conectados a tus sistemas.",
      icono: "🤖",
      tags: ["IA", "NLP", "WhatsApp", "Telegram", "Instagram"],
      precio: 4000,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv43xq9xs8hzzbt14m0r7b7",
      orden: 2,
      activo: true,
    },
    {
      _id: "servicio-agentes-ia",
      _type: "servicio",
      titulo: "Agentes de IA",
      slug: { _type: "slug", current: "agentes-ia" },
      descripcion:
        "Desplegamos agentes de inteligencia artificial autonomos que analizan datos, toman decisiones y ejecutan tareas complejas. Ideales para soporte, analisis de documentos, clasificacion y mas.",
      icono: "🧠",
      tags: ["GPT", "LangChain", "RAG", "Autonomo", "Analisis"],
      precio: 6000,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv43ycmz67j9k146x5x920b",
      orden: 3,
      activo: true,
    },
    {
      _id: "servicio-landing-pages",
      _type: "servicio",
      titulo: "Landing Pages",
      slug: { _type: "slug", current: "landing-pages" },
      descripcion:
        "Landing pages disenadas para convertir. Optimizadas para SEO, velocidad de carga y dispositivos moviles. Incluyen analiticas, formularios de contacto y A/B testing.",
      icono: "🎯",
      tags: ["SEO", "Conversion", "Rapido", "Responsive", "Analytics"],
      precio: 3000,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv43z1hxmamwvj8b5b7nv8w",
      orden: 4,
      activo: true,
    },
    {
      _id: "servicio-automatizaciones",
      _type: "servicio",
      titulo: "Automatizaciones",
      slug: { _type: "slug", current: "automatizaciones" },
      descripcion:
        "Conectamos tus herramientas y eliminamos tareas repetitivas con flujos de trabajo automatizados. Integraciones con CRM, email marketing, facturacion, notificaciones y mas.",
      icono: "⚡",
      tags: ["Zapier", "n8n", "Workflows", "APIs", "Notificaciones"],
      precio: 4500,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv43zq2tk9b7d7j759ggsyj",
      orden: 5,
      activo: true,
    },
    {
      _id: "servicio-integraciones",
      _type: "servicio",
      titulo: "Integraciones",
      slug: { _type: "slug", current: "integraciones" },
      descripcion:
        "Conectamos tu negocio con las plataformas que ya usas: Paddle para pagos, Clerk para autenticacion, Resend para emails, Telegram para notificaciones y cualquier API externa.",
      icono: "🔗",
      tags: ["API REST", "Webhooks", "Paddle", "Clerk", "OAuth"],
      precio: 3500,
      intervalo: "MENSUAL",
      paddlePriceId: "pri_01krv440bmmmdz6jz1qg9eezeg",
      orden: 6,
      activo: true,
    },
  ]

  // ── Landing ────────────────────────────────────────────────
  const landing = {
    _id: "landing",
    _type: "landing",
    hero_titulo: "Impulsa tu negocio con tecnología inteligente",
    hero_subtitulo:
      "Desarrollamos sitios web, chatbots, agentes de IA y automatizaciones que transforman tu empresa. Tecnología moderna, resultados reales.",
    hero_cta_primario: "Comenzar ahora",
    hero_cta_secundario: "Ver servicios",
    stats: [
      { _key: "s1", numero: 10, label: "Proyectos" },
      { _key: "s2", numero: 3, label: "Años creando" },
      { _key: "s3", numero: 6, label: "Servicios" },
    ],
    proceso_pasos: [
      {
        _key: "p1",
        titulo: "Consultoría inicial",
        descripcion:
          "Analizamos tu negocio, entendemos tus necesidades y definimos juntos la solución ideal. Sin costo y sin compromiso.",
      },
      {
        _key: "p2",
        titulo: "Diseño y propuesta",
        descripcion:
          "Creamos un plan detallado con alcance, tecnologías, tiempos y presupuesto. Todo transparente desde el día uno.",
      },
      {
        _key: "p3",
        titulo: "Desarrollo",
        descripcion:
          "Construimos tu solución con las mejores prácticas: código limpio, tests, CI/CD y revisiones periódicas.",
      },
      {
        _key: "p4",
        titulo: "Revisión y ajustes",
        descripcion:
          "Probamos todo junto a vos. Ajustamos cada detalle hasta que quede exactamente como lo imaginaste.",
      },
      {
        _key: "p5",
        titulo: "Lanzamiento y soporte",
        descripcion:
          "Ponemos tu proyecto en producción y te damos soporte continuo para que crezca sin fricción.",
      },
    ],
  }

  // ── SEO ────────────────────────────────────────────────────
  const seo = {
    _id: "seo",
    _type: "seo",
    titulo_sitio: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
    descripcion:
      "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio. Desarrollo moderno con React, Next.js y TypeScript.",
    keywords: [
      "desarrollo web",
      "chatbots",
      "agentes de IA",
      "automatizaciones",
      "landing pages",
      "Next.js",
      "React",
      "TypeScript",
    ],
  }

  // ── Contacto ───────────────────────────────────────────────
  const contacto = {
    _id: "contacto",
    _type: "contacto",
    email: "piixel.arch@gmail.com",
    whatsapp: "+56 9 5345 3967",
    telegram: "@pixelarch.ti",
    linkedin: "",
    github: "https://github.com/franciscoinostroza/PixelArch",
    instagram: "https://instagram.com/pixelarch.ti",
  }

  // ── Subir ──────────────────────────────────────────────────
  const all = [
    ...servicios,
    landing,
    seo,
    contacto,
  ]

  for (const doc of all) {
    const result = await client.createOrReplace(doc as Parameters<typeof client.createOrReplace>[0])
    console.log(`✅ ${doc._type}: ${result._id}`)
  }

  console.log(`\n🎉 ${all.length} documentos creados en Sanity.`)
  console.log(`   Visitá https://pixelarch-production.up.railway.app/studio`)
}

seed().catch((e) => {
  console.error("❌ Error:", e.message)
  process.exit(1)
})
