import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  dominioNegocio,
  dominioRegistrable,
  esHostNoProspectable,
  esProveedorPublico,
  extraerEmailPublicado,
  extraerTelefonoPublicado,
  limpiarNombreNegocio,
  normalizarDominio,
  normalizarEmail,
} from "@/lib/propuestas/normalizar"

/**
 * T-05 (AC-14, AC-19; RF-14, RF-19, RF-22): normalizacion y extraccion.
 *
 * Todo el modulo es puro. Los tests no hacen red ni tocan la base: fijan las
 * reglas de dominios multiparte, proveedores publicos, hosts no prospectables
 * y extraccion sin adivinar patrones.
 */

describe("T-05: normalizarEmail (AC-14, AC-19)", () => {
  it("aplica trim + lowercase sin tocar el local part", () => {
    expect(normalizarEmail("  Info@Consultora.COM.ar ")).toBe(
      "info@consultora.com.ar",
    )
    expect(normalizarEmail("Hola+Propuestas@Consultora.com")).toBe(
      "hola+propuestas@consultora.com",
    )
    expect(normalizarEmail("a@b.co")).toBe("a@b.co")
  })

  it("rechaza emails sintacticamente invalidos", () => {
    const invalidos = [
      "",
      "sin-arroba",
      "a@b",
      "a@b.c",
      "@b.com",
      "a@",
      "a b@c.com",
      "a@@b.com",
      "a..b@c.com",
      ".a@c.com",
      "a.@c.com",
      "a@-c.com",
      "a@c..com",
      "a@c.com.",
      "a@b.123",
      "a@localhost",
      "a@com.ar",
      "a@co.uk",
      "mailto:a@b.com",
      "info@consultora",
      "info at consultora.com",
    ]

    for (const valor of invalidos) {
      expect(normalizarEmail(valor), valor).toBeNull()
    }
  })

  it("acota la longitud del local part y del email completo", () => {
    const localLargo = "a".repeat(65)
    expect(normalizarEmail(`${localLargo}@consultora.com`)).toBeNull()

    const localMaximo = "a".repeat(64)
    expect(normalizarEmail(`${localMaximo}@consultora.com`)).toBe(
      `${localMaximo}@consultora.com`,
    )

    expect(normalizarEmail(`${"a".repeat(250)}@consultora.com`)).toBeNull()
  })
})

describe("T-05: normalizarDominio (AC-14)", () => {
  it("normaliza URLs y hosts sin reducir subdominios", () => {
    expect(normalizarDominio("https://WWW.Consultora.COM.ar/inicio?x=1")).toBe(
      "consultora.com.ar",
    )
    expect(normalizarDominio("www.consultora.com.ar")).toBe(
      "consultora.com.ar",
    )
    expect(normalizarDominio("consultora.com.ar.")).toBe("consultora.com.ar")
    expect(normalizarDominio("consultora.com.ar:8443")).toBe(
      "consultora.com.ar",
    )
    expect(normalizarDominio("//consultora.com.ar")).toBe(
      "consultora.com.ar",
    )
    expect(normalizarDominio("mail.consultora.com.ar")).toBe(
      "mail.consultora.com.ar",
    )
  })

  it("rechaza IPs, credenciales, hosts sin punto y sufijos publicos solos", () => {
    const invalidos = [
      "",
      "localhost",
      "foo",
      "com.ar",
      "co.uk",
      "ar",
      "com",
      "192.168.0.1",
      "999.1.1.1",
      "foo bar.com",
      "foo_bar.com",
      "-foo.com",
      "foo..com",
      "https://user:pass@foo.com",
      "ftp://foo.com",
      "javascript:alert(1)",
    ]

    for (const valor of invalidos) {
      expect(normalizarDominio(valor), valor).toBeNull()
    }
  })
})

describe("T-05: dominioRegistrable (AC-14)", () => {
  it("resuelve dominios multiparte sin devolver el sufijo solo", () => {
    const casos: Array<[string, string]> = [
      ["consultora.com.ar", "consultora.com.ar"],
      ["www.consultora.com.ar", "consultora.com.ar"],
      ["blog.estudio-juridico.com.ar", "estudio-juridico.com.ar"],
      ["loja.marca.com.br", "marca.com.br"],
      ["shop.marca.co.uk", "marca.co.uk"],
      ["a.b.marca.com.mx", "marca.com.mx"],
      ["pedidos.marca.com.au", "marca.com.au"],
      ["marca.co.nz", "marca.co.nz"],
      ["marca.co.jp", "marca.co.jp"],
      ["marca.com.co", "marca.com.co"],
      ["marca.com.gt", "marca.com.gt"],
      ["marca.co.cr", "marca.co.cr"],
      ["foo.xyz", "foo.xyz"],
      ["a.b.foo.xyz", "foo.xyz"],
      ["marca.com", "marca.com"],
      ["marca.ar", "marca.ar"],
    ]

    for (const [entrada, esperado] of casos) {
      expect(dominioRegistrable(entrada), entrada).toBe(esperado)
    }
  })

  it("devuelve null para sufijos publicos, hosts invalidos e IPs", () => {
    const invalidos = [
      "",
      "com.ar",
      "co.uk",
      "com.br",
      "com.mx",
      "co.nz",
      "ar",
      "com",
      "localhost",
      "192.168.0.1",
      "https://com.ar",
    ]

    for (const valor of invalidos) {
      expect(dominioRegistrable(valor), valor).toBeNull()
    }
  })

  it("nunca devuelve un sufijo publico como dominio registrable", () => {
    const sufijos = ["com.ar", "com.br", "co.uk", "com.mx", "com.au", "co.jp"]

    for (const sufijo of sufijos) {
      expect(dominioRegistrable(sufijo)).toBeNull()
    }
  })
})

describe("T-05: proveedores publicos y hosts no prospectables (AC-14)", () => {
  it("reconoce Gmail, Hotmail, Outlook, Yahoo, iCloud y equivalentes", () => {
    const proveedores = [
      "gmail.com",
      "GMAIL.COM",
      "www.gmail.com",
      "info@gmail.com",
      "hotmail.com",
      "hotmail.com.ar",
      "outlook.com",
      "outlook.es",
      "yahoo.com",
      "yahoo.com.ar",
      "icloud.com",
      "me.com",
      "live.com",
      "protonmail.com",
      "mailto:ventas@Outlook.com",
    ]

    for (const dominio of proveedores) {
      expect(esProveedorPublico(dominio), dominio).toBe(true)
    }
  })

  it("no confunde dominios de negocio ni parecidos con proveedores publicos", () => {
    const otros = [
      "consultora.com",
      "notgmail.com",
      "gmail.com.ejemplo.com",
      "example.com",
      "com.ar",
      "",
    ]

    for (const dominio of otros) {
      expect(esProveedorPublico(dominio), dominio).toBe(false)
    }
  })

  it("rechaza redes sociales, marketplaces, agregadores y link-in-bio", () => {
    const noProspectables = [
      "facebook.com",
      "www.facebook.com",
      "m.facebook.com",
      "instagram.com",
      "https://www.instagram.com/consultora",
      "ar.linkedin.com",
      "linkedin.com",
      "tiktok.com",
      "twitter.com",
      "x.com",
      "youtube.com",
      "linktr.ee",
      "https://linktr.ee/consultora",
      "mercadolibre.com.ar",
      "tienda.mercadolibre.com.ar",
      "amazon.com.mx",
      "google.com",
      "maps.google.com",
      "yelp.com",
      "tripadvisor.com",
      "booking.com",
      "wa.me",
      "t.me",
      "bit.ly",
      "paginasamarillas.com.ar",
    ]

    for (const host of noProspectables) {
      expect(esHostNoProspectable(host), host).toBe(true)
    }
  })

  it("no bloquea un dominio propio ni un parecido por substring", () => {
    const permitidos = [
      "consultora.com",
      "pixelarch.dev",
      "facebook.ejemplo.com",
      "facebook.com.evil.com",
      "notfacebook.com",
      "com.ar",
      "",
    ]

    for (const host of permitidos) {
      expect(esHostNoProspectable(host), host).toBe(false)
    }
  })

  it("dominioNegocio combina normalizacion, dominio registrable y proveedor", () => {
    expect(dominioNegocio("https://www.consultora.com.ar/contacto")).toBe(
      "consultora.com.ar",
    )
    expect(dominioNegocio("mail.consultora.com.ar")).toBe("consultora.com.ar")
    for (const proveedor of [
      "gmail.com",
      "hotmail.com",
      "outlook.es",
      "yahoo.com.ar",
      "icloud.com",
    ]) {
      expect(dominioNegocio(proveedor), proveedor).toBeNull()
    }

    expect(dominioNegocio("com.ar")).toBeNull()
    expect(dominioNegocio("no es un dominio")).toBeNull()
  })
})

describe("T-05: extraerEmailPublicado (AC-19)", () => {
  const FUENTE = "https://consultora.com/contacto"

  it("prioriza mailto aunque el texto tenga otro email antes", () => {
    const html = `
      <p>Escribinos a texto@consultora.com</p>
      <a href="mailto:info@consultora.com">Email</a>
    `

    expect(extraerEmailPublicado(html, FUENTE)).toEqual({
      email: "info@consultora.com",
      fuenteUrl: FUENTE,
    })
  })

  it("limpia query, entidades y percent-encoding del mailto", () => {
    expect(
      extraerEmailPublicado(
        '<a href="mailto:Ventas%40Consultora.com?subject=Hola">Email</a>',
        FUENTE,
      ),
    ).toEqual({ email: "ventas@consultora.com", fuenteUrl: FUENTE })

    expect(
      extraerEmailPublicado(
        '<a href="mailto:info&#64;consultora.com">Email</a>',
        FUENTE,
      ),
    ).toEqual({ email: "info@consultora.com", fuenteUrl: FUENTE })
  })

  it("usa el primer mailto valido de una lista", () => {
    expect(
      extraerEmailPublicado(
        '<a href="mailto:info@consultora.com,ventas@consultora.com">Escribir</a>',
        FUENTE,
      )?.email,
    ).toBe("info@consultora.com")
  })

  it("cae al texto visible y decodifica entidades", () => {
    const html = "<p>Contacto: info&#64;consultora.com</p>"

    expect(extraerEmailPublicado(html, FUENTE)).toEqual({
      email: "info@consultora.com",
      fuenteUrl: FUENTE,
    })
  })

  it("ignora scripts, estilos y comentarios", () => {
    const html = `
      <script>var mail = "spam@sentry.io"</script>
      <style>.x { background: url("logo@2x.png"); }</style>
      <!-- oculto@example.com -->
      <p>Ventas: ventas@consultora.com</p>
    `

    expect(extraerEmailPublicado(html, FUENTE)?.email).toBe(
      "ventas@consultora.com",
    )
  })

  it("rechaza ruido y sigue buscando el email real", () => {
    const ruidos = [
      "no-reply@consultora.com",
      "noreply@consultora.com",
      "do-not-reply@consultora.com",
      "abc123@sentry.io",
      "foo@wixpress.com",
      "test@example.com",
      "logo@2x.png",
      "postmaster@consultora.local",
    ]

    for (const ruido of ruidos) {
      const html = `<a href="mailto:${ruido}">x</a><p>Contacto: info@consultora.com</p>`
      expect(extraerEmailPublicado(html, FUENTE)?.email, ruido).toBe(
        "info@consultora.com",
      )
    }
  })

  it("descarta ruido tambien en el texto visible", () => {
    const html =
      "<p>Escribir a no-reply@consultora.com o a info@consultora.com</p>"

    expect(extraerEmailPublicado(html, FUENTE)?.email).toBe(
      "info@consultora.com",
    )
  })

  it("no adivina un email a partir del dominio", () => {
    const html = "<p>Visitanos en consultora.com o escribinos por el formulario</p>"
    expect(extraerEmailPublicado(html, FUENTE)).toBeNull()
  })

  it("exige una URL de fuente absoluta http(s) valida", () => {
    const html = '<a href="mailto:info@consultora.com">Email</a>'

    expect(extraerEmailPublicado(html, "consultora.com")).toBeNull()
    expect(extraerEmailPublicado(html, "ftp://consultora.com")).toBeNull()
    expect(extraerEmailPublicado(html, "javascript:alert(1)")).toBeNull()
    expect(extraerEmailPublicado(html, "")).toBeNull()
  })

  it("normaliza la fuente con la URL canonica", () => {
    expect(
      extraerEmailPublicado(
        '<a href="mailto:info@consultora.com">Email</a>',
        "https://consultora.com",
      )?.fuenteUrl,
    ).toBe("https://consultora.com/")
  })
})

describe("T-05: extraerTelefonoPublicado (AC-19)", () => {
  it("extrae solo desde tel: y normaliza el numero", () => {
    expect(
      extraerTelefonoPublicado(
        '<a href="tel:+54 9 11 1234-5678">Llamar</a>',
      ),
    ).toBe("+5491112345678")

    expect(
      extraerTelefonoPublicado("<a href='tel:011-4444-5555'>Llamar</a>"),
    ).toBe("01144445555")

    expect(
      extraerTelefonoPublicado(
        '<a href="tel:+541144445555;ext=123">Llamar</a>',
      ),
    ).toBe("+541144445555")

    expect(
      extraerTelefonoPublicado('<a href="tel:%2B5491112345678">Llamar</a>'),
    ).toBe("+5491112345678")
  })

  it("no toma telefonos del texto visible, scripts ni valores invalidos", () => {
    expect(
      extraerTelefonoPublicado("<p>Tel: +54 11 1234-5678</p>"),
    ).toBeNull()

    expect(
      extraerTelefonoPublicado(
        '<script>var t = "tel:+541112345678"</script>',
      ),
    ).toBeNull()

    expect(extraerTelefonoPublicado('<a href="tel:123">x</a>')).toBeNull()
    expect(extraerTelefonoPublicado("")).toBeNull()
  })

  it("devuelve el primer tel: valido", () => {
    expect(
      extraerTelefonoPublicado(
        '<a href="tel:123">x</a><a href="tel:+541144445555">y</a><a href="tel:+541166667777">z</a>',
      ),
    ).toBe("+541144445555")
  })
})

describe("T-05: limpiarNombreNegocio (AC-19)", () => {
  it("limpia separadores y etiquetas genericas del title", () => {
    expect(
      limpiarNombreNegocio("  Consultora Ejemplo  |  Diseno web ", "consultora.com"),
    ).toBe("Consultora Ejemplo")

    expect(
      limpiarNombreNegocio("Inicio | Consultora Ejemplo", "consultora.com"),
    ).toBe("Consultora Ejemplo")

    expect(
      limpiarNombreNegocio("Consultora Ejemplo | Home", "consultora.com"),
    ).toBe("Consultora Ejemplo")

    expect(
      limpiarNombreNegocio("Consultora Ejemplo - Diseno", "consultora.com"),
    ).toBe("Consultora Ejemplo")

    expect(
      limpiarNombreNegocio("Consultora Ejemplo :: Diseno", "consultora.com"),
    ).toBe("Consultora Ejemplo")
  })

  it("decodifica entidades y quita tags", () => {
    expect(
      limpiarNombreNegocio("Consultora &amp; Asociados", "consultora.com"),
    ).toBe("Consultora & Asociados")

    expect(
      limpiarNombreNegocio("<b>Consultora</b> Ejemplo", "consultora.com"),
    ).toBe("Consultora Ejemplo")
  })

  it("cae al host cuando no hay un nombre util", () => {
    expect(
      limpiarNombreNegocio("", "www.consultora-ejemplo.com.ar"),
    ).toBe("Consultora Ejemplo")

    expect(
      limpiarNombreNegocio("Home", "https://www.estudio-legal.com"),
    ).toBe("Estudio Legal")

    expect(limpiarNombreNegocio("Sin titulo", "marca.com")).toBe("Marca")
  })

  it("devuelve un texto seguro cuando el host tampoco sirve", () => {
    expect(limpiarNombreNegocio("Home", "com.ar")).toBe("Sitio web")
    expect(limpiarNombreNegocio("", "localhost")).toBe("Sitio web")
  })

  it("acota el nombre a 120 caracteres", () => {
    const titulo = `Consultora ${"x".repeat(300)}`
    expect(limpiarNombreNegocio(titulo, "consultora.com").length).toBeLessThanOrEqual(
      120,
    )
  })
})

describe("T-05: modulos puros sin PII, red ni Prisma (AC-19, AC-41)", () => {
  const ROOT = process.cwd()
  const FUENTES = [
    "src/lib/propuestas/normalizar.ts",
    "src/lib/propuestas/dedupe.ts",
  ]

  it("no importa Prisma, red, entorno ni logging", () => {
    for (const relativo of FUENTES) {
      const fuente = readFileSync(path.join(ROOT, relativo), "utf8")

      expect(fuente, relativo).not.toMatch(/@prisma\/client|prisma\./)
      expect(fuente, relativo).not.toMatch(/\bfetch\s*\(/)
      expect(fuente, relativo).not.toMatch(
        /node:(?:http|https|dns|net|tls|dgram)/,
      )
      expect(fuente, relativo).not.toMatch(/\bprocess\.env\b/)
      expect(fuente, relativo).not.toMatch(/\bconsole\./)
      expect(fuente, relativo).not.toMatch(/\b(?:logger|captureException)\b/)
    }
  })
})
