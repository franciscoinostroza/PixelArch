/**
 * Crea productos y precios en Paddle
 * Uso: npx tsx src/scripts/seed-paddle.ts
 */
import { Environment, Paddle } from "@paddle/paddle-node-sdk"

const apiKey = process.env.PADDLE_API_KEY
if (!apiKey) throw new Error("PADDLE_API_KEY no configurada")

const paddle = new Paddle(apiKey, { environment: Environment.sandbox })

const servicios = [
  { nombre: "Desarrollo Web", precioMensual: 5000, precioAnual: 50000 },
  { nombre: "Chatbot Inteligente", precioMensual: 4000, precioAnual: 40000 },
  { nombre: "Agentes de IA", precioMensual: 6000, precioAnual: 60000 },
  { nombre: "Landing Pages", precioMensual: 3000, precioAnual: 30000 },
  { nombre: "Automatizaciones", precioMensual: 4500, precioAnual: 45000 },
  { nombre: "Integraciones", precioMensual: 3500, precioAnual: 35000 },
]

async function seed() {
  for (const s of servicios) {
    console.log(`\nCreando producto: ${s.nombre}`)

    const product = await paddle.products.create({
      name: s.nombre,
      taxCategory: "standard",
    })
    console.log(`  Producto: ${product.id}`)

    const priceMonthly = await paddle.prices.create({
      productId: product.id,
      description: `${s.nombre} - Mensual`,
      unitPrice: { amount: String(s.precioMensual), currencyCode: "USD" },
      billingCycle: { interval: "month", frequency: 1 },
      taxMode: "account_setting",
    })
    console.log(`  Precio mensual: ${priceMonthly.id} — $${(s.precioMensual / 100).toFixed(2)}/mes`)

    const priceYearly = await paddle.prices.create({
      productId: product.id,
      description: `${s.nombre} - Anual`,
      unitPrice: { amount: String(s.precioAnual), currencyCode: "USD" },
      billingCycle: { interval: "year", frequency: 1 },
      taxMode: "account_setting",
    })
    console.log(`  Precio anual:   ${priceYearly.id} — $${(s.precioAnual / 100).toFixed(2)}/año`)
  }

  console.log("\nHecho. Copiá los price IDs al Prisma.")
}

seed()
