/**
 * T-05 (AC-14, AC-19; RF-14, RF-19, RF-22): normalizacion y extraccion de
 * datos publicados.
 *
 * Modulo puro: no toca Prisma, red, entorno ni proveedores. No adivina emails
 * por patron (`nombre@dominio`), no completa datos que la pagina no publica y
 * no usa IA. `normalizarEmail` solo aplica trim + lowercase y valida sintaxis;
 * las reglas de "ruido" (no-reply, example.com, sentry, imagenes) viven en la
 * extraccion.
 */

const MAX_EMAIL = 254
const MAX_LOCAL = 64
const MAX_DOMINIO = 253
const MAX_NOMBRE = 120

/**
 * Sufijos de segundo nivel mas comunes. `dominioRegistrable` los trata como un
 * unico sufijo publico: nunca devuelve `com.ar` ni `co.uk` solos, porque no son
 * dominios de negocio registrables.
 *
 * Es una lista curada, no la Public Suffix List completa. Para un sufijo
 * multiparte no listado se usan las dos ultimas etiquetas; alcanza para el
 * alcance B2B del portal sin agregar una dependencia.
 */
const SUFIJOS_MULTIPARTE = new Set<string>([
  // Argentina
  "com.ar",
  "net.ar",
  "org.ar",
  "gob.ar",
  "edu.ar",
  "int.ar",
  "mil.ar",
  "tur.ar",
  // Brasil
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "art.br",
  "blog.br",
  "eng.br",
  "med.br",
  "adv.br",
  "jus.br",
  "leg.br",
  // Reino Unido
  "co.uk",
  "org.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "net.uk",
  "ac.uk",
  "gov.uk",
  "nhs.uk",
  "police.uk",
  "mod.uk",
  "sch.uk",
  // Mexico, Colombia
  "com.mx",
  "net.mx",
  "org.mx",
  "gob.mx",
  "edu.mx",
  "com.co",
  "net.co",
  "org.co",
  "gov.co",
  "edu.co",
  "nom.co",
  // Peru, Uruguay, Paraguay, Bolivia, Ecuador, Venezuela
  "com.pe",
  "net.pe",
  "org.pe",
  "gob.pe",
  "edu.pe",
  "nom.pe",
  "com.uy",
  "net.uy",
  "org.uy",
  "gub.uy",
  "edu.uy",
  "com.py",
  "net.py",
  "org.py",
  "gov.py",
  "edu.py",
  "com.bo",
  "net.bo",
  "org.bo",
  "gov.bo",
  "edu.bo",
  "com.ec",
  "net.ec",
  "org.ec",
  "gov.ec",
  "edu.ec",
  "med.ec",
  "com.ve",
  "net.ve",
  "org.ve",
  "gov.ve",
  "edu.ve",
  // Espana
  "com.es",
  "nom.es",
  "org.es",
  "gob.es",
  "edu.es",
  // Centroamerica y Caribe
  "com.gt",
  "net.gt",
  "org.gt",
  "gob.gt",
  "edu.gt",
  "com.sv",
  "net.sv",
  "org.sv",
  "gob.sv",
  "edu.sv",
  "com.hn",
  "net.hn",
  "org.hn",
  "gob.hn",
  "edu.hn",
  "com.ni",
  "net.ni",
  "org.ni",
  "gob.ni",
  "edu.ni",
  "com.pa",
  "net.pa",
  "org.pa",
  "gob.pa",
  "edu.pa",
  "com.do",
  "net.do",
  "org.do",
  "gob.do",
  "edu.do",
  "com.pr",
  "net.pr",
  "org.pr",
  "gov.pr",
  "edu.pr",
  "co.cr",
  "or.cr",
  "ac.cr",
  "go.cr",
  "ed.cr",
  "com.cu",
  "net.cu",
  "org.cu",
  "gov.cu",
  "edu.cu",
  "com.ht",
  "com.jm",
  "com.tt",
  "com.bb",
  // Canada (provincias) y Australia / Nueva Zelanda / Sudafrica
  "on.ca",
  "qc.ca",
  "bc.ca",
  "ab.ca",
  "mb.ca",
  "sk.ca",
  "ns.ca",
  "nb.ca",
  "nl.ca",
  "pe.ca",
  "nt.ca",
  "nu.ca",
  "yt.ca",
  "gc.ca",
  "com.au",
  "net.au",
  "org.au",
  "gov.au",
  "edu.au",
  "id.au",
  "asn.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  "ac.nz",
  "geek.nz",
  "school.nz",
  "co.za",
  "net.za",
  "org.za",
  "gov.za",
  "ac.za",
  // Asia
  "co.jp",
  "ne.jp",
  "or.jp",
  "go.jp",
  "ac.jp",
  "ad.jp",
  "ed.jp",
  "gr.jp",
  "lg.jp",
  "co.in",
  "net.in",
  "org.in",
  "gen.in",
  "firm.in",
  "ind.in",
  "gov.in",
  "ac.in",
  "edu.in",
  "res.in",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "ac.cn",
  "com.hk",
  "net.hk",
  "org.hk",
  "gov.hk",
  "edu.hk",
  "idv.hk",
  "com.sg",
  "net.sg",
  "org.sg",
  "gov.sg",
  "edu.sg",
  "per.sg",
  "co.kr",
  "ne.kr",
  "or.kr",
  "re.kr",
  "pe.kr",
  "go.kr",
  "ac.kr",
  "com.tr",
  "net.tr",
  "org.tr",
  "gov.tr",
  "edu.tr",
  "av.tr",
  "bel.tr",
  "biz.tr",
  "info.tr",
  // Europa del Este y otros
  "com.ru",
  "net.ru",
  "org.ru",
  "gov.ru",
  "edu.ru",
  "msk.ru",
  "spb.ru",
  "com.ua",
  "net.ua",
  "org.ua",
  "gov.ua",
  "edu.ua",
  "in.ua",
  "com.pl",
  "net.pl",
  "org.pl",
  "gov.pl",
  "edu.pl",
  "info.pl",
  "biz.pl",
  "co.il",
  "org.il",
  "net.il",
  "gov.il",
  "ac.il",
  "edu.il",
  "muni.il",
  "co.id",
  "net.id",
  "org.id",
  "web.id",
  "go.id",
  "ac.id",
  "sch.id",
  "com.my",
  "net.my",
  "org.my",
  "gov.my",
  "edu.my",
  "co.th",
  "in.th",
  "ac.th",
  "go.th",
  "net.th",
  "or.th",
  "com.vn",
  "net.vn",
  "org.vn",
  "gov.vn",
  "edu.vn",
  "com.ph",
  "net.ph",
  "org.ph",
  "gov.ph",
  "edu.ph",
  "com.pk",
  "net.pk",
  "org.pk",
  "gov.pk",
  "edu.pk",
  "com.eg",
  "net.eg",
  "org.eg",
  "gov.eg",
  "edu.eg",
  "com.ng",
  "net.ng",
  "org.ng",
  "gov.ng",
  "edu.ng",
  "co.ke",
  "or.ke",
  "ne.ke",
  "go.ke",
  "ac.ke",
  "sc.ke",
  "co.ma",
  "net.ma",
  "org.ma",
  "gov.ma",
  "ac.ma",
  "press.ma",
  "com.sa",
  "net.sa",
  "org.sa",
  "gov.sa",
  "edu.sa",
  "med.sa",
  "pub.sa",
  "sch.sa",
  "co.ae",
  "net.ae",
  "org.ae",
  "gov.ae",
  "ac.ae",
  "sch.ae",
  "com.gr",
  "net.gr",
  "org.gr",
  "gov.gr",
  "edu.gr",
  "co.hu",
  "info.hu",
  "org.hu",
  "priv.hu",
  "sport.hu",
  "com.ro",
  "org.ro",
  "tm.ro",
  "nt.ro",
  "nom.ro",
  "info.ro",
  "rec.ro",
  "arts.ro",
  "firm.ro",
  "store.ro",
  "com.bg",
  "net.bg",
  "org.bg",
  "gov.bg",
  "edu.bg",
  "com.hr",
  "from.hr",
  "iz.hr",
  "name.hr",
  "co.rs",
  "org.rs",
  "edu.rs",
  "gov.rs",
  "in.rs",
  "co.at",
  "or.at",
])

/**
 * Proveedores de email publico. Nunca se deduplica ni se suprime por dominio
 * cuando el dominio es uno de estos (spec §7.2 / AC-14).
 */
const PROVEEDORES_PUBLICOS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.es",
  "hotmail.com.ar",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.it",
  "outlook.com",
  "outlook.es",
  "outlook.fr",
  "outlook.com.ar",
  "outlook.co.uk",
  "live.com",
  "live.co.uk",
  "live.com.ar",
  "msn.com",
  "yahoo.com",
  "yahoo.com.ar",
  "yahoo.com.br",
  "yahoo.com.mx",
  "yahoo.es",
  "yahoo.co.uk",
  "yahoo.fr",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "tutanota.com",
  "tuta.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "hushmail.com",
])

/**
 * Marcas globales que actuan como red social, marketplace o agregador. Se
 * compara la primera etiqueta del dominio registrable para cubrir sus variantes
 * por pais (por ejemplo `mercadolibre.com.ar`, `amazon.com.mx`).
 */
const MARCAS_NO_PROSPECTABLES = new Set<string>([
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "twitter",
  "youtube",
  "google",
  "amazon",
  "mercadolibre",
  "mercadolivre",
  "ebay",
  "aliexpress",
  "alibaba",
  "etsy",
  "shopee",
  "temu",
  "wish",
  "booking",
  "tripadvisor",
  "yelp",
  "airbnb",
  "expedia",
  "trivago",
  "kayak",
  "despegar",
  "decolar",
  "agoda",
  "pedidosya",
  "rappi",
  "pinterest",
  "snapchat",
  "reddit",
  "telegram",
  "whatsapp",
  "discord",
  "twitch",
  "vimeo",
  "medium",
])

/**
 * Dominios que no son la web propia del negocio y que no se deben prospectar
 * (redes, link-in-bio, agregadores, directorios y acortadores). Se comparan
 * contra el dominio registrable, no contra el string crudo.
 */
const DOMINIOS_NO_PROSPECTABLES = new Set<string>([
  "fb.com",
  "fb.me",
  "lnkd.in",
  "t.co",
  "youtu.be",
  "t.me",
  "telegram.me",
  "wa.me",
  "threads.net",
  "tumblr.com",
  "vk.com",
  "x.com",
  "linktr.ee",
  "linktree.com",
  "linkin.bio",
  "bio.link",
  "beacons.ai",
  "lnk.bio",
  "komi.io",
  "taplink.cc",
  "linkr.bio",
  "solo.to",
  "hoo.be",
  "allmylinks.com",
  "campsite.bio",
  "snipfeed.co",
  "milkshake.app",
  "stan.store",
  "direct.me",
  "many.link",
  "shor.by",
  "withkoji.com",
  "paginasamarillas.com.ar",
  "paginasamarillas.com",
  "cylex.com.ar",
  "cylex.com",
  "infobel.com",
  "yellowpages.com",
  "foursquare.com",
  "trustpilot.com",
  "wikipedia.org",
  "glassdoor.com",
  "indeed.com",
  "goo.gl",
  "goo.gle",
  "bit.ly",
  "tinyurl.com",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "wixpress.com",
  "sentry.io",
])

/** Dominios de ejemplo/placeholder que no son un contacto real. */
const DOMINIOS_RUIDO = new Set<string>([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "example.com.ar",
  "example.com.br",
  "example.co.uk",
  "example.es",
  "example.com.mx",
  "domain.com",
  "domain.net",
  "tudominio.com",
  "tudominio.com.ar",
  "midominio.com",
  "midominio.com.ar",
  "sudominio.com",
  "test.com",
  "test.org",
  "test.net",
  "test.com.ar",
  "localhost",
])

const TLDS_RESERVADOS = new Set<string>([
  "example",
  "invalid",
  "local",
  "localhost",
  "test",
])

/** TLDs que en realidad son una extension de archivo (`logo@2x.png`). */
const EXTENSIONES_ASSET = new Set<string>([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "bmp",
  "css",
  "js",
  "json",
  "xml",
  "pdf",
  "zip",
  "rar",
  "mp3",
  "mp4",
  "woff",
  "woff2",
  "ttf",
  "eot",
])

const ETIQUETAS_GENERICAS = new Set<string>([
  "home",
  "inicio",
  "index",
  "untitled",
  "sin titulo",
  "sin título",
  "bienvenido",
  "bienvenida",
  "bienvenidos",
  "pagina principal",
  "página principal",
])

const RE_LOCAL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const RE_DOMINIO =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/
const RE_EMAIL_TEXTO =
  /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi
const RE_MAILTO = /mailto:([^"'<>\s]+)/gi
const RE_HREF = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

function esIpV4(host: string): boolean {
  const partes = host.split(".")
  if (partes.length !== 4) return false

  return partes.every((parte) => {
    if (!/^\d{1,3}$/.test(parte)) return false
    return Number(parte) <= 255
  })
}

/**
 * Convierte una URL, un host o un `host:puerto` en un host normalizado:
 * lowercase, sin `www.`, sin puerto, sin punto final, sin credenciales y sin
 * IPs. No reduce subdominios (eso lo hace `dominioRegistrable`).
 */
function hostNormalizado(input: string): string | null {
  if (typeof input !== "string") return null

  const raw = input.trim()
  if (raw.length === 0 || raw.length > 2048) return null

  let candidato: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) candidato = raw
  else if (raw.startsWith("//")) candidato = `https:${raw}`
  else candidato = `https://${raw}`

  let url: URL
  try {
    url = new URL(candidato)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null

  let host = url.hostname.trim().toLowerCase()
  if (host.startsWith("[")) return null
  if (host.includes(":")) return null

  host = host.replace(/\.+$/, "")
  if (host.startsWith("www.")) host = host.slice(4)

  if (host.length === 0 || host.length > MAX_DOMINIO) return null
  if (esIpV4(host)) return null

  const etiquetas = host.split(".")
  if (etiquetas.length < 2) return null

  for (const etiqueta of etiquetas) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(etiqueta)) {
      return null
    }
  }

  // Un TLD numerico no es un dominio (y evita tratar IPv4 raras como dominio).
  const tld = etiquetas[etiquetas.length - 1]
  if (!/[a-z]/.test(tld)) return null

  return host
}

/**
 * Extrae el dominio registrable de un host ya normalizado, usando la lista de
 * sufijos multiparte. Devuelve `null` cuando el host es un sufijo publico solo
 * (`com.ar`, `co.uk`) o no tiene suficientes etiquetas.
 */
function dominioRegistrableDeHost(host: string): string | null {
  const etiquetas = host.split(".")
  if (etiquetas.length < 2) return null

  const dosUltimas = etiquetas.slice(-2).join(".")

  if (SUFIJOS_MULTIPARTE.has(dosUltimas)) {
    if (etiquetas.length < 3) return null
    return etiquetas.slice(-3).join(".")
  }

  return dosUltimas
}

function esDominioValido(dominio: string): boolean {
  if (dominio.length < 4 || dominio.length > MAX_DOMINIO) return false
  if (!RE_DOMINIO.test(dominio)) return false

  const etiquetas = dominio.split(".")
  if (etiquetas.length < 2) return false

  const tld = etiquetas[etiquetas.length - 1]
  if (tld.length < 2) return false
  if (!/[a-z]/.test(tld)) return false
  if (TLDS_RESERVADOS.has(tld)) return false

  return dominioRegistrableDeHost(dominio) !== null
}

/**
 * Normaliza un email: trim + lowercase y validacion sintactica. No cambia el
 * local part (no quita `+tags` ni puntos) y no completa dominios ni patrones.
 */
export function normalizarEmail(input: string): string | null {
  if (typeof input !== "string") return null

  const email = input.trim().toLowerCase()
  if (email.length === 0 || email.length > MAX_EMAIL) return null
  if (/\s/.test(email)) return null

  const arroba = email.indexOf("@")
  if (arroba <= 0 || arroba !== email.lastIndexOf("@")) return null

  const local = email.slice(0, arroba)
  const dominio = email.slice(arroba + 1)

  if (local.length === 0 || local.length > MAX_LOCAL) return null
  if (!RE_LOCAL.test(local)) return null
  if (!esDominioValido(dominio)) return null

  return `${local}@${dominio}`
}

/**
 * Normaliza un host o URL a un dominio valido. El puerto se descarta; se
 * devuelve `null` para IPs, credenciales, hosts sin punto y sufijos publicos
 * solos.
 */
export function normalizarDominio(input: string): string | null {
  const host = hostNormalizado(input)
  if (host === null) return null
  if (dominioRegistrableDeHost(host) === null) return null
  return host
}

/** Dominio registrable (`mail.foo.com.ar` -> `foo.com.ar`). */
export function dominioRegistrable(host: string): string | null {
  const normalizado = hostNormalizado(host)
  if (normalizado === null) return null
  return dominioRegistrableDeHost(normalizado)
}

/**
 * Dominio de negocio utilizable para dedupe/supresion: registrable y nunca un
 * proveedor de email publico. Devuelve `null` para Gmail/Hotmail/etc., sufijos
 * publicos e inputs invalidos.
 */
export function dominioNegocio(input: string): string | null {
  const host = normalizarDominio(input)
  if (host === null) return null

  const registrable = dominioRegistrableDeHost(host)
  if (registrable === null) return null
  if (PROVEEDORES_PUBLICOS.has(registrable)) return null

  return registrable
}

function hostDeDominioDeEntrada(valor: string): string | null {
  if (typeof valor !== "string") return null

  const raw = valor.trim()
  if (raw.length === 0) return null

  const arroba = raw.lastIndexOf("@")
  const sinUsuario = arroba >= 0 ? raw.slice(arroba + 1) : raw

  return normalizarDominio(sinUsuario)
}

/** `true` para Gmail, Hotmail, Outlook, Yahoo, iCloud y equivalentes. */
export function esProveedorPublico(dominio: string): boolean {
  const host = hostDeDominioDeEntrada(dominio)
  if (host === null) return false

  const registrable = dominioRegistrableDeHost(host)
  if (registrable === null) return false

  return PROVEEDORES_PUBLICOS.has(registrable)
}

/**
 * `true` para redes sociales, marketplaces, agregadores, directorios,
 * link-in-bio y acortadores. Acepta host o URL y compara el dominio
 * registrable, no substring (`facebook.ejemplo.com` no se bloquea).
 */
export function esHostNoProspectable(host: string): boolean {
  const normalizado = normalizarDominio(host)
  if (normalizado === null) return false

  const registrable = dominioRegistrableDeHost(normalizado)
  if (registrable === null) return false

  if (DOMINIOS_NO_PROSPECTABLES.has(registrable)) return true

  const marca = registrable.split(".")[0]
  return MARCAS_NO_PROSPECTABLES.has(marca)
}

function codigoSeguro(codigo: number): string {
  if (!Number.isFinite(codigo) || codigo <= 0 || codigo > 0x10ffff) return ""
  try {
    return String.fromCodePoint(codigo)
  } catch {
    return ""
  }
}

/** Decodifica entidades HTML basicas (incluye `&#64;` y `&commat;`). */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      codigoSeguro(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) => codigoSeguro(Number(dec)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
}

/**
 * Quita comentarios, scripts y estilos antes de buscar. El contenido de un
 * script no es un dato publicado y no debe generar un email falso.
 */
function quitarRuidoHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
}

function decodificarUriSeguro(valor: string): string {
  try {
    return decodeURIComponent(valor)
  } catch {
    return valor
  }
}

function normalizarCandidatoEmail(crudo: string): string | null {
  let valor = decodificarEntidades(crudo).trim()
  valor = decodificarUriSeguro(valor)
  valor = valor.replace(/^mailto:/i, "")

  const corte = valor.search(/[?&]/)
  if (corte >= 0) valor = valor.slice(0, corte)

  valor = valor
    .replace(/^[<("'[\s]+/, "")
    .replace(/[>)"'\].,;:\s]+$/, "")

  return normalizarEmail(valor)
}

function emailsDeMailto(crudo: string): string[] {
  let valor = decodificarEntidades(crudo).trim()
  valor = decodificarUriSeguro(valor)
  valor = valor.replace(/^mailto:/i, "")

  const corte = valor.search(/[?&]/)
  if (corte >= 0) valor = valor.slice(0, corte)

  return valor.split(/[,;]/)
}

/** Ruido que no identifica a un contacto profesional del negocio. */
function esEmailRuido(email: string): boolean {
  const separador = email.lastIndexOf("@")
  if (separador <= 0) return true

  const local = email.slice(0, separador).toLowerCase()
  const dominio = email.slice(separador + 1).toLowerCase()

  if (
    /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon)$/.test(local)
  ) {
    return true
  }
  if (local.includes("noreply") || local.includes("no-reply")) return true

  if (
    dominio === "sentry.io" ||
    dominio.endsWith(".sentry.io") ||
    dominio === "sentry-next.wixpress.com"
  ) {
    return true
  }

  if (dominio === "wixpress.com" || dominio.endsWith(".wixpress.com")) {
    return true
  }

  if (DOMINIOS_RUIDO.has(dominio)) return true

  const tld = dominio.split(".").pop() ?? ""
  if (EXTENSIONES_ASSET.has(tld)) return true

  if (
    dominio.endsWith(".local") ||
    dominio.endsWith(".internal") ||
    dominio.endsWith(".localhost")
  ) {
    return true
  }

  return false
}

function urlFuente(pageUrl: string): string | null {
  const raw = pageUrl.trim()
  if (raw.length === 0) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    if (!url.hostname.includes(".")) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Extrae el primer email publicado por el negocio: primero los `mailto:` y
 * luego el texto visible, sin `<script>`/`<style>`/comentarios. Rechaza ruido
 * (no-reply, example.com, sentry, wixpress, imagenes). No adivina patrones:
 * si no hay un email publicado, devuelve `null`.
 */
export function extraerEmailPublicado(
  html: string,
  pageUrl: string,
): { email: string; fuenteUrl: string } | null {
  if (typeof html !== "string" || typeof pageUrl !== "string") return null

  const fuenteUrl = urlFuente(pageUrl)
  if (fuenteUrl === null) return null

  const limpio = quitarRuidoHtml(html)

  const regexMailto = new RegExp(RE_MAILTO.source, "gi")
  let match: RegExpExecArray | null
  while ((match = regexMailto.exec(limpio)) !== null) {
    if (!match[1]) continue

    for (const parte of emailsDeMailto(match[1])) {
      const email = normalizarCandidatoEmail(parte)
      if (email !== null && !esEmailRuido(email)) {
        return { email, fuenteUrl }
      }
    }
  }

  const texto = decodificarEntidades(limpio.replace(/<[^>]*>/g, " "))
  const encontrados = texto.match(new RegExp(RE_EMAIL_TEXTO.source, "gi")) ?? []

  for (const candidato of encontrados) {
    const email = normalizarCandidatoEmail(candidato)
    if (email !== null && !esEmailRuido(email)) {
      return { email, fuenteUrl }
    }
  }

  return null
}

function normalizarTelefono(valor: string): string | null {
  const corte = valor.search(/;/)
  const base = (corte >= 0 ? valor.slice(0, corte) : valor).trim()
  if (base.length === 0) return null

  const tieneMas = base.startsWith("+")
  if (/[a-z]/i.test(base.replace(/^-+/, ""))) return null

  const digitos = base.replace(/\D/g, "")
  if (digitos.length < 6 || digitos.length > 15) return null

  return `${tieneMas ? "+" : ""}${digitos}`
}

/**
 * Extrae un telefono solo desde enlaces `tel:`. No toma numeros del texto
 * visible, imagenes ni atributos que no sean `tel:`.
 */
export function extraerTelefonoPublicado(html: string): string | null {
  if (typeof html !== "string" || html.length === 0) return null

  const limpio = quitarRuidoHtml(html)
  const regex = new RegExp(RE_HREF.source, "gi")
  let match: RegExpExecArray | null

  while ((match = regex.exec(limpio)) !== null) {
    const href = (match[1] ?? match[2] ?? match[3] ?? "").trim()
    const tel = /^tel:(.+)$/i.exec(href)
    if (!tel?.[1]) continue

    const crudo = decodificarUriSeguro(decodificarEntidades(tel[1]))
    const telefono = normalizarTelefono(crudo)
    if (telefono !== null) return telefono
  }

  return null
}

function recortar(texto: string, maximo: number): string {
  const limpio = texto.trim()
  if (limpio.length <= maximo) return limpio

  const corte = limpio.slice(0, maximo)
  const sinPalabraParcial = corte.replace(/\s+\S*$/, "").trim()

  return sinPalabraParcial.length > 0
    ? sinPalabraParcial
    : corte.trim()
}

function nombreDesdeHost(host: string): string {
  const dominio = dominioRegistrable(host)
  if (dominio === null) return "Sitio web"

  const etiqueta = dominio.split(".")[0]
  if (!/[a-z]/.test(etiqueta)) return "Sitio web"

  const palabras = etiqueta.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  if (palabras.length === 0) return "Sitio web"

  const nombre = palabras
    .split(" ")
    .map((palabra) =>
      palabra.length === 0
        ? palabra
        : palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase(),
    )
    .join(" ")

  return recortar(nombre, MAX_NOMBRE)
}

function limpiarTitulo(titulo: string): string {
  if (typeof titulo !== "string") return ""

  const valor = decodificarEntidades(titulo)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (valor.length === 0) return ""

  const segmentos = valor
    .split(/\s*[|·•»«]\s*|\s+[–—-]\s+|::/)
    .map((segmento) =>
      segmento
        .trim()
        .replace(/^[\s"'“”‘’([\]–—-]+/, "")
        .replace(/[\s"'“”‘’)\].,;:–—-]+$/, ""),
    )
    .filter(
      (segmento) =>
        segmento.length >= 2 &&
        !ETIQUETAS_GENERICAS.has(segmento.toLowerCase()),
    )

  if (segmentos.length === 0) return ""

  return segmentos[0]
}

/**
 * Limpia el nombre de un negocio a partir de `<title>` / `og:site_name`:
 * decodifica entidades, quita tags, colapsa espacios y descarta separadores o
 * etiquetas genericas ("Inicio", "Home"). Si no queda nada util, deriva el
 * nombre del host (`www.consultora-ejemplo.com.ar` -> "Consultora Ejemplo").
 * No inventa un nombre comercial que la pagina no publique.
 */
export function limpiarNombreNegocio(titulo: string, host: string): string {
  const limpio = limpiarTitulo(titulo)
  if (limpio.length > 0) return recortar(limpio, MAX_NOMBRE)
  return nombreDesdeHost(host)
}
