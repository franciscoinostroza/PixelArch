/**
 * Crea productos y precios en Paddle via API REST
 * Uso: node src/scripts/seed-paddle-rest.mjs
 */
const API_KEY = process.env.PADDLE_API_KEY
const BASE = "https://api.paddle.com"

if (!API_KEY) {
  console.error("PADDLE_API_KEY not set")
  process.exit(1)
}

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
}

const servicios = [
  { nombre: "Desarrollo Web", mensual: 5000, anual: 50000 },
  { nombre: "Chatbot Inteligente", mensual: 4000, anual: 40000 },
  { nombre: "Agentes de IA", mensual: 6000, anual: 60000 },
  { nombre: "Landing Pages", mensual: 3000, anual: 30000 },
  { nombre: "Automatizaciones", mensual: 4500, anual: 45000 },
  { nombre: "Integraciones", mensual: 3500, anual: 35000 },
]

async function main() {
  for (const s of servicios) {
    console.log(`\n${s.nombre}`)

    const productRes = await fetch(`${BASE}/products`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: s.nombre, tax_category: "standard" }),
    })
    const product = await productRes.json()
    if (!productRes.ok) {
      console.error("  ERROR product:", product)
      continue
    }
    const productId = product.data.id
    console.log(`  Producto: ${productId}`)

    // Mensual
    const priceM = await fetch(`${BASE}/prices`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: productId,
        description: `${s.nombre} - Mensual`,
        unit_price: { amount: String(s.mensual), currency_code: "USD" },
        billing_cycle: { interval: "month", frequency: 1 },
        tax_mode: "account_setting",
      }),
    })
    const pm = await priceM.json()
    if (!priceM.ok) {
      console.error("  ERROR price monthly:", pm)
    } else {
      console.log(`  Mensual: ${pm.data.id} — $${(s.mensual / 100).toFixed(2)}/mes`)
    }

    // Anual
    const priceY = await fetch(`${BASE}/prices`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: productId,
        description: `${s.nombre} - Anual`,
        unit_price: { amount: String(s.anual), currency_code: "USD" },
        billing_cycle: { interval: "year", frequency: 1 },
        tax_mode: "account_setting",
      }),
    })
    const py = await priceY.json()
    if (!priceY.ok) {
      console.error("  ERROR price yearly:", py)
    } else {
      console.log(`  Anual:   ${py.data.id} — $${(s.anual / 100).toFixed(2)}/año`)
    }
  }

  console.log("\nHecho.")
}

main()
