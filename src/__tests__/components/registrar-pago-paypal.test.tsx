import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-25 (AC-17, AC-23, AC-25): UI de registro manual PayPal.
 *
 * Cubre:
 * - visibilidad solo para admin (`puedeRegistrarManual`) y ocultamiento de los
 *   botones genericos de registro manual (MP/transferencia);
 * - teclado: foco inicial, trampa de foco, Escape y retorno del foco;
 * - seleccion hito/soporte, meses 1..12, desglose sin floats, fecha, flags y
 *   recibo;
 * - validacion (referencia, monto, evidencia y PII), errores `role=alert` y
 *   estado `aria-live`;
 * - payload exacto a `/api/admin/paypal/manual`, exito con recibo, duplicado,
 *   timeout y errores del servidor.
 *
 * No hay red: `fetch` y el callback `registrarPago` se mockean.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import {
  RegistrarPagoPaypalButton,
  RegistrarPagoPaypalModal,
  PaypalManualDuplicadoError,
  type PaypalManualConcepto,
  type RegistrarPagoPaypalRequest,
  type RegistrarPagoPaypalResult,
} from "@/components/ui/registrar-pago-paypal-button"
import { RegistrarPagoButton } from "@/components/ui/registrar-pago-button"
import { RegistrarPagoHitoButton } from "@/components/ui/registrar-pago-hito-button"

const CONCEPTO_HITO: PaypalManualConcepto = {
  tipo: "hito",
  hitoId: "hito_1",
  titulo: "Sitio ACME — Anticipo",
  montoAcordadoCents: 10050,
}

const CONCEPTO_SOPORTE: PaypalManualConcepto = {
  tipo: "soporte",
  suscripcionId: "suscripcion_1",
  titulo: "Soporte Web",
  montoAcordadoCents: 30000,
  montoMensualCents: 10000,
  mesesDefault: 3,
}

function renderBoton(
  overrides: {
    conceptos?: PaypalManualConcepto[]
    puedeRegistrarManual?: boolean
    registrarPago?: (
      input: RegistrarPagoPaypalRequest
    ) => Promise<RegistrarPagoPaypalResult>
    usarFetch?: boolean
    timeoutMs?: number
  } = {}
) {
  const registrarPago = vi.fn<
    (input: RegistrarPagoPaypalRequest) => Promise<RegistrarPagoPaypalResult>
  >(async () => ({
    ok: true,
    pagoId: "pago_1",
  }))

  const resultado = render(
    <RegistrarPagoPaypalButton
      conceptos={overrides.conceptos ?? [CONCEPTO_HITO]}
      feeBps={540}
      feeFixedCents={30}
      puedeRegistrarManual={overrides.puedeRegistrarManual ?? true}
      registrarPago={
        overrides.usarFetch
          ? undefined
          : (overrides.registrarPago ?? registrarPago)
      }
      timeoutMs={overrides.timeoutMs}
    />
  )

  return { ...resultado, registrarPago }
}

async function abrir() {
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", {
    name: "Registrar pago PayPal",
  })
  await user.click(trigger)
  const dialog = screen.getByRole("dialog", {
    name: "Registrar pago PayPal",
  })
  return { user, trigger, dialog }
}

async function completarReferenciasYEvidencia(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.type(screen.getByLabelText("Capture id"), "CAPTURE-1")
  await user.type(screen.getByLabelText("Order id"), "ORDER-1")
  await user.type(
    screen.getByLabelText("Evidencia (texto o URL)"),
    "Capture CAPTURE-1 / order ORDER-1 / comprobante recibido"
  )
}

function fechaLocalHoy(): string {
  const ahora = new Date()
  const anio = ahora.getFullYear()
  const mes = String(ahora.getMonth() + 1).padStart(2, "0")
  const dia = String(ahora.getDate()).padStart(2, "0")
  return `${anio}-${mes}-${dia}`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("RegistrarPagoPaypalButton: permisos (AC-17, AC-25)", () => {
  it("no renderiza nada para la asistente", () => {
    renderBoton({ puedeRegistrarManual: false })

    expect(
      screen.queryByRole("button", { name: "Registrar pago PayPal" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("muestra el disparador al admin", () => {
    renderBoton()

    expect(
      screen.getByRole("button", { name: "Registrar pago PayPal" })
    ).toBeInTheDocument()
  })

  it("no renderiza nada sin conceptos registrables", () => {
    renderBoton({ conceptos: [] })

    expect(
      screen.queryByRole("button", { name: "Registrar pago PayPal" })
    ).not.toBeInTheDocument()
  })

  it("oculta los botones genericos de registro manual cuando no es admin", () => {
    const { container: soporte } = render(
      <RegistrarPagoButton
        suscripcionId="suscripcion_1"
        servicio="Soporte Web"
        precioUsd={10000}
        precioArs={null}
        puedeRegistrar={false}
      />
    )
    const { container: hito } = render(
      <RegistrarPagoHitoButton
        hitoId="hito_1"
        hitoTitulo="Anticipo"
        proyectoTitulo="Sitio ACME"
        precioUsd={10050}
        precioArs={null}
        puedeRegistrar={false}
      />
    )

    expect(soporte).toBeEmptyDOMElement()
    expect(hito).toBeEmptyDOMElement()
  })
})

describe("RegistrarPagoPaypalModal: teclado y accesibilidad (AC-23)", () => {
  it("abre el dialogo, enfoca el modal y cierra con Escape devolviendo el foco", async () => {
    renderBoton()
    const { user, trigger, dialog } = await abrir()

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "true")

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

  it("anuncia el estado con aria-live y expone errores con role=alert", async () => {
    renderBoton()
    const { user, dialog } = await abrir()

    const estado = within(dialog).getByRole("status")
    expect(estado).toHaveAttribute("aria-live", "polite")

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Indicá el capture id y/o el order id de PayPal."
    )
    expect(screen.getByLabelText("Capture id")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("marca el monto invalido con aria-invalid y no llama a la API", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    const monto = within(dialog).getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "abc")

    expect(monto).toHaveAttribute("aria-invalid", "true")

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ingresá un monto válido en USD (por ejemplo 100,50)."
    )
    expect(registrarPago).not.toHaveBeenCalled()
  })

  it("bloquea la evidencia con datos personales del pagador", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(
      within(dialog).getByLabelText("Capture id"),
      "CAPTURE-1"
    )
    await user.type(
      within(dialog).getByLabelText("Evidencia (texto o URL)"),
      "Pago de juan@example.com"
    )

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La evidencia no puede contener datos personales del pagador."
    )
    expect(
      within(dialog).getByLabelText("Evidencia (texto o URL)")
    ).toHaveAttribute("aria-invalid", "true")
    expect(registrarPago).not.toHaveBeenCalled()
  })

  it("valida la longitud maxima de la referencia y de la evidencia (AC-25)", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    const capture = within(dialog).getByLabelText("Capture id")
    const evidencia = within(dialog).getByLabelText("Evidencia (texto o URL)")

    await user.type(capture, "X".repeat(129))
    await user.type(evidencia, "Comprobante recibido")
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La referencia de PayPal no puede superar 128 caracteres."
    )
    expect(capture).toHaveAttribute("aria-invalid", "true")
    expect(registrarPago).not.toHaveBeenCalled()

    fireEvent.change(capture, { target: { value: "CAPTURE-1" } })
    fireEvent.change(evidencia, { target: { value: "x".repeat(2_001) } })
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La evidencia es obligatoria (texto o URL, máximo 2000 caracteres)."
    )
    expect(evidencia).toHaveAttribute("aria-invalid", "true")
    expect(registrarPago).not.toHaveBeenCalled()
  })
})

describe("RegistrarPagoPaypalModal: formulario hito/soporte y dinero (AC-24, AC-25)", () => {
  it("ofrece hito y soporte y arranca con el desglose del hito", async () => {
    renderBoton({ conceptos: [CONCEPTO_HITO, CONCEPTO_SOPORTE] })
    const { dialog } = await abrir()

    const concepto = within(dialog).getByLabelText("Concepto")
    expect(concepto).toHaveValue("hito:hito_1")

    const opciones = Array.from(
      (concepto as HTMLSelectElement).options
    ).map((option) => option.textContent)
    expect(opciones).toEqual([
      "Hito · Sitio ACME — Anticipo",
      "Soporte · Soporte Web",
    ])

    expect(
      within(dialog).getByLabelText("Monto acordado (USD)")
    ).toHaveValue("100,50")
    expect(within(dialog).getByLabelText("Comisión (USD)")).toHaveValue(
      "6,06"
    )
    expect(within(dialog).getByLabelText("Total (USD)")).toHaveValue("106,56")
    expect(within(dialog).getByText(/US\$106,56/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText("Meses")).not.toBeInTheDocument()
    expect(
      within(dialog).getByLabelText("Marcar el hito como pagado")
    ).toBeChecked()
    expect(
      within(dialog).getByLabelText("Fecha de registro")
    ).toHaveAttribute("readonly")
    expect(
      within(dialog).getByText(/Se emite con los datos del cliente del CRM/)
    ).toBeInTheDocument()
  })

  it("recalcula la comision al editar el monto sin floats", async () => {
    renderBoton()
    const { user, dialog } = await abrir()

    const monto = within(dialog).getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "1000,50")

    expect(within(dialog).getByLabelText("Comisión (USD)")).toHaveValue(
      "57,43"
    )
    expect(within(dialog).getByLabelText("Total (USD)")).toHaveValue(
      "1057,93"
    )
  })

  it("cambia a soporte, recalcula por meses y muestra 1..12", async () => {
    renderBoton({ conceptos: [CONCEPTO_HITO, CONCEPTO_SOPORTE] })
    const { user, dialog } = await abrir()

    await user.selectOptions(
      within(dialog).getByLabelText("Concepto"),
      "soporte:suscripcion_1"
    )

    expect(
      within(dialog).getByLabelText("Monto acordado (USD)")
    ).toHaveValue("300,00")
    const meses = within(dialog).getByLabelText("Meses") as HTMLSelectElement
    expect(meses).toHaveValue("3")
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
    expect(
      within(dialog).getByLabelText("Acreditar los meses al soporte")
    ).toBeChecked()

    await user.selectOptions(meses, "2")

    expect(
      within(dialog).getByLabelText("Monto acordado (USD)")
    ).toHaveValue("200,00")
    expect(within(dialog).getByLabelText("Comisión (USD)")).toHaveValue(
      "11,74"
    )
    expect(within(dialog).getByLabelText("Total (USD)")).toHaveValue("211,74")
  })

  it("muestra la fecha de hoy como solo lectura y permite no acreditar meses (AC-23, AC-25)", async () => {
    const { registrarPago } = renderBoton({ conceptos: [CONCEPTO_SOPORTE] })
    const { user, dialog } = await abrir()

    const fecha = within(dialog).getByLabelText("Fecha de registro")
    expect(fecha).toHaveAttribute("readonly")
    expect(fecha).toHaveValue(fechaLocalHoy())

    await user.click(
      within(dialog).getByLabelText("Acreditar los meses al soporte")
    )
    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() =>
      expect(registrarPago).toHaveBeenCalledWith(
        expect.objectContaining({
          suscripcionId: "suscripcion_1",
          meses: 3,
          acreditarMeses: false,
        })
      )
    )
  })
})

describe("RegistrarPagoPaypalModal: envio del pago (AC-25)", () => {
  it("envia el hito con captura, order id, desglose y flag explicito", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByLabelText("Marcar el hito como pagado")
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() =>
      expect(registrarPago).toHaveBeenCalledWith({
        hitoId: "hito_1",
        montoAcordadoCents: 10050,
        comisionCents: 606,
        totalCents: 10656,
        externalId: "CAPTURE-1",
        paypalOrderId: "ORDER-1",
        evidencia: "Capture CAPTURE-1 / order ORDER-1 / comprobante recibido",
        marcarHitoPagado: false,
      })
    )
    // Un hito nunca envia meses ni el flag de soporte.
    expect(registrarPago.mock.calls[0][0]).not.toHaveProperty("meses")
    expect(registrarPago.mock.calls[0][0]).not.toHaveProperty("acreditarMeses")
  })

  it("envia el soporte con meses y el flag de acreditacion", async () => {
    const { registrarPago } = renderBoton({
      conceptos: [CONCEPTO_HITO, CONCEPTO_SOPORTE],
    })
    const { user, dialog } = await abrir()

    await user.selectOptions(
      within(dialog).getByLabelText("Concepto"),
      "soporte:suscripcion_1"
    )
    await user.selectOptions(within(dialog).getByLabelText("Meses"), "2")
    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() =>
      expect(registrarPago).toHaveBeenCalledWith({
        suscripcionId: "suscripcion_1",
        montoAcordadoCents: 20000,
        comisionCents: 1174,
        totalCents: 21174,
        externalId: "CAPTURE-1",
        paypalOrderId: "ORDER-1",
        evidencia: "Capture CAPTURE-1 / order ORDER-1 / comprobante recibido",
        meses: 2,
        acreditarMeses: true,
      })
    )
  })

  it("permite enviar el formulario con Enter desde un campo (AC-23)", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    const capture = within(dialog).getByLabelText("Capture id")
    capture.focus()
    await user.keyboard("{Enter}")

    await waitFor(() => expect(registrarPago).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Pago registrado")).toBeInTheDocument()
  })

  it("muestra el exito, refresca la pagina y enlaza el recibo", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() => expect(registrarPago).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Pago registrado")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Pago registrado.")
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    const recibo = screen.getByRole("link", { name: /ver recibo/i })
    expect(recibo).toHaveAttribute("href", "/admin/pagos/pago_1/recibo")
  })

  it("muestra duplicado y enlaza el pago existente", async () => {
    const registrarPago = vi
      .fn<() => Promise<RegistrarPagoPaypalResult>>()
      .mockRejectedValue(
        new PaypalManualDuplicadoError(
          "Ya existe un pago PayPal con la misma referencia.",
          "pago_existente"
        )
      )
    renderBoton({ registrarPago })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un pago PayPal con la misma referencia."
    )
    expect(
      screen.getByRole("link", { name: "Ver el pago existente" })
    ).toHaveAttribute("href", "/admin/pagos/pago_existente/recibo")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("mapea el 409 duplicado de la API y enlaza el pago existente (AC-25)", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            error: "Ya existe un pago PayPal con la misma referencia.",
            pagoId: "pago_existente",
            duplicado: true,
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un pago PayPal con la misma referencia."
    )
    expect(
      screen.getByRole("link", { name: "Ver el pago existente" })
    ).toHaveAttribute("href", "/admin/pagos/pago_existente/recibo")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("rechaza una respuesta 200 sin ok sin mostrar exito", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ pagoId: "pago_sin_ok" }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El servidor devolvió una respuesta inválida."
    )
    expect(screen.queryByText("Pago registrado")).not.toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("usa /api/admin/paypal/manual cuando no hay callback", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, pagoId: "pago_fetch" }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/manual",
      expect.objectContaining({ method: "POST" })
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1]?.body as string) ?? "{}"
    )
    expect(body).toEqual({
      hitoId: "hito_1",
      montoAcordadoCents: 10050,
      comisionCents: 606,
      totalCents: 10656,
      evidencia: "Capture CAPTURE-1 / order ORDER-1 / comprobante recibido",
      externalId: "CAPTURE-1",
      paypalOrderId: "ORDER-1",
      marcarHitoPagado: true,
    })
    expect(await screen.findByText("Pago registrado")).toBeInTheDocument()
  })

  it("muestra el error del servidor si la API rechaza el registro", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            error: "El hito ya tiene un pago exitoso registrado.",
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El hito ya tiene un pago exitoso registrado."
    )
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("corta por timeout y vuelve a habilitar el formulario", async () => {
    const registrarPago = vi.fn(
      () => new Promise<RegistrarPagoPaypalResult>(() => {})
    )
    renderBoton({ registrarPago, timeoutMs: 25 })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    const alerta = await screen.findByRole("alert", {}, { timeout: 2000 })
    expect(alerta).toHaveTextContent("La operación tardó demasiado. Reintentá.")
    expect(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    ).toBeEnabled()
    expect(dialog).toHaveAttribute("aria-busy", "false")
  })

  it("muestra aria-busy y bloquea un segundo envio mientras registra", async () => {
    let resolver:
      | ((resultado: RegistrarPagoPaypalResult) => void)
      | undefined
    const registrarPago = vi.fn(
      () =>
        new Promise<RegistrarPagoPaypalResult>((resolve) => {
          resolver = resolve
        })
    )
    renderBoton({ registrarPago })
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(dialog).toHaveAttribute("aria-busy", "true")
    expect(
      within(dialog).getByRole("button", { name: "Registrando…" })
    ).toBeDisabled()
    expect(
      within(dialog).getByLabelText("Capture id")
    ).toBeDisabled()

    await act(async () => {
      resolver?.({ ok: true, pagoId: "pago_1" })
    })

    expect(await screen.findByText("Pago registrado")).toBeInTheDocument()
  })
})

describe("RegistrarPagoPaypalModal: contenido y privacidad (AC-19, AC-23)", () => {
  it("no imprime ni envia datos del pagador mas alla de la evidencia", async () => {
    const { registrarPago } = renderBoton()
    const { user, dialog } = await abrir()

    await completarReferenciasYEvidencia(user)
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    await waitFor(() => expect(registrarPago).toHaveBeenCalledTimes(1))
    expect(document.body.innerHTML).not.toContain("pagador@example.com")
    expect(JSON.stringify(registrarPago.mock.calls)).not.toContain(
      "pagador@example.com"
    )
  })

  it("el modal directo sin permiso no renderiza el dialogo", () => {
    render(
      <RegistrarPagoPaypalModal
        open
        onClose={() => {}}
        conceptos={[CONCEPTO_HITO]}
        feeBps={540}
        feeFixedCents={30}
        puedeRegistrarManual={false}
      />
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
