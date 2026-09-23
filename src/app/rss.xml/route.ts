import { sanityFetch } from "@/lib/sanity"

export const revalidate = 3600

const ARTICULOS_QUERY = `*[_type == "articulo" && activo == true] | order(fecha desc)[0...50] {
  titulo,
  "slug": slug.current,
  descripcion,
  fecha,
  "portada": portada.asset->url
}`

interface ArticuloRss {
  titulo: string
  slug: string
  descripcion?: string
  fecha?: string
  portada?: string
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"
  const articulos = (await sanityFetch<ArticuloRss[]>(ARTICULOS_QUERY)) || []

  const now = new Date().toUTCString()

  const items = articulos
    .map((a) => {
      const url = `${base}/blog/${a.slug}`
      const pubDate = a.fecha ? new Date(a.fecha + "T12:00:00Z").toUTCString() : now
      return `    <item>
      <title>${escapeXml(a.titulo)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
${a.descripcion ? `      <description>${escapeXml(a.descripcion)}</description>\n` : ""}${a.portada ? `      <enclosure url="${escapeXml(a.portada)}" type="image/jpeg" />\n` : ""}    </item>`
    })
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/rss.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog — PixelArch</title>
    <link>${escapeXml(`${base}/blog`)}</link>
    <description>Artículos sobre desarrollo web, chatbots, agentes de IA, automatizaciones e infraestructura.</description>
    <language>es</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}