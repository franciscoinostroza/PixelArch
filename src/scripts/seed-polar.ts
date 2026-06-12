import { Polar } from "@polar-sh/sdk"

const token = process.env.POLAR_ACCESS_TOKEN
if (!token) throw new Error("POLAR_ACCESS_TOKEN no configurada")

const polar = new Polar({ accessToken: token, server: "production" })

type ServicioSeed = {
  nombre: string
  slug: string
  unico: number
  basico: number
  mantenimiento: number
}

const servicios: ServicioSeed[] = [
  { nombre: "Desarrollo Web",          slug: "desarrollo-web",          unico: 100000, basico: 2500, mantenimiento: 20000 },
  { nombre: "Chatbot Inteligente",      slug: "chatbot",                 unico: 50000,  basico: 2000, mantenimiento: 10000 },
  { nombre: "Agentes de IA",            slug: "agentes-ia",              unico: 150000, basico: 3500, mantenimiento: 20000 },
  { nombre: "Landing Pages",            slug: "landing-pages",           unico: 30000,  basico: 1500, mantenimiento: 10000 },
  { nombre: "Automatizaciones",         slug: "automatizaciones",        unico: 80000,  basico: 4500, mantenimiento: 15000 },
  { nombre: "Integraciones",            slug: "integraciones",           unico: 50000,  basico: 3500, mantenimiento: 10000 },
]

async function seed() {
  const results: { slug: string; unicoId: string; basicoId: string; mantId: string }[] = []

  for (const s of servicios) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`  ${s.nombre}`)
    console.log(`${"=".repeat(50)}`)

    const pUnico = await polar.products.create({
      name: `${s.nombre} - Pago Único`,
      description: `Pago único por ${s.nombre}`,
      prices: [{
        amountType: "fixed",
        priceAmount: s.unico,
      }],
    })

    const pBasico = await polar.products.create({
      name: `${s.nombre} - Plan Básico`,
      description: `Suscripción mensual - Plan Básico de ${s.nombre}`,
      prices: [{
        amountType: "fixed",
        priceAmount: s.basico,
      }],
      recurringInterval: "month",
    })

    const pMant = await polar.products.create({
      name: `${s.nombre} - Plan Mantenimiento`,
      description: `Suscripción mensual - Plan Mantenimiento de ${s.nombre}`,
      prices: [{
        amountType: "fixed",
        priceAmount: s.mantenimiento,
      }],
      recurringInterval: "month",
    })

    const idUnico = (pUnico.prices as any[])[0]?.id ?? "?"
    const idBasico = (pBasico.prices as any[])[0]?.id ?? "?"
    const idMant = (pMant.prices as any[])[0]?.id ?? "?"

    console.log(`  Producto Único:     ${pUnico.id} — Price ${idUnico} — $${(s.unico / 100).toFixed(2)}`)
    console.log(`  Producto Básico:    ${pBasico.id} — Price ${idBasico} — $${(s.basico / 100).toFixed(2)}/mes`)
    console.log(`  Producto Mant.:     ${pMant.id} — Price ${idMant} — $${(s.mantenimiento / 100).toFixed(2)}/mes`)

    results.push({ slug: s.slug, unicoId: pUnico.id, basicoId: pBasico.id, mantId: pMant.id })
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log("  COMPLETADO — Copiá los product IDs al Prisma")
  console.log("")
  for (const r of results) {
    console.log(`${r.slug}:`)
    console.log(`  polarProductIdUnico:         "${r.unicoId}"`)
    console.log(`  polarProductIdBasico:         "${r.basicoId}"`)
    console.log(`  polarProductIdMantenimiento:  "${r.mantId}"`)
    console.log("")
  }
  console.log(`${"=".repeat(50)}`)
}

seed().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})
