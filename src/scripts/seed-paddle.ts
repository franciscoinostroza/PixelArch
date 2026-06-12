/**
 * Crea productos y precios en Paddle Sandbox
 * 6 servicios × 3 precios = 18 prices
 * Uso: PADDLE_API_KEY=... npx tsx src/scripts/seed-paddle.ts
 */
import { Environment, Paddle } from "@paddle/paddle-node-sdk"

const apiKey = process.env.PADDLE_API_KEY
if (!apiKey) throw new Error("PADDLE_API_KEY no configurada")

// Live (production) — la API key es pdl_live_*
const paddle = new Paddle(apiKey, { environment: Environment.production })

const servicios = [
  {
    nombre: "Desarrollo Web",
    unico: 100000,
    basico: 2500,
    mantenimiento: 20000,
  },
  {
    nombre: "Chatbot Inteligente",
    unico: 50000,
    basico: 2000,
    mantenimiento: 10000,
  },
  {
    nombre: "Agentes de IA",
    unico: 150000,
    basico: 3500,
    mantenimiento: 20000,
  },
  {
    nombre: "Landing Pages",
    unico: 30000,
    basico: 1500,
    mantenimiento: 10000,
  },
  {
    nombre: "Automatizaciones",
    unico: 80000,
    basico: 4500,
    mantenimiento: 15000,
  },
  {
    nombre: "Integraciones",
    unico: 50000,
    basico: 3500,
    mantenimiento: 10000,
  },
]

async function seed() {
  for (const s of servicios) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`  ${s.nombre}`)
    console.log(`${"=".repeat(50)}`)

    // Crear producto
    const product = await paddle.products.create({
      name: s.nombre,
      taxCategory: "standard",
    })
    console.log(`  Producto: ${product.id}`)

    // Precio Único (one-time)
    const priceUnico = await paddle.prices.create({
      productId: product.id,
      description: `${s.nombre} - Pago Único`,
      unitPrice: { amount: String(s.unico), currencyCode: "USD" },
      taxMode: "account_setting",
    })
    console.log(`  Único:        ${priceUnico.id} — $${(s.unico / 100).toFixed(2)}`)

    // Precio Básico (recurring mensual)
    const priceBasico = await paddle.prices.create({
      productId: product.id,
      description: `${s.nombre} - Plan Básico`,
      unitPrice: { amount: String(s.basico), currencyCode: "USD" },
      billingCycle: { interval: "month", frequency: 1 },
      taxMode: "account_setting",
    })
    console.log(`  Básico:       ${priceBasico.id} — $${(s.basico / 100).toFixed(2)}/mes`)

    // Precio Mantenimiento (recurring mensual)
    const priceMant = await paddle.prices.create({
      productId: product.id,
      description: `${s.nombre} - Plan Mantenimiento`,
      unitPrice: { amount: String(s.mantenimiento), currencyCode: "USD" },
      billingCycle: { interval: "month", frequency: 1 },
      taxMode: "account_setting",
    })
    console.log(`  Mantenimiento: ${priceMant.id} — $${(s.mantenimiento / 100).toFixed(2)}/mes`)
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`  COMPLETADO — Copiá los price IDs al Prisma`)
  console.log(`${"=".repeat(50)}`)
}

seed().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})
