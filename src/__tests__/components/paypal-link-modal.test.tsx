import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-20 (AC-1, AC-2, AC-3, AC-14, AC-16, AC-23, AC-24, AC-26): modal accesible
 * de link PayPal.
 *
 * Cubre apertura/cierre, teclado (foco inicial, trampa, Escape, retorno),
 * preview de comision/total sin floats, meses de soporte, idioma, generar /
 * reutilizar / regenerar (incluido soporte de N meses), edicion con link
 * vigente, 409 REQUIERE_REGENERAR, copia con canal COPIA, WhatsApp, email,
 * errores, timeout/abort y el estado deshabilitado sin configuracion. No hay
 * red: `fetch` y los callbacks estan mockeados.
 */

import {
  GenerarLinkPaypalButton,
  type GenerarLinkPaypalButtonProps,
} from "@/components/ui/generar-link-paypal-button"
import {
  MENSAJE_PAYPAL_NO_DISPONIBLE,
  PaypalLinkModal,
  PaypalLinkRequiereRegenerarError,
  type PaypalEnlaceGenerado,
  type PaypalEnlaceExistente,
  type PaypalEnviarRequest,
  type PaypalEnviarResult,
  type PaypalLinkModalProps,
} from "@/components/ui/paypal-link-modal"

const TELEFONO = "+54 9 11 1234-5678"
const TELEFONO_DIGITOS = "5491112345678"
const TEXTO_WHATSAPP =
  "Hola! Te paso el detalle del cobro por PayPal: https://pixelarch.dev/pago/paypal/token-1"
const TEXTO_COPIA =
  "Hola! Te paso el detalle del cobro por PayPal: https://pixelarch.dev/pago/paypal/token-1"

const BASE_PROPS = {
  feeBps: 540,
  feeFixedCents: 30,
  paypalDisponible: true,
} as const

/**
 * `true` solo si `K` es una prop obligatoria de `T`: un objeto vacio deja de
 * ser asignable a `Pick<T, K>` en cuanto la prop es opcional.
 */
type EsRequerida<T, K extends keyof T> = Record<never, never> extends Pick<T, K>
  ? never
  : true

function enFuturo(dias = 10): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
}

function enlaceGenerado(
  overrides: Partial<PaypalEnlaceGenerado> = {}
): PaypalEnlaceGenerado {
  return {
    enlaceId: "enlace_1",
    url: "https://pixelarch.dev/pago/paypal/token-1",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    expiraEn: enFuturo(),
    reutilizado: false,
    ...overrides,
  }
}

const EXISTENTE: PaypalEnlaceExistente = {
  enlaceId: "enlace_vigente",
  url: "https://pixelarch.dev/pago/paypal/vigente",
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  expiraEn: enFuturo(),
  reutilizado: true,
}

function respuestaEnvio(canal: "EMAIL" | "WHATSAPP" | "COPIA"): PaypalEnviarResult {
  if (canal === "EMAIL") {
    return {
      ok: true,
      canal: "EMAIL",
      enviado: true,
      mensaje: { asunto: "Cobro por PayPal", cuerpo: "Detalle del cobro" },
    }
  }

  return {
    ok: true,
    canal,
    enviado: false,
    mensaje: {
      texto: canal === "COPIA" ? TEXTO_COPIA : TEXTO_WHATSAPP,
    },
  }
}

function renderBoton(
  overrides: Partial<ComponentProps<typeof GenerarLinkPaypalButton>> = {}
) {
  const generarLink = vi.fn(
    async (): Promise<PaypalEnlaceGenerado> => enlaceGenerado()
  )
  const enviarLink = vi.fn(
    async (input: PaypalEnviarRequest): Promise<PaypalEnviarResult> =>
      respuestaEnvio(input.canal)
  )

  const resultado = render(
    <GenerarLinkPaypalButton
      concepto={{ tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" }}
      montoAcordadoDefaultCents={10050}
      {...BASE_PROPS}
      generarLink={generarLink}
      enviarLink={enviarLink}
      clienteTelefono={TELEFONO}
      {...overrides}
    />
  )

  return { ...resultado, generarLink, enviarLink }
}

function renderModal(overrides: Partial<PaypalLinkModalProps> = {}) {
  return render(
    <PaypalLinkModal
      open
      onClose={() => {}}
      concepto={{ tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" }}
      montoAcordadoDefaultCents={10050}
      {...BASE_PROPS}
      {...overrides}
    />
  )
}

async function abrirModal() {
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: /Generar link PayPal/ })
  await user.click(trigger)
  return { user, trigger }
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("PaypalLinkModal: apertura y accesibilidad (AC-23)", () => {
  it("abre el dialogo desde el boton y lo cierra con Cancelar devolviendo el foco", async () => {
    renderBoton()
    const { user, trigger } = await abrirModal()

    const dialog = screen.getByRole("dialog", { name: "Link de pago PayPal" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(dialog).toHaveFocus()

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("cierra con Escape y devuelve el foco al disparador", async () => {
    renderBoton()
    const { user, trigger } = await abrirModal()

    expect(screen.getByRole("dialog")).toHaveFocus()
    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("atrapa el foco con Tab y Shift+Tab dentro del dialogo", async () => {
    renderBoton()
    const { user } = await abrirModal()
    const dialog = screen.getByRole("dialog")

    for (let i = 0; i < 8; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    for (let i = 0; i < 4; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it("anuncia el estado con aria-live y expone errores con role=alert", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> => {
        throw new Error("PayPal no pudo crear el checkout.")
      }
    )

    renderBoton({ generarLink })
    const { user } = await abrirModal()

    const estado = screen.getByRole("status")
    expect(estado).toHaveAttribute("aria-live", "polite")

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PayPal no pudo crear el checkout."
    )
    expect(screen.getByRole("dialog", { name: "Link de pago PayPal" })).toBeInTheDocument()
  })

  it("marca el monto invalido con aria-invalid y un error role=alert", async () => {
    const { generarLink } = renderBoton()
    const { user } = await abrirModal()

    const monto = screen.getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "abc")

    expect(monto).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ingresá un monto válido en USD (por ejemplo 100,50)."
    )
    expect(screen.getByRole("button", { name: "Generar link" })).toBeDisabled()
    expect(generarLink).not.toHaveBeenCalled()
  })

  it("expone el motivo accesible del WhatsApp sin telefono", async () => {
    renderBoton({ clienteTelefono: null })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    const whatsapp = screen.getByRole("button", { name: "Enviar por WhatsApp" })
    expect(whatsapp).toBeDisabled()
    expect(whatsapp).toHaveAttribute(
      "title",
      "El cliente no tiene un teléfono cargado."
    )
    expect(whatsapp).toHaveAccessibleDescription(
      "El cliente no tiene un teléfono cargado."
    )
  })
})

describe("PaypalLinkModal: preview de dinero (AC-1, AC-24, AC-26)", () => {
  it("previsualiza monto, comision y total en centavos es-AR", async () => {
    renderBoton()
    await abrirModal()

    expect(screen.getByText("US$100,50")).toBeInTheDocument()
    expect(screen.getByText("US$6,06")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
    expect(screen.getByText(/Tarifa aplicada: 5,40% \+ US\$0,30/)).toBeInTheDocument()
  })

  it("recalcula el preview al editar el monto sin usar floats", async () => {
    renderBoton()
    const { user } = await abrirModal()

    const monto = screen.getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "1000,50")

    expect(screen.getByText("US$1.000,50")).toBeInTheDocument()
    // ceil((100050 + 30) * 10000 / 9460) = 105793; comision = 5743
    expect(screen.getByText("US$1.057,93")).toBeInTheDocument()
    expect(screen.getByText("US$57,43")).toBeInTheDocument()
  })

  it("con link vigente muestra el snapshot de comision/total y aclara la tarifa actual", async () => {
    renderBoton({
      enlaceExistente: {
        ...EXISTENTE,
        comision: 999,
        total: 11049,
      },
    })
    await abrirModal()

    // Snapshot del link: 10050 + 999 = 11049 (tarifa anterior).
    expect(screen.getByText("US$9,99")).toBeInTheDocument()
    expect(screen.getByText("US$110,49")).toBeInTheDocument()
    expect(
      screen.getByText(/El link vigente conserva el desglose con el que se generó/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Tarifa actual: 5,40% \+ US\$0,30/)
    ).toBeInTheDocument()
    // No debe reemplazar el snapshot por el calculo con la tarifa actual.
    expect(screen.queryByText("US$6,06")).not.toBeInTheDocument()
    expect(screen.queryByText("US$106,56")).not.toBeInTheDocument()
  })

  it("muestra solo meses para soporte y recalcula el monto por mes", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({ montoAcordado: 30000, comision: 1745, total: 31745 })
    )

    renderBoton({
      concepto: { tipo: "soporte", suscripcionId: "suscripcion_1", titulo: "Soporte" },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 2,
      generarLink,
    })
    const { user } = await abrirModal()

    const meses = screen.getByLabelText("Meses")
    expect(meses).toHaveValue("2")
    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveValue("200,00")

    await user.selectOptions(meses, "3")

    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveValue("300,00")
    expect(screen.getByText("US$300,00")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(generarLink).toHaveBeenCalledWith({
      suscripcionId: "suscripcion_1",
      montoAcordadoCents: 30000,
      meses: 3,
      idioma: "es",
      regenerar: false,
    })
  })

  it("no ofrece meses en un hito", async () => {
    renderBoton()
    await abrirModal()

    expect(screen.queryByLabelText("Meses")).not.toBeInTheDocument()
  })

  it("ofrece exactamente los meses 1 a 12 en soporte y envia el limite 12", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({ montoAcordado: 120000, comision: 6883, total: 126883 })
    )

    renderBoton({
      concepto: {
        tipo: "soporte",
        suscripcionId: "suscripcion_1",
        titulo: "Soporte",
      },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 1,
      generarLink,
    })
    const { user } = await abrirModal()

    const meses = screen.getByLabelText("Meses") as HTMLSelectElement
    expect(Array.from(meses.options).map((option) => option.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ])

    await user.selectOptions(meses, "12")

    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveValue("1200,00")
    expect(screen.getByText("US$1.200,00")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(generarLink).toHaveBeenCalledWith({
      suscripcionId: "suscripcion_1",
      montoAcordadoCents: 120000,
      meses: 12,
      idioma: "es",
      regenerar: false,
    })
  })

  it("mantiene el desglose en es-AR al elegir ingles (solo cambia la plantilla)", async () => {
    renderBoton()
    const { user } = await abrirModal()

    await user.selectOptions(screen.getByLabelText("Idioma del mensaje"), "en")

    expect(screen.getByText("US$100,50")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
    expect(screen.queryByText("US$100.50")).not.toBeInTheDocument()
  })
})

describe("PaypalLinkModal: generar, reutilizar y regenerar (AC-1, AC-2, AC-26)", () => {
  it("genera el link, muestra la URL y confirma por aria-live", async () => {
    const { generarLink } = renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Link de pago" })).toHaveValue(
        "https://pixelarch.dev/pago/paypal/token-1"
      )
    })
    expect(screen.getByRole("status")).toHaveTextContent("Link generado.")
    expect(screen.getByText(/✓ Link generado/)).toBeInTheDocument()
    expect(generarLink).toHaveBeenCalledWith({
      hitoId: "hito_1",
      montoAcordadoCents: 10050,
      idioma: "es",
      regenerar: false,
    })
    expect(generarLink).toHaveBeenCalledTimes(1)
  })

  it("envia descripcion y nota interna cuando el caller las informa (RF-3)", async () => {
    const { generarLink } = renderBoton({
      descripcion: "Anticipo",
      notaInterna: "Acordado por email",
    })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith(
        expect.objectContaining({
          descripcion: "Anticipo",
          notaInterna: "Acordado por email",
        })
      )
    )
  })

  it("informa cuando el servidor reutiliza un link vigente", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({ reutilizado: true })
    )

    renderBoton({ generarLink })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Se reutilizó el link vigente."
      )
    )
    expect(screen.getByText(/Link vigente reutilizado/)).toBeInTheDocument()
    expect(generarLink).toHaveBeenCalledTimes(1)
  })

  it("muestra un enlace existente y permite regenerarlo solo si esta vigente", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({
          url: "https://pixelarch.dev/pago/paypal/nuevo",
          reutilizado: false,
        })
    )

    renderBoton({ enlaceExistente: EXISTENTE, generarLink })
    const { user } = await abrirModal()

    expect(screen.getByRole("textbox", { name: "Link de pago" })).toHaveValue(
      EXISTENTE.url
    )
    expect(screen.getByText(/Link vigente reutilizado/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Link de pago" })).toHaveValue(
        "https://pixelarch.dev/pago/paypal/nuevo"
      )
    )
    expect(generarLink).toHaveBeenCalledWith(
      expect.objectContaining({ regenerar: true, montoAcordadoCents: 10050 })
    )
    expect(screen.getByRole("status")).toHaveTextContent("Link regenerado.")
  })

  it("inicializa meses e idioma desde el link existente y regenera soporte con N meses", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({
          montoAcordado: 30000,
          comision: 1745,
          total: 31745,
          meses: 3,
          idioma: "en",
          reutilizado: false,
        })
    )

    renderBoton({
      concepto: {
        tipo: "soporte",
        suscripcionId: "suscripcion_1",
        titulo: "Soporte",
      },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 1,
      enlaceExistente: {
        ...EXISTENTE,
        montoAcordado: 30000,
        comision: 1745,
        total: 31745,
        meses: 3,
        idioma: "en",
      },
      generarLink,
    })
    const { user } = await abrirModal()

    expect(screen.getByLabelText("Meses")).toHaveValue("3")
    expect(screen.getByLabelText("Idioma del mensaje")).toHaveValue("en")
    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveValue("300,00")

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith(
        expect.objectContaining({
          suscripcionId: "suscripcion_1",
          montoAcordadoCents: 30000,
          meses: 3,
          idioma: "en",
          regenerar: true,
        })
      )
    )
    // Nunca debe enviar meses=1 con el total de N meses.
    expect(generarLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ meses: 1 })
    )
  })

  it("ignora un enlace vencido y no ofrece regenerar", async () => {
    renderBoton({
      enlaceExistente: {
        ...EXISTENTE,
        expiraEn: new Date(Date.now() - 60_000).toISOString(),
      },
    })
    await abrirModal()

    expect(
      screen.getByLabelText("Monto acordado (USD)")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Regenerar link" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "Link de pago" })
    ).not.toBeInTheDocument()
  })

  it("muestra la vigencia del enlace vigente reutilizado", async () => {
    renderBoton({ enlaceExistente: EXISTENTE })
    await abrirModal()

    expect(screen.getAllByText(/válido hasta/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Link vigente reutilizado/)).toBeInTheDocument()
  })
})

describe("PaypalLinkModal: edicion con link vigente y 409 (AC-2, AC-26)", () => {
  it("permite editar monto con link vigente y exige confirmacion explicita", async () => {
    const { generarLink } = renderBoton({ enlaceExistente: EXISTENTE })
    const { user } = await abrirModal()

    const monto = screen.getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "120,00")

    expect(generarLink).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Regenerar con estos datos" })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Regenerar con estos datos" })
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Se reemplazará el link vigente/
    )
    expect(generarLink).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Sí, regenerar" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith(
        expect.objectContaining({
          montoAcordadoCents: 12000,
          regenerar: true,
        })
      )
    )
  })

  it("permite editar meses de soporte con confirmacion", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> =>
        enlaceGenerado({
          montoAcordado: 40000,
          comision: 2317,
          total: 42317,
          meses: 4,
          reutilizado: false,
        })
    )

    renderBoton({
      concepto: {
        tipo: "soporte",
        suscripcionId: "suscripcion_1",
        titulo: "Soporte",
      },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 1,
      enlaceExistente: {
        ...EXISTENTE,
        montoAcordado: 30000,
        comision: 1745,
        total: 31745,
        meses: 3,
      },
      generarLink,
    })
    const { user } = await abrirModal()

    await user.selectOptions(screen.getByLabelText("Meses"), "4")

    await user.click(
      screen.getByRole("button", { name: "Regenerar con estos datos" })
    )
    await user.click(screen.getByRole("button", { name: "Sí, regenerar" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith(
        expect.objectContaining({
          montoAcordadoCents: 40000,
          meses: 4,
          regenerar: true,
        })
      )
    )
  })

  it("ofrece regenerar cuando el servidor responde 409 REQUIERE_REGENERAR", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error:
            "Ya existe un link PayPal vigente con otros datos. Regenerelo para aplicar el cambio.",
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          enlaceGenerado({
            url: "https://pixelarch.dev/pago/paypal/regenerado",
            reutilizado: false,
          }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ generarLink: undefined })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Regenerelo/)
    expect(
      screen.getByRole("button", { name: "Regenerar link" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Link de pago" })).toHaveValue(
        "https://pixelarch.dev/pago/paypal/regenerado"
      )
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('"regenerar":true'),
      })
    )
  })

  it("acepta un error de callback marcado como requiere regenerar", async () => {
    const generarLink = vi
      .fn<() => Promise<PaypalEnlaceGenerado>>()
      .mockRejectedValueOnce(
        new PaypalLinkRequiereRegenerarError(
          "Ya existe un link vigente. Regenerelo."
        )
      )
      .mockResolvedValueOnce(
        enlaceGenerado({ url: "https://pixelarch.dev/pago/paypal/nuevo" })
      )

    renderBoton({ generarLink })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Regenerelo/)

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Link de pago" })).toHaveValue(
        "https://pixelarch.dev/pago/paypal/nuevo"
      )
    )
    expect(generarLink).toHaveBeenCalledTimes(2)
    expect(generarLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ regenerar: true })
    )
  })
})

describe("PaypalLinkModal: copiar y enviar (AC-3, AC-14)", () => {
  it("registra el canal COPIA y copia el texto canonico del servidor", async () => {
    const { enviarLink } = renderBoton()
    const { user } = await abrirModal()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    await waitFor(() =>
      expect(enviarLink).toHaveBeenCalledWith({
        enlaceId: "enlace_1",
        canal: "COPIA",
        idioma: "es",
      })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEXTO_COPIA))
    expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Mensaje copiado.")
  })

  it("copia la URL si el servidor no devuelve texto", async () => {
    const enviarLink = vi.fn(
      async (): Promise<PaypalEnviarResult> => ({
        ok: true,
        canal: "COPIA",
        enviado: false,
      })
    )
    renderBoton({ enviarLink })
    const { user } = await abrirModal()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })
    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://pixelarch.dev/pago/paypal/token-1"
      )
    )
  })

  it("usa /api/admin/paypal/enviar con canal COPIA cuando no hay callback", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            canal: "COPIA",
            enviado: false,
            mensaje: { texto: TEXTO_COPIA },
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({
      enlaceExistente: EXISTENTE,
      generarLink: undefined,
      enviarLink: undefined,
    })
    const { user } = await abrirModal()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")

    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/paypal/enviar",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"canal":"COPIA"'),
        })
      )
    )
    expect(writeText).toHaveBeenCalledWith(TEXTO_COPIA)
  })

  it("muestra el error del servidor si falla el registro de COPIA", async () => {
    const enviarLink = vi.fn(
      async (): Promise<PaypalEnviarResult> => {
        throw new Error("No se pudo registrar el envio del cobro.")
      }
    )
    renderBoton({ enviarLink })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })
    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo registrar el envio del cobro."
    )
  })

  it("corta por timeout si /enviar no responde", async () => {
    const enviarLink = vi.fn(
      () => new Promise<PaypalEnviarResult>(() => {})
    )
    renderBoton({ enviarLink, timeoutMs: 25 })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })
    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    const alerta = await screen.findByRole("alert", {}, { timeout: 2000 })
    expect(alerta).toHaveTextContent("La operación tardó demasiado. Reintentá.")
    expect(screen.getByRole("button", { name: "Copiar mensaje" })).toBeEnabled()
  })

  it("envia por WhatsApp usando el texto canonico del servidor", async () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null)
    const { enviarLink } = renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }))

    await waitFor(() =>
      expect(enviarLink).toHaveBeenCalledWith({
        enlaceId: "enlace_1",
        canal: "WHATSAPP",
        idioma: "es",
      })
    )

    const texto = respuestaEnvio("WHATSAPP").mensaje?.texto ?? ""
    expect(abrir).toHaveBeenCalledWith(
      `https://wa.me/${TELEFONO_DIGITOS}?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener,noreferrer"
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Mensaje de WhatsApp listo."
    )
    // La UI nunca imprime el telefono ni otros datos del cliente.
    expect(screen.queryByText(/1234-5678/)).not.toBeInTheDocument()
  })

  it("pre-abre la ventana de WhatsApp antes de esperar al servidor", async () => {
    let resolver: ((resultado: PaypalEnviarResult) => void) | undefined
    const enviarLink = vi.fn(
      () =>
        new Promise<PaypalEnviarResult>((resolve) => {
          resolver = resolve
        })
    )
    const ventana = {
      closed: false,
      opener: null as unknown,
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window
    const abrir = vi.spyOn(window, "open").mockReturnValue(ventana)

    renderBoton({ enviarLink })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })
    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }))

    // Se abre sincronicamente, dentro del gesto del usuario.
    expect(abrir).toHaveBeenCalledWith("about:blank", "_blank")
    expect(enviarLink).toHaveBeenCalledTimes(1)
    expect(ventana.location.href).toBe("")

    await act(async () => {
      resolver?.(respuestaEnvio("WHATSAPP"))
    })

    await waitFor(() =>
      expect(ventana.location.href).toBe(
        `https://wa.me/${TELEFONO_DIGITOS}?text=${encodeURIComponent(TEXTO_WHATSAPP)}`
      )
    )
    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it("envia por email con el canal EMAIL", async () => {
    const { enviarLink } = renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Enviar por email" }))

    await waitFor(() =>
      expect(enviarLink).toHaveBeenCalledWith({
        enlaceId: "enlace_1",
        canal: "EMAIL",
        idioma: "es",
      })
    )
    expect(screen.getByRole("status")).toHaveTextContent("Email enviado.")
  })

  it("permite elegir ingles para el mensaje", async () => {
    const { enviarLink } = renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.selectOptions(screen.getByLabelText("Idioma del mensaje"), "en")
    await user.click(screen.getByRole("button", { name: "Enviar por email" }))

    await waitFor(() =>
      expect(enviarLink).toHaveBeenCalledWith(
        expect.objectContaining({ idioma: "en", canal: "EMAIL" })
      )
    )
  })

  it("deshabilita WhatsApp cuando el cliente no tiene telefono", async () => {
    renderBoton({ clienteTelefono: null })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    const whatsapp = screen.getByRole("button", { name: "Enviar por WhatsApp" })
    expect(whatsapp).toBeDisabled()
    expect(whatsapp).toHaveAttribute("title", "El cliente no tiene un teléfono cargado.")
  })

  it("no imprime el telefono del cliente en el DOM ni lo envia al servidor", async () => {
    // T-20 (privacidad, RNF-13): el modal no expone ni transmite PII del cliente.
    vi.spyOn(window, "open").mockImplementation(() => null)
    const { enviarLink } = renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })
    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }))

    await waitFor(() => expect(enviarLink).toHaveBeenCalledTimes(1))
    expect(document.body.innerHTML).not.toContain("1234-5678")
    expect(JSON.stringify(enviarLink.mock.calls)).not.toContain("1234-5678")
  })

  it("cae al fetch de /api/admin/paypal/enviar y muestra el error del servidor", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({
            error: "PayPal no disponible: configuracion incompleta o invalida.",
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ enviarLink: undefined })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Enviar por email" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PayPal no disponible: configuracion incompleta o invalida."
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/enviar",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("muestra un error de conexion si el envio no llega al servidor", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null)
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ enviarLink: undefined })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error de conexión. Reintentá."
    )
  })

  it("muestra carga al enviar por email y bloquea un segundo envio", async () => {
    let resolver: ((resultado: PaypalEnviarResult) => void) | undefined
    const enviarLink = vi.fn(
      () =>
        new Promise<PaypalEnviarResult>((resolve) => {
          resolver = resolve
        })
    )

    renderBoton({ enviarLink })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    await user.click(screen.getByRole("button", { name: "Enviar por email" }))

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "Enviar por email" })).toBeDisabled()

    await act(async () => {
      resolver?.(respuestaEnvio("EMAIL"))
    })

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Email enviado.")
    )
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false")
  })

  it("avisa con role=alert si el navegador no permite copiar", async () => {
    renderBoton()
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))
    await screen.findByRole("textbox", { name: "Link de pago" })

    // user-event instala su propio stub de clipboard: se reemplaza writeText
    // despues de abrir para simular el rechazo del navegador.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("No permitido"))

    await user.click(screen.getByRole("button", { name: "Copiar mensaje" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo copiar el mensaje. Copialo a mano."
    )
    expect(writeText).toHaveBeenCalledWith(TEXTO_COPIA)
  })
})

describe("PaypalLinkModal: errores, timeout y disponibilidad (AC-14, AC-16)", () => {
  it("muestra el estado de carga, deshabilita los inputs y resuelve al terminar", async () => {
    let resolver: ((enlace: PaypalEnlaceGenerado) => void) | undefined
    const generarLink = vi.fn(
      () =>
        new Promise<PaypalEnlaceGenerado>((resolve) => {
          resolver = resolve
        })
    )

    renderBoton({
      concepto: {
        tipo: "soporte",
        suscripcionId: "suscripcion_1",
        titulo: "Soporte",
      },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 2,
      generarLink,
    })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(
      screen.getByRole("button", { name: "Generando…" })
    ).toBeDisabled()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByLabelText("Monto acordado (USD)")).toBeDisabled()
    expect(screen.getByLabelText("Meses")).toBeDisabled()
    expect(screen.getByLabelText("Idioma del mensaje")).toBeDisabled()

    await act(async () => {
      resolver?.(
        enlaceGenerado({
          montoAcordado: 20000,
          comision: 1136,
          total: 21136,
          meses: 2,
        })
      )
    })

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Link de pago" })
      ).toBeInTheDocument()
    )
  })

  it("cae al fetch de /api/admin/paypal/link y muestra el error del servidor", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({
            error: "PayPal no disponible: configuracion incompleta o invalida.",
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ generarLink: undefined })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PayPal no disponible: configuracion incompleta o invalida."
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/link",
      expect.objectContaining({ method: "POST" })
    )
    expect(
      screen.queryByRole("textbox", { name: "Link de pago" })
    ).not.toBeInTheDocument()
  })

  it("corta por timeout un callback que nunca responde", async () => {
    const generarLink = vi.fn(
      () => new Promise<PaypalEnlaceGenerado>(() => {})
    )

    renderBoton({ generarLink, timeoutMs: 25 })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    const alerta = await screen.findByRole("alert", {}, { timeout: 2000 })
    expect(alerta).toHaveTextContent(
      "La operación tardó demasiado. Reintentá."
    )
    expect(screen.getByRole("button", { name: "Generar link" })).toBeEnabled()
  })

  it("detecta un abort por error.name (no instanceof Error)", async () => {
    const fetchMock = vi.fn(async () => {
      // Objeto plano: no es `instanceof Error`, pero tiene name AbortError.
      throw { name: "AbortError", message: "The operation was aborted." }
    })
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ generarLink: undefined, timeoutMs: 50 })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La operación tardó demasiado. Reintentá."
    )
  })

  it("cubre la lectura de res.json() con el timeout", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw { name: "AbortError", message: "body aborted" }
          },
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ generarLink: undefined, timeoutMs: 50 })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La operación tardó demasiado. Reintentá."
    )
  })

  it("aborta la peticion real al vencer el presupuesto", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          })
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ generarLink: undefined, timeoutMs: 25 })
    const { user } = await abrirModal()

    await user.click(screen.getByRole("button", { name: "Generar link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La operación tardó demasiado. Reintentá."
    )
    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal?.aborted).toBe(true)
  })

  it("no pisa el estado si la respuesta llega despues de cerrar", async () => {
    let resolver: ((enlace: PaypalEnlaceGenerado) => void) | undefined
    const generarLink = vi.fn(
      () =>
        new Promise<PaypalEnlaceGenerado>((resolve) => {
          resolver = resolve
        })
    )
    const props: PaypalLinkModalProps = {
      open: true,
      onClose: () => {},
      concepto: { tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" },
      montoAcordadoDefaultCents: 10050,
      ...BASE_PROPS,
      generarLink,
    }

    const { rerender } = render(<PaypalLinkModal {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Generar link" }))

    rerender(<PaypalLinkModal {...props} open={false} />)

    await act(async () => {
      resolver?.(enlaceGenerado())
    })

    rerender(<PaypalLinkModal {...props} open />)

    expect(
      screen.getByLabelText("Monto acordado (USD)")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "Link de pago" })
    ).not.toBeInTheDocument()
  })

  it("deshabilita el boton y explica el motivo cuando PayPal no esta disponible", async () => {
    renderBoton({ paypalDisponible: false })

    const trigger = screen.getByRole("button", { name: /Generar link PayPal/ })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute("title", MENSAJE_PAYPAL_NO_DISPONIBLE)
    expect(screen.getByText(MENSAJE_PAYPAL_NO_DISPONIBLE)).toHaveClass("sr-only")
  })

  it("no abre el modal ni intenta crear checkout si PayPal no esta disponible", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ paypalDisponible: false })

    const user = userEvent.setup()
    const trigger = screen.getByRole("button", { name: /Generar link PayPal/ })
    await user.click(trigger)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText(MENSAJE_PAYPAL_NO_DISPONIBLE)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("el modal abierto sin configuracion muestra el aviso y no ofrece generar", () => {
    renderModal({ paypalDisponible: false })

    expect(screen.getByRole("alert")).toHaveTextContent(
      MENSAJE_PAYPAL_NO_DISPONIBLE
    )
    expect(
      screen.queryByRole("button", { name: "Generar link" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument()
  })

  it("rechaza un monto invalido sin llamar a la API", async () => {
    const { generarLink } = renderBoton()
    const { user } = await abrirModal()

    const monto = screen.getByLabelText("Monto acordado (USD)")
    await user.clear(monto)

    expect(screen.getByRole("button", { name: "Generar link" })).toBeDisabled()

    await user.type(monto, "abc")

    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ingresá un monto válido en USD (por ejemplo 100,50)."
    )
    expect(generarLink).not.toHaveBeenCalled()
  })
})

describe("PaypalLinkModal: contrato client-safe y props (T-20, AC-16)", () => {
  function leerFuente(ruta: string): string {
    return readFileSync(join(process.cwd(), ruta), "utf8")
  }

  it("importa el gross-up desde fees-core sin node:crypto ni dependencias de servidor", () => {
    const modal = leerFuente("src/components/ui/paypal-link-modal.tsx")
    const feesCore = leerFuente("src/lib/paypal/fees-core.ts")

    // El modal calcula el preview con el modulo puro compartido.
    expect(modal).toMatch(
      /from\s+["']@\/lib\/paypal\/fees-core["']/
    )
    // Y no arrastra el barrel de servidor ni built-ins de Node al bundle cliente.
    expect(modal).not.toMatch(/from\s+["']@\/lib\/paypal\/fees["']/)
    expect(modal).not.toMatch(
      /(?:from\s+|require\s*\(\s*)["'](?:node:crypto|crypto)["']/
    )
    // `fees-core` no debe importar nada: es la garantia de que es client-safe.
    expect(feesCore).not.toMatch(/^\s*import\s/m)
    expect(feesCore).not.toMatch(
      /(?:from\s+|require\s*\(\s*)["'](?:node:crypto|crypto)["']/
    )
  })

  it("exige las props de configuracion y el concepto en el modal y el boton", () => {
    // Si alguna pasara a opcional, el tipo se vuelve `never` y `tsc` falla.
    const modal: {
      [K in
        | "open"
        | "onClose"
        | "concepto"
        | "montoAcordadoDefaultCents"
        | "feeBps"
        | "feeFixedCents"
        | "paypalDisponible"]: EsRequerida<PaypalLinkModalProps, K>
    } = {
      open: true,
      onClose: true,
      concepto: true,
      montoAcordadoDefaultCents: true,
      feeBps: true,
      feeFixedCents: true,
      paypalDisponible: true,
    }

    const boton: {
      [K in
        | "concepto"
        | "montoAcordadoDefaultCents"
        | "feeBps"
        | "feeFixedCents"
        | "paypalDisponible"]: EsRequerida<GenerarLinkPaypalButtonProps, K>
    } = {
      concepto: true,
      montoAcordadoDefaultCents: true,
      feeBps: true,
      feeFixedCents: true,
      paypalDisponible: true,
    }

    expect(Object.values(modal).every(Boolean)).toBe(true)
    expect(Object.values(boton).every(Boolean)).toBe(true)
  })
})
