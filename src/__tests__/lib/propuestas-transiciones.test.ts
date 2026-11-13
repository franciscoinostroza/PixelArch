import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ESTADOS_ENVIO,
  ESTADOS_PROSPECTO,
  evaluarEdicionEnvio,
  evaluarNuevoMensaje,
  puedeAprobar,
  puedeEnviar,
  siguienteSecuencia,
  transicionEnvioPermitida,
  transicionProspectoPermitida,
  type ConfiguracionAprobacion,
  type ConfiguracionEnvio,
  type EntradaAprobacion,
  type EntradaEnvio,
  type ResultadoPermiso,
} from "@/lib/propuestas/transiciones"

/**
 * T-07 (AC-24, AC-27, AC-31; RF-38, RF-42..45): transiciones y permisos.
 *
 * Reglas verificadas:
 * - aprobar no envia y exige email, no supresion, plantilla y configuracion;
 * - enviar exige aprobacion vigente, hashes coincidentes, cupo y configuracion;
 * - editar un aprobado invalida la aprobacion;
 * - el maximo de mensajes se respeta y no hay cola ni automatismo;
 * - toda entrada malformada falla cerrado sin lanzar ni filtrar PII.
 *
 * Modulo puro: no hay Prisma, red, emails, Resend, secretos reales ni fechas.
 */

const EMAIL = "info@consultora-ejemplo.com"
const OTRO_EMAIL = "ventas@otra-empresa.com"
const HASH = "a".repeat(64)
const OTRO_HASH = "b".repeat(64)

const CONFIG_APROBACION: ConfiguracionAprobacion = {
  secreto: true,
  urlPublica: true,
  fromEmail: true,
  replyTo: true,
  textoLegal: true,
  baseLegal: true,
}

const CONFIG_ENVIO: ConfiguracionEnvio = {
  ...CONFIG_APROBACION,
  envioHabilitado: true,
  resend: true,
}

function aprobacionValida(
  overrides: Partial<EntradaAprobacion> = {},
): EntradaAprobacion {
  return {
    estadoEnvio: "BORRADOR",
    hashContenido: HASH,
    email: EMAIL,
    prospectoEstado: "BORRADOR",
    contactabilidad: { contactable: true },
    plantilla: { activa: true, version: 1 },
    hayOtroEnvioPendiente: false,
    secuencia: { numero: 1, maximo: 2 },
    config: CONFIG_APROBACION,
    ...overrides,
  }
}

function envioValido(overrides: Partial<EntradaEnvio> = {}): EntradaEnvio {
  return {
    estadoEnvio: "APROBADO",
    aprobadoHash: HASH,
    snapshotHash: HASH,
    hashContenido: HASH,
    hashContenidoActual: HASH,
    destinatario: EMAIL,
    email: EMAIL,
    contactabilidad: { contactable: true },
    cupo: { permitido: true, restantes: 10 },
    config: CONFIG_ENVIO,
    ...overrides,
  }
}

function motivosDe(resultado: ResultadoPermiso): string[] {
  return resultado.ok ? [] : resultado.motivos
}

function incluye(resultado: ResultadoPermiso, fragmento: string): boolean {
  const buscado = fragmento.toLowerCase()
  return motivosDe(resultado).some((motivo) =>
    motivo.toLowerCase().includes(buscado),
  )
}

describe("T-07: puedeAprobar (AC-24, AC-27, AC-31)", () => {
  it("permite aprobar un borrador completo", () => {
    expect(puedeAprobar(aprobacionValida())).toEqual({ ok: true })
  })

  it("no exige el gate de envio ni la clave de Resend: aprobar no envia", () => {
    const config: ConfiguracionEnvio = {
      ...CONFIG_APROBACION,
      envioHabilitado: false,
      resend: false,
    }

    expect(puedeAprobar(aprobacionValida({ config }))).toEqual({ ok: true })
  })

  it("rechaza sin email y sin contactabilidad verificada", () => {
    const sinEmail = puedeAprobar(aprobacionValida({ email: null }))
    expect(sinEmail.ok).toBe(false)
    expect(incluye(sinEmail, "email")).toBe(true)

    const sinContactabilidad = puedeAprobar(
      aprobacionValida({ contactabilidad: null }),
    )
    expect(sinContactabilidad.ok).toBe(false)
    expect(incluye(sinContactabilidad, "contactabilidad")).toBe(true)
  })

  it("rechaza un email malformado aunque exista (AC-27)", () => {
    for (const email of [
      "no-es-email",
      "info@",
      "@consultora-ejemplo.com",
      "info @consultora-ejemplo.com",
    ]) {
      const resultado = puedeAprobar(aprobacionValida({ email }))

      expect(resultado.ok, email).toBe(false)
      expect(incluye(resultado, "email"), email).toBe(true)
    }
  })

  it("rechaza email suprimido o dominio suprimido (T-06)", () => {
    const suprimido = puedeAprobar(
      aprobacionValida({
        contactabilidad: { contactable: false, motivo: "SUPRIMIDO_EMAIL" },
      }),
    )
    expect(suprimido.ok).toBe(false)
    expect(incluye(suprimido, "suprimido")).toBe(true)

    const dominio = puedeAprobar(
      aprobacionValida({
        contactabilidad: { contactable: false, motivo: "SUPRIMIDO_DOMINIO" },
      }),
    )
    expect(dominio.ok).toBe(false)
    expect(incluye(dominio, "dominio")).toBe(true)
  })

  it("rechaza un prospecto suprimido o descartado", () => {
    for (const estado of ["SUPRIMIDO", "DESCARTADO"]) {
      const resultado = puedeAprobar(
        aprobacionValida({ prospectoEstado: estado }),
      )

      expect(resultado.ok, estado).toBe(false)
    }
  })

  it("falla cerrado si no se puede verificar el estado del prospecto", () => {
    for (const estado of [null, undefined, "", "OTRO"]) {
      const resultado = puedeAprobar(
        aprobacionValida({ prospectoEstado: estado }),
      )

      expect(resultado.ok, String(estado)).toBe(false)
      expect(incluye(resultado, "estado del prospecto")).toBe(true)
    }
  })

  it("rechaza un envio que no esta en BORRADOR", () => {
    for (const estado of ["APROBADO", "ENVIANDO", "ENVIADO", "FALLIDO"]) {
      const resultado = puedeAprobar(aprobacionValida({ estadoEnvio: estado }))

      expect(resultado.ok, estado).toBe(false)
      expect(incluye(resultado, "BORRADOR"), estado).toBe(true)
    }
  })

  it("rechaza si falta el hash del borrador", () => {
    for (const hash of [null, "", "   "]) {
      const resultado = puedeAprobar(
        aprobacionValida({ hashContenido: hash }),
      )

      expect(resultado.ok, String(hash)).toBe(false)
      expect(incluye(resultado, "hash")).toBe(true)
    }
  })

  it("exige una plantilla activa con version valida", () => {
    const invalidas: Array<EntradaAprobacion["plantilla"]> = [
      null,
      undefined,
      { activa: false, version: 1 },
      { activa: true, version: 0 },
      { activa: true, version: 1.5 },
      { activa: true, version: null },
    ]

    for (const plantilla of invalidas) {
      const resultado = puedeAprobar(aprobacionValida({ plantilla }))

      expect(resultado.ok, JSON.stringify(plantilla)).toBe(false)
      expect(incluye(resultado, "plantilla")).toBe(true)
    }
  })

  it("rechaza si hay otro envio pendiente o no se pudo verificar", () => {
    const otro = puedeAprobar(
      aprobacionValida({ hayOtroEnvioPendiente: true }),
    )
    expect(otro.ok).toBe(false)
    expect(incluye(otro, "existe un envio")).toBe(true)

    const desconocido = puedeAprobar(
      aprobacionValida({ hayOtroEnvioPendiente: undefined }),
    )
    expect(desconocido.ok).toBe(false)
    expect(incluye(desconocido, "no se pudo verificar")).toBe(true)
  })

  it("exige la configuracion de aprobacion completa", () => {
    const casos: Array<[Partial<ConfiguracionAprobacion>, string]> = [
      [{ ...CONFIG_APROBACION, secreto: false }, "PROPUESTAS_SECRETO"],
      [{ ...CONFIG_APROBACION, urlPublica: false }, "NEXT_PUBLIC_URL"],
      [{ ...CONFIG_APROBACION, fromEmail: false }, "PROPUESTAS_FROM_EMAIL"],
      [{ ...CONFIG_APROBACION, replyTo: false }, "PROPUESTAS_REPLY_TO"],
      [{ ...CONFIG_APROBACION, textoLegal: false }, "PROPUESTAS_TEXTO_LEGAL"],
      [{ ...CONFIG_APROBACION, baseLegal: false }, "PROPUESTAS_BASE_LEGAL"],
    ]

    for (const [config, fragmento] of casos) {
      const resultado = puedeAprobar(aprobacionValida({ config }))

      expect(resultado.ok, fragmento).toBe(false)
      expect(incluye(resultado, fragmento), fragmento).toBe(true)
    }

    const sinConfig = puedeAprobar(aprobacionValida({ config: null }))
    expect(sinConfig.ok).toBe(false)
    expect(motivosDe(sinConfig).length).toBe(6)
  })

  it("falla cerrado si un flag de config no es booleano (AC-27)", () => {
    const config = {
      ...CONFIG_APROBACION,
      secreto: "true" as unknown as boolean,
    }

    const resultado = puedeAprobar(aprobacionValida({ config }))

    expect(resultado.ok).toBe(false)
    expect(incluye(resultado, "PROPUESTAS_SECRETO")).toBe(true)
  })

  it("exige una secuencia valida dentro del maximo", () => {
    const supera = puedeAprobar(
      aprobacionValida({ secuencia: { numero: 3, maximo: 2 } }),
    )
    expect(supera.ok).toBe(false)
    expect(incluye(supera, "maximo")).toBe(true)

    const maximoInvalido = puedeAprobar(
      aprobacionValida({ secuencia: { numero: 1, maximo: 0 } }),
    )
    expect(maximoInvalido.ok).toBe(false)
    expect(incluye(maximoInvalido, "maximo")).toBe(true)

    const numeroInvalido = puedeAprobar(
      aprobacionValida({ secuencia: { numero: 0, maximo: 2 } }),
    )
    expect(numeroInvalido.ok).toBe(false)
    expect(incluye(numeroInvalido, "secuencia")).toBe(true)
  })

  it("acepta estados y emails sin distinguir mayusculas", () => {
    expect(
      puedeAprobar(
        aprobacionValida({
          estadoEnvio: "borrador",
          email: " INFO@CONSULTORA-EJEMPLO.COM ",
        }),
      ),
    ).toEqual({ ok: true })
  })

  it("falla cerrado con entradas ausentes o malformadas", () => {
    const entradas = [
      undefined,
      null,
      {},
      "texto",
      42,
      { config: "no-es-objeto" },
    ]

    for (const entrada of entradas) {
      const resultado = puedeAprobar(
        entrada as unknown as EntradaAprobacion | null | undefined,
      )

      expect(resultado.ok, String(entrada)).toBe(false)
      expect(motivosDe(resultado).length).toBeGreaterThan(0)
    }
  })

  it("no filtra email, hash ni secretos en los motivos", () => {
    const resultado = puedeAprobar(
      aprobacionValida({
        email: null,
        contactabilidad: null,
        plantilla: null,
        config: null,
      }),
    )

    const serializado = JSON.stringify(resultado)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain(HASH)
  })
})

describe("T-07: puedeEnviar (AC-24, AC-27, AC-31)", () => {
  it("permite enviar una aprobacion vigente y completa", () => {
    expect(puedeEnviar(envioValido())).toEqual({ ok: true })
  })

  it("rechaza si no esta APROBADO", () => {
    for (const estado of [
      "BORRADOR",
      "ENVIANDO",
      "ENVIADO",
      "FALLIDO",
      "CANCELADO",
    ]) {
      const resultado = puedeEnviar(envioValido({ estadoEnvio: estado }))

      expect(resultado.ok, estado).toBe(false)
      expect(incluye(resultado, "APROBADO"), estado).toBe(true)
    }
  })

  it("rechaza si falta o no coincide el hash del snapshot aprobado", () => {
    const faltante = puedeEnviar(envioValido({ aprobadoHash: null }))
    expect(faltante.ok).toBe(false)
    expect(incluye(faltante, "snapshot")).toBe(true)

    const distinto = puedeEnviar(envioValido({ snapshotHash: OTRO_HASH }))
    expect(distinto.ok).toBe(false)
    expect(incluye(distinto, "no coincide")).toBe(true)
  })

  it("rechaza si el borrador cambio desde la aprobacion", () => {
    const cambiado = puedeEnviar(
      envioValido({ hashContenidoActual: OTRO_HASH }),
    )
    expect(cambiado.ok).toBe(false)
    expect(incluye(cambiado, "cambio desde la aprobacion")).toBe(true)

    const faltante = puedeEnviar(envioValido({ hashContenido: null }))
    expect(faltante.ok).toBe(false)
    expect(incluye(faltante, "hash")).toBe(true)
  })

  it("rechaza si el destinatario no coincide con el email del prospecto", () => {
    const resultado = puedeEnviar(
      envioValido({ destinatario: OTRO_EMAIL }),
    )

    expect(resultado.ok).toBe(false)
    expect(incluye(resultado, "destinatario")).toBe(true)
  })

  it("rechaza sin email o con el contacto suprimido", () => {
    const sinEmail = puedeEnviar(envioValido({ email: null }))
    expect(sinEmail.ok).toBe(false)
    expect(incluye(sinEmail, "email")).toBe(true)

    const suprimido = puedeEnviar(
      envioValido({
        contactabilidad: { contactable: false, motivo: "SUPRIMIDO_EMAIL" },
      }),
    )
    expect(suprimido.ok).toBe(false)
    expect(incluye(suprimido, "suprimido")).toBe(true)

    const dominio = puedeEnviar(
      envioValido({
        contactabilidad: { contactable: false, motivo: "SUPRIMIDO_DOMINIO" },
      }),
    )
    expect(dominio.ok).toBe(false)
    expect(incluye(dominio, "dominio")).toBe(true)
  })

  it("rechaza sin cupo disponible y falla cerrado si no se puede verificar", () => {
    const agotado = puedeEnviar(
      envioValido({ cupo: { permitido: false, restantes: 0 } }),
    )
    expect(agotado.ok).toBe(false)
    expect(incluye(agotado, "cupo")).toBe(true)

    for (const cupo of [null, undefined, {}]) {
      const resultado = puedeEnviar(envioValido({ cupo }))

      expect(resultado.ok, JSON.stringify(cupo)).toBe(false)
      expect(incluye(resultado, "cupo")).toBe(true)
    }
  })

  it("no acepta un cupo truthy que no sea booleano (AC-27)", () => {
    const resultado = puedeEnviar(
      envioValido({
        cupo: { permitido: "true" as unknown as boolean, restantes: 10 },
      }),
    )

    expect(resultado.ok).toBe(false)
    expect(incluye(resultado, "cupo")).toBe(true)
  })

  it("exige la configuracion de envio completa", () => {
    const casos: Array<[Partial<ConfiguracionEnvio>, string]> = [
      [
        { ...CONFIG_ENVIO, envioHabilitado: false },
        "PROPUESTAS_ENVIO_HABILITADO",
      ],
      [{ ...CONFIG_ENVIO, resend: false }, "RESEND_API_KEY"],
      [{ ...CONFIG_ENVIO, secreto: false }, "PROPUESTAS_SECRETO"],
      [{ ...CONFIG_ENVIO, urlPublica: false }, "NEXT_PUBLIC_URL"],
      [{ ...CONFIG_ENVIO, fromEmail: false }, "PROPUESTAS_FROM_EMAIL"],
      [{ ...CONFIG_ENVIO, replyTo: false }, "PROPUESTAS_REPLY_TO"],
      [{ ...CONFIG_ENVIO, textoLegal: false }, "PROPUESTAS_TEXTO_LEGAL"],
      [{ ...CONFIG_ENVIO, baseLegal: false }, "PROPUESTAS_BASE_LEGAL"],
    ]

    for (const [config, fragmento] of casos) {
      const resultado = puedeEnviar(envioValido({ config }))

      expect(resultado.ok, fragmento).toBe(false)
      expect(incluye(resultado, fragmento), fragmento).toBe(true)
    }

    const sinConfig = puedeEnviar(envioValido({ config: null }))
    expect(sinConfig.ok).toBe(false)
    expect(motivosDe(sinConfig).length).toBe(8)
  })

  it("el gate de envio exige `true` booleano, no un string (AC-27)", () => {
    const config = {
      ...CONFIG_ENVIO,
      envioHabilitado: "true" as unknown as boolean,
    }

    const resultado = puedeEnviar(envioValido({ config }))

    expect(resultado.ok).toBe(false)
    expect(incluye(resultado, "PROPUESTAS_ENVIO_HABILITADO")).toBe(true)
  })

  it("no se puede enviar despues de editar un aprobado (AC-24)", () => {
    const edicion = evaluarEdicionEnvio("APROBADO")
    expect(edicion.permitido).toBe(true)
    expect(edicion.crearVersion).toBe(true)
    expect(edicion.invalidarAprobacion).toBe(true)

    // La edicion deja el envio en una version BORRADOR y cambia el hash.
    const editado = puedeEnviar(
      envioValido({
        estadoEnvio: "BORRADOR",
        hashContenido: OTRO_HASH,
        hashContenidoActual: OTRO_HASH,
      }),
    )
    expect(editado.ok).toBe(false)
    expect(incluye(editado, "APROBADO")).toBe(true)

    // Aunque se fuerce APROBADO, el hash del borrador ya no coincide.
    const hashViejo = puedeEnviar(
      envioValido({ hashContenidoActual: OTRO_HASH }),
    )
    expect(hashViejo.ok).toBe(false)
    expect(incluye(hashViejo, "cambio desde la aprobacion")).toBe(true)
  })

  it("falla cerrado con entradas ausentes o malformadas", () => {
    const entradas = [
      undefined,
      null,
      {},
      "texto",
      42,
      { config: "no-es-objeto" },
    ]

    for (const entrada of entradas) {
      const resultado = puedeEnviar(
        entrada as unknown as EntradaEnvio | null | undefined,
      )

      expect(resultado.ok, String(entrada)).toBe(false)
      expect(motivosDe(resultado).length).toBeGreaterThan(0)
    }
  })

  it("no filtra email, destinatario ni hash en los motivos", () => {
    const resultado = puedeEnviar(
      envioValido({
        email: null,
        destinatario: null,
        aprobadoHash: null,
        snapshotHash: null,
        hashContenido: null,
        hashContenidoActual: null,
        config: null,
        cupo: null,
      }),
    )

    const serializado = JSON.stringify(resultado)
    expect(serializado).not.toContain(EMAIL)
    expect(serializado).not.toContain(OTRO_EMAIL)
    expect(serializado).not.toContain(HASH)
  })
})

describe("T-07: evaluarEdicionEnvio (AC-24; RF-38)", () => {
  it("edita en sitio un BORRADOR sin crear version ni invalidar nada", () => {
    expect(evaluarEdicionEnvio("BORRADOR")).toEqual({
      permitido: true,
      crearVersion: false,
      invalidarAprobacion: false,
      motivos: [],
    })
  })

  it("editar un APROBADO crea version nueva e invalida la aprobacion", () => {
    expect(evaluarEdicionEnvio("APROBADO")).toEqual({
      permitido: true,
      crearVersion: true,
      invalidarAprobacion: true,
      motivos: [],
    })
  })

  it("acepta el estado sin distinguir mayusculas", () => {
    expect(evaluarEdicionEnvio("aprobado").invalidarAprobacion).toBe(true)
    expect(evaluarEdicionEnvio("borrador").crearVersion).toBe(false)
  })

  it("no permite editar estados terminales o en curso", () => {
    const noEditables = ESTADOS_ENVIO.filter(
      (estado) => estado !== "BORRADOR" && estado !== "APROBADO",
    )

    for (const estado of noEditables) {
      const resultado = evaluarEdicionEnvio(estado)

      expect(resultado.permitido, estado).toBe(false)
      expect(resultado.crearVersion, estado).toBe(false)
      expect(resultado.invalidarAprobacion, estado).toBe(false)
      expect(resultado.motivos.length, estado).toBeGreaterThan(0)
    }

    for (const invalido of [null, undefined, "OTRO"]) {
      expect(evaluarEdicionEnvio(invalido).permitido).toBe(false)
    }
  })
})

describe("T-07: siguiente secuencia y maximo de mensajes (AC-31)", () => {
  it("empieza en 1 y usa el maximo valido + 1", () => {
    expect(siguienteSecuencia([])).toBe(1)
    expect(siguienteSecuencia([1])).toBe(2)
    expect(siguienteSecuencia([1, 2])).toBe(3)
    expect(siguienteSecuencia([2, 1])).toBe(3)
    expect(siguienteSecuencia([1, 1])).toBe(2)
    expect(siguienteSecuencia([1, 3])).toBe(4)
  })

  it("ignora valores invalidos y entradas que no son arreglos", () => {
    expect(siguienteSecuencia(null)).toBe(1)
    expect(siguienteSecuencia(undefined)).toBe(1)
    expect(
      siguienteSecuencia("no-es-arreglo" as unknown as readonly number[]),
    ).toBe(1)

    const invalidos = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null]
    expect(
      siguienteSecuencia(invalidos as unknown as readonly number[]),
    ).toBe(1)

    expect(
      siguienteSecuencia([1, "2", 0, null] as unknown as readonly number[]),
    ).toBe(2)
  })

  it("permite inicial y follow-up con maximo 2, y bloquea el tercero", () => {
    const inicial = evaluarNuevoMensaje({ secuencias: [], maximo: 2 })
    expect(inicial).toEqual({ ok: true, secuencia: 1 })

    const followUp = evaluarNuevoMensaje({ secuencias: [1], maximo: 2 })
    expect(followUp).toEqual({ ok: true, secuencia: 2 })

    const tercero = evaluarNuevoMensaje({ secuencias: [1, 2], maximo: 2 })
    expect(tercero.ok).toBe(false)
    if (tercero.ok) return

    expect(tercero.secuencia).toBe(3)
    expect(tercero.motivos.join(" ").toLowerCase()).toContain("maximo")
  })

  it("respeta un maximo configurado distinto de 2", () => {
    expect(evaluarNuevoMensaje({ secuencias: [], maximo: 1 })).toEqual({
      ok: true,
      secuencia: 1,
    })

    const segundo = evaluarNuevoMensaje({ secuencias: [1], maximo: 1 })
    expect(segundo.ok).toBe(false)

    expect(
      evaluarNuevoMensaje({ secuencias: [1, 2], maximo: 3 }),
    ).toEqual({ ok: true, secuencia: 3 })
  })

  it("falla cerrado con maximo invalido o entrada malformada", () => {
    for (const maximo of [null, undefined, 0, -1, 1.5, Number.NaN]) {
      const resultado = evaluarNuevoMensaje({
        secuencias: [],
        maximo: maximo as number | null | undefined,
      })

      expect(resultado.ok, String(maximo)).toBe(false)
      if (!resultado.ok) {
        expect(resultado.motivos.join(" ").toLowerCase()).toContain("maximo")
      }
    }

    for (const entrada of [undefined, null, {}]) {
      const resultado = evaluarNuevoMensaje(entrada)
      expect(resultado.ok).toBe(false)
    }
  })

  it("el resultado no contiene programacion ni cola, solo secuencia", () => {
    const resultado = evaluarNuevoMensaje({ secuencias: [1], maximo: 2 })

    expect(Object.keys(resultado).sort()).toEqual(["ok", "secuencia"])
    expect(JSON.stringify(resultado)).not.toContain("scheduled")
    expect(JSON.stringify(resultado)).not.toContain("programado")
  })
})

describe("T-07: mapas de transiciones (AC-27, AC-31)", () => {
  it("permite solo transiciones validas de envio", () => {
    const validas: Array<[string, string]> = [
      ["BORRADOR", "APROBADO"],
      ["BORRADOR", "CANCELADO"],
      ["APROBADO", "ENVIANDO"],
      ["APROBADO", "CANCELADO"],
      ["ENVIANDO", "ENVIADO"],
      ["ENVIANDO", "FALLIDO"],
      ["ENVIADO", "REBOTADO"],
      ["ENVIADO", "QUEJA"],
      ["ENVIADO", "RESPONDIDO"],
    ]

    for (const [desde, hacia] of validas) {
      expect(transicionEnvioPermitida(desde, hacia), `${desde}->${hacia}`).toBe(
        true,
      )
    }

    const invalidas: Array<[string, string]> = [
      ["BORRADOR", "ENVIADO"],
      ["APROBADO", "BORRADOR"],
      ["ENVIADO", "CANCELADO"],
      ["FALLIDO", "BORRADOR"],
      ["BORRADOR", "BORRADOR"],
      ["OTRO", "APROBADO"],
    ]

    for (const [desde, hacia] of invalidas) {
      expect(
        transicionEnvioPermitida(desde, hacia),
        `${desde}->${hacia}`,
      ).toBe(false)
    }

    expect(transicionEnvioPermitida(null, "APROBADO")).toBe(false)
    expect(transicionEnvioPermitida("BORRADOR", null)).toBe(false)
  })

  it("permite el flujo del prospecto y sus salidas terminales", () => {
    const validas: Array<[string, string]> = [
      ["NUEVO", "SIN_ENRIQUECER"],
      ["NUEVO", "ENRIQUECIDO"],
      ["ENRIQUECIDO", "PUNTUADO"],
      ["SIN_ENRIQUECER", "PUNTUADO"],
      ["PUNTUADO", "BORRADOR"],
      ["BORRADOR", "APROBADO"],
      ["APROBADO", "ENVIADO"],
      ["ENVIADO", "RESPONDIO"],
      ["NUEVO", "DESCARTADO"],
      ["PUNTUADO", "SUPRIMIDO"],
      ["ENVIADO", "SUPRIMIDO"],
    ]

    for (const [desde, hacia] of validas) {
      expect(
        transicionProspectoPermitida(desde, hacia),
        `${desde}->${hacia}`,
      ).toBe(true)
    }

    const invalidas: Array<[string, string]> = [
      ["SUPRIMIDO", "BORRADOR"],
      ["DESCARTADO", "NUEVO"],
      ["PUNTUADO", "ENVIADO"],
      ["NUEVO", "PUNTUADO"],
      ["OTRO", "NUEVO"],
    ]

    for (const [desde, hacia] of invalidas) {
      expect(
        transicionProspectoPermitida(desde, hacia),
        `${desde}->${hacia}`,
      ).toBe(false)
    }
  })

  it("los estados declarados coinciden con los del esquema", () => {
    expect(ESTADOS_ENVIO).toEqual([
      "BORRADOR",
      "APROBADO",
      "ENVIANDO",
      "ENVIADO",
      "FALLIDO",
      "REBOTADO",
      "QUEJA",
      "RESPONDIDO",
      "CANCELADO",
    ])
    expect(ESTADOS_PROSPECTO).toEqual([
      "NUEVO",
      "SIN_ENRIQUECER",
      "ENRIQUECIDO",
      "PUNTUADO",
      "BORRADOR",
      "APROBADO",
      "ENVIADO",
      "RESPONDIO",
      "DESCARTADO",
      "SUPRIMIDO",
    ])
  })
})

describe("T-18: follow-up manual tras ENVIADO (AC-31; RF-50)", () => {
  it("ENVIADO -> BORRADOR habilita un segundo mensaje manual", () => {
    expect(transicionProspectoPermitida("ENVIADO", "BORRADOR")).toBe(true)
    expect(transicionProspectoPermitida("ENVIADO", "RESPONDIO")).toBe(true)
    // Un follow-up no puede saltarse el borrador ni la aprobacion.
    expect(transicionProspectoPermitida("ENVIADO", "APROBADO")).toBe(false)
    expect(transicionProspectoPermitida("ENVIADO", "ENVIADO")).toBe(false)
  })

  it("permite el segundo mensaje y bloquea el tercero por maximo", () => {
    const segundo = evaluarNuevoMensaje({ secuencias: [1], maximo: 2 })
    expect(segundo).toEqual({ ok: true, secuencia: 2 })

    const tercero = evaluarNuevoMensaje({ secuencias: [1, 2], maximo: 2 })
    expect(tercero.ok).toBe(false)
    if (tercero.ok) return
    expect(tercero.secuencia).toBe(3)
    expect(tercero.motivos.join(" ")).toMatch(/máximo|maximo/i)
  })

  it("el follow-up exige un borrador nuevo y una aprobacion nueva", () => {
    // El prospecto ya contactado puede volver a BORRADOR, pero el envio nuevo
    // arranca en BORRADOR: no se envia hasta aprobarlo explicitamente.
    expect(
      puedeAprobar(
        aprobacionValida({
          prospectoEstado: "ENVIADO",
          secuencia: { numero: 2, maximo: 2 },
        }),
      ),
    ).toEqual({ ok: true })

    const sinAprobar = puedeEnviar(
      envioValido({
        estadoEnvio: "BORRADOR",
        hashContenido: OTRO_HASH,
        hashContenidoActual: OTRO_HASH,
      }),
    )
    expect(sinAprobar.ok).toBe(false)
    expect(incluye(sinAprobar, "APROBADO")).toBe(true)
  })

  it("no hay automatismo: la secuencia es solo numeracion manual", () => {
    const resultado = evaluarNuevoMensaje({ secuencias: [1], maximo: 2 })

    expect(Object.keys(resultado).sort()).toEqual(["ok", "secuencia"])
    expect(JSON.stringify(resultado)).not.toMatch(
      /scheduled|cron|queue|cola|automatico|automático/i,
    )
  })
})

describe("T-07: transiciones puras sin red, Prisma ni entorno (AC-27, AC-41)", () => {
  const FUENTE = "src/lib/propuestas/transiciones.ts"

  it("no importa proveedores, red, entorno, logging ni azar", () => {
    const fuente = readFileSync(path.join(process.cwd(), FUENTE), "utf8")

    expect(fuente).not.toMatch(/@prisma\/client|prisma\./)
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
    expect(fuente).not.toMatch(/node:(?:http|https|dns|net|tls|crypto)/)
    expect(fuente).not.toMatch(/\bprocess\.env\b/)
    expect(fuente).not.toMatch(/\bMath\.random\b/)
    expect(fuente).not.toMatch(/\bDate\.now\b|new Date\b/)
    expect(fuente).not.toMatch(/\b(?:console|logger|captureException)\b/)
    expect(fuente).not.toMatch(/from "resend"|getResend|api\.resend\.com/i)
  })

  it("solo toma el tipo de T-06, sin reimplementar supresion ni multiinquilino", () => {
    const fuente = readFileSync(path.join(process.cwd(), FUENTE), "utf8")

    expect(fuente).toMatch(
      /import type \{ ResultadoContactabilidad \} from "\.\/supresion"/,
    )
    expect(fuente).not.toMatch(/createHmac|timingSafeEqual|hashEmail/)
    expect(fuente).not.toMatch(/gmail\.com|wordpress\.com/i)
    expect(fuente).not.toMatch(/esDominioMultiinquilino|esProveedorPublico/)
  })
})
