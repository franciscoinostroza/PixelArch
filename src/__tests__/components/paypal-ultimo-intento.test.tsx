import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-22 (AC-4, AC-15, AC-23): el modal muestra el ultimo intento PayPal no
 * vigente y ofrece regenerar sin tocar el estado del cobro. La unica llamada
 * permitida es la de generacion del link (callback inyectado).
 */

import {
  PaypalLinkModal,
  type PaypalEnlaceExistente,
  type PaypalEnlaceGenerado,
  type PaypalUltimoIntento,
} from "@/components/ui/paypal-link-modal"

const BASE = {
  feeBps: 540,
  feeFixedCents: 30,
  paypalDisponible: true,
} as const

function enFuturo(dias = 20): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
}

function enFuturoPasado(dias = 5): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
}

function generado(): PaypalEnlaceGenerado {
  return {
    enlaceId: "enlace_nuevo",
    url: "https://pixelarch.dev/pago/paypal/nuevo",
    montoAcordado: 10050,
    comision: 606,
    total: 10656,
    moneda: "usd",
    expiraEn: enFuturo(),
    reutilizado: false,
  }
}

const VENCIDO: PaypalUltimoIntento = {
  enlaceId: "enlace_vencido",
  estado: "VENCIDO",
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  expiraEn: enFuturoPasado(5),
  creadoEn: enFuturoPasado(35),
  meses: null,
  idioma: "es",
  motivo: null,
}

const EXISTENTE: PaypalEnlaceExistente = {
  enlaceId: "enlace_vigente",
  url: "https://pixelarch.dev/pago/paypal/vigente",
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  expiraEn: enFuturo(10),
  meses: null,
  idioma: "es",
  reutilizado: true,
}

function renderModal(
  props: Partial<Parameters<typeof PaypalLinkModal>[0]> = {}
) {
  return render(
    <PaypalLinkModal
      open
      onClose={() => {}}
      concepto={{ tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" }}
      montoAcordadoDefaultCents={10050}
      {...BASE}
      {...props}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("PaypalLinkModal: ultimo intento y regeneracion (T-22)", () => {
  it("muestra el ultimo intento vencido y el aviso de cobro pendiente", () => {
    renderModal({ ultimoIntento: VENCIDO })

    expect(
      screen.getByText(/Último intento PayPal: Vencido/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/El cobro sigue pendiente\. Regenerá el link/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Regenerar link" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Generar link" })
    ).not.toBeInTheDocument()
  })

  it("muestra el motivo sanitizado de un intento fallido", () => {
    renderModal({
      ultimoIntento: {
        ...VENCIDO,
        estado: "FALLIDO",
        motivo: "PayPal no pudo crear el checkout.",
      },
    })

    expect(
      screen.getByText(/Último intento PayPal: Fallido/)
    ).toBeInTheDocument()
    expect(
      screen.getByText("PayPal no pudo crear el checkout.")
    ).toBeInTheDocument()
  })

  it("regenera con la misma llamada del modal, sin tocar el estado del cobro", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> => generado()
    )
    renderModal({ ultimoIntento: VENCIDO, generarLink })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith({
        hitoId: "hito_1",
        montoAcordadoCents: 10050,
        idioma: "es",
        regenerar: true,
      })
    )
    expect(generarLink).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole("textbox", { name: "Link de pago" })
    ).toHaveValue("https://pixelarch.dev/pago/paypal/nuevo")
    expect(screen.getByRole("status")).toHaveTextContent("Link regenerado.")
    // No hay llamadas a endpoints de pagos/cobros: solo se genero el link.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("precarga monto, meses e idioma del ultimo intento de soporte", async () => {
    const generarLink = vi.fn(
      async (): Promise<PaypalEnlaceGenerado> => generado()
    )
    renderModal({
      concepto: {
        tipo: "soporte",
        suscripcionId: "sop_1",
        titulo: "Soporte Web",
      },
      montoAcordadoDefaultCents: 10000,
      montoMensualCents: 10000,
      mesesDefault: 1,
      ultimoIntento: {
        ...VENCIDO,
        montoAcordado: 30000,
        comision: 1745,
        total: 31745,
        meses: 3,
        idioma: "en",
      },
      generarLink,
    })
    const user = userEvent.setup()

    expect(screen.getByLabelText("Meses")).toHaveValue("3")
    expect(screen.getByLabelText("Monto acordado (USD)")).toHaveValue("300,00")
    expect(screen.getByLabelText("Idioma del mensaje")).toHaveValue("en")

    await user.click(screen.getByRole("button", { name: "Regenerar link" }))

    await waitFor(() =>
      expect(generarLink).toHaveBeenCalledWith({
        suscripcionId: "sop_1",
        montoAcordadoCents: 30000,
        meses: 3,
        idioma: "en",
        regenerar: true,
      })
    )
  })

  it("con un link vigente prioriza reutilizarlo y no muestra el intento anterior", () => {
    renderModal({ enlaceExistente: EXISTENTE, ultimoIntento: VENCIDO })

    expect(
      screen.getByRole("textbox", { name: "Link de pago" })
    ).toHaveValue(EXISTENTE.url)
    expect(
      screen.queryByText(/Último intento PayPal:/)
    ).not.toBeInTheDocument()
  })

  it("no muestra el intento anterior si PayPal no esta disponible", () => {
    renderModal({ ultimoIntento: VENCIDO, paypalDisponible: false })

    expect(
      screen.getByRole("alert")
    ).toHaveTextContent("PayPal no disponible: configuración incompleta.")
    expect(
      screen.queryByText(/Último intento PayPal:/)
    ).not.toBeInTheDocument()
  })
})
