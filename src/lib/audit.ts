export interface AuditFinding {
  type: "ok" | "warn" | "fail"
  text: string
}

export interface AuditScores {
  velocidad: number
  ssl: number
  seo: number
  seguridad: number
}

export interface AuditData {
  finalUrl: string
  status: number
  redirects: boolean
  ttfbMs: number
  totalMs: number
  htmlKb: number
  title: string | null
  metaDescription: string | null
  hasViewport: boolean
  h1Count: number
  lang: string | null
  imgCount: number
  imgNoAlt: number
  https: boolean
  certDaysLeft: number | null
  headers: {
    hsts: boolean
    csp: boolean
    xfo: boolean
    xcto: boolean
    referrer: boolean
  }
}

export function normalizeUrl(input: string): string | null {
  let raw = input.trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw
  try {
    const u = new URL(raw)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    if (!u.hostname.includes(".")) return null
    if (u.hostname.length > 253) return null
    return u.toString()
  } catch {
    return null
  }
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
  }
  if (h.includes(":")) return true
  return false
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function computeScores(data: AuditData): AuditScores {
  let velocidad = 25
  if (data.totalMs <= 800) velocidad = 100
  else if (data.totalMs <= 1500) velocidad = 90
  else if (data.totalMs <= 2500) velocidad = 75
  else if (data.totalMs <= 4000) velocidad = 60
  else if (data.totalMs <= 7000) velocidad = 40
  if (data.htmlKb > 1000) velocidad -= 20
  else if (data.htmlKb > 500) velocidad -= 10

  let ssl = 15
  if (data.https) {
    ssl = 80
    if (data.certDaysLeft !== null && data.certDaysLeft > 14) ssl += 10
    if (data.headers.hsts) ssl += 10
    if (data.certDaysLeft !== null && data.certDaysLeft < 7) ssl = Math.min(ssl, 40)
  }

  let seo = 0
  if (data.title) seo += 30
  if (data.metaDescription) seo += 25
  if (data.h1Count === 1) seo += 20
  else if (data.h1Count > 1) seo += 10
  if (data.hasViewport) seo += 15
  if (data.lang) seo += 10

  const headerCount =
    (data.headers.hsts ? 1 : 0) +
    (data.headers.csp ? 1 : 0) +
    (data.headers.xfo ? 1 : 0) +
    (data.headers.xcto ? 1 : 0) +
    (data.headers.referrer ? 1 : 0)
  let seguridad = headerCount * 20
  if (!data.https) seguridad = Math.min(seguridad, 40)

  return {
    velocidad: clamp(velocidad),
    ssl: clamp(ssl),
    seo: clamp(seo),
    seguridad: clamp(seguridad),
  }
}

export function buildFindings(data: AuditData): AuditFinding[] {
  const f: AuditFinding[] = []

  if (data.https) {
    f.push({ type: "ok", text: "HTTPS activo y funcionando." })
  } else {
    f.push({ type: "fail", text: "Sin HTTPS: los navegadores muestran el sitio como \"no seguro\" y Google lo penaliza." })
  }

  if (data.certDaysLeft !== null) {
    if (data.certDaysLeft < 7) {
      f.push({ type: "fail", text: `El certificado SSL vence en ${data.certDaysLeft} días — renovalo ya.` })
    } else if (data.certDaysLeft < 21) {
      f.push({ type: "warn", text: `El certificado SSL vence en ${data.certDaysLeft} días. Conviene renovarlo pronto.` })
    } else {
      f.push({ type: "ok", text: `Certificado SSL válido por ${data.certDaysLeft} días.` })
    }
  }

  if (data.totalMs <= 2500) {
    f.push({ type: "ok", text: `El sitio respondió en ${data.totalMs} ms.` })
  } else if (data.totalMs <= 5000) {
    f.push({ type: "warn", text: `El sitio tardó ${data.totalMs} ms en responder — se puede mejorar.` })
  } else {
    f.push({ type: "fail", text: `El sitio tardó ${data.totalMs} ms en responder — la mitad de los visitantes móviles se va antes de los 4 segundos.` })
  }

  if (data.htmlKb > 500) {
    f.push({ type: "warn", text: `El HTML pesa ${data.htmlKb} KB — hay margen para optimizar.` })
  }

  if (!data.title) {
    f.push({ type: "fail", text: "Falta el título de la página (<title>): afecta cómo te muestra Google." })
  } else if (data.title.length > 60) {
    f.push({ type: "warn", text: `El título tiene ${data.title.length} caracteres — Google corta alrededor de 60.` })
  } else {
    f.push({ type: "ok", text: `Título presente: “${data.title}”.` })
  }

  if (!data.metaDescription) {
    f.push({ type: "warn", text: "Falta la meta description: Google arma el resumen solo y puede no ser el que querés." })
  }

  if (data.h1Count === 0) {
    f.push({ type: "warn", text: "No hay ningún H1 en la página — conviene uno principal claro." })
  } else if (data.h1Count > 1) {
    f.push({ type: "warn", text: `Hay ${data.h1Count} H1 en la página — conviene dejar uno solo.` })
  }

  if (!data.hasViewport) {
    f.push({ type: "fail", text: "Falta la meta viewport: en celulares el sitio se ve mal (zoom y desbordes)." })
  }

  if (data.imgNoAlt > 0) {
    f.push({ type: "warn", text: `${data.imgNoAlt} de ${data.imgCount} imágenes sin texto alternativo (accesibilidad y SEO).` })
  }

  if (!data.headers.hsts) f.push({ type: "warn", text: "Falta HSTS: obliga a los navegadores a usar siempre HTTPS." })
  if (!data.headers.csp) f.push({ type: "warn", text: "Falta Content-Security-Policy: la defensa principal contra inyección de scripts." })
  if (!data.headers.xfo) f.push({ type: "warn", text: "Falta X-Frame-Options: tu sitio puede embeberse en iframes ajenos (clickjacking)." })
  if (!data.headers.xcto) f.push({ type: "warn", text: "Falta X-Content-Type-Options: los navegadores pueden interpretar archivos con el tipo equivocado." })

  if (data.redirects) {
    f.push({ type: "ok", text: `El sitio redirige correctamente a ${data.finalUrl}.` })
  }

  return f.slice(0, 14)
}