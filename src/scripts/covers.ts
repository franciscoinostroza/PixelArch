/**
 * Generador de portadas SVG para articulos del blog de PixelArch.
 * Cada slug tiene una ilustracion propia dibujada con primitivas.
 */

function wrapTitle(title: string, max = 26): string[] {
  const words = title.split(" ")
  const lines: string[] = []
  let current = ""
  for (const w of words) {
    if ((current + " " + w).trim().length > max) {
      if (current) lines.push(current)
      current = w
    } else {
      current = (current + " " + w).trim()
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 4)
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/* Ilustraciones: cada una ocupa la zona x 80..560, y 200..600 */

function motifLanding(): string {
  return `
  <rect x="150" y="250" width="380" height="300" rx="16" fill="#0f0d1a" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
  <rect x="150" y="250" width="380" height="40" rx="16" fill="rgba(255,255,255,0.05)"/>
  <rect x="150" y="278" width="380" height="12" fill="rgba(255,255,255,0.05)"/>
  <circle cx="178" cy="270" r="5" fill="#ff6259"/>
  <circle cx="196" cy="270" r="5" fill="#ffbd2e"/>
  <circle cx="214" cy="270" r="5" fill="#28c93f"/>
  <rect x="178" y="318" width="324" height="88" rx="12" fill="url(#g)" opacity="0.9"/>
  <rect x="178" y="318" width="200" height="20" rx="6" fill="#07060c" opacity="0.45"/>
  <rect x="178" y="350" width="150" height="12" rx="6" fill="#07060c" opacity="0.35"/>
  <rect x="178" y="370" width="110" height="22" rx="8" fill="#07060c" opacity="0.5"/>
  <rect x="178" y="436" width="324" height="10" rx="5" fill="rgba(255,255,255,0.12)"/>
  <rect x="178" y="458" width="240" height="10" rx="5" fill="rgba(255,255,255,0.08)"/>
  <rect x="178" y="480" width="290" height="10" rx="5" fill="rgba(255,255,255,0.08)"/>
  <path d="M470 300 l26 14 -26 14 z" fill="url(#g)"/>
  <circle cx="470" cy="300" r="18" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>`
}

function motifAgente(): string {
  return `
  <line x1="220" y1="300" x2="330" y2="260" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <line x1="330" y1="260" x2="440" y2="330" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <line x1="440" y1="330" x2="330" y2="430" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <line x1="330" y1="430" x2="210" y2="420" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <line x1="210" y1="420" x2="220" y2="300" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <line x1="330" y1="260" x2="330" y2="430" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
  <circle cx="220" cy="300" r="26" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="440" cy="330" r="26" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="210" cy="420" r="26" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="330" cy="430" r="26" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="330" cy="260" r="26" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="330" cy="340" r="52" fill="url(#g)" opacity="0.95"/>
  <circle cx="330" cy="340" r="16" fill="#07060c"/>
  <path d="M480 210 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6 z" fill="#22d3ee"/>
  <circle cx="140" cy="520" r="8" fill="#8b5cf6" opacity="0.7"/>
  <circle cx="500" cy="520" r="6" fill="#22d3ee" opacity="0.6"/>`
}

function motifAutomatizaciones(): string {
  return `
  <rect x="150" y="290" width="100" height="100" rx="18" fill="url(#g)" opacity="0.95"/>
  <rect x="150" y="320" width="100" height="14" rx="7" fill="#07060c" opacity="0.45"/>
  <rect x="150" y="344" width="64" height="10" rx="5" fill="#07060c" opacity="0.35"/>
  <rect x="310" y="290" width="100" height="100" rx="18" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <rect x="310" y="320" width="100" height="14" rx="7" fill="rgba(255,255,255,0.14)"/>
  <rect x="310" y="344" width="64" height="10" rx="5" fill="rgba(255,255,255,0.1)"/>
  <rect x="470" y="290" width="100" height="100" rx="18" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <rect x="470" y="320" width="100" height="14" rx="7" fill="rgba(255,255,255,0.14)"/>
  <rect x="470" y="344" width="64" height="10" rx="5" fill="rgba(255,255,255,0.1)"/>
  <path d="M262 340 h34 M296 340 l-12 -10 M296 340 l-12 10" stroke="#22d3ee" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M422 340 h34 M456 340 l-12 -10 M456 340 l-12 10" stroke="#8b5cf6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M345 500 l-34 34 10 -28 -22 2 36 -40 -10 30 20 -2 z" fill="url(#g)"/>
  <circle cx="190" cy="520" r="7" fill="rgba(255,255,255,0.3)"/>
  <circle cx="440" cy="530" r="5" fill="rgba(255,255,255,0.25)"/>`
}

function motifHosting(): string {
  return `
  <rect x="170" y="230" width="300" height="340" rx="18" fill="#0f0d1a" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
  <rect x="170" y="230" width="300" height="44" rx="18" fill="rgba(255,255,255,0.05)"/>
  <rect x="170" y="262" width="300" height="12" fill="rgba(255,255,255,0.05)"/>
  <rect x="196" y="296" width="248" height="52" rx="10" fill="#141020" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  <circle cx="220" cy="322" r="7" fill="#34d399"/>
  <circle cx="244" cy="322" r="7" fill="#34d399"/>
  <rect x="282" y="312" width="62" height="8" rx="4" fill="rgba(255,255,255,0.16)"/>
  <rect x="360" y="312" width="62" height="8" rx="4" fill="rgba(255,255,255,0.1)"/>
  <rect x="196" y="364" width="248" height="52" rx="10" fill="#141020" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  <circle cx="220" cy="390" r="7" fill="#34d399"/>
  <circle cx="244" cy="390" r="7" fill="#34d399"/>
  <rect x="282" y="380" width="62" height="8" rx="4" fill="rgba(255,255,255,0.16)"/>
  <rect x="360" y="380" width="62" height="8" rx="4" fill="rgba(255,255,255,0.1)"/>
  <rect x="196" y="432" width="248" height="52" rx="10" fill="#141020" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  <circle cx="220" cy="458" r="7" fill="#ffbd2e"/>
  <circle cx="244" cy="458" r="7" fill="#ff6259"/>
  <rect x="282" y="448" width="62" height="8" rx="4" fill="rgba(255,255,255,0.16)"/>
  <rect x="360" y="448" width="62" height="8" rx="4" fill="rgba(255,255,255,0.1)"/>
  <path d="M320 530 l14 20 14 -20 z" fill="#ff6259"/>`
}

function motifCobros(): string {
  return `
  <rect x="140" y="260" width="380" height="220" rx="22" fill="#141020" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <rect x="140" y="260" width="380" height="60" rx="22" fill="rgba(255,255,255,0.06)"/>
  <rect x="180" y="310" width="52" height="38" rx="7" fill="url(#g)"/>
  <circle cx="452" cy="330" r="24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <rect x="140" y="414" width="380" height="66" rx="0" fill="rgba(255,255,255,0.04)"/>
  <text x="180" y="456" font-family="Consolas, monospace" font-size="30" font-weight="700" fill="#f6f5f8">54&#160;&#160;00</text>
  <text x="460" y="456" text-anchor="end" font-family="Consolas, monospace" font-size="26" fill="rgba(246,245,248,0.6)">VISA</text>
  <circle cx="240" cy="540" r="42" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="240" y="552" text-anchor="middle" font-family="Consolas, monospace" font-size="30" font-weight="700" fill="#22d3ee">$</text>
  <circle cx="420" cy="540" r="42" fill="url(#g)" opacity="0.9"/>
  <text x="420" y="552" text-anchor="middle" font-family="Consolas, monospace" font-size="26" font-weight="700" fill="#07060c">US$</text>
  <path d="M296 540 h68 M364 540 l-12 -10 M364 540 l-12 10" stroke="#8b5cf6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
}

function motifMonitoreo(): string {
  return `
  <rect x="140" y="240" width="380" height="280" rx="18" fill="#0f0d1a" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
  <rect x="140" y="240" width="380" height="38" rx="18" fill="rgba(255,255,255,0.05)"/>
  <rect x="140" y="266" width="380" height="12" fill="rgba(255,255,255,0.05)"/>
  <circle cx="170" cy="259" r="4" fill="#ff6259"/>
  <circle cx="186" cy="259" r="4" fill="#ffbd2e"/>
  <circle cx="202" cy="259" r="4" fill="#28c93f"/>
  <polyline points="176,430 216,430 236,380 256,460 276,340 296,470 316,300 336,420 356,390 376,410 396,360 416,440 436,410 456,420 484,420" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="484" cy="420" r="10" fill="#22d3ee"/>
  <circle cx="484" cy="420" r="20" fill="none" stroke="rgba(34,211,238,0.4)" stroke-width="2"/>
  <circle cx="484" cy="420" r="30" fill="none" stroke="rgba(34,211,238,0.18)" stroke-width="2"/>
  <text x="176" y="330" font-family="Consolas, monospace" font-size="15" fill="rgba(246,245,248,0.4)">uptime: 99.9%</text>
  <text x="176" y="356" font-family="Consolas, monospace" font-size="15" fill="rgba(246,245,248,0.4)">ssl: ok</text>`
}

function motifDiscos(): string {
  return `
  <rect x="150" y="240" width="330" height="62" rx="9" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <rect x="150" y="248" width="10" height="46" rx="3" fill="#0b0913"/>
  <rect x="200" y="264" width="130" height="14" rx="4" fill="url(#g)" opacity="0.9"/>
  <text x="200" y="290" font-family="Consolas, monospace" font-size="13" fill="rgba(246,245,248,0.6)">M.2 NVMe · 2280</text>
  <rect x="150" y="352" width="260" height="88" rx="12" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <rect x="172" y="374" width="60" height="12" rx="4" fill="rgba(255,255,255,0.16)"/>
  <rect x="172" y="396" width="90" height="12" rx="4" fill="rgba(255,255,255,0.1)"/>
  <text x="172" y="426" font-family="Consolas, monospace" font-size="15" fill="#7de3f5">SSD 2.5" · SATA</text>
  <rect x="150" y="490" width="260" height="110" rx="14" fill="#141020" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="280" cy="545" r="34" fill="#0f0d1a" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <circle cx="280" cy="545" r="8" fill="rgba(255,255,255,0.3)"/>
  <line x1="280" y1="511" x2="312" y2="533" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="172" y="584" font-family="Consolas, monospace" font-size="15" fill="#fbbf24">HDD 2.5" · SATA</text>
  <rect x="330" y="270" width="90" height="6" rx="3" fill="rgba(255,255,255,0.08)"/>
  <rect x="330" y="270" width="86" height="6" rx="3" fill="url(#g)"/>
  <text x="330" y="296" font-family="Consolas, monospace" font-size="14" fill="#7de3f5">7.000 MB/s</text>
  <rect x="330" y="382" width="90" height="6" rx="3" fill="rgba(255,255,255,0.08)"/>
  <rect x="330" y="382" width="60" height="6" rx="3" fill="#22d3ee"/>
  <text x="330" y="408" font-family="Consolas, monospace" font-size="14" fill="#7de3f5">550 MB/s</text>
  <rect x="330" y="520" width="90" height="6" rx="3" fill="rgba(255,255,255,0.08)"/>
  <rect x="330" y="520" width="32" height="6" rx="3" fill="#fbbf24"/>
  <text x="330" y="546" font-family="Consolas, monospace" font-size="14" fill="#fbbf24">160 MB/s</text>`
}

const MOTIFS: Record<string, () => string> = {
  "landing-pages-que-convierten": motifLanding,
  "que-es-un-agente-de-ia": motifAgente,
  "5-tareas-para-automatizar": motifAutomatizaciones,
  "hosting-compartido-vs-gestionado": motifHosting,
  "como-cobrar-online-argentina-chile": motifCobros,
  "monitoreo-24-7": motifMonitoreo,
  "como-elegir-el-disco-de-tu-notebook": motifDiscos,
}

export function coverSvg(slug: string, title: string): string {
  const lines = wrapTitle(title)
  const fontSize = lines.length > 3 ? 46 : lines.length > 2 ? 54 : 62
  const lineHeight = fontSize + 16
  const startY = 340
  const text = lines
    .map(
      (l, i) =>
        `<text x="640" y="${startY + i * lineHeight}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#f6f5f8">${escapeXml(l)}</text>`
    )
    .join("")
  const motif = (MOTIFS[slug] || motifAgente)()

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <rect x="6" y="6" width="3" height="3" rx="1" fill="rgba(255,255,255,0.05)"/>
    </pattern>
  </defs>
  <rect width="1200" height="800" fill="#0b0913"/>
  <rect width="1200" height="800" fill="url(#grid)"/>
  <circle cx="170" cy="150" r="240" fill="rgba(139,92,246,0.13)"/>
  <circle cx="1030" cy="660" r="260" fill="rgba(34,211,238,0.1)"/>
  <rect x="40" y="40" width="1120" height="720" rx="28" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  <rect x="76" y="84" width="14" height="14" rx="3" fill="url(#g)"/>
  <rect x="96" y="84" width="14" height="14" rx="3" fill="url(#g)" opacity="0.5"/>
  <text x="126" y="98" font-family="Consolas, monospace" font-size="24" letter-spacing="6" fill="#b9a6ff" font-weight="700">PIXELARCH</text>
  <text x="126" y="130" font-family="Consolas, monospace" font-size="16" letter-spacing="4" fill="#645f74">BLOG</text>
  ${motif}
  ${text}
  <rect x="640" y="${startY + lines.length * lineHeight + 14}" width="150" height="4" rx="2" fill="url(#g)"/>
  <text x="640" y="712" font-family="Consolas, monospace" font-size="18" letter-spacing="2" fill="#645f74">pixelarch.dev</text>
</svg>`
}