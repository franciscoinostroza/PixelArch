/**
 * Reemplaza las portadas generadas por FOTOS REALES (Unsplash + Wikimedia Commons)
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/regenerate-covers-real.ts
 * Requiere SANITY_API_TOKEN en .env.local
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient } from "@sanity/client"
import sharp from "sharp"

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

interface CoverSource {
  url: string
  credit: string
  needUA: boolean
}

const COVERS: Record<string, CoverSource> = {
  "landing-pages-que-convierten": {
    url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Carlos Muza (Unsplash)",
    needUA: false,
  },
  "que-es-un-agente-de-ia": {
    url: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Unsplash",
    needUA: false,
  },
  "5-tareas-para-automatizar": {
    url: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Andy Kelly (Unsplash)",
    needUA: false,
  },
  "hosting-compartido-vs-gestionado": {
    url: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Taylor Vick (Unsplash)",
    needUA: false,
  },
  "como-cobrar-online-argentina-chile": {
    url: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Unsplash",
    needUA: false,
  },
  "monitoreo-24-7": {
    url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80&auto=format&fit=crop",
    credit: "Foto: Luke Chesser (Unsplash)",
    needUA: false,
  },
  "como-elegir-el-disco-de-tu-notebook": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/2023_Dysk_SSD_Kingston_NV2_2TB.jpg/1280px-2023_Dysk_SSD_Kingston_NV2_2TB.jpg",
    credit: "Foto: Wikimedia Commons (CC)",
    needUA: true,
  },
}

async function download(url: string, needUA: boolean): Promise<Buffer> {
  const headers: Record<string, string> = {
    Accept: "image/*",
  }
  if (needUA) headers["User-Agent"] = "PixelArchBot/1.0 (hola@pixelarch.dev)"
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(buf).metadata()
  if (!meta.width || !meta.height) throw new Error("No es una imagen valida")
  return buf
}

async function run() {
  console.log("Conectando a Sanity...\n")

  for (const [slug, src] of Object.entries(COVERS)) {
    const doc = await client.fetch(`*[_type == "articulo" && slug.current == $slug][0]{_id, titulo}`, { slug })
    if (!doc) {
      console.log(`SKIP  ${slug} (no existe)`)
      continue
    }

    try {
      const buf = await download(src.url, src.needUA)
      const mime = (await sharp(buf).metadata()).format === "png" ? "image/png" : "image/jpeg"
      const asset = await client.assets.upload("image", buf, {
        contentType: mime,
        filename: `${slug}-cover.${mime === "image/png" ? "png" : "jpg"}`,
      })
      await client
        .patch(doc._id)
        .set({
          portada: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
          og_image: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
        })
        .commit()
      console.log(`OK    ${slug} (${src.credit})`)
    } catch (e) {
      console.log(`FAIL  ${slug}: ${(e as Error).message}`)
    }
  }

  console.log("\nListo. Revisa https://pixelarch.dev/blog")
}

run().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})