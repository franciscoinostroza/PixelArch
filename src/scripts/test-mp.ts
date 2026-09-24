/**
 * Prueba de generacion de link de pago de Mercado Pago.
 * Usa el token de MP_ACCESS_TOKEN (prueba o produccion segun .env.local)
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/test-mp.ts [montoARS] [suscripcionId] [meses]
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { crearLinkDePago } from "../lib/mercadopago"

async function run() {
  const monto = Number(process.argv[2] || 100)
  const suscripcionId = process.argv[3] || `test-${Date.now()}`
  const meses = Number(process.argv[4] || 1)
  const token = process.env.MP_ACCESS_TOKEN || ""

  console.log("Token:", token.slice(0, 9) + "... (" + token.length + " chars)")
  console.log("Monto: $" + monto + " ARS | suscripcion:", suscripcionId, "| meses:", meses, "\n")

  const link = await crearLinkDePago({
    externalReference: suscripcionId,
    titulo: "Prueba PixelArch",
    montoArsCents: Math.round(monto * 100),
    metadata: { tipo: "soporte", meses },
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