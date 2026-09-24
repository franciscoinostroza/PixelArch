/**
 * Prueba de generacion de link de pago de Mercado Pago.
 * Usa el token de MP_ACCESS_TOKEN (prueba o produccion segun .env.local)
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/test-mp.ts [montoARS]
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { crearLinkDePago } from "../lib/mercadopago"

async function run() {
  const monto = Number(process.argv[2] || 100)
  const token = process.env.MP_ACCESS_TOKEN || ""

  console.log("Token:", token.slice(0, 9) + "... (" + token.length + " chars)")
  console.log("Monto: $" + monto + " ARS\n")

  const link = await crearLinkDePago({
    suscripcionId: `test-${Date.now()}`,
    titulo: "Prueba PixelArch",
    montoArsCents: Math.round(monto * 100),
    meses: 1,
  })

  if (!link) {
    console.error("No se pudo crear el link (falta MP_ACCESS_TOKEN?)")
    process.exit(1)
  }

  console.log("Preference:", link.preferenceId)
  console.log("Link:", link.url)
}

run().catch((e) => {
  console.error("Error:", e?.message || e)
  process.exit(1)
})