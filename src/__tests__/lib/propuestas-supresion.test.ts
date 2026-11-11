import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ErrorSupresion,
  claveSupresionDominio,
  claveSupresionEmail,
  crearTokenBaja,
  dominioSuprimible,
  emailEnmascarado,
  esDominioMultiinquilino,
  evaluarContactabilidad,
  hashEmail,
  verificarTokenBaja,
  type SupresionEvaluable,
} from "@/lib/propuestas/supresion"

/**
 * T-06 (AC-15, AC-16, AC-17, AC-18, AC-33, AC-34, AC-35, AC-36; RF-23..28,
 * RF-51, RF-52): supresion por hash, tokens de baja y contactabilidad.
 *
 * Modulo puro: no hay red, Prisma, emails ni Resend. Los emails son ficticios
 * y se verifica que el valor en claro no quede en hashes, claves ni tokens.
 */

const SECRETO = "propuestas-test-secreto-0123456789abcdef"
const OTRO_SECRETO = "propuestas-test-secreto-fedcba9876543210"
const EMAIL = "info@consultora.com"

function alterarParte(token: string, indice: number, valor: string): string {
  const partes = token.split(".")
  partes[indice] = valor
  return partes.join(".")
}

function cambiarPrimerCaracter(token: string, indice: number): string {
  const partes = token.split(".")
  const actual = partes[indice]
  const primero = actual.charAt(0) === "a" ? "b" : "a"
  partes[indice] = primero + actual.slice(1)
  return partes.join(".")
}

describe("T-06: hashEmail (AC-15, AC-17)", () => {
  it("es estable y normaliza trim, mayusculas y espacios", () => {
    const hash = hashEmail("  Info@Consultora.COM ", SECRETO)

    expect(hash).toBe(hashEmail(EMAIL, SECRETO))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashEmail(EMAIL, SECRETO)).toBe(hash)
  })

  it("cambia con otro secreto", () => {
    expect(hashEmail(EMAIL, OTRO_SECRETO)).not.toBe(hashEmail(EMAIL, SECRETO))
  })

  it("no deja el email en claro en el hash", () => {
    const hash = hashEmail(EMAIL, SECRETO)

    expect(hash).not.toContain("info")
    expect(hash).not.toContain("consultora")
    expect(hash).not.toContain("@")
  })

  it("rechaza emails invalidos y HTML adversarial", () => {
    const invalidos = [
      "",
      "sin-arroba",
      "info@consultora",
      "info@consultora.c",
      "mailto:info@consultora.com",
      "<b>info@consultora.com</b>",
      "info@consultora.com<script>alert(1)</script>",
      "info@consultora.com\r\nBcc: otro@example.com",
      "info at consultora.com",
      "info@consultora.com\u0000",
    ]

    for (const valor of invalidos) {
      expect(() => hashEmail(valor, SECRETO), valor).toThrow(ErrorSupresion)
    }
  })

  it("rechaza un secreto ausente o demasiado corto", () => {
    expect(() => hashEmail(EMAIL, "")).toThrow(ErrorSupresion)
    expect(() => hashEmail(EMAIL, "corto")).toThrow(ErrorSupresion)
    expect(() => hashEmail(EMAIL, " ".repeat(40))).toThrow(ErrorSupresion)
  })
})

describe("T-06: claves de supresion (AC-15, AC-18)", () => {
  it("crea una clave idempotente por email", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const clave = claveSupresionEmail(hash)

    expect(clave).toBe(`EMAIL:${hash}`)
    expect(claveSupresionEmail(hash)).toBe(clave)
    expect(claveSupresionEmail(hash.toUpperCase())).toBe(clave)
    expect(claveSupresionEmail(`EMAIL:${hash}`)).toBe(clave)
    expect(claveSupresionEmail(`  ${hash.toUpperCase()}  `)).toBe(clave)
    expect(clave).not.toContain(EMAIL)
  })

  it("no mezcla emails distintos ni hashes invalidos", () => {
    const uno = claveSupresionEmail(hashEmail(EMAIL, SECRETO))
    const dos = claveSupresionEmail(hashEmail("ventas@consultora.com", SECRETO))

    expect(uno).not.toBe(dos)
    expect(() => claveSupresionEmail("")).toThrow(ErrorSupresion)
    expect(() => claveSupresionEmail("abc")).toThrow(ErrorSupresion)
    expect(() => claveSupresionEmail("g".repeat(64))).toThrow(ErrorSupresion)
    expect(() => claveSupresionEmail(`EMAIL:${"z".repeat(64)}`)).toThrow(
      ErrorSupresion,
    )
  })

  it("crea una clave de dominio normalizada y sin email", () => {
    expect(claveSupresionDominio("consultora.com")).toBe(
      "DOMINIO:consultora.com",
    )
    expect(claveSupresionDominio("CONSULTORA.COM")).toBe(
      "DOMINIO:consultora.com",
    )
    expect(claveSupresionDominio("mail.consultora.com")).toBe(
      "DOMINIO:consultora.com",
    )
    expect(claveSupresionDominio("https://www.consultora.com.ar/contacto")).toBe(
      "DOMINIO:consultora.com.ar",
    )
    expect(claveSupresionDominio("info@consultora.com")).toBe(
      "DOMINIO:consultora.com",
    )
    expect(claveSupresionDominio("DOMINIO:consultora.com")).toBe(
      "DOMINIO:consultora.com",
    )

    const clave = claveSupresionDominio("consultora.com")
    expect(clave).toBe(claveSupresionDominio("www.consultora.com"))
    expect(clave).not.toContain(EMAIL)
  })

  it("rechaza sufijos publicos, basura y hosts no prospectables", () => {
    const invalidos = [
      "",
      "com.ar",
      "co.uk",
      "com.br",
      "localhost",
      "192.168.0.1",
      "javascript:alert(1)",
      "<script>consultora.com</script>",
      "info@consultora.com<script>",
      "EMAIL:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "DOMINIO:",
      "DOMINIO:gmail.com",
      "google.com",
      "facebook.com",
      "mercadolibre.com.ar",
      "linktr.ee",
      "sites.google.com",
    ]

    for (const valor of invalidos) {
      expect(dominioSuprimible(valor), valor).toBeNull()
      expect(() => claveSupresionDominio(valor), valor).toThrow(ErrorSupresion)
    }
  })
})

describe("T-06: proveedores publicos (AC-15, AC-18)", () => {
  it("nunca acepta un proveedor de email publico como dominio suprimible", () => {
    const proveedores = [
      "gmail.com",
      "googlemail.com",
      "hotmail.com",
      "hotmail.es",
      "outlook.com",
      "outlook.es",
      "yahoo.com",
      "yahoo.com.ar",
      "icloud.com",
      "me.com",
      "live.com",
      "msn.com",
      "protonmail.com",
      "proton.me",
      "tutanota.com",
      "tuta.com",
      "gmx.com",
      "gmx.net",
      "mail.com",
      "zoho.com",
      "yandex.com",
      "fastmail.com",
      "hushmail.com",
      "gmail.com.br",
      "hotmail.de",
      "outlook.com.mx",
      "yahoo.fr",
      "web.de",
      "t-online.de",
      "orange.fr",
      "laposte.net",
      "libero.it",
      "virgilio.it",
      "uol.com.br",
      "bol.com.br",
      "terra.com.br",
      "ig.com.br",
      "speedy.com.ar",
      "fibertel.com.ar",
      "arnet.com.ar",
      "ciudad.com.ar",
      "mail.ru",
      "bk.ru",
      "inbox.ru",
      "qq.com",
      "163.com",
      "126.com",
      "naver.com",
      "daum.net",
      "hanmail.net",
      "rediffmail.com",
      "seznam.cz",
      "wp.pl",
      "o2.pl",
      "interia.pl",
      "onet.pl",
      "ukr.net",
      "meta.ua",
    ]

    for (const proveedor of proveedores) {
      expect(dominioSuprimible(proveedor), proveedor).toBeNull()
      expect(
        () => claveSupresionDominio(proveedor),
        proveedor,
      ).toThrow(ErrorSupresion)
    }

    // Un email publico tampoco habilita una supresion por dominio.
    expect(dominioSuprimible("Info@Gmail.com")).toBeNull()
  })

  it("no rechaza un dominio de negocio que solo se parece a un proveedor", () => {
    const negocios: Array<[string, string]> = [
      ["consultora.com", "consultora.com"],
      ["notgmail.com", "notgmail.com"],
      ["gmail.com.ejemplo.com", "ejemplo.com"],
      ["miempresa.com.ar", "miempresa.com.ar"],
      ["estudio-juridico.com", "estudio-juridico.com"],
    ]

    for (const [input, esperado] of negocios) {
      expect(dominioSuprimible(input), input).toBe(esperado)
    }
  })
})

describe("T-06: hosts multiinquilino (AC-15, AC-18)", () => {
  it("rechaza plataformas compartidas por dominio y por subdominio", () => {
    const compartidos = [
      "wordpress.com",
      "consultora.wordpress.com",
      "wixsite.com",
      "consultora.wixsite.com",
      "wix.com",
      "weebly.com",
      "consultora.weebly.com",
      "jimdo.com",
      "consultora.jimdo.com",
      "webnode.com",
      "strikingly.com",
      "carrd.co",
      "consultora.carrd.co",
      "tumblr.com",
      "consultora.tumblr.com",
      "substack.com",
      "consultora.substack.com",
      "ghost.io",
      "consultora.ghost.io",
      "notion.site",
      "consultora.notion.site",
      "webflow.io",
      "consultora.webflow.io",
      "myshopify.com",
      "tienda.myshopify.com",
      "shopify.com",
      "squarespace.com",
      "consultora.squarespace.com",
      "square.site",
      "consultora.square.site",
      "godaddysites.com",
      "site123.com",
      "cargo.site",
      "consultora.cargo.site",
      "framer.website",
      "consultora.framer.website",
      "bubbleapps.io",
      "softr.app",
      "glideapp.io",
      "business.site",
      "consultora.business.site",
      "blogspot.com",
      "consultora.blogspot.com",
      "consultora.blogspot.com.ar",
      "github.io",
      "consultora.github.io",
      "gitlab.io",
      "netlify.app",
      "consultora.netlify.app",
      "vercel.app",
      "consultora.vercel.app",
      "pages.dev",
      "consultora.pages.dev",
      "web.app",
      "consultora.web.app",
      "firebaseapp.com",
      "consultora.firebaseapp.com",
      "herokuapp.com",
      "consultora.herokuapp.com",
      "onrender.com",
      "consultora.onrender.com",
      "railway.app",
      "consultora.up.railway.app",
      "fly.dev",
      "consultora.fly.dev",
      "azurewebsites.net",
      "consultora.azurewebsites.net",
      "azure.com",
      "consultora.azure.com",
      "windows.net",
      "consultora.windows.net",
      "r2.dev",
      "consultora.r2.dev",
      "canva.site",
      "consultora.canva.site",
      "cloudfront.net",
      "d123.cloudfront.net",
      "amazonaws.com",
      "bucket.s3.amazonaws.com",
    ]

    for (const host of compartidos) {
      expect(dominioSuprimible(host), host).toBeNull()
      expect(() => claveSupresionDominio(host), host).toThrow(ErrorSupresion)
      expect(esDominioMultiinquilino(host), host).toBe(true)
    }
  })

  it("no confunde un dominio propio con una plataforma", () => {
    const propios = [
      "consultora.com",
      "miwordpress.com",
      "wordpress.com.ejemplo.com",
      "notshopify.com",
      "pixelarch.dev",
    ]

    for (const dominio of propios) {
      expect(esDominioMultiinquilino(dominio), dominio).toBe(false)
    }
  })
})

describe("T-06: emailEnmascarado (AC-15, AC-17)", () => {
  it("conserva la primera letra y el dominio, nunca el email completo", () => {
    expect(emailEnmascarado("Info@Consultora.COM")).toBe(
      "i***@consultora.com",
    )
    expect(emailEnmascarado("a@b.co")).toBe("***@b.co")

    for (const email of [
      "info@consultora.com",
      "ventas@consultora.com.ar",
      "a@b.co",
    ]) {
      const enmascarado = emailEnmascarado(email)
      expect(enmascarado).not.toBe(email)
      expect(enmascarado).not.toContain(email.split("@")[0])
    }
  })

  it("devuelve vacio para entradas invalidas o HTML adversarial", () => {
    const invalidos = [
      "",
      "sin-arroba",
      "info@consultora",
      "<b>info@consultora.com</b>",
      "info@consultora.com<script>",
      "info@consultora.com\r\nBcc: otro@example.com",
    ]

    for (const valor of invalidos) {
      expect(emailEnmascarado(valor), valor).toBe("")
    }
  })
})

describe("T-06: evaluarContactabilidad (AC-15, AC-16, AC-18)", () => {
  it("sin email valido no es contactable", () => {
    for (const email of [null, "", "sin-arroba", "<b>info@consultora.com</b>"]) {
      expect(
        evaluarContactabilidad(
          { email, supresiones: [] },
          SECRETO,
        ),
        String(email),
      ).toEqual({ contactable: false, motivo: "SIN_EMAIL" })
    }
  })

  it("con email valido y sin supresiones es contactable", () => {
    expect(
      evaluarContactabilidad({ email: EMAIL, supresiones: [] }, SECRETO),
    ).toEqual({ contactable: true })
  })

  it("bloquea por hash de email, con prefijo y mayusculas", () => {
    const hash = hashEmail(EMAIL, SECRETO)

    expect(
      evaluarContactabilidad(
        {
          email: " Info@Consultora.com ",
          supresiones: [{ ambito: "EMAIL", emailHash: hash }],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })

    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          supresiones: [
            { ambito: "EMAIL", emailHash: `EMAIL:${hash.toUpperCase()}` },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })
  })

  it("otro secreto no coincide con el hash guardado", () => {
    const hash = hashEmail(EMAIL, OTRO_SECRETO)

    expect(
      evaluarContactabilidad(
        { email: EMAIL, supresiones: [{ ambito: "EMAIL", emailHash: hash }] },
        SECRETO,
      ),
    ).toEqual({ contactable: true })
  })

  it("bloquea por dominio de negocio explicito o derivado del email", () => {
    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          dominioNegocio: "https://www.consultora.com",
          supresiones: [
            { ambito: "DOMINIO", dominioNegocio: "consultora.com" },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_DOMINIO" })

    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          supresiones: [
            { ambito: "DOMINIO", dominioNegocio: "DOMINIO:consultora.com" },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_DOMINIO" })
  })

  it("un dominio publico o multiinquilino nunca bloquea por dominio", () => {
    expect(
      evaluarContactabilidad(
        {
          email: "info@gmail.com",
          supresiones: [{ ambito: "DOMINIO", dominioNegocio: "gmail.com" }],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: true })

    expect(
      evaluarContactabilidad(
        {
          email: "info@consultora.wordpress.com",
          supresiones: [
            {
              ambito: "DOMINIO",
              dominioNegocio: "consultora.wordpress.com",
            },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: true })
  })

  it("un email publico sigue bloqueado por el dominio de negocio del prospecto", () => {
    expect(
      evaluarContactabilidad(
        {
          email: "info@gmail.com",
          dominioNegocio: "consultora.com",
          supresiones: [
            { ambito: "DOMINIO", dominioNegocio: "consultora.com" },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_DOMINIO" })
  })

  it("un dominio distinto no bloquea", () => {
    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          supresiones: [
            { ambito: "DOMINIO", dominioNegocio: "otra-empresa.com" },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: true })
  })

  it("la supresion por email gana sobre la de dominio", () => {
    const hash = hashEmail(EMAIL, SECRETO)

    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          supresiones: [
            { ambito: "DOMINIO", dominioNegocio: "consultora.com" },
            { ambito: "EMAIL", emailHash: hash },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })
  })

  it("la supresion por email es global aunque cambie el prospecto o el dominio (AC-35)", () => {
    const supresion: SupresionEvaluable = {
      ambito: "EMAIL",
      emailHash: hashEmail(EMAIL, SECRETO),
    }

    const otrosContextos = [
      { email: "INFO@CONSULTORA.COM", dominioNegocio: "otro-negocio.com" },
      { email: "  Info@Consultora.com  " },
      { email: EMAIL, dominioNegocio: "https://www.otra-empresa.com.ar" },
    ]

    for (const contexto of otrosContextos) {
      expect(
        evaluarContactabilidad({ ...contexto, supresiones: [supresion] }, SECRETO),
        JSON.stringify(contexto),
      ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })
    }
  })

  it("el resultado no revela email, hash ni dominio (AC-15)", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const resultado = evaluarContactabilidad(
      {
        email: EMAIL,
        dominioNegocio: "consultora.com",
        supresiones: [{ ambito: "EMAIL", emailHash: hash }],
      },
      SECRETO,
    )

    expect(Object.keys(resultado).sort()).toEqual(["contactable", "motivo"])

    const serializado = JSON.stringify(resultado)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain("consultora")
    expect(serializado).not.toContain(hash)
  })

  it("ignora registros corruptos o de otro ambito", () => {
    const invalidas = [
      null,
      undefined,
      {},
      { ambito: "OTRO", emailHash: hashEmail(EMAIL, SECRETO) },
      { ambito: "EMAIL", emailHash: "no-es-un-hash" },
      { ambito: "EMAIL", emailHash: `<b>${hashEmail(EMAIL, SECRETO)}</b>` },
      { ambito: "DOMINIO", dominioNegocio: "<script>consultora.com</script>" },
      { ambito: "DOMINIO", dominioNegocio: "gmail.com" },
      { ambito: "DOMINIO", dominioNegocio: "consultora.wordpress.com" },
    ] as unknown as SupresionEvaluable[]

    expect(
      evaluarContactabilidad({ email: EMAIL, supresiones: invalidas }, SECRETO),
    ).toEqual({ contactable: true })
  })

  it("ignora una lista de supresiones corrupta que no es un array", () => {
    const corruptas = [
      null,
      undefined,
      "consultora.com",
      42,
      {},
      { ambito: "EMAIL", emailHash: hashEmail(EMAIL, SECRETO) },
    ]

    for (const supresiones of corruptas) {
      expect(
        evaluarContactabilidad(
          {
            email: EMAIL,
            supresiones: supresiones as unknown as SupresionEvaluable[],
          },
          SECRETO,
        ),
        String(supresiones),
      ).toEqual({ contactable: true })
    }
  })

  it("falla cerrado con un secreto invalido", () => {
    expect(() =>
      evaluarContactabilidad({ email: EMAIL, supresiones: [] }, "corto"),
    ).toThrow(ErrorSupresion)

    // Sin email no hay nada que hashear: el resultado sigue sin ser contactable.
    expect(
      evaluarContactabilidad({ email: null, supresiones: [] }, "corto"),
    ).toEqual({ contactable: false, motivo: "SIN_EMAIL" })
  })

  it("la supresion sobrevive al borrado del prospecto (fixture)", () => {
    const prospecto = { id: "clxprospecto1", email: EMAIL }
    const hash = hashEmail(prospecto.email, SECRETO)
    const clave = claveSupresionEmail(hash)
    const token = crearTokenBaja(prospecto.id, hash, SECRETO)
    const supresion: SupresionEvaluable = { ambito: "EMAIL", emailHash: hash }

    // El prospecto se elimina: solo queda la supresion por hash.
    const prospectoEliminado = null
    expect(prospectoEliminado).toBeNull()

    expect(clave).toBe(`EMAIL:${hash}`)
    expect(verificarTokenBaja(token, SECRETO)).toEqual({
      ok: true,
      prospectoId: prospecto.id,
      emailHash: hash,
    })
    expect(
      evaluarContactabilidad(
        { email: prospecto.email, supresiones: [supresion] },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })

    const serializado = JSON.stringify({ hash, clave, token })
    expect(serializado).not.toContain(EMAIL)
    expect(token).not.toContain("@")
  })
})

describe("T-06: token de baja (AC-33, AC-35)", () => {
  const ID = "clxprospecto1"

  function tokenValido(): string {
    return crearTokenBaja(ID, hashEmail(EMAIL, SECRETO), SECRETO)
  }

  it("tiene el formato v1.<prospectoId>.<emailHash>.<hmac> sin PII", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const token = crearTokenBaja(ID, hash, SECRETO)
    const partes = token.split(".")

    expect(partes).toHaveLength(4)
    expect(partes[0]).toBe("v1")
    expect(partes[1]).toBe(ID)
    expect(partes[2]).toBe(hash)
    expect(partes[3]).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).toMatch(
      /^v1\.[A-Za-z0-9_-]{1,64}\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/,
    )
    expect(token).not.toContain("@")
    expect(token).not.toContain("info")
    expect(token).not.toContain("consultora")
  })

  it("es determinista y cambia con prospecto, hash o secreto", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const token = crearTokenBaja(ID, hash, SECRETO)

    expect(crearTokenBaja(ID, hash, SECRETO)).toBe(token)
    expect(crearTokenBaja("clxprospecto2", hash, SECRETO)).not.toBe(token)
    expect(
      crearTokenBaja(ID, hashEmail("ventas@consultora.com", SECRETO), SECRETO),
    ).not.toBe(token)
    expect(crearTokenBaja(ID, hash, OTRO_SECRETO)).not.toBe(token)
  })

  it("acepta hash en mayusculas o con prefijo y lo canonicaliza", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const token = crearTokenBaja(ID, hash, SECRETO)

    expect(crearTokenBaja(ID, hash.toUpperCase(), SECRETO)).toBe(token)
    expect(crearTokenBaja(ID, `EMAIL:${hash}`, SECRETO)).toBe(token)
  })

  it("verifica el token y devuelve id y hash normalizados", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const token = crearTokenBaja(ID, hash, SECRETO)

    expect(verificarTokenBaja(token, SECRETO)).toEqual({
      ok: true,
      prospectoId: ID,
      emailHash: hash,
    })
    expect(verificarTokenBaja(`  ${token}  `, SECRETO)).toEqual({
      ok: true,
      prospectoId: ID,
      emailHash: hash,
    })
  })

  it("rechaza token manipulado, truncado o con formato invalido", () => {
    const token = tokenValido()
    const hash = token.split(".")[2]

    const invalidos = [
      alterarParte(token, 0, "v2"),
      alterarParte(token, 1, "clxprospecto2"),
      alterarParte(token, 2, hash.startsWith("0") ? `1${hash.slice(1)}` : `0${hash.slice(1)}`),
      cambiarPrimerCaracter(token, 3),
      `${token}.extra`,
      token.split(".").slice(0, 2).join("."),
      "",
      "v1",
      "v1..",
      `v1.${ID}..`,
      `<${token}>`,
      token.replace(/\./g, "%2E"),
      token.replace(/\./g, "&period;"),
      token.replace(/\.[^.]+$/, ""),
    ]

    for (const invalido of invalidos) {
      expect(verificarTokenBaja(invalido, SECRETO), invalido).toEqual({
        ok: false,
      })
    }
  })

  it("rechaza entradas que no son string y tokens con hash no canonico", () => {
    const token = tokenValido()
    const hash = token.split(".")[2]
    const noStrings = [null, undefined, 42, {}, [], true]

    for (const valor of noStrings) {
      expect(
        verificarTokenBaja(valor as unknown as string, SECRETO),
        String(valor),
      ).toEqual({ ok: false })
    }

    expect(
      verificarTokenBaja(alterarParte(token, 2, hash.toUpperCase()), SECRETO),
    ).toEqual({ ok: false })
  })

  it("rechaza un token firmado con otro secreto o con secreto invalido", () => {
    const token = tokenValido()

    expect(verificarTokenBaja(token, OTRO_SECRETO)).toEqual({ ok: false })
    expect(verificarTokenBaja(token, "corto")).toEqual({ ok: false })
    expect(verificarTokenBaja(token, "")).toEqual({ ok: false })
  })

  it("rechaza entradas invalidas al crear el token", () => {
    const hash = hashEmail(EMAIL, SECRETO)

    expect(() => crearTokenBaja("", hash, SECRETO)).toThrow(ErrorSupresion)
    expect(() => crearTokenBaja("id.con.puntos", hash, SECRETO)).toThrow(
      ErrorSupresion,
    )
    expect(() => crearTokenBaja("x".repeat(65), hash, SECRETO)).toThrow(
      ErrorSupresion,
    )
    expect(() => crearTokenBaja(ID, "", SECRETO)).toThrow(ErrorSupresion)
    expect(() => crearTokenBaja(ID, "abc", SECRETO)).toThrow(ErrorSupresion)
    expect(() => crearTokenBaja(ID, "g".repeat(64), SECRETO)).toThrow(
      ErrorSupresion,
    )
    expect(() => crearTokenBaja(ID, hash, "corto")).toThrow(ErrorSupresion)
  })

  it("el token no depende de la base: sirve aunque el prospecto ya no exista", () => {
    const hash = hashEmail(EMAIL, SECRETO)
    const token = crearTokenBaja(ID, hash, SECRETO)
    const verificado = verificarTokenBaja(token, SECRETO)

    expect(verificado.ok).toBe(true)
    if (!verificado.ok) return

    expect(
      evaluarContactabilidad(
        {
          email: EMAIL,
          supresiones: [
            { ambito: "EMAIL", emailHash: verificado.emailHash },
          ],
        },
        SECRETO,
      ),
    ).toEqual({ contactable: false, motivo: "SUPRIMIDO_EMAIL" })
  })
})

describe("T-06: modulo puro sin PII, red, Prisma ni entorno (AC-41)", () => {
  const ROOT = process.cwd()
  const FUENTE = "src/lib/propuestas/supresion.ts"

  it("no importa Prisma, red, entorno, logging ni proveedores", () => {
    const fuente = readFileSync(path.join(ROOT, FUENTE), "utf8")

    expect(fuente).not.toMatch(/@prisma\/client|prisma\./)
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
    expect(fuente).not.toMatch(/node:(?:http|https|dns|net|tls|dgram)/)
    expect(fuente).not.toMatch(/\bprocess\.env\b/)
    expect(fuente).not.toMatch(/\bconsole\./)
    expect(fuente).not.toMatch(/\b(?:logger|captureException|Resend|resend)\b/)
  })
})
