import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-26 (AC-17, AC-22, AC-23): UI de reembolso/contracargo PayPal.
 *
 * Cubre:
 * - visibilidad solo para admin y solo sobre pagos PayPal ajustables;
 * - teclado (foco inicial, trampa, Escape, retorno) y aviso de que el pago
 *   original se conserva;
 * - monto/motivo/evidencia, decision NINGUNA/REVERTIR_HITO/DESCONTAR_MESES y
 *   meses 1..12;
 * - confirmacion explicita antes de enviar, errores `role=alert`, exito
 *   `aria-live`, duplicado de estado, timeout y fallback a fetch;
 * - payload exacto a `/api/admin/paypal/ajustes` sin datos del pagador.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import {
  AjustePaypalButton,
  type AjustePaypalPago,
  type RegistrarAjustePaypalRequest,
  type RegistrarAjustePaypalResult,
} from "@/components/ui/ajuste-paypal-button"

const PAGO: AjustePaypalPago = {
  id: "pago_1",
  monto: 10656,
  moneda: "usd",
  montoAjustado: 0,
  tieneHito: true,
  tieneSoporte: false,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  concepto: "Sitio ACME — Anticipo",
  referencia: "Capture CAPTURE-1",
  pasarela: "PAYPAL",
}

const PAGO_SOPORTE: AjustePaypalPago = {
  id: "pago_soporte",
  monto: 10656,
  moneda: "usd",
  montoAjustado: 656,
  tieneHito: false,
  tieneSoporte: true,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  concepto: "Soporte Web",
  referencia: "Capture CAPTURE-2",
  pasarela: "PAYPAL",
}

function renderBoton(
  overrides: {
    pago?: AjustePaypalPago
    puedeRegistrarAjuste?: boolean
    registrarAjuste?: (
      input: RegistrarAjustePaypalRequest
    ) => Promise<RegistrarAjustePaypalResult>
    usarFetch?: boolean
    timeoutMs?: number
  } = {}
) {
  const registrarAjuste = vi.fn(
    async (): Promise<RegistrarAjustePaypalResult> => ({
      ok: true,
      ajusteId: "ajuste_1",
      pagoId: "pago_1",
      estadoPago: "REFUNDED",
      decision: "NINGUNA",
    })
  )

  const resultado = render(
    <AjustePaypalButton
      pago={overrides.pago ?? PAGO}
      puedeRegistrarAjuste={overrides.puedeRegistrarAjuste ?? true}
      registrarAjuste={
        overrides.usarFetch
          ? undefined
          : (overrides.registrarAjuste ?? registrarAjuste)
      }
      timeoutMs={overrides.timeoutMs}
    />
  )

  return { ...resultado, registrarAjuste }
}

async function abrir() {
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Ajuste PayPal" })
  await user.click(trigger)
  const dialog = screen.getByRole("dialog", {
    name: "Reembolso o contracargo",
  })
  return { user, trigger, dialog }
}

async function confirmarAjuste(
  user: ReturnType<typeof userEvent.setup>,
  tipo: "reembolso" | "contracargo" = "reembolso"
) {
  await user.click(screen.getByRole("button", { name: "Registrar ajuste" }))
  const confirmar = await screen.findByRole("button", {
    name: `Confirmar ${tipo}`,
  })
  await user.click(confirmar)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AjustePaypalButton: permisos y elegibilidad (AC-17, AC-22)", () => {
  it("no renderiza nada para la asistente", () => {
    renderBoton({ puedeRegistrarAjuste: false })

    expect(
      screen.queryByRole("button", { name: "Ajuste PayPal" })
    ).not.toBeInTheDocument()
  })

  it("muestra el disparador al admin sobre un pago ajustable", () => {
    renderBoton()

    expect(
      screen.getByRole("button", { name: "Ajuste PayPal" })
    ).toBeInTheDocument()
  })

  it("oculta el ajuste en pagos que no son PayPal", () => {
    renderBoton({ pago: { ...PAGO, pasarela: "MERCADOPAGO" } })

    expect(
      screen.queryByRole("button", { name: "Ajuste PayPal" })
    ).not.toBeInTheDocument()
  })

  it("oculta el ajuste si el pago no esta en un estado ajustable", () => {
    for (const pago of [
      { ...PAGO, estadoPago: "REFUNDED" },
      { ...PAGO, estadoPago: "SUCCEEDED", montoAjustado: 10656 },
      { ...PAGO, estadoPago: "REVISION", revisionEstado: "PENDIENTE" },
    ]) {
      const { unmount } = render(
        <AjustePaypalButton pago={pago} puedeRegistrarAjuste />
      )
      expect(
        screen.queryByRole("button", { name: "Ajuste PayPal" })
      ).not.toBeInTheDocument()
      unmount()
    }
  })

  it("ofrece el ajuste sobre un pago REVISION rechazado", () => {
    renderBoton({
      pago: { ...PAGO, estadoPago: "REVISION", revisionEstado: "RECHAZADO" },
    })

    expect(
      screen.getByRole("button", { name: "Ajuste PayPal" })
    ).toBeInTheDocument()
  })
})

describe("AjustePaypalModal: teclado y confirmacion (AC-22, AC-23)", () => {
  it("abre el dialogo, advierte que conserva el pago y cierra con Escape", async () => {
    renderBoton()
    const { user, trigger, dialog } = await abrir()

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveFocus()
    expect(
      within(dialog).getByText(/El pago original se conserva/)
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Sitio ACME — Anticipo · Capture CAPTURE-1/)
    ).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("atrapa el foco con Tab y Shift+Tab dentro del dialogo", async () => {
    renderBoton()
    const { user, dialog } = await abrir()

    for (let i = 0; i < 10; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    for (let i = 0; i < 5; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it("exige confirmacion explicita y permite volver sin registrar", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(
      within(dialog).getByLabelText("Motivo"),
      "Solicitado por el cliente"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )

    const confirmacion = await within(dialog).findByRole("alert")
    expect(confirmacion).toHaveTextContent(
      "¿Confirmás el reembolso por US$106,56?"
    )
    expect(
      within(dialog).getByRole("button", { name: "Confirmar reembolso" })
    ).toHaveFocus()
    expect(registrarAjuste).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Volver" }))

    expect(
      within(dialog).queryByRole("button", { name: "Confirmar reembolso" })
    ).not.toBeInTheDocument()
    expect(registrarAjuste).not.toHaveBeenCalled()
  })

  it("expone errores role=alert si falta motivo/evidencia", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Indicá al menos un motivo o una evidencia."
    )
    expect(
      within(dialog).getByLabelText("Motivo")
    ).toHaveAttribute("aria-invalid", "true")
    expect(registrarAjuste).not.toHaveBeenCalled()
  })

  it("rechaza un monto mayor al disponible", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    const monto = within(dialog).getByLabelText("Monto del ajuste (USD)")
    await user.clear(monto)
    await user.type(monto, "200,00")
    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso total")

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "El monto supera lo disponible del pago para ajustar."
    )
    expect(registrarAjuste).not.toHaveBeenCalled()
  })

  it("marca un monto invalido con aria-invalid y role=alert", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    const monto = within(dialog).getByLabelText("Monto del ajuste (USD)")
    await user.clear(monto)
    await user.type(monto, "abc")
    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Ingresá un monto válido en USD (por ejemplo 100,50)."
    )
    expect(monto).toHaveAttribute("aria-invalid", "true")
    expect(registrarAjuste).not.toHaveBeenCalled()
  })

  it("completa la confirmacion usando solo el teclado (AC-23)", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")

    const registrar = within(dialog).getByRole("button", {
      name: "Registrar ajuste",
    })
    registrar.focus()
    await user.keyboard("{Enter}")

    const confirmar = await within(dialog).findByRole("button", {
      name: "Confirmar reembolso",
    })
    expect(confirmar).toHaveFocus()
    await user.keyboard("{Enter}")

    await waitFor(() => expect(registrarAjuste).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Ajuste registrado")).toBeInTheDocument()
  })
})

describe("AjustePaypalModal: decisiones y payload (AC-22)", () => {
  it("registra un reembolso con decision NINGUNA sin tocar el hito", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(
      within(dialog).getByLabelText("Motivo"),
      "Solicitado por el cliente"
    )
    await user.type(
      within(dialog).getByLabelText("Evidencia"),
      "Refund PAYPAL-123"
    )
    await confirmarAjuste(user)

    await waitFor(() =>
      expect(registrarAjuste).toHaveBeenCalledWith({
        pagoId: "pago_1",
        tipo: "REEMBOLSO",
        montoCents: 10656,
        motivo: "Solicitado por el cliente",
        evidencia: "Refund PAYPAL-123",
        decision: "NINGUNA",
        mesesDescontados: null,
      })
    )
  })

  it("permite contracargo con REVERTIR_HITO y envia la decision", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.selectOptions(
      within(dialog).getByLabelText("Tipo de ajuste"),
      "CONTRACARGO"
    )
    await user.selectOptions(
      within(dialog).getByLabelText("Decisión"),
      "REVERTIR_HITO"
    )
    await user.type(within(dialog).getByLabelText("Motivo"), "Contracargo")
    await confirmarAjuste(user, "contracargo")

    await waitFor(() =>
      expect(registrarAjuste).toHaveBeenCalledWith(
        expect.objectContaining({
          pagoId: "pago_1",
          tipo: "CONTRACARGO",
          decision: "REVERTIR_HITO",
          mesesDescontados: null,
        })
      )
    )
  })

  it("descuenta meses en un soporte y permite elegir 1..12", async () => {
    const { registrarAjuste } = renderBoton({ pago: PAGO_SOPORTE })
    const { user, dialog } = await abrir()

    expect(
      within(dialog).getByLabelText("Monto del ajuste (USD)")
    ).toHaveValue("100,00")
    expect(
      within(dialog).getByText(/Disponible para ajustar: US\$100,00/)
    ).toBeInTheDocument()

    await user.selectOptions(
      within(dialog).getByLabelText("Decisión"),
      "DESCONTAR_MESES"
    )

    const meses = within(dialog).getByLabelText(
      "Meses a descontar"
    ) as HTMLSelectElement
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

    await user.selectOptions(meses, "3")
    await user.type(
      within(dialog).getByLabelText("Motivo"),
      "Contracargo de 3 meses"
    )
    await confirmarAjuste(user)

    await waitFor(() =>
      expect(registrarAjuste).toHaveBeenCalledWith(
        expect.objectContaining({
          pagoId: "pago_soporte",
          decision: "DESCONTAR_MESES",
          mesesDescontados: 3,
        })
      )
    )
  })

  it("deshabilita las decisiones incompatibles con el concepto", async () => {
    renderBoton()
    const { dialog } = await abrir()

    const decision = within(dialog).getByLabelText(
      "Decisión"
    ) as HTMLSelectElement
    const opciones = Array.from(decision.options)
    expect(
      opciones.find((option) => option.value === "REVERTIR_HITO")?.disabled
    ).toBe(false)
    expect(
      opciones.find((option) => option.value === "DESCONTAR_MESES")?.disabled
    ).toBe(true)
  })

  it("muestra el exito con el estado resultante y refresca la pagina", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await confirmarAjuste(user)

    await waitFor(() => expect(registrarAjuste).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Ajuste registrado")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Ajuste registrado.")
    expect(screen.getByText("El pago quedó como Reembolsado.")).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("muestra el error del servidor sin refrescar", async () => {
    const registrarAjuste = vi
      .fn<() => Promise<RegistrarAjustePaypalResult>>()
      .mockRejectedValue(
        new Error("El pago no esta en un estado ajustable para reembolso o contracargo.")
      )
    renderBoton({ registrarAjuste })
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await confirmarAjuste(user)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El pago no esta en un estado ajustable para reembolso o contracargo."
    )
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("usa /api/admin/paypal/ajustes cuando no hay callback", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            ajusteId: "ajuste_fetch",
            pagoId: "pago_1",
            estadoPago: "REFUNDED",
            decision: "NINGUNA",
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await confirmarAjuste(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/ajustes",
      expect.objectContaining({ method: "POST" })
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1]?.body as string) ?? "{}"
    )
    expect(body).toEqual({
      pagoId: "pago_1",
      tipo: "REEMBOLSO",
      montoCents: 10656,
      motivo: "Reembolso",
      evidencia: null,
      decision: "NINGUNA",
      mesesDescontados: null,
    })
    expect(await screen.findByText("Ajuste registrado")).toBeInTheDocument()
  })

  it("corta por timeout y vuelve a habilitar la confirmacion", async () => {
    const registrarAjuste = vi.fn(
      () => new Promise<RegistrarAjustePaypalResult>(() => {})
    )
    renderBoton({ registrarAjuste, timeoutMs: 25 })
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )
    await user.click(
      await within(dialog).findByRole("button", {
        name: "Confirmar reembolso",
      })
    )

    const alerta = await screen.findByText(
      "La operación tardó demasiado. Reintentá.",
      {},
      { timeout: 2000 }
    )
    expect(alerta).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    ).toBeEnabled()
  })

  it("no expone datos del pagador en el DOM ni en el payload", async () => {
    const { registrarAjuste } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Motivo"), "Reembolso")
    await confirmarAjuste(user)

    await waitFor(() => expect(registrarAjuste).toHaveBeenCalledTimes(1))
    expect(document.body.innerHTML).not.toContain("pagador@example.com")
    expect(JSON.stringify(registrarAjuste.mock.calls)).not.toContain(
      "pagador@example.com"
    )
  })
})
