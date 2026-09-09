/**
 * Regenera las portadas de los articulos del blog (ilustraciones por tema)
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/regenerate-covers.ts
 * Requiere SANITY_API_TOKEN en .env.local
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient } from "@sanity/client"
import sharp from "sharp"
import { coverSvg } from "./covers"

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

const SLUGS = [
  "landing-pages-que-convierten",
  "que-es-un-agente-de-ia",
  "5-tareas-para-automatizar",
  "hosting-compartido-vs-gestionado",
  "como-cobrar-online-argentina-chile",
  "monitoreo-24-7",
]

async function run() {
  console.log("Conectando a Sanity...\n")

  for (const slug of SLUGS) {
    const doc = await client.fetch(
      `*[_type == "articulo" && slug.current == $slug][0]{_id, titulo}`,
      { slug }
    )
    if (!doc) {
      console.log(`SKIP  ${slug} (no existe)`)
      continue
    }

    const svg = coverSvg(slug, doc.titulo)
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const asset = await client.assets.upload("image", png, {
      contentType: "image/png",
      filename: `${slug}-cover.png`,
    })

    await client
      .patch(doc._id)
      .set({
        portada: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
        og_image: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
      })
      .commit()

    console.log(`OK    ${slug}`)
  }

  console.log("\nListo. Revisa https://pixelarch.dev/blog")
}

run().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})