const { Pool } = require("pg")

const TOKEN = process.env.POLAR_ACCESS_TOKEN
if (!TOKEN) throw new Error("POLAR_ACCESS_TOKEN no configurada")
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada")

const API = "https://api.polar.sh/v1"
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const servicios = [
  { id: "servicio-desarrollo-web",    nombre: "Desarrollo Web",        unico: 100000, basico: 2500,  mantenimiento: 20000 },
  { id: "servicio-chatbot",           nombre: "Chatbot Inteligente",    unico: 50000,  basico: 2000,  mantenimiento: 10000 },
  { id: "servicio-agentes-ia",        nombre: "Agentes de IA",          unico: 150000, basico: 3500,  mantenimiento: 20000 },
  { id: "servicio-landing-pages",     nombre: "Landing Pages",          unico: 30000,  basico: 1500,  mantenimiento: 10000 },
  { id: "servicio-automatizaciones",   nombre: "Automatizaciones",       unico: 80000,  basico: 4500,  mantenimiento: 15000 },
  { id: "servicio-integraciones",     nombre: "Integraciones",          unico: 50000,  basico: 3500,  mantenimiento: 10000 },
]

function toSnake(v: string): string {
  return v.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
}

function deepSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[toSnake(k)] = Array.isArray(v) ? v.map(i => typeof i === "object" && i ? deepSnake(i as Record<string, unknown>) : i) : v
  }
  return result
}

async function polarCreate(product: Record<string, unknown>) {
  const res = await fetch(`${API}/products/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(deepSnake(product)),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Polar API error ${res.status}: ${text}`)
  }
  return res.json()
}

async function main() {
  for (const s of servicios) {
    console.log(`\n--- ${s.nombre} ---`)

    const pUnico = await polarCreate({
      name: `${s.nombre} - Pago Único`,
      description: `Pago único por ${s.nombre}`,
      prices: [{ amountType: "fixed", priceAmount: s.unico }],
    })

    const pBasico = await polarCreate({
      name: `${s.nombre} - Plan Básico`,
      description: `Suscripción mensual - Plan Básico de ${s.nombre}`,
      prices: [{ amountType: "fixed", priceAmount: s.basico }],
      recurringInterval: "month",
    })

    const pMant = await polarCreate({
      name: `${s.nombre} - Plan Mantenimiento`,
      description: `Suscripción mensual - Plan Mantenimiento de ${s.nombre}`,
      prices: [{ amountType: "fixed", priceAmount: s.mantenimiento }],
      recurringInterval: "month",
    })

    await pool.query(
      `UPDATE "Servicio" SET "polarProductIdUnico" = $1, "polarProductIdBasico" = $2, "polarProductIdMantenimiento" = $3 WHERE id = $4`,
      [pUnico.id, pBasico.id, pMant.id, s.id]
    )

    console.log(`  Único: ${pUnico.id}`)
    console.log(`  Básico: ${pBasico.id}`)
    console.log(`  Mant.: ${pMant.id}`)
    console.log(`  → DB actualizada ✓`)
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log("  COMPLETADO — 18 productos creados y DB actualizada")
  console.log(`${"=".repeat(50)}`)

  await pool.end()
}

main().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})
