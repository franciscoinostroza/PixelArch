import type { MetadataRoute } from "next"
import { sanityFetch } from "@/lib/sanity"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_URL || "https://pixelarch.com"

  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/productos`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/gracias`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/terminos`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/privacidad`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/reembolsos`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ]

  const slugs = await sanityFetch<{ slug: string }[]>(
    `*[_type == "servicio" && defined(slug.current)]{ "slug": slug.current }`
  )

  if (slugs) {
    for (const s of slugs) {
      entries.push({
        url: `${baseUrl}/productos/${s.slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.6,
      })
    }
  }

  return entries
}
