import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

/**
 * T-24 (AC-10, AC-12, AC-19, AC-22): historial de pagos del detalle del
 * cliente con desglose PayPal, autor, envio, revision, ajustes y recibo.
 *
 * La consulta y la pagina se prueban con Prisma/Clerk mockeados. El historial
 * no incluye email, telefono ni datos del pagador; la asistente puede ver el
 * pago y abrir el recibo.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  clienteFindUnique: vi.fn(),
  servicioFindMany: vi.fn(),
  getDolar: vi.fn(),
  paypalConfig: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliente: { findUnique: mocks.clienteFindUnique },
    servicio: { findMany: mocks.servicioFindMany },
  },
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

// `redirect` de Next corta la ejecucion lanzando; replicarlo evita que la
// pagina continue tras redirigir en los tests de autorizacion.
mocks.redirect.mockImplementation((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: mocks.getDolar,
}))

vi.mock("@/lib/paypal/config", () => ({
  paypalConfig: mocks.paypalConfig,
}))

vi.mock("@/components/ui/deploy-config", () => ({ DeployConfig: () => null }))
vi.mock("@/components/ui/entregar-button", () => ({ EntregarButton: () => null }))
vi.mock("@/components/ui/subscription-actions", () => ({
  SubscriptionActions: () => null,
}))
vi.mock("@/components/ui/asignar-producto-button", () => ({
  AsignarProductoButton: () => null,
}))
vi.mock("@/components/ui/editar-cliente-button", () => ({
  EditarClienteButton: () => null,
}))
vi.mock("@/components/ui/nuevo-proyecto-button", () => ({
  NuevoProyectoButton: () => null,
}))
vi.mock("@/components/ui/proyecto-block", () => ({
  ProyectoBlock: () => null,
}))
vi.mock("@/components/ui/activar-soporte-button", () => ({
  ActivarSoporteButton: () => null,
}))
vi.mock("@/components/ui/registrar-pago-button", () => ({
  RegistrarPagoButton: () => null,
}))
vi.mock("@/components/ui/generar-link-mp-button", () => ({
  GenerarLinkMpButton: () => null,
}))
vi.mock("@/components/ui/generar-link-paypal-button", () => ({
  GenerarLinkPaypalButton: () => null,
}))
vi.mock("@/components/ui/ajustes-suscripcion-button", () => ({
  AjustesSuscripcionButton: () => null,
}))

vi.mock("@/components/ui/ajuste-paypal-button", () => ({
  AjustePaypalButton: (props: {
    pago: { id: string }
    puedeRegistrarAjuste: boolean
  }) =>
    props.puedeRegistrarAjuste ? (
      <button type="button" data-testid={`ajuste-${props.pago.id}`}>
        Ajuste PayPal
      </button>
    ) : null,
}))

import ClienteDetalle from "@/app/(admin)/admin/clientes/[id]/page"

const FECHA = new Date("2026-10-20T12:00:00.000Z")
const RECIBO = "PAY-20261020-ABCDEF123456"

const PAGO_PAYPAL = {
  id: "pago_paypal",
  clienteId: "cliente_1",
  pasarela: "PAYPAL",
  origen: "AUTOMATICO",
  metodo: "PAYPAL",
  estadoPago: "REVISION",
  revisionEstado: "PENDIENTE",
  monto: 10656,
  montoAcordado: 10050,
  comision: 606,
  montoEsperado: 10656,
  moneda: "usd",
  externalId: "CAPTURE-1",
  paypalOrderId: "ORDER-1",
  reciboId: RECIBO,
  reciboEmitidoEn: FECHA,
  creadoEn: FECHA,
  registradoPor: null,
  hitoId: "hito_1",
  suscripcionId: null,
  enlacePagoId: "enlace_1",
  hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
  suscripcion: null,
  enlacePago: {
    concepto: "Sitio ACME — Anticipo",
    descripcion: "Anticipo 50%",
    externalId: "ORDER-1",
    generadoPorNombre: "Ana Admin",
    enviadoPor: "ana",
    enviadoEn: FECHA,
    canalEnvio: "EMAIL",
    idioma: "es",
    eventos: [
      {
        id: "evento_reversed",
        tipo: "PAYMENT.CAPTURE.REVERSED",
        resultado: "REQUIERE_ACCION",
        motivo: null,
        monto: 10656,
        moneda: "usd",
        creadoEn: FECHA,
      },
    ],
  },
  ajustes: [
    {
      id: "ajuste_1",
      tipo: "REEMBOLSO",
      monto: 10656,
      decision: "NINGUNA",
      motivo: "Solicitado por el cliente",
      creadoEn: FECHA,
    },
  ],
  eventos: [],
  pagadorEmail: "pagador@example.com",
  pagadorNombre: "Pagador Oculto",
  telefono: "+54 9 11 0000-0000",
}

const PAGO_AJUSTABLE = {
  ...PAGO_PAYPAL,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  ajustes: [],
}

const PAGO_MP = {
  id: "pago_mp",
  clienteId: "cliente_1",
  pasarela: "MERCADOPAGO",
  origen: "AUTOMATICO",
  metodo: "MERCADOPAGO",
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  monto: 500000,
  montoAcordado: 500000,
  comision: 0,
  montoEsperado: 500000,
  moneda: "ars",
  externalId: "MP-123",
  paypalOrderId: null,
  reciboId: null,
  reciboEmitidoEn: null,
  creadoEn: FECHA,
  registradoPor: null,
  hitoId: null,
  suscripcionId: null,
  enlacePagoId: "enlace_mp",
  hito: null,
  suscripcion: { servicio: { nombre: "Soporte Web" } },
  enlacePago: {
    concepto: "Soporte octubre",
    descripcion: null,
    externalId: "PREF-1",
    generadoPorNombre: null,
    enviadoPor: null,
    enviadoEn: null,
    canalEnvio: null,
    idioma: null,
    eventos: [],
  },
  ajustes: [],
  eventos: [],
}

const FECHA_MANUAL = new Date("2026-10-18T15:30:00.000Z")
const FECHA_MANUAL_TEXTO = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
}).format(FECHA_MANUAL)

const PAGO_MANUAL = {
  id: "pago_manual",
  clienteId: "cliente_1",
  pasarela: "MANUAL",
  origen: "MANUAL",
  metodo: "TRANSFERENCIA",
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  monto: 500000,
  montoAcordado: 500000,
  comision: 0,
  montoEsperado: 500000,
  moneda: "ars",
  externalId: "TRANSFERENCIA-123",
  paypalOrderId: null,
  reciboId: null,
  reciboEmitidoEn: null,
  creadoEn: FECHA_MANUAL,
  registradoPor: "Maria Admin",
  hitoId: null,
  suscripcionId: null,
  enlacePagoId: null,
  hito: null,
  suscripcion: { servicio: { nombre: "Soporte Web" } },
  enlacePago: null,
  ajustes: [],
  eventos: [],
}

function clienteDemo() {
  return {
    id: "cliente_1",
    nombre: "Cliente Demo",
    email: "cliente@example.com",
    empresa: "Demo S.A.",
    telefono: "+54 9 11 1234-5678",
    notas: null,
    activo: true,
    creadoEn: new Date("2026-01-01T12:00:00.000Z"),
    suscripciones: [],
    proyectos: [],
    pagos: [PAGO_PAYPAL, PAGO_MP],
  }
}

function staff(esAdmin: boolean) {
  return {
    userId: "user_1",
    nombre: esAdmin ? "Admin" : "Asistente",
    rol: esAdmin ? "admin" : "asistente",
    esAdmin,
    cliente: null,
  }
}

async function renderPage() {
  return render(
    await ClienteDetalle({ params: Promise.resolve({ id: "cliente_1" }) })
  )
}

describe("Detalle del cliente: historial PayPal (T-24)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireStaff.mockResolvedValue(staff(false))
    mocks.clienteFindUnique.mockResolvedValue(clienteDemo())
    mocks.servicioFindMany.mockResolvedValue([])
    mocks.getDolar.mockResolvedValue(null)
    mocks.paypalConfig.mockReturnValue({
      disponible: true,
      motivo: null,
      env: "sandbox",
      baseUrl: "https://api-m.sandbox.paypal.com",
      clientId: "client",
      clientSecret: "secret",
      webhookId: "webhook",
      fee: { bps: 540, fixedCents: 30 },
    })
  })

  it("incluye enlace, ajustes y eventos en la consulta, sin cliente en pagos", async () => {
    await renderPage()

    const consulta = mocks.clienteFindUnique.mock.calls[0][0]
    const pagos = consulta.include.pagos.include

    expect(pagos.enlacePago.select.generadoPorNombre).toBe(true)
    expect(pagos.enlacePago.select.enviadoEn).toBe(true)
    expect(pagos.enlacePago.select.canalEnvio).toBe(true)
    expect(
      pagos.enlacePago.select.eventos.where
    ).toEqual({ requiereAccion: true })
    expect(pagos.ajustes.select.tipo).toBe(true)
    expect(pagos.eventos.where).toEqual({ requiereAccion: true })
    expect(pagos.cliente).toBeUndefined()
  })

  it("muestra desglose, autor, envio y recibo del pago PayPal", async () => {
    await renderPage()

    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("Acordado: US$100,50")).toBeInTheDocument()
    expect(screen.getByText("Comisión: US$6,06")).toBeInTheDocument()
    expect(screen.getByText("Total: US$106,56")).toBeInTheDocument()
    expect(screen.getByText("Generó: Ana Admin")).toBeInTheDocument()
    expect(screen.getByText(/Envío: .*Email/)).toBeInTheDocument()
    expect(screen.getByText("Idioma: Español")).toBeInTheDocument()

    const recibo = within(
      screen.getByTestId("pago-pago_paypal")
    ).getByRole("link", { name: /ver recibo/i })
    expect(recibo).toHaveAttribute("href", "/admin/pagos/pago_paypal/recibo")
  })

  it("muestra revisión, ajustes y eventos que requieren acción", async () => {
    await renderPage()

    expect(screen.getByText("En revisión")).toBeInTheDocument()
    expect(screen.getByText("Revisión: Pendiente")).toBeInTheDocument()
    expect(
      screen.getByText(/Reembolso US\$106,56 · sin cambio/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Requiere acción: Contracargo/)).toBeInTheDocument()
  })

  it("respeta a la asistente: puede ver el pago y abrir el recibo", async () => {
    await renderPage()

    expect(mocks.requireStaff).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Historial de pagos")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("pago-pago_paypal")).getByRole("link", {
        name: /ver recibo/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /nuevo proyecto/i })
    ).not.toBeInTheDocument()
  })

  it("no expone datos del pagador en el historial", async () => {
    await renderPage()

    expect(screen.queryByText("pagador@example.com")).not.toBeInTheDocument()
    expect(screen.queryByText("Pagador Oculto")).not.toBeInTheDocument()
    expect(screen.queryByText("+54 9 11 0000-0000")).not.toBeInTheDocument()
  })

  it("muestra el recibo de un pago de Mercado Pago elegible (AC-18, AC-19)", async () => {
    await renderPage()

    const filaMp = within(screen.getByTestId("pago-pago_mp"))
    expect(
      filaMp.getByRole("link", { name: /ver recibo/i })
    ).toHaveAttribute("href", "/admin/pagos/pago_mp/recibo")
    expect(filaMp.getByText("Mercado Pago")).toBeInTheDocument()

    // PayPal conserva su propio enlace.
    expect(
      within(screen.getByTestId("pago-pago_paypal")).getByRole("link", {
        name: /ver recibo/i,
      })
    ).toHaveAttribute("href", "/admin/pagos/pago_paypal/recibo")
    expect(
      screen.getAllByRole("link", { name: /ver recibo/i })
    ).toHaveLength(2)
  })

  it("mantiene visible un pago MP sin referencia externa y no le da recibo (AC-20)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [{ ...PAGO_MP, externalId: null }],
    })

    await renderPage()

    const fila = within(screen.getByTestId("pago-pago_mp"))
    expect(fila.getByText("Mercado Pago")).toBeInTheDocument()
    expect(fila.getByText("Total: $5.000 ARS")).toBeInTheDocument()
    expect(
      fila.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("muestra autor, fecha y canal de un pago manual sin enlace (AC-12)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [PAGO_MANUAL],
    })

    await renderPage()

    expect(screen.getByText("Registró: Maria Admin")).toBeInTheDocument()
    expect(screen.getByText("Envío: sin registro")).toBeInTheDocument()
    // Pasarela y origen se muestran ambos como "Manual" en la fila.
    expect(screen.getAllByText("Manual").length).toBeGreaterThan(0)
    expect(screen.getByText(FECHA_MANUAL_TEXTO)).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("no enlaza el recibo de un pago PayPal sin recibo emitido (AC-10, AC-12)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [
        {
          ...PAGO_PAYPAL,
          reciboId: null,
          reciboEmitidoEn: null,
        },
      ],
    })

    await renderPage()

    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("no enlaza el recibo de PayPal si falta la referencia externa (AC-10)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [
        {
          ...PAGO_PAYPAL,
          externalId: null,
          paypalOrderId: null,
          enlacePago: { ...PAGO_PAYPAL.enlacePago, externalId: null },
        },
      ],
    })

    await renderPage()

    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("no duplica un evento que aparece en el pago y en su enlace (AC-12)", async () => {
    const evento = PAGO_PAYPAL.enlacePago.eventos[0]
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [
        {
          ...PAGO_PAYPAL,
          eventos: [evento],
          enlacePago: { ...PAGO_PAYPAL.enlacePago, eventos: [evento] },
        },
      ],
    })

    await renderPage()

    expect(
      screen.getAllByText(/Requiere acción: Contracargo/)
    ).toHaveLength(1)
  })

  it("muestra el mismo historial al admin (AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(staff(true))

    await renderPage()

    expect(mocks.requireStaff).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("pago-pago_paypal")).getByRole("link", {
        name: /ver recibo/i,
      })
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("pago-pago_mp")).getByRole("link", {
        name: /ver recibo/i,
      })
    ).toBeInTheDocument()
  })

  it("muestra la accion de reembolso/contracargo solo al admin (T-26, AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(staff(true))
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [PAGO_AJUSTABLE],
    })

    await renderPage()

    expect(
      screen.getByRole("columnheader", { name: "Acciones" })
    ).toBeInTheDocument()
    expect(screen.getByTestId("ajuste-pago_paypal")).toBeInTheDocument()
  })

  it("no muestra la accion de ajuste a la asistente (T-26, AC-17)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({
      ...clienteDemo(),
      pagos: [PAGO_AJUSTABLE],
    })

    await renderPage()

    expect(
      screen.queryByRole("columnheader", { name: "Acciones" })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^ajuste-/)).not.toBeInTheDocument()
  })

  it("redirige al gate si no hay staff autenticado (AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")
    expect(mocks.clienteFindUnique).not.toHaveBeenCalled()
  })
})
