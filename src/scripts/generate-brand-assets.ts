/**
 * Genera assets de marca: favicon-32.png y og-image.png (1200x630)
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/generate-brand-assets.ts
 */
import sharp from "sharp"

function ogSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="gt" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f6f5f8"/>
      <stop offset="1" stop-color="#c9c3ff"/>
    </linearGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <rect x="6" y="6" width="3" height="3" rx="1" fill="rgba(255,255,255,0.05)"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="#0b0913"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <circle cx="170" cy="130" r="220" fill="rgba(139,92,246,0.14)"/>
  <circle cx="1040" cy="540" r="250" fill="rgba(34,211,238,0.1)"/>
  <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>

  <rect x="76" y="84" width="15" height="15" rx="3" fill="url(#g)"/>
  <rect x="96" y="84" width="15" height="15" rx="3" fill="url(#g)" opacity="0.5"/>
  <text x="124" y="98" font-family="Consolas, monospace" font-size="24" letter-spacing="6" fill="#b9a6ff" font-weight="700">PIXELARCH</text>

  <text x="76" y="270" font-family="Segoe UI, Arial, sans-serif" font-size="62" font-weight="700" fill="url(#gt)">Software y la red</text>
  <text x="76" y="344" font-family="Segoe UI, Arial, sans-serif" font-size="62" font-weight="700" fill="url(#gt)">que lo sostiene</text>
  <rect x="76" y="384" width="150" height="5" rx="2.5" fill="url(#g)"/>

  <text x="76" y="450" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#a29cb3">Desarrollo web · Chatbots · Agentes de IA</text>
  <text x="76" y="490" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#a29cb3">Automatizaciones · Infraestructura monitoreada</text>

  <text x="76" y="566" font-family="Consolas, monospace" font-size="19" letter-spacing="2" fill="#645f74">pixelarch.dev</text>

  <g transform="translate(880, 200)">
    <rect x="0" y="0" width="240" height="70" rx="14" fill="rgba(139,92,246,0.14)" stroke="rgba(139,92,246,0.4)" stroke-width="1.5"/>
    <text x="24" y="44" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="#f6f5f8">⚡ Automatización</text>
    <rect x="0" y="90" width="240" height="70" rx="14" fill="rgba(34,211,238,0.1)" stroke="rgba(34,211,238,0.35)" stroke-width="1.5"/>
    <text x="24" y="134" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="#f6f5f8">🧠 Agentes de IA</text>
    <rect x="0" y="180" width="240" height="70" rx="14" fill="rgba(52,211,153,0.1)" stroke="rgba(52,211,153,0.35)" stroke-width="1.5"/>
    <text x="24" y="224" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="#f6f5f8">🛡️ Infra + monitoreo</text>
  </g>
</svg>`
}

async function run() {
  const favicon = await sharp("public/favicon.png").resize(32, 32).png().toBuffer()
  await sharp(favicon).toFile("public/favicon-32.png")
  console.log("OK  public/favicon-32.png (32x32)")

  const og = await sharp(Buffer.from(ogSvg())).png().toBuffer()
  await sharp(og).toFile("public/og-image.png")
  console.log("OK  public/og-image.png (1200x630)")
}

run().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})